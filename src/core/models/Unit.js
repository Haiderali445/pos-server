const mongoose = require("mongoose");

const unitSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    code: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    tenantId: {
      type: String,
      default: "default-store",
      index: true,
    },
    active: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

unitSchema.index({ tenantId: 1, code: 1 }, { unique: true });

const Unit = mongoose.models.Unit || mongoose.model("Unit", unitSchema);
module.exports = Unit;
