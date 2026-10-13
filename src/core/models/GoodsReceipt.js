const mongoose = require("mongoose");

const goodsReceiptLineSchema = new mongoose.Schema(
  {
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
    unitCost: {
      type: Number,
      required: true,
      min: 0,
    },
    batchCode: {
      type: String,
      trim: true,
      required: true,
    },
    batchId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
  },
  { _id: false }
);

const goodsReceiptSchema = new mongoose.Schema(
  {
    grnNumber: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    purchaseInvoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "bills",
      required: true,
      index: true,
    },
    supplierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      default: null,
      index: true,
    },
    items: {
      type: [goodsReceiptLineSchema],
      required: true,
      validate: [(items) => items.length > 0, "Goods receipt must contain items"],
    },
    totalCost: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ["completed", "voided"],
      default: "completed",
      index: true,
    },
    date: {
      type: Date,
      default: Date.now,
      index: true,
    },
    notes: {
      type: String,
      trim: true,
      default: "",
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

goodsReceiptSchema.index({ tenantId: 1, purchaseInvoiceId: 1, date: 1 });

module.exports =
  mongoose.models.GoodsReceipt || mongoose.model("GoodsReceipt", goodsReceiptSchema);
