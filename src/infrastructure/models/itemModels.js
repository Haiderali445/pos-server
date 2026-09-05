const mongoose = require("mongoose");

const itemSchema = new mongoose.Schema(
  {
    sku: {
      type: String,
      trim: true,
      uppercase: true,
      sparse: true,
      unique: true,
    },
    barcode: {
      type: String,
      trim: true,
      sparse: true,
      unique: true,
    },
    name: {
      type: String,
      required: true,
    },
    purchasePrice: {
      type: Number,
      required: true,
    },
    salePrice: {
      type: Number,
      required: true,
     
    },
    stock: {
      type: Number,
      required: true,
      min: 0,
     
    },
    category: {
      type: String,
      required: true,
    },
    image: {
      type: String,
      required: true,
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
    timestamps: true, // Ensure timestamps for createdAt and updatedAt
  }
);

itemSchema.index({ name: "text", sku: "text", barcode: "text" });
itemSchema.index({ category: 1, active: 1 });

const Items = mongoose.model("Items", itemSchema);

module.exports = Items;
