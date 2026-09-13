const mongoose = require("mongoose");
const { softDeletePlugin } = require("./plugins/softDelete");

const itemSchema = new mongoose.Schema(
  {
    sku: {
      type: String,
      trim: true,
      uppercase: true,
      sparse: true,
    },
    barcode: {
      type: String,
      trim: true,
      sparse: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    purchasePrice: {
      type: Number,
      required: true,
      min: 0,
    },
    salePrice: {
      type: Number,
      required: true,
      min: 0,
    },
    stock: {
      type: Number,
      required: true,
      min: 0,
    },
    category: {
      type: String,
      required: true,
      trim: true,
    },
    image: {
      type: String,
      default: "",
    },
    dealers: {
      type: String,
      default: "",
    },
    reorderLevel: {
      type: Number,
      default: 5,
      min: 0,
    },
    active: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

itemSchema.plugin(softDeletePlugin);

itemSchema.index({ tenantId: 1, name: "text", sku: "text", barcode: "text" });
itemSchema.index({ tenantId: 1, category: 1, active: 1 });
itemSchema.index({ tenantId: 1, barcode: 1 });
itemSchema.index({ tenantId: 1, sku: 1 });

const Items = mongoose.models.Items || mongoose.model("Items", itemSchema);

module.exports = Items;
