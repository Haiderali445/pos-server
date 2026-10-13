const mongoose = require("mongoose");

const adjustmentLineSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: ["return", "replacement"],
      required: true,
    },
    sourceItemIndex: {
      type: Number,
      default: null,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Items",
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 0.001,
    },
    condition: {
      type: String,
      enum: ["resellable", "damaged"],
      default: "resellable",
    },
    unitPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    unitCost: {
      type: Number,
      required: true,
      min: 0,
    },
    totalCost: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: false }
);

const billAdjustmentSchema = new mongoose.Schema(
  {
    adjustmentNumber: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    originalBillId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "bills",
      required: true,
      index: true,
    },
    invoiceNumber: {
      type: String,
      trim: true,
      default: "",
    },
    invoiceType: {
      type: String,
      enum: ["Sale", "Purchase"],
      required: true,
    },
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      default: null,
      index: true,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    items: {
      type: [adjustmentLineSchema],
      required: true,
      validate: [(items) => items.length > 0, "Adjustment must contain items"],
    },
    returnedAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    replacementAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    balanceChange: {
      type: Number,
      required: true,
    },
    date: {
      type: Date,
      default: Date.now,
      index: true,
    },
    tenantId: {
      type: String,
      default: "default-store",
      index: true,
    },
    operatorId: {
      type: String,
      default: "system",
      trim: true,
    },
  },
  { timestamps: true }
);

billAdjustmentSchema.index({ tenantId: 1, originalBillId: 1, date: 1 });

module.exports =
  mongoose.models.BillAdjustment || mongoose.model("BillAdjustment", billAdjustmentSchema);
