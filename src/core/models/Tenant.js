const mongoose = require("mongoose");
const { softDeletePlugin } = require("./plugins/softDelete");

const tenantSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    taxStrategy: {
      type: String,
      enum: ["zero", "flat", "vat"],
      default: "zero",
    },
    taxRate: {
      type: Number,
      default: 0,
      min: 0,
    },
    receiptTemplate: {
      type: String,
      enum: ["thermal80mm", "standardA4"],
      default: "thermal80mm",
    },
    currency: {
      type: String,
      default: "PKR",
    },
    contactPhone: {
      type: String,
      default: "",
    },
    address: {
      type: String,
      default: "",
    },
    active: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

tenantSchema.plugin(softDeletePlugin);

const Tenant = mongoose.models.Tenant || mongoose.model("Tenant", tenantSchema);

module.exports = Tenant;
