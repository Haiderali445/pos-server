const mongoose = require("mongoose");
const { softDeletePlugin } = require("./plugins/softDelete");

const billSchema = new mongoose.Schema(
  {
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
    subtotal: {
      type: Number,
      default: 0,
    },
    taxAmount: {
      type: Number,
      default: 0,
    },
    totalAmount: {
      type: Number,
      required: true,
    },
    paidAmount: {
      type: Number,
      required: true,
    },
    paymentMethod: {
      type: String,
      required: true,
    },
    cartItems: {
      type: Array,
      required: true,
    },
    date: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ["completed", "voided"],
      default: "completed",
    },
    operatorId: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

billSchema.plugin(softDeletePlugin);

billSchema.index({ tenantId: 1, date: -1 });
billSchema.index({ tenantId: 1, costumerNumber: 1, date: -1 });

const Bill = mongoose.models.bills || mongoose.model("bills", billSchema);

module.exports = Bill;
