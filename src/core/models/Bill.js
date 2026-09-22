const mongoose = require("mongoose");
const { softDeletePlugin } = require("./plugins/softDelete");

/**
 * Embedded cart item snapshot with unit-level cost, revenue, and profit calculations
 */
const cartItemSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.Mixed,
      ref: "Items",
      default: null,
    },
    // Backwards-compatible identifier for client payloads
    _id: {
      type: mongoose.Schema.Types.Mixed,
      default: () => new mongoose.Types.ObjectId(),
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    sku: {
      type: String,
      trim: true,
      default: "",
    },
    barcode: {
      type: String,
      trim: true,
      default: "",
    },
    category: {
      type: String,
      trim: true,
      default: "General",
    },
    quantity: {
      type: Number,
      required: true,
      min: 0.001,
    },
    unitPrice: {
      type: Number,
      required: true,
      min: 0,
      description: "Agreed sale price or purchase price per unit",
    },
    salePrice: {
      type: Number,
      min: 0,
    },
    unitCost: {
      type: Number,
      default: 0,
      min: 0,
      description: "FIFO purchase cost per unit at checkout snapshot",
    },
    purchasePrice: {
      type: Number,
      min: 0,
    },
    unitDiscount: {
      type: Number,
      default: 0,
      min: 0,
    },
    subtotal: {
      type: Number,
      default: 0,
      description: "(quantity * unitPrice) - unitDiscount",
    },
    unitProfit: {
      type: Number,
      default: 0,
      description: "unitPrice - unitCost - (unitDiscount / quantity)",
    },
    totalProfit: {
      type: Number,
      default: 0,
      description: "unitProfit * quantity",
    },
    profitMarginPercentage: {
      type: Number,
      default: 0,
      description: "((unitPrice - unitCost) / unitPrice) * 100",
    },
    batchAllocations: [
      {
        batchId: {
          type: mongoose.Schema.Types.Mixed,
          default: null,
        },
        batchCode: {
          type: String,
          default: "",
        },
        quantity: {
          type: Number,
          default: 0,
        },
        unitCost: {
          type: Number,
          default: 0,
        },
      },
    ],
  },
  { _id: false }
);

const billSchema = new mongoose.Schema(
  {
    invoiceNumber: {
      type: String,
      trim: true,
      uppercase: true,
      default: function () {
        const prefix = this.invoiceType === "Purchase" ? "PUR" : "INV";
        const timestamp = Date.now().toString().slice(-6);
        const random = Math.floor(100 + Math.random() * 900);
        return `${prefix}-${timestamp}-${random}`;
      },
    },
    invoiceType: {
      type: String,
      enum: ["Sale", "Purchase", "Return", "Payment"],
      default: "Sale",
      index: true,
    },
    // Linked unified Khata account (Customer or Supplier)
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      default: null,
      index: true,
    },
    // Legacy customer fields preserved for seamless frontend UI compatibility
    costumerName: {
      type: String,
      default: "",
      trim: true,
    },
    costumerNumber: {
      type: String,
      default: "",
      trim: true,
    },
    fare: {
      type: Number,
      default: 0,
      min: 0,
      description: "Transport / delivery / shipping freight charges",
    },
    totalDiscount: {
      type: Number,
      default: 0,
      min: 0,
      description: "Overall discount deducted from invoice total",
    },
    subtotal: {
      type: Number,
      default: 0,
      min: 0,
    },
    taxAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    paidAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    dueAmount: {
      type: Number,
      default: 0,
      min: 0,
      description: "Remaining open balance (Receivable/Payable)",
    },
    paymentMethod: {
      type: String,
      required: true,
      default: "cash",
      trim: true,
    },
    paymentStatus: {
      type: String,
      enum: ["paid", "partial", "unpaid", "overpaid"],
      default: "paid",
      index: true,
    },
    cartItems: {
      type: [cartItemSchema],
      required: true,
      validate: [
        (items) => Array.isArray(items) && items.length > 0,
        "Invoice must contain at least one item",
      ],
    },
    totalProfit: {
      type: Number,
      default: 0,
      description: "Cumulative gross profit across all line items",
    },
    totalItemsCount: {
      type: Number,
      default: 0,
    },
    date: {
      type: Date,
      default: Date.now,
      index: true,
    },
    dueDate: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ["completed", "voided", "draft", "pending"],
      default: "completed",
      index: true,
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
    operatorId: {
      type: String,
      default: "system",
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

billSchema.plugin(softDeletePlugin);

// Compound indexes
billSchema.index({ tenantId: 1, date: -1 });
billSchema.index({ tenantId: 1, invoiceType: 1, date: -1 });
billSchema.index({ tenantId: 1, accountId: 1, date: -1 });
billSchema.index({ tenantId: 1, invoiceNumber: 1 });
billSchema.index({ tenantId: 1, costumerNumber: 1, date: -1 });
billSchema.index({ tenantId: 1, status: 1 });

/**
 * Calculates item and invoice profit metrics, net balances, and payment statuses
 */
billSchema.methods.calculateMetrics = function () {
  // Generate invoice number if not assigned
  if (!this.invoiceNumber) {
    const prefix = this.invoiceType === "Purchase" ? "PUR" : "INV";
    const timestamp = Date.now().toString().slice(-6);
    const random = Math.floor(100 + Math.random() * 900);
    this.invoiceNumber = `${prefix}-${timestamp}-${random}`;
  }

  let calculatedProfit = 0;
  let totalQty = 0;

  if (Array.isArray(this.cartItems)) {
    this.cartItems.forEach((item) => {
      const qty = Number(item.quantity || 1);
      const price = Number(item.unitPrice !== undefined ? item.unitPrice : item.salePrice || item.price || 0);
      const cost = Number(item.unitCost !== undefined ? item.unitCost : item.purchasePrice || 0);
      const discount = Number(item.unitDiscount || 0);

      item.quantity = qty;
      item.unitPrice = price;
      item.salePrice = price;
      item.unitCost = cost;
      item.purchasePrice = cost;
      item.unitDiscount = discount;

      item.subtotal = Number((qty * price - discount).toFixed(2));
      const lineCost = (Array.isArray(item.batchAllocations) && item.batchAllocations.length > 0)
        ? item.batchAllocations.reduce((sum, a) => sum + ((Number(a.unitCost) || 0) * (Number(a.quantity) || 0)), 0)
        : (cost * qty);
      const computedProfit = Number((item.subtotal - lineCost).toFixed(2));
      item.totalProfit = item.totalProfit !== undefined && !isNaN(item.totalProfit) && item.totalProfit !== 0
        ? Number(item.totalProfit)
        : computedProfit;
      item.unitProfit = Number((item.totalProfit / (qty || 1)).toFixed(2));
      item.profitMarginPercentage = price > 0 ? Number((((price - cost) / price) * 100).toFixed(2)) : 0;

      calculatedProfit += item.totalProfit;
      totalQty += qty;
    });
  }

  this.totalProfit = Number(calculatedProfit.toFixed(2));
  this.totalItemsCount = Number(totalQty.toFixed(3));

  // Compute due balance
  const netPayable = Number((Number(this.totalAmount || 0) + Number(this.fare || 0) - Number(this.totalDiscount || 0)).toFixed(2));
  const paid = Number(this.paidAmount || 0);
  const remaining = Number((netPayable - paid).toFixed(2));

  this.dueAmount = Math.max(0, remaining);

  if (paid >= netPayable) {
    this.paymentStatus = paid > netPayable ? "overpaid" : "paid";
  } else if (paid > 0) {
    this.paymentStatus = "partial";
  } else {
    this.paymentStatus = "unpaid";
  }

  return this;
};

/**
 * Pre-validation hook to ensure all cart items and metrics are properly populated
 */
billSchema.pre("validate", function (next) {
  this.calculateMetrics();
  next();
});

billSchema.pre("save", function (next) {
  this.calculateMetrics();
  next();
});

const Bill = mongoose.models.bills || mongoose.model("bills", billSchema);

module.exports = Bill;
