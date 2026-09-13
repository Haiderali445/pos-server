const Bill = require("../../core/models/Bill");
const Item = require("../../core/models/Item");
const Tenant = require("../../core/models/Tenant");
const { unitOfWork } = require("../../core/database/unitOfWork");
const { appEvents } = require("../../core/events/eventEmitter");
const { EVENT_TYPES } = require("../../core/events/eventTypes");
const { NotFoundError, BadRequestError, ConflictError } = require("../../core/errors/AppError");
const TaxStrategyFactory = require("../../strategies/tax/TaxStrategyFactory");
const ReceiptStrategyFactory = require("../../strategies/receipts/ReceiptStrategyFactory");

class BillingService {
  async getBills({ tenantId = "default-store", search = "", paymentMethod = "" } = {}) {
    const query = { tenantId, status: { $ne: "voided" } };

    if (paymentMethod && paymentMethod !== "all") {
      query.paymentMethod = paymentMethod.toLowerCase();
    }

    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), "i");
      query.$or = [{ costumerName: regex }, { costumerNumber: regex }, { _id: regex.test(search.trim()) ? search.trim() : undefined }].filter(Boolean);
    }

    return Bill.find(query).sort({ date: -1, createdAt: -1 });
  }

  async getBillById(id, tenantId = "default-store") {
    const bill = await Bill.findOne({ _id: id, tenantId });
    if (!bill) {
      throw new NotFoundError("Invoice not found");
    }
    return bill;
  }

  async createBill(data, { tenantId = "default-store", operatorId = "system" } = {}) {
    const { cartItems, paidAmount, paymentMethod, costumerName, costumerNumber } = data;

    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      throw new BadRequestError("Cart items array cannot be empty for checkout");
    }

    if (paidAmount === undefined || paidAmount === null) {
      throw new BadRequestError("Paid amount is required");
    }

    const tenant = (await Tenant.findOne({ tenantId })) || { taxStrategy: "zero", taxRate: 0 };
    const taxStrategy = TaxStrategyFactory.getStrategy(tenant.taxStrategy || "zero");

    const rawSubtotal = cartItems.reduce((sum, item) => {
      const price = Number(item.salePrice || item.price || 0);
      const qty = Number(item.quantity || 1);
      return sum + price * qty;
    }, 0);

    const taxCalculation = taxStrategy.calculateTax(rawSubtotal, cartItems, tenant.taxRate || 0);
    const finalTotal = data.totalAmount !== undefined ? Number(data.totalAmount) : taxCalculation.total;

    const createdBill = await unitOfWork.runInTransaction(async (session) => {
      for (const cartItem of cartItems) {
        if (!cartItem._id) continue;

        const product = await Item.findOne({ _id: cartItem._id, tenantId }).session(session);
        if (product) {
          const qtyNeeded = Number(cartItem.quantity || 1);
          if (product.stock < qtyNeeded) {
            throw new ConflictError(
              `Insufficient stock for '${product.name}'. Available: ${product.stock}, requested: ${qtyNeeded}`
            );
          }

          product.stock -= qtyNeeded;
          await product.save({ session });

          if (product.stock <= (product.reorderLevel || 5)) {
            appEvents.emitEvent(EVENT_TYPES.STOCK_LOW, {
              productId: product._id,
              productName: product.name,
              currentStock: product.stock,
              tenantId,
            });
          }
        }
      }

      const [bill] = await Bill.create(
        [
          {
            costumerName: costumerName ? costumerName.trim() : "",
            costumerNumber: costumerNumber ? costumerNumber.trim() : "",
            subtotal: Number(rawSubtotal.toFixed(2)),
            taxAmount: taxCalculation.taxAmount,
            totalAmount: finalTotal,
            paidAmount: Number(paidAmount),
            paymentMethod: paymentMethod || "cash",
            cartItems,
            date: data.date ? new Date(data.date) : new Date(),
            tenantId,
            operatorId,
            status: "completed",
          },
        ],
        { session }
      );

      return bill;
    });

    appEvents.emitEvent(EVENT_TYPES.SALE_COMPLETED, {
      invoiceId: createdBill._id,
      totalAmount: createdBill.totalAmount,
      tenantId,
      operatorId,
    });

    return createdBill;
  }

  async editBill(data, tenantId = "default-store") {
    const id = data._id || data.billId;
    if (!id) {
      throw new BadRequestError("Invoice ID is required for updating");
    }

    const bill = await Bill.findOne({ _id: id, tenantId });
    if (!bill) {
      throw new NotFoundError("Invoice not found");
    }

    if (data.costumerName !== undefined) bill.costumerName = data.costumerName.trim();
    if (data.costumerNumber !== undefined) bill.costumerNumber = data.costumerNumber.trim();
    if (data.paymentMethod) bill.paymentMethod = data.paymentMethod;
    if (data.paidAmount !== undefined) bill.paidAmount = Number(data.paidAmount);
    if (data.totalAmount !== undefined) bill.totalAmount = Number(data.totalAmount);

    await bill.save();
    return bill;
  }

  async voidBill(id, tenantId = "default-store", operatorId = "system") {
    if (!id) {
      throw new BadRequestError("Invoice ID is required to void");
    }

    const bill = await Bill.findOne({ _id: id, tenantId });
    if (!bill) {
      throw new NotFoundError("Invoice not found");
    }

    if (bill.status === "voided") {
      throw new ConflictError("Invoice is already voided");
    }

    const voidedBill = await unitOfWork.runInTransaction(async (session) => {
      for (const item of bill.cartItems || []) {
        if (!item._id) continue;
        await Item.findOneAndUpdate(
          { _id: item._id, tenantId },
          { $inc: { stock: Number(item.quantity || 1) } },
          { session }
        );
      }

      bill.status = "voided";
      await bill.softDelete(operatorId);
      return bill;
    });

    appEvents.emitEvent(EVENT_TYPES.SALE_VOIDED, {
      invoiceId: voidedBill._id,
      tenantId,
      operatorId,
    });

    return { message: "Invoice voided and inventory stock restored", bill: voidedBill };
  }

  async restoreBill(id, tenantId = "default-store") {
    if (!id) {
      throw new BadRequestError("Invoice ID is required to restore");
    }

    const bill = await Bill.findOne({ _id: id, tenantId }, null, { withDeleted: true });
    if (!bill) {
      throw new NotFoundError("Invoice not found");
    }

    const restoredBill = await unitOfWork.runInTransaction(async (session) => {
      for (const item of bill.cartItems || []) {
        if (!item._id) continue;
        await Item.findOneAndUpdate(
          { _id: item._id, tenantId },
          { $inc: { stock: -Number(item.quantity || 1) } },
          { session }
        );
      }

      bill.status = "completed";
      if (typeof bill.restore === "function") {
        await bill.restore();
      } else {
        bill.isDeleted = false;
        bill.deletedAt = null;
        bill.deletedBy = null;
        await bill.save({ session });
      }

      return bill;
    });

    return { message: "Invoice restored successfully", bill: restoredBill };
  }

  async deleteBill(id, tenantId = "default-store") {
    if (!id) {
      throw new BadRequestError("Invoice ID is required to delete");
    }

    const bill = await Bill.findOne({ _id: id, tenantId });
    if (!bill) {
      throw new NotFoundError("Invoice not found");
    }

    await Bill.deleteOne({ _id: id, tenantId });
    return { message: "Invoice record deleted successfully", id };
  }

  async getFormattedReceipt(id, tenantId = "default-store") {
    const bill = await this.getBillById(id, tenantId);
    const tenant = (await Tenant.findOne({ tenantId })) || {};
    const formatter = ReceiptStrategyFactory.getStrategy(tenant.receiptTemplate || "thermal80mm");
    return formatter.formatReceipt(bill, tenant);
  }

  async getVoidedBills(tenantId = "default-store") {
    return Bill.find({ tenantId, status: "voided" }, null, { withDeleted: true })
      .populate("deletedBy", "name email username")
      .sort({ deletedAt: -1, createdAt: -1 });
  }
}

module.exports = BillingService;