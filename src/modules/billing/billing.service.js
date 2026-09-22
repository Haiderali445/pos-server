const mongoose = require("mongoose");
const Bill = require("../../core/models/Bill");
const Item = require("../../core/models/Item");
const Account = require("../../core/models/Account");
const AccountTransaction = require("../../core/models/AccountTransaction");
const StockMovement = require("../../core/models/StockMovement");
const ProductPriceAudit = require("../../core/models/ProductPriceAudit");
const Charge = require("../../core/models/Charge");
const Tenant = require("../../core/models/Tenant");
const { unitOfWork } = require("../../core/database/unitOfWork");
const { appEvents } = require("../../core/events/eventEmitter");
const { EVENT_TYPES } = require("../../core/events/eventTypes");
const { NotFoundError, BadRequestError, ConflictError } = require("../../core/errors/AppError");
const TaxStrategyFactory = require("../../strategies/tax/TaxStrategyFactory");
const ReceiptStrategyFactory = require("../../strategies/receipts/ReceiptStrategyFactory");

class BillingService {
  async getBills({
    tenantId = "default-store",
    search = "",
    paymentMethod = "",
    invoiceType = "",
    startDate = "",
    endDate = "",
  } = {}) {
    const query = { tenantId, status: { $ne: "voided" } };

    if (invoiceType && invoiceType !== "all") {
      query.invoiceType = invoiceType;
    }

    if (paymentMethod && paymentMethod !== "all") {
      query.paymentMethod = paymentMethod.toLowerCase();
    }

    if (startDate || endDate) {
      query.date = {};
      if (startDate) {
        query.date.$gte = new Date(startDate);
      }
      if (endDate) {
        const e = new Date(endDate);
        e.setHours(23, 59, 59, 999);
        query.date.$lte = e;
      }
    }

    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), "i");
      query.$or = [
        { invoiceNumber: regex },
        { costumerName: regex },
        { costumerNumber: regex },
        { _id: regex.test(search.trim()) ? search.trim() : undefined },
      ].filter(Boolean);
    }

    return Bill.find(query)
      .populate("accountId", "name accountCode accountType phone currentBalance")
      .sort({ date: -1, createdAt: -1 });
  }

  async getBillById(id, tenantId = "default-store") {
    const bill = await Bill.findOne({ _id: id, tenantId }).populate(
      "accountId",
      "name accountCode accountType phone currentBalance"
    );
    if (!bill) {
      throw new NotFoundError("Invoice not found");
    }
    return bill;
  }

  /**
   * Universal Invoice Creation:
   * Supports both Sales Checkout (with FIFO stock batch consumption & Customer Khata debt update)
   * and Purchase Invoices (with new StockBatch creation, currentStock increment, ProductPriceAudit, & Supplier Khata).
   */
  async createBill(data, { tenantId = "default-store", operatorId = "system" } = {}) {
    const {
      cartItems,
      paidAmount,
      paymentMethod,
      costumerName,
      costumerNumber,
      invoiceType = "Sale",
      accountId,
      fare = 0,
      totalDiscount = 0,
    } = data;

    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      throw new BadRequestError("Cart items array cannot be empty for checkout");
    }

    if (paidAmount === undefined || paidAmount === null) {
      throw new BadRequestError("Paid amount is required");
    }

    const tenant = (await Tenant.findOne({ tenantId })) || { taxStrategy: "zero", taxRate: 0 };
    const taxStrategy = TaxStrategyFactory.getStrategy(tenant.taxStrategy || "zero");

    const rawSubtotal = cartItems.reduce((sum, item) => {
      const price = Number(item.unitPrice !== undefined ? item.unitPrice : item.salePrice || item.price || 0);
      const qty = Number(item.quantity || 1);
      return sum + price * qty;
    }, 0);

    const discountedSubtotal = Math.max(0, rawSubtotal - Number(totalDiscount || 0));

    const taxCalculation =
      invoiceType === "Sale"
        ? taxStrategy.calculateTax(discountedSubtotal, cartItems, tenant.taxRate || 0)
        : { taxAmount: 0, total: discountedSubtotal };

    const expectedTotal = Number((taxCalculation.total + Number(fare || 0)).toFixed(2));

    // Ensure tax and fare are always added to the final total
    const finalTotal =
      data.totalAmount !== undefined && Math.abs(Number(data.totalAmount) - expectedTotal) <= 0.05
        ? Number(data.totalAmount)
        : expectedTotal;

    const createdBill = await unitOfWork.runInTransaction(async (session, context) => {
      const billId = new mongoose.Types.ObjectId();
      const enrichedCartItems = [];
      let linkedAccountId = accountId || null;

      const grandTotal = finalTotal;
      const numPaid = Number(paidAmount || 0);
      const unpaidAmount = Math.max(0, Number((grandTotal - numPaid).toFixed(2)));

      // =========================================================================
      // SCENARIO 1: SALE CHECKOUT (FIFO Batch Consumption & Khata Integration)
      // =========================================================================
      if (invoiceType === "Sale") {
        for (const cartItem of cartItems) {
          const productId = cartItem._id || cartItem.productId;
          if (!productId) {
            enrichedCartItems.push(cartItem);
            continue;
          }

          const product = await Item.findOne({ _id: productId, tenantId }).session(session);
          if (!product) {
            throw new NotFoundError(`Product not found: ${cartItem.name || productId}`);
          }

          const qtyNeeded = Number(cartItem.quantity || 1);
          if (product.stock < qtyNeeded) {
            throw new ConflictError(
              `Insufficient stock for '${product.name}'. Available: ${product.stock}, requested: ${qtyNeeded}`
            );
          }

          const previousStock = product.stock;
          // Consume stock using FIFO algorithm across batches
          const fifoResult = product.consumeFIFO(qtyNeeded);
          await product.save({ session });

          // Low stock alert hook
          if (product.stock <= (product.reorderLevel || 5)) {
            context.onCommit(() => {
              appEvents.emitEvent(EVENT_TYPES.STOCK_LOW, {
                productId: product._id,
                productName: product.name,
                currentStock: product.stock,
                tenantId,
              });
            });
          }

          const saleRate = Number(
            cartItem.unitPrice !== undefined ? cartItem.unitPrice : cartItem.salePrice || cartItem.price || product.salePrice
          );
          const itemDiscount = Number(cartItem.unitDiscount || 0);
          const totalItemRevenue = qtyNeeded * saleRate - itemDiscount;
          const totalProfit = Number((totalItemRevenue - fifoResult.totalCost).toFixed(2));
          const unitProfit = Number((totalProfit / qtyNeeded).toFixed(2));
          const marginPct = saleRate > 0 ? Number((((saleRate - fifoResult.unitCost) / saleRate) * 100).toFixed(2)) : 0;

          // Record StockMovement audit trail for consumed batches
          for (const alloc of fifoResult.allocations) {
            await StockMovement.recordMovement(
              {
                tenantId,
                productId: product._id,
                movementType: "Sale",
                changeQty: -Number(alloc.quantity),
                previousStock: previousStock,
                newStock: product.stock,
                unitCost: alloc.unitCost,
                unitPrice: saleRate,
                batchId: alloc.batchId,
                batchCode: alloc.batchCode,
                referenceId: billId,
                referenceType: "Bill",
                accountId: linkedAccountId,
                reason: `Sale checkout to ${costumerName || "Walk-in"}`,
                performedBy: operatorId,
              },
              { session }
            );
          }

          enrichedCartItems.push({
            ...cartItem,
            productId: product._id,
            name: product.name,
            sku: product.sku || "",
            barcode: product.barcode || "",
            category: product.category || "General",
            quantity: qtyNeeded,
            unitPrice: saleRate,
            salePrice: saleRate,
            unitCost: fifoResult.unitCost,
            purchasePrice: fifoResult.unitCost,
            unitDiscount: itemDiscount,
            subtotal: Number((qtyNeeded * saleRate - itemDiscount).toFixed(2)),
            unitProfit,
            totalProfit,
            profitMarginPercentage: marginPct,
            batchAllocations: fifoResult.allocations,
          });
        }

        // Customer Khata / Balance Integration for Credit / Borrow
        const isBorrow =
          paymentMethod === "borrow" ||
          paymentMethod === "credit" ||
          unpaidAmount > 0;

        if (!linkedAccountId && (costumerNumber && costumerNumber.trim())) {
          const existingAcc = await Account.findOne({
            phone: costumerNumber.trim(),
            tenantId,
            accountType: "Customer",
          }).session(session);
          if (existingAcc) {
            linkedAccountId = existingAcc._id;
          }
        }

        // Auto-create customer Khata account if none exists, name is supplied, and there is credit/borrow
        if (!linkedAccountId && isBorrow && costumerName && costumerName.trim()) {
          const count = await Account.countDocuments({ tenantId, accountType: "Customer" }).session(session);
          const [newAcc] = await Account.create(
            [
              {
                accountCode: `CUST-${String(count + 1).padStart(4, "0")}`,
                name: costumerName.trim(),
                phone: costumerNumber ? costumerNumber.trim() : "",
                accountType: "Customer",
                currentBalance: 0,
                tenantId,
              },
            ],
            { session }
          );
          linkedAccountId = newAcc._id;
        }

        // Atomically update customer currentBalance if on credit/borrow or unpaidAmount > 0
        let updatedCustomer = null;
        if (linkedAccountId && isBorrow) {
          const creditDelta = unpaidAmount > 0 ? unpaidAmount : grandTotal;
          updatedCustomer = await Account.findOneAndUpdate(
            { _id: linkedAccountId, tenantId },
            { $inc: { currentBalance: creditDelta } },
            { new: true, session }
          );
        }
      }

      // =========================================================================
      // SCENARIO 2: PURCHASE INVOICE (Batch Generation, Stock Increment, Price Audit)
      // =========================================================================
      else if (invoiceType === "Purchase") {
        for (const cartItem of cartItems) {
          const productId = cartItem._id || cartItem.productId;
          if (!productId) continue;

          const product = await Item.findOne({ _id: productId, tenantId }).session(session);
          if (!product) {
            throw new NotFoundError(`Product not found for purchase: ${cartItem.name || productId}`);
          }

          const oldPurchaseCost = Number(product.purchasePrice || 0);
          const qty = Number(cartItem.quantity || 1);
          const unitCost = Number(
            cartItem.unitCost !== undefined ? cartItem.unitCost : cartItem.purchasePrice || 0
          );
          const previousStock = product.stock;

          // 1. Add new StockBatch to the item
          const newBatch = product.addBatch({
            batchCode:
              cartItem.batchCode ||
              `BATCH-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`,
            qty,
            unitCost,
            supplierId: linkedAccountId,
            expiryDate: cartItem.expiryDate || null,
            receivedDate: data.date ? new Date(data.date) : new Date(),
          });

          // 2. Log ProductPriceAudit if unit purchase cost changed
          if (oldPurchaseCost !== unitCost) {
            await ProductPriceAudit.recordAudit(
              {
                productId: product._id,
                productName: product.name,
                oldPrice: oldPurchaseCost,
                newPrice: unitCost,
                priceType: "purchasePrice",
                changeReason: `Purchase Invoice: ${data.invoiceNumber || "New Purchase"}`,
                batchCode: newBatch.batchCode,
                referenceId: billId,
                referenceType: "Bill",
                changedBy: operatorId,
                tenantId,
              },
              { session }
            );
          }

          await product.save({ session });

          // 3. Record StockMovement
          await StockMovement.recordMovement(
            {
              tenantId,
              productId: product._id,
              movementType: "Purchase",
              changeQty: qty,
              previousStock,
              newStock: product.stock,
              unitCost,
              unitPrice: Number(cartItem.salePrice || product.salePrice || 0),
              batchId: newBatch._id,
              batchCode: newBatch.batchCode,
              referenceId: billId,
              referenceType: "Bill",
              accountId: linkedAccountId,
              reason: `Purchase receipt from supplier`,
              performedBy: operatorId,
            },
            { session }
          );

          enrichedCartItems.push({
            ...cartItem,
            productId: product._id,
            name: product.name,
            sku: product.sku || "",
            barcode: product.barcode || "",
            category: product.category || "General",
            quantity: qty,
            unitPrice: unitCost,
            unitCost,
            subtotal: Number((qty * unitCost).toFixed(2)),
            unitProfit: 0,
            totalProfit: 0,
            profitMarginPercentage: 0,
            batchAllocations: [
              {
                batchId: newBatch._id,
                batchCode: newBatch.batchCode,
                quantity: qty,
                unitCost,
              },
            ],
          });
        }

        // Supplier Khata / Balance Integration (Payable Increase on Supplier Purchase)
        // Increase supplier's payable balance: $inc: { currentBalance: grandTotal }
        if (linkedAccountId) {
          await Account.findOneAndUpdate(
            { _id: linkedAccountId, tenantId },
            { $inc: { currentBalance: grandTotal } },
            { session }
          );

          // If paidAmount tendered at GRN receipt, adjust balance down
          if (numPaid > 0) {
            await Account.findOneAndUpdate(
              { _id: linkedAccountId, tenantId },
              { $inc: { currentBalance: -numPaid } },
              { session }
            );
          }
        }
      }

      // Determine payment status
      const paymentStatus =
        unpaidAmount <= 0
          ? "paid"
          : numPaid > 0
          ? "partial"
          : "unpaid";

      // Create the Invoice / Bill record
      const [bill] = await Bill.create(
        [
          {
            _id: billId,
            invoiceNumber: data.invoiceNumber || undefined,
            invoiceType,
            accountId: linkedAccountId,
            costumerName: costumerName ? costumerName.trim() : "",
            costumerNumber: costumerNumber ? costumerNumber.trim() : "",
            fare: Number(fare || 0),
            totalDiscount: Number(totalDiscount || 0),
            subtotal: Number(rawSubtotal.toFixed(2)),
            taxAmount: taxCalculation.taxAmount,
            totalAmount: grandTotal,
            paidAmount: numPaid,
            dueAmount: unpaidAmount,
            paymentMethod: paymentMethod || "cash",
            paymentStatus,
            cartItems: enrichedCartItems.length > 0 ? enrichedCartItems : cartItems,
            date: data.date ? new Date(data.date) : new Date(),
            tenantId,
            operatorId,
            status: "completed",
          },
        ],
        { session }
      );

      // =========================================================================
      // FINANCIAL LEDGER SYNCHRONIZATION: AccountTransaction entries
      // =========================================================================
      if (invoiceType === "Sale" && linkedAccountId) {
        const isCreditSale =
          paymentMethod === "borrow" ||
          paymentMethod === "credit" ||
          unpaidAmount > 0;

        if (isCreditSale) {
          const creditAmount = unpaidAmount > 0 ? unpaidAmount : grandTotal;
          const currentAcc = await Account.findOne({ _id: linkedAccountId, tenantId }).session(session);

          await AccountTransaction.create(
            [
              {
                tenantId,
                accountId: linkedAccountId,
                transactionType: "Credit",
                amount: creditAmount,
                debit: creditAmount,
                credit: 0,
                balanceAfter: currentAcc ? currentAcc.currentBalance : 0,
                reference_table: "Invoices",
                reference_id: bill._id,
                invoiceNumber: bill.invoiceNumber,
                paymentMethod: paymentMethod || "credit",
                description: `Credit Sale Invoice #${bill.invoiceNumber}`,
                notes: `Unpaid customer balance: PKR ${creditAmount.toFixed(2)}`,
                date: bill.date || new Date(),
                operatorId,
              },
            ],
            { session }
          );
        }
      } else if (invoiceType === "Purchase" && linkedAccountId) {
        const currentSupp = await Account.findOne({ _id: linkedAccountId, tenantId }).session(session);

        // 1. Log supplier bill payable liability
        await AccountTransaction.create(
          [
            {
              tenantId,
              accountId: linkedAccountId,
              transactionType: "Purchase",
              amount: grandTotal,
              debit: 0,
              credit: grandTotal,
              balanceAfter: currentSupp ? currentSupp.currentBalance : 0,
              reference_table: "Invoices",
              reference_id: bill._id,
              invoiceNumber: bill.invoiceNumber,
              paymentMethod: paymentMethod || "credit",
              description: `Supplier Bill Payable #${bill.invoiceNumber}`,
              notes: `Supplier bill payable: PKR ${grandTotal.toFixed(2)}`,
              date: bill.date || new Date(),
              operatorId,
            },
          ],
          { session }
        );

        // 2. If immediate payment tendered, log the payment transaction
        if (numPaid > 0) {
          await AccountTransaction.create(
            [
              {
                tenantId,
                accountId: linkedAccountId,
                transactionType: "Payment",
                amount: numPaid,
                debit: numPaid,
                credit: 0,
                balanceAfter: currentSupp ? currentSupp.currentBalance : 0,
                reference_table: "Invoices",
                reference_id: bill._id,
                invoiceNumber: bill.invoiceNumber,
                paymentMethod: paymentMethod || "cash",
                description: `Payment against Supplier Bill #${bill.invoiceNumber}`,
                notes: `Paid at GRN receipt: PKR ${numPaid.toFixed(2)}`,
                date: bill.date || new Date(),
                operatorId,
              },
            ],
            { session }
          );
        }
      }

      context.onCommit(() => {
        const eventType =
          invoiceType === "Purchase" ? EVENT_TYPES.PURCHASE_COMPLETED || "purchase.completed" : EVENT_TYPES.SALE_COMPLETED;

        appEvents.emitEvent(eventType, {
          invoiceId: bill._id,
          invoiceNumber: bill.invoiceNumber,
          totalAmount: bill.totalAmount,
          tenantId,
          operatorId,
        });
      });

      return bill;
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
    if (data.fare !== undefined) bill.fare = Number(data.fare);
    if (data.totalDiscount !== undefined) bill.totalDiscount = Number(data.totalDiscount);

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
      // 1. Reverse stock adjustments
      for (const item of bill.cartItems || []) {
        const productId = item.productId || item._id;
        if (!productId) continue;

        const product = await Item.findOne({ _id: productId, tenantId }).session(session);
        if (!product) continue;

        const previousStock = product.stock;
        const qty = Number(item.quantity || 1);

        if (bill.invoiceType === "Sale") {
          // Restore stock back into product
          product.stock = Number((product.stock + qty).toFixed(3));

          // Restore batch availableQty if allocations were recorded
          if (Array.isArray(item.batchAllocations) && item.batchAllocations.length > 0) {
            for (const alloc of item.batchAllocations) {
              if (alloc.batchId) {
                const batch = product.batches.id(alloc.batchId);
                if (batch) {
                  batch.availableQty = Number((batch.availableQty + Number(alloc.quantity || 0)).toFixed(3));
                }
              }
            }
          }

          await product.save({ session });

          // Record void audit movement
          await StockMovement.recordMovement(
            {
              tenantId,
              productId: product._id,
              movementType: "Void",
              changeQty: qty,
              previousStock,
              newStock: product.stock,
              unitCost: Number(item.unitCost || 0),
              unitPrice: Number(item.unitPrice || 0),
              referenceId: bill._id,
              referenceType: "Bill",
              accountId: bill.accountId,
              reason: `Void invoice reversal - ${bill.invoiceNumber || bill._id}`,
              performedBy: operatorId,
            },
            { session }
          );
        } else if (bill.invoiceType === "Purchase") {
          // Deduct previously purchased stock
          if (product.stock >= qty) {
            product.stock = Number((product.stock - qty).toFixed(3));
            await product.save({ session });
          }

          await StockMovement.recordMovement(
            {
              tenantId,
              productId: product._id,
              movementType: "Void",
              changeQty: -qty,
              previousStock,
              newStock: product.stock,
              unitCost: Number(item.unitCost || 0),
              unitPrice: Number(item.unitPrice || 0),
              referenceId: bill._id,
              referenceType: "Bill",
              accountId: bill.accountId,
              reason: `Void purchase reversal - ${bill.invoiceNumber || bill._id}`,
              performedBy: operatorId,
            },
            { session }
          );
        }
      }

      // 2. Reverse Customer / Supplier Khata open balance if invoice was on credit
      if (bill.accountId) {
        if (bill.invoiceType === "Sale" && bill.dueAmount > 0) {
          const revAccount = await Account.findOneAndUpdate(
            { _id: bill.accountId, tenantId },
            { $inc: { currentBalance: -bill.dueAmount } },
            { new: true, session }
          );
          if (revAccount) {
            await AccountTransaction.create(
              [
                {
                  tenantId,
                  accountId: bill.accountId,
                  transactionType: "Void",
                  amount: bill.dueAmount,
                  debit: 0,
                  credit: bill.dueAmount,
                  balanceAfter: revAccount.currentBalance,
                  reference_table: "Invoices",
                  reference_id: bill._id,
                  invoiceNumber: bill.invoiceNumber,
                  description: `Void reversal for Invoice #${bill.invoiceNumber}`,
                  notes: `Reversed open debt: PKR ${bill.dueAmount.toFixed(2)}`,
                  date: new Date(),
                  operatorId,
                },
              ],
              { session }
            );
          }
        } else if (bill.invoiceType === "Purchase") {
          const revAmt = bill.dueAmount > 0 ? bill.dueAmount : bill.totalAmount;
          const revAccount = await Account.findOneAndUpdate(
            { _id: bill.accountId, tenantId },
            { $inc: { currentBalance: -revAmt } },
            { new: true, session }
          );
          if (revAccount) {
            await AccountTransaction.create(
              [
                {
                  tenantId,
                  accountId: bill.accountId,
                  transactionType: "Void",
                  amount: revAmt,
                  debit: revAmt,
                  credit: 0,
                  balanceAfter: revAccount.currentBalance,
                  reference_table: "Invoices",
                  reference_id: bill._id,
                  invoiceNumber: bill.invoiceNumber,
                  description: `Void reversal for Purchase Bill #${bill.invoiceNumber}`,
                  notes: `Reversed supplier payable: PKR ${revAmt.toFixed(2)}`,
                  date: new Date(),
                  operatorId,
                },
              ],
              { session }
            );
          }
        }
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
        const productId = item.productId || item._id;
        if (!productId) continue;

        await Item.findOneAndUpdate(
          { _id: productId, tenantId },
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

  /**
   * Financial Intelligence: Profit & Loss Statement (Equivalent to sp_GetProfitLoss)
   * Calculates Gross Sales, Exact FIFO COGS from consumed batches, Operating Expenses, and Net Profit.
   */
  async getProfitLoss({ tenantId = "default-store", startDate, endDate } = {}) {
    const start = startDate ? new Date(startDate) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const end = endDate ? new Date(endDate) : new Date();
    end.setHours(23, 59, 59, 999);

    // 1. Fetch completed sales invoices for the period
    const salesInvoices = await Bill.find({
      tenantId,
      invoiceType: "Sale",
      status: { $ne: "voided" },
      isDeleted: { $ne: true },
      date: { $gte: start, $lte: end },
    }).lean();

    let grossSales = 0;
    let totalDiscounts = 0;
    let totalFreight = 0;
    let totalCOGS = 0;
    let totalUnitsSold = 0;
    const productStats = {};

    for (const inv of salesInvoices) {
      grossSales += Number(inv.totalAmount || 0);
      totalDiscounts += Number(inv.totalDiscount || 0);
      totalFreight += Number(inv.fare || 0);

      for (const item of inv.cartItems || []) {
        const qty = Number(item.quantity || 1);
        const unitCost = Number(item.unitCost || item.purchasePrice || 0);
        const unitPrice = Number(item.unitPrice || item.salePrice || 0);

        const lineCOGS = (Array.isArray(item.batchAllocations) && item.batchAllocations.length > 0)
          ? Number(item.batchAllocations.reduce((sum, a) => sum + (Number(a.unitCost || 0) * Number(a.quantity || 0)), 0).toFixed(2))
          : Number((unitCost * qty).toFixed(2));
        const lineRevenue = Number((unitPrice * qty).toFixed(2));
        const lineProfit = Number((lineRevenue - lineCOGS).toFixed(2));

        totalCOGS += lineCOGS;
        totalUnitsSold += qty;

        const prodKey = String(item.productId || item.name);
        if (!productStats[prodKey]) {
          productStats[prodKey] = {
            productId: item.productId,
            name: item.name,
            unitsSold: 0,
            revenue: 0,
            cogs: 0,
            profit: 0,
          };
        }
        productStats[prodKey].unitsSold += qty;
        productStats[prodKey].revenue = Number((productStats[prodKey].revenue + lineRevenue).toFixed(2));
        productStats[prodKey].cogs = Number((productStats[prodKey].cogs + lineCOGS).toFixed(2));
        productStats[prodKey].profit = Number((productStats[prodKey].profit + lineProfit).toFixed(2));
      }
    }

    grossSales = Number(grossSales.toFixed(2));
    totalCOGS = Number(totalCOGS.toFixed(2));
    totalDiscounts = Number(totalDiscounts.toFixed(2));
    totalFreight = Number(totalFreight.toFixed(2));

    const grossProfit = Number((grossSales - totalCOGS).toFixed(2));
    const grossMarginPercentage =
      grossSales > 0 ? Number(((grossProfit / grossSales) * 100).toFixed(2)) : 0;

    // 2. Fetch Operating Expenses from Charges
    const charges = await Charge.find({
      tenantId,
      date: { $gte: start, $lte: end },
      isDeleted: { $ne: true },
    }).lean();

    let totalOperatingExpenses = 0;
    const expensesByCategory = {};

    for (const ch of charges) {
      const amt = Number(ch.amount || 0);
      totalOperatingExpenses += amt;
      const cat = ch.category || "general";
      expensesByCategory[cat] = Number(((expensesByCategory[cat] || 0) + amt).toFixed(2));
    }

    totalOperatingExpenses = Number(totalOperatingExpenses.toFixed(2));
    const netProfit = Number((grossProfit - totalOperatingExpenses).toFixed(2));
    const netMarginPercentage =
      grossSales > 0 ? Number(((netProfit / grossSales) * 100).toFixed(2)) : 0;

    // Sort top products by profit
    const topProducts = Object.values(productStats)
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 10);

    return {
      period: {
        startDate: start,
        endDate: end,
      },
      summary: {
        grossSales,
        totalDiscounts,
        totalFreight,
        cogs: totalCOGS,
        grossProfit,
        grossMarginPercentage,
        totalOperatingExpenses,
        netProfit,
        netMarginPercentage,
        totalInvoices: salesInvoices.length,
        totalUnitsSold: Number(totalUnitsSold.toFixed(3)),
      },
      expensesByCategory,
      topProducts,
    };
  }
}

module.exports = BillingService;