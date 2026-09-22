const mongoose = require("mongoose");
const { softDeletePlugin } = require("./plugins/softDelete");

const MOVEMENT_TYPES = ["Purchase", "Sale", "Adjustment", "Transfer", "Return", "Void"];
const REFERENCE_TYPES = [
  "Bill",
  "Invoice",
  "PurchaseOrder",
  "StockAdjustment",
  "ManualTransfer",
  "InitialStock",
  "Other",
];

const stockMovementSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Items",
      required: true,
      index: true,
    },
    movementType: {
      type: String,
      required: true,
      enum: MOVEMENT_TYPES,
      index: true,
    },
    
    changeQty: {
      type: Number,
      required: true,
    },
    previousStock: {
      type: Number,
      required: true,
    },
    newStock: {
      type: Number,
      required: true,
    },
    unitCost: {
      type: Number,
      default: 0,
      min: 0,
    },
    unitPrice: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalCostValue: {
      type: Number,
      default: 0,
    },
    totalSaleValue: {
      type: Number,
      default: 0,
    },
    batchId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    batchCode: {
      type: String,
      trim: true,
      default: "",
    },
    referenceId: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      index: true,
    },
    referenceType: {
      type: String,
      enum: REFERENCE_TYPES,
      default: "Bill",
      index: true,
    },
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      default: null,
      index: true,
    },
    reason: {
      type: String,
      trim: true,
      default: "",
    },
    performedBy: {
      type: String,
      default: "system",
      trim: true,
    },
    date: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

stockMovementSchema.plugin(softDeletePlugin);

// Compound indexes for rapid audit trail lookups
stockMovementSchema.index({ tenantId: 1, productId: 1, date: -1 });
stockMovementSchema.index({ tenantId: 1, movementType: 1, date: -1 });
stockMovementSchema.index({ tenantId: 1, referenceId: 1 });
stockMovementSchema.index({ tenantId: 1, accountId: 1, date: -1 });

/**
 * Pre-save calculation hook for monetary valuation
 */
stockMovementSchema.pre("save", function (next) {
  if (this.unitCost && this.changeQty) {
    this.totalCostValue = Number((Math.abs(this.changeQty) * this.unitCost).toFixed(2));
  }
  if (this.unitPrice && this.changeQty) {
    this.totalSaleValue = Number((Math.abs(this.changeQty) * this.unitPrice).toFixed(2));
  }
  next();
});

/**
 * Static helper to record an audit movement in one line (session-compatible)
 */
stockMovementSchema.statics.recordMovement = async function (movementData, options = {}) {
  const {
    tenantId = "default-store",
    productId,
    movementType,
    changeQty,
    previousStock,
    newStock,
    unitCost = 0,
    unitPrice = 0,
    batchId = null,
    batchCode = "",
    referenceId,
    referenceType = "Bill",
    accountId = null,
    reason = "",
    performedBy = "system",
    date = new Date(),
  } = movementData;

  const totalCostValue = Number((Math.abs(changeQty) * unitCost).toFixed(2));
  const totalSaleValue = Number((Math.abs(changeQty) * unitPrice).toFixed(2));

  const movement = new this({
    tenantId,
    productId,
    movementType,
    changeQty: Number(changeQty),
    previousStock: Number(previousStock),
    newStock: Number(newStock),
    unitCost: Number(unitCost),
    unitPrice: Number(unitPrice),
    totalCostValue,
    totalSaleValue,
    batchId,
    batchCode,
    referenceId,
    referenceType,
    accountId,
    reason,
    performedBy,
    date,
  });

  return movement.save(options);
};

/**
 * Get full stock movement audit trail for a product
 */
stockMovementSchema.statics.getProductHistory = function (productId, tenantId = "default-store", options = {}) {
  return this.find({ productId, tenantId }, null, options)
    .sort({ date: -1, createdAt: -1 })
    .populate("accountId", "name accountCode accountType");
};

const StockMovement = mongoose.models.StockMovement || mongoose.model("StockMovement", stockMovementSchema);

module.exports = StockMovement;
