const mongoose = require("mongoose");
const Bill = require("../../core/models/Bill");
const Item = require("../../core/models/Item");
const Account = require("../../core/models/Account");
const AccountTransaction = require("../../core/models/AccountTransaction");
const BillAdjustment = require("../../core/models/BillAdjustment");
const GoodsReceipt = require("../../core/models/GoodsReceipt");
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

const roundMoney = (value) => Number(Number(value || 0).toFixed(2));

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
    if (invoiceType === "Purchase" && !accountId) {
      throw new BadRequestError("A supplier account is required for a purchase invoice");
    }

    const tenant = (await Tenant.findOne({ tenantId })) || { taxStrategy: "zero", taxRate: 0 };
    const taxStrategy = TaxStrategyFactory.getStrategy(tenant.taxStrategy || "zero");

    const rawSubtotal = roundMoney(cartItems.reduce((sum, item) => {
      const price = invoiceType === "Purchase"
        ? Number(item.unitCost !== undefined ? item.unitCost : item.purchasePrice || item.unitPrice || 0)
        : Number(item.unitPrice !== undefined ? item.unitPrice : item.salePrice || item.price || 0);
      const qty = Number(item.quantity || 1);
      const lineDiscount = Number(item.unitDiscount || 0);
      return sum + Math.max(0, roundMoney(price * qty - lineDiscount));
    }, 0));

    const discountedSubtotal = roundMoney(Math.max(0, rawSubtotal - Number(totalDiscount || 0)));

    const taxCalculation =
      invoiceType === "Sale"
        ? taxStrategy.calculateTax(discountedSubtotal, cartItems, tenant.taxRate || 0)
        : { taxAmount: 0, total: discountedSubtotal };

    const expectedTotal = roundMoney(Number(taxCalculation.total) + Number(fare || 0));
    const finalTotal = expectedTotal;

    const createdBill = await unitOfWork.runInTransaction(async (session, context) => {
      const billId = new mongoose.Types.ObjectId();
      const enrichedCartItems = [];
      let linkedAccountId = accountId || null;

      const grandTotal = finalTotal;
      const numPaid = roundMoney(paidAmount);
      const unpaidAmount = Math.max(0, roundMoney(grandTotal - numPaid));

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
          const totalItemRevenue = roundMoney(qtyNeeded * saleRate - itemDiscount);
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
            subtotal: totalItemRevenue,
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
            { $inc: { currentBalance: roundMoney(creditDelta) } },
            { new: true, session }
          );
        }
      }

      // =========================================================================
      // SCENARIO 2: PURCHASE INVOICE (supplier balance only; stock is posted by a GRN)
      // =========================================================================
      else if (invoiceType === "Purchase") {
        const supplier = await Account.findOne({ _id: linkedAccountId, tenantId }).session(session);
        if (!supplier || supplier.accountType !== "Supplier") {
          throw new BadRequestError("Select a valid supplier account for this purchase invoice");
        }
        if (data.invoiceNumber) {
          const duplicateInvoice = await Bill.findOne({
            tenantId,
            accountId: linkedAccountId,
            invoiceType: "Purchase",
            invoiceNumber: String(data.invoiceNumber).trim().toUpperCase(),
            status: { $ne: "voided" },
          }).session(session);
          if (duplicateInvoice) {
            throw new ConflictError("This supplier invoice number is already recorded");
          }
        }

        for (const cartItem of cartItems) {
          const productId = cartItem._id || cartItem.productId;
          const product = productId
            ? await Item.findOne({ _id: productId, tenantId }).session(session)
            : null;
          if (productId && !product) {
            throw new NotFoundError(`Product not found for purchase: ${cartItem.name || productId}`);
          }

          const qty = Number(cartItem.quantity || 1);
          const unitCost = Number(
            cartItem.unitCost !== undefined ? cartItem.unitCost : cartItem.purchasePrice || 0
          );

          enrichedCartItems.push({
            ...cartItem,
            productId: product?._id || productId || null,
            name: product?.name || cartItem.name,
            sku: product?.sku || cartItem.sku || "",
            barcode: product?.barcode || cartItem.barcode || "",
            category: product?.category || cartItem.category || "General",
            quantity: qty,
            unitPrice: unitCost,
            unitCost,
            subtotal: roundMoney(qty * unitCost),
            unitProfit: 0,
            totalProfit: 0,
            profitMarginPercentage: 0,
            batchAllocations: [],
          });
        }

        // Supplier Khata / Balance Integration (Payable Increase on Supplier Purchase)
        // Increase supplier's payable balance: $inc: { currentBalance: grandTotal }
        if (linkedAccountId) {
          await Account.findOneAndUpdate(
            { _id: linkedAccountId, tenantId },
            { $inc: { currentBalance: roundMoney(grandTotal) } },
            { session }
          );

          // If paidAmount tendered at GRN receipt, adjust balance down
          if (numPaid > 0) {
            await Account.findOneAndUpdate(
              { _id: linkedAccountId, tenantId },
              { $inc: { currentBalance: -roundMoney(numPaid) } },
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
            subtotal: rawSubtotal,
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

  async createAdjustment(billId, data, { tenantId = "default-store", operatorId = "system" } = {}) {
    if (!billId) {
      throw new BadRequestError("Original invoice ID is required for an adjustment");
    }
    if (!data.reason || !String(data.reason).trim()) {
      throw new BadRequestError("An adjustment reason is required");
    }
    if (!Array.isArray(data.items) || data.items.length === 0) {
      throw new BadRequestError("Add at least one returned or replacement item");
    }

    return unitOfWork.runInTransaction(async (session) => {
      const bill = await Bill.findOne({ _id: billId, tenantId }).session(session);
      if (!bill || !["Sale", "Purchase"].includes(bill.invoiceType)) {
        throw new NotFoundError("Sale or purchase invoice not found");
      }
      if (bill.status !== "completed") {
        throw new ConflictError("Only completed invoices can be adjusted");
      }

      const priorAdjustments = await BillAdjustment.find({
        originalBillId: bill._id,
        tenantId,
      }).session(session);
      const returnedBySource = new Map();
      for (const adjustment of priorAdjustments) {
        for (const line of adjustment.items) {
          if (line.action === "return" && line.sourceItemIndex !== null) {
            const key = String(line.sourceItemIndex);
            returnedBySource.set(key, (returnedBySource.get(key) || 0) + Number(line.quantity || 0));
          }
        }
      }
      (bill.cartItems || []).forEach((line, index) => {
        returnedBySource.set(
          String(index),
          Math.max(
            returnedBySource.get(String(index)) || 0,
            Number(line.adjustedReturnQuantity || 0)
          )
        );
      });

      const adjustmentId = new mongoose.Types.ObjectId();
      const preparedLines = [];
      let returnedAmount = 0;
      let replacementAmount = 0;
      const originalRawSubtotal = roundMoney((bill.cartItems || []).reduce((sum, line) => {
        const qty = Number(line.quantity || 0);
        const price = Number(line.unitPrice || line.salePrice || line.unitCost || 0);
        return sum + Math.max(0, price * qty - Number(line.unitDiscount || 0));
      }, 0));
      const discountedSubtotal = Math.max(
        0,
        roundMoney(originalRawSubtotal - Number(bill.totalDiscount || 0))
      );
      const globalDiscountFactor = originalRawSubtotal > 0
        ? discountedSubtotal / originalRawSubtotal
        : 1;

      for (const entry of data.items) {
        const action = entry.action;
        const quantity = Number(entry.quantity);
        if (!["return", "replacement"].includes(action) || !Number.isFinite(quantity) || quantity <= 0) {
          throw new BadRequestError("Each adjustment line needs an action and a quantity greater than zero");
        }

        let product;
        let sourceItemIndex = null;
        let condition = "resellable";
        let unitPrice;
        let unitCost;
        let lineAmount;
        let totalCost;

        if (action === "return") {
          sourceItemIndex = Number(entry.sourceItemIndex);
          const source = Number.isInteger(sourceItemIndex) ? bill.cartItems[sourceItemIndex] : null;
          if (!source) {
            throw new BadRequestError("Returned items must be selected from the original invoice");
          }
          const productId = source.productId || source._id;
          product = await Item.findOne({ _id: productId, tenantId }).session(session);
          if (!product) {
            throw new NotFoundError(`Returned product not found: ${source.name}`);
          }

          const sourceQty = Number(source.quantity || 0);
          const previouslyReturned = returnedBySource.get(String(sourceItemIndex)) || 0;
          if (previouslyReturned + quantity - sourceQty > 0.0005) {
            throw new BadRequestError(
              `Return quantity for '${source.name}' exceeds the ${Math.max(0, sourceQty - previouslyReturned)} remaining`
            );
          }
          returnedBySource.set(String(sourceItemIndex), previouslyReturned + quantity);
          bill.cartItems[sourceItemIndex].adjustedReturnQuantity = Number(
            (previouslyReturned + quantity).toFixed(3)
          );

          const originalUnitPrice = Number(source.unitPrice || source.salePrice || source.unitCost || 0);
          const originalLineAmount = Math.max(
            0,
            originalUnitPrice * sourceQty - Number(source.unitDiscount || 0)
          );
          const discountedLineAmount = originalLineAmount * globalDiscountFactor;
          const allocatedTax = bill.invoiceType === "Sale" && discountedSubtotal > 0
            ? Number(bill.taxAmount || 0) * discountedLineAmount / discountedSubtotal
            : 0;
          const fullReturnAmount = roundMoney(discountedLineAmount + allocatedTax);
          const returnedBefore = previouslyReturned / (sourceQty || 1);
          const returnedAfter = (previouslyReturned + quantity) / (sourceQty || 1);
          lineAmount = roundMoney(fullReturnAmount * returnedAfter) -
            roundMoney(fullReturnAmount * returnedBefore);

          const originalLineCost = Array.isArray(source.batchAllocations) && source.batchAllocations.length > 0
            ? source.batchAllocations.reduce(
              (sum, allocation) =>
                sum + Number(allocation.unitCost || 0) * Number(allocation.quantity || 0),
              0
            )
            : Number(source.unitCost || source.purchasePrice || 0) * sourceQty;
          const costBefore = roundMoney(originalLineCost * returnedBefore);
          const costAfter = roundMoney(originalLineCost * returnedAfter);
          totalCost = Math.max(0, roundMoney(costAfter - costBefore));
          unitCost = quantity > 0 ? roundMoney(totalCost / quantity) : 0;
          unitPrice = quantity > 0 ? Number((lineAmount / quantity).toFixed(4)) : 0;
          condition = bill.invoiceType === "Sale"
            ? entry.condition === "damaged" ? "damaged" : "resellable"
            : "resellable";
        } else {
          if (!entry.productId) {
            throw new BadRequestError("Replacement items must be selected from the product catalog");
          }
          product = await Item.findOne({ _id: entry.productId, tenantId }).session(session);
          if (!product) {
            throw new NotFoundError("Replacement product not found");
          }
          unitPrice = bill.invoiceType === "Sale"
            ? roundMoney(product.salePrice)
            : roundMoney(product.purchasePrice);
          unitCost = roundMoney(product.purchasePrice);
          totalCost = roundMoney(unitCost * quantity);
          lineAmount = roundMoney(unitPrice * quantity);
          if (bill.invoiceType === "Sale" && discountedSubtotal > 0) {
            lineAmount = roundMoney(
              lineAmount * (1 + Number(bill.taxAmount || 0) / discountedSubtotal)
            );
          }
        }

        if (action === "return") returnedAmount = roundMoney(returnedAmount + lineAmount);
        else replacementAmount = roundMoney(replacementAmount + lineAmount);

        const previousStock = product.stock;
        if (bill.invoiceType === "Sale" && action === "return" && condition === "resellable") {
          const batch = product.addBatch({
            batchCode: `RETURN-${adjustmentId.toString().slice(-8)}`,
            qty: quantity,
            unitCost,
            supplierId: bill.accountId,
            purchaseInvoiceId: bill._id,
            receivedDate: data.date ? new Date(data.date) : new Date(),
          });
          await product.save({ session });
          await StockMovement.recordMovement(
            {
              tenantId,
              productId: product._id,
              movementType: "Return",
              changeQty: quantity,
              previousStock,
              newStock: product.stock,
              unitCost,
              unitPrice,
              batchId: batch._id,
              batchCode: batch.batchCode,
              referenceId: adjustmentId,
              referenceType: "BillAdjustment",
              accountId: bill.accountId,
              reason: `Resellable return for invoice ${bill.invoiceNumber}: ${data.reason}`,
              performedBy: operatorId,
            },
            { session }
          );
        } else if (bill.invoiceType === "Purchase" && action === "replacement") {
          const batch = product.addBatch({
            batchCode: `REPLACE-${adjustmentId.toString().slice(-8)}`,
            qty: quantity,
            unitCost,
            supplierId: bill.accountId,
            purchaseInvoiceId: bill._id,
            receivedDate: data.date ? new Date(data.date) : new Date(),
          });
          await product.save({ session });
          await StockMovement.recordMovement(
            {
              tenantId,
              productId: product._id,
              movementType: "Adjustment",
              changeQty: quantity,
              previousStock,
              newStock: product.stock,
              unitCost,
              unitPrice,
              batchId: batch._id,
              batchCode: batch.batchCode,
              referenceId: adjustmentId,
              referenceType: "BillAdjustment",
              accountId: bill.accountId,
              reason: `Supplier replacement for invoice ${bill.invoiceNumber}: ${data.reason}`,
              performedBy: operatorId,
            },
            { session }
          );
        } else if (
          (bill.invoiceType === "Purchase" && action === "return") ||
          (bill.invoiceType === "Sale" && action === "replacement")
        ) {
          let fifoResult;
          try {
            fifoResult = product.consumeFIFO(quantity);
          } catch (error) {
            throw new ConflictError(error.message);
          }
          await product.save({ session });
          for (const allocation of fifoResult.allocations) {
            await StockMovement.recordMovement(
              {
                tenantId,
                productId: product._id,
                movementType: action === "return" ? "Return" : "Adjustment",
                changeQty: -Number(allocation.quantity),
                previousStock,
                newStock: product.stock,
                unitCost: allocation.unitCost,
                unitPrice,
                batchId: allocation.batchId,
                batchCode: allocation.batchCode,
                referenceId: adjustmentId,
                referenceType: "BillAdjustment",
                accountId: bill.accountId,
                reason: `${action === "return" ? "Return to supplier" : "Customer replacement"} for invoice ${bill.invoiceNumber}: ${data.reason}`,
                performedBy: operatorId,
              },
              { session }
            );
          }
          totalCost = roundMoney(fifoResult.totalCost);
          if (bill.invoiceType === "Sale") unitCost = fifoResult.unitCost;
        } else if (bill.invoiceType === "Sale" && action === "return" && condition === "damaged") {
          await StockMovement.recordMovement(
            {
              tenantId,
              productId: product._id,
              movementType: "Return",
              changeQty: 0,
              previousStock,
              newStock: previousStock,
              unitCost,
              unitPrice,
              referenceId: adjustmentId,
              referenceType: "BillAdjustment",
              accountId: bill.accountId,
              reason: `Damaged return not restocked for invoice ${bill.invoiceNumber}: ${data.reason}`,
              performedBy: operatorId,
            },
            { session }
          );
        }

        preparedLines.push({
          action,
          sourceItemIndex,
          productId: product._id,
          name: product.name,
          quantity,
          condition,
          unitPrice,
          unitCost,
          totalCost,
          totalAmount: lineAmount,
        });
      }

      const balanceChange = roundMoney(replacementAmount - returnedAmount);
      const adjustment = new BillAdjustment({
        _id: adjustmentId,
        adjustmentNumber: `ADJ-${Date.now().toString().slice(-8)}`,
        originalBillId: bill._id,
        invoiceNumber: bill.invoiceNumber,
        invoiceType: bill.invoiceType,
        accountId: bill.accountId,
        reason: String(data.reason).trim(),
        items: preparedLines,
        returnedAmount,
        replacementAmount,
        balanceChange,
        date: data.date ? new Date(data.date) : new Date(),
        tenantId,
        operatorId,
      });
      await bill.save({ session });
      await adjustment.save({ session });

      if (bill.accountId && balanceChange !== 0) {
        const account = await Account.findOne({ _id: bill.accountId, tenantId }).session(session);
        if (!account) {
          throw new NotFoundError("Invoice account not found");
        }
        const customer = bill.invoiceType === "Sale";
        const updatedAccount = await Account.findOneAndUpdate(
          { _id: bill.accountId, tenantId },
          { $inc: { currentBalance: balanceChange } },
          { new: true, session }
        );
        await AccountTransaction.create(
          [
            {
              tenantId,
              accountId: bill.accountId,
              transactionType: "Adjustment",
              amount: Math.abs(balanceChange),
              debit: customer
                ? Math.max(0, balanceChange)
                : Math.max(0, -balanceChange),
              credit: customer
                ? Math.max(0, -balanceChange)
                : Math.max(0, balanceChange),
              balanceAfter: updatedAccount.currentBalance,
              reference_table: "Adjustments",
              reference_id: adjustment._id,
              relatedInvoiceId: bill._id,
              invoiceNumber: bill.invoiceNumber,
              description: `Adjustment for invoice ${bill.invoiceNumber}`,
              notes: String(data.reason).trim(),
              date: adjustment.date,
              operatorId,
            },
          ],
          { session }
        );
      }

      return adjustment;
    });
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

  async getBillAdjustments(billId, tenantId = "default-store") {
    if (!billId) {
      throw new BadRequestError("Invoice ID is required");
    }
    const bill = await Bill.findOne({ _id: billId, tenantId });
    if (!bill) {
      throw new NotFoundError("Invoice not found");
    }
    return BillAdjustment.find({ originalBillId: bill._id, tenantId })
      .populate("accountId", "name accountCode accountType")
      .sort({ date: -1, createdAt: -1 });
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
    const existingAdjustment = await BillAdjustment.findOne({ originalBillId: bill._id, tenantId });
    if (existingAdjustment) {
      throw new ConflictError("This invoice has adjustments. Record a reversing adjustment instead of voiding it.");
    }

    const voidedBill = await unitOfWork.runInTransaction(async (session) => {
      // 1. Reverse stock adjustments
      if (bill.invoiceType === "Purchase") {
        const receipts = await GoodsReceipt.find({
          purchaseInvoiceId: bill._id,
          tenantId,
          status: "completed",
        }).session(session);

        if (receipts.length > 0) {
          for (const receipt of receipts) {
            for (const line of receipt.items) {
              const product = await Item.findOne({ _id: line.productId, tenantId }).session(session);
              if (!product) {
                throw new ConflictError(`Cannot void purchase invoice: product '${line.name}' no longer exists`);
              }
              const batch = line.batchId ? product.batches.id(line.batchId) : null;
              const qty = Number(line.quantity || 0);
              if (!batch || batch.availableQty + 0.0005 < qty || product.stock + 0.0005 < qty) {
                throw new ConflictError(
                  `Cannot void purchase invoice: ${line.name} has already been sold or used. Record a return adjustment instead.`
                );
              }

              const previousStock = product.stock;
              batch.availableQty = Number((batch.availableQty - qty).toFixed(3));
              product.stock = Number((product.stock - qty).toFixed(3));
              if (product.stock < 0) {
                throw new ConflictError(`Cannot void purchase invoice: stock for ${line.name} would become negative`);
              }
              product.purchasePrice = product.batches
                .filter((candidate) => candidate.availableQty > 0)
                .sort((left, right) => right.receivedDate - left.receivedDate)[0]?.unitCost || 0;
              await product.save({ session });
              await StockMovement.recordMovement(
                {
                  tenantId,
                  productId: product._id,
                  movementType: "Void",
                  changeQty: -qty,
                  previousStock,
                  newStock: product.stock,
                  unitCost: line.unitCost,
                  referenceId: receipt._id,
                  referenceType: "GRN",
                  accountId: bill.accountId,
                  reason: `Void GRN for purchase invoice ${bill.invoiceNumber}`,
                  performedBy: operatorId,
                },
                { session }
              );
            }
            receipt.status = "voided";
            await receipt.save({ session });
          }
        } else {
          // Older purchase bills posted stock directly during invoice creation.
          for (const item of bill.cartItems || []) {
            if (!Array.isArray(item.batchAllocations) || item.batchAllocations.length === 0) continue;
            const productId = item.productId || item._id;
            const product = await Item.findOne({ _id: productId, tenantId }).session(session);
            if (!product) {
              throw new ConflictError(`Cannot void purchase invoice: product '${item.name}' no longer exists`);
            }
            const previousStock = product.stock;
            for (const allocation of item.batchAllocations) {
              const batch = allocation.batchId ? product.batches.id(allocation.batchId) : null;
              const qty = Number(allocation.quantity || 0);
              if (!batch || batch.availableQty + 0.0005 < qty || product.stock + 0.0005 < qty) {
                throw new ConflictError(
                  `Cannot void purchase invoice: ${item.name} has already been sold or used. Record a return adjustment instead.`
                );
              }
              batch.availableQty = Number((batch.availableQty - qty).toFixed(3));
              product.stock = Number((product.stock - qty).toFixed(3));
            }
            product.purchasePrice = product.batches
              .filter((batch) => batch.availableQty > 0)
              .sort((left, right) => right.receivedDate - left.receivedDate)[0]?.unitCost || 0;
            await product.save({ session });
            await StockMovement.recordMovement(
              {
                tenantId,
                productId: product._id,
                movementType: "Void",
                changeQty: -Number(item.quantity || 0),
                previousStock,
                newStock: product.stock,
                unitCost: Number(item.unitCost || 0),
                referenceId: bill._id,
                referenceType: "Bill",
                accountId: bill.accountId,
                reason: `Void purchase invoice ${bill.invoiceNumber}`,
                performedBy: operatorId,
              },
              { session }
            );
          }
        }
      } else if (bill.invoiceType === "Sale") {
        for (const item of bill.cartItems || []) {
          const productId = item.productId || item._id;
          if (!productId) continue;

          const product = await Item.findOne({ _id: productId, tenantId }).session(session);
          if (!product) {
            throw new ConflictError(`Cannot void invoice: product '${item.name}' no longer exists`);
          }

          const previousStock = product.stock;
          const qty = Number(item.quantity || 1);
          // Restore stock back into product
          product.stock = Number((product.stock + qty).toFixed(3));

          // Restore batch availableQty if allocations were recorded
          if (Array.isArray(item.batchAllocations) && item.batchAllocations.length > 0) {
            for (const alloc of item.batchAllocations) {
              if (alloc.batchId) {
                const batch = product.batches.id(alloc.batchId);
                if (!batch) {
                  throw new ConflictError(`Cannot void invoice: stock batch for '${item.name}' no longer exists`);
                }
                batch.availableQty = Number((batch.availableQty + Number(alloc.quantity || 0)).toFixed(3));
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
          const revAmt = roundMoney(bill.dueAmount || 0);
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
      bill.isDeleted = true;
      bill.deletedAt = new Date();
      bill.deletedBy = operatorId;
      await bill.save({ session });
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
    if (bill.status !== "voided") {
      throw new ConflictError("Only voided invoices can be restored");
    }
    const existingAdjustment = await BillAdjustment.findOne({ originalBillId: bill._id, tenantId });
    if (existingAdjustment) {
      throw new ConflictError("This invoice has adjustments and cannot be restored");
    }

    const restoredBill = await unitOfWork.runInTransaction(async (session) => {
      const restoreStock = async (
        productId,
        name,
        qty,
        allocations,
        direction,
        referenceId = bill._id,
        referenceType = "Bill"
      ) => {
        const product = await Item.findOne({ _id: productId, tenantId }).session(session);
        if (!product) {
          throw new ConflictError(`Cannot restore invoice: product '${name}' no longer exists`);
        }
        const previousStock = product.stock;
        for (const allocation of allocations || []) {
          if (!allocation.batchId) continue;
          const batch = product.batches.id(allocation.batchId);
          const allocationQty = Number(allocation.quantity || 0);
          if (!batch) {
            throw new ConflictError(`Cannot restore invoice: stock batch for '${name}' no longer exists`);
          }
          if (direction < 0 && batch.availableQty + 0.0005 < allocationQty) {
            throw new ConflictError(
              `Cannot restore invoice: not enough stock remains in the original batch for '${name}'`
            );
          }
          batch.availableQty = Number((batch.availableQty + direction * allocationQty).toFixed(3));
        }
        if (direction < 0 && product.stock + 0.0005 < qty) {
          throw new ConflictError(`Cannot restore invoice: not enough stock remains for '${name}'`);
        }
        product.stock = Number((product.stock + direction * qty).toFixed(3));
        if (bill.invoiceType === "Purchase") {
          product.purchasePrice = product.batches
            .filter((batch) => batch.availableQty > 0)
            .sort((left, right) => right.receivedDate - left.receivedDate)[0]?.unitCost || 0;
        }
        await product.save({ session });
        await StockMovement.recordMovement(
          {
            tenantId,
            productId: product._id,
            movementType: "Void",
            changeQty: direction * qty,
            previousStock,
            newStock: product.stock,
            referenceId,
            referenceType,
            accountId: bill.accountId,
            reason: `Restore invoice ${bill.invoiceNumber || bill._id}`,
            performedBy: "system",
          },
          { session }
        );
      };

      if (bill.invoiceType === "Sale") {
        for (const item of bill.cartItems || []) {
          const productId = item.productId || item._id;
          if (!productId) continue;
          await restoreStock(
            productId,
            item.name,
            Number(item.quantity || 1),
            item.batchAllocations,
            -1
          );
        }
      } else if (bill.invoiceType === "Purchase") {
        const receipts = await GoodsReceipt.find({
          purchaseInvoiceId: bill._id,
          tenantId,
          status: "voided",
        }).session(session);
        if (receipts.length > 0) {
          for (const receipt of receipts) {
            for (const line of receipt.items) {
              await restoreStock(
                line.productId,
                line.name,
                Number(line.quantity || 0),
                [{ batchId: line.batchId, quantity: line.quantity }],
                1,
                receipt._id,
                "GRN"
              );
            }
            receipt.status = "completed";
            await receipt.save({ session });
          }
        } else {
          // Legacy purchase bills received stock when the invoice was created.
          for (const item of bill.cartItems || []) {
            const productId = item.productId || item._id;
            if (!productId || !item.batchAllocations?.length) continue;
            await restoreStock(
              productId,
              item.name,
              Number(item.quantity || 0),
              item.batchAllocations,
              1
            );
          }
        }
      }

      if (bill.accountId) {
        const amount = roundMoney(bill.dueAmount || 0);
        if (amount > 0) {
          const account = await Account.findOneAndUpdate(
            { _id: bill.accountId, tenantId },
            { $inc: { currentBalance: amount } },
            { new: true, session }
          );
          if (!account) {
            throw new NotFoundError("Invoice account not found");
          }
          await AccountTransaction.create(
            [
              {
                tenantId,
                accountId: bill.accountId,
                transactionType: bill.invoiceType === "Sale" ? "Credit" : "Purchase",
                amount,
                debit: bill.invoiceType === "Sale" ? amount : 0,
                credit: bill.invoiceType === "Purchase" ? amount : 0,
                balanceAfter: account.currentBalance,
                reference_table: "Invoices",
                reference_id: bill._id,
                invoiceNumber: bill.invoiceNumber,
                description: `Restore invoice ${bill.invoiceNumber}`,
                notes: `Restored outstanding balance: PKR ${amount.toFixed(2)}`,
                date: new Date(),
                operatorId: "system",
              },
            ],
            { session }
          );
        }
      }

      bill.status = "completed";
      bill.isDeleted = false;
      bill.deletedAt = null;
      bill.deletedBy = null;
      await bill.save({ session });

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

    const salesAdjustments = await BillAdjustment.find({
      tenantId,
      invoiceType: "Sale",
      date: { $gte: start, $lte: end },
    }).lean();

    for (const adjustment of salesAdjustments) {
      grossSales = roundMoney(grossSales + Number(adjustment.balanceChange || 0));

      for (const line of adjustment.items || []) {
        const quantity = Number(line.quantity || 0);
        const lineAmount = Number(line.totalAmount || 0);
        const storedLineCost = Number(line.totalCost || 0);
        const lineCost = storedLineCost > 0 || Number(line.unitCost || 0) === 0
          ? storedLineCost
          : roundMoney(Number(line.unitCost || 0) * quantity);
        const isReturn = line.action === "return";
        const revenueChange = isReturn ? -lineAmount : lineAmount;
        const costChange = isReturn
          ? line.condition === "resellable" ? -lineCost : 0
          : lineCost;
        const unitsChange = isReturn ? -quantity : quantity;
        totalCOGS = roundMoney(totalCOGS + costChange);
        totalUnitsSold = Number((totalUnitsSold + unitsChange).toFixed(3));

        const productKey = String(line.productId || line.name);
        if (!productStats[productKey]) {
          productStats[productKey] = {
            productId: line.productId,
            name: line.name,
            unitsSold: 0,
            revenue: 0,
            cogs: 0,
            profit: 0,
          };
        }
        productStats[productKey].unitsSold = Number(
          (productStats[productKey].unitsSold + unitsChange).toFixed(3)
        );
        productStats[productKey].revenue = roundMoney(
          productStats[productKey].revenue + revenueChange
        );
        productStats[productKey].cogs = roundMoney(
          productStats[productKey].cogs + costChange
        );
        productStats[productKey].profit = roundMoney(
          productStats[productKey].profit + revenueChange - costChange
        );
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