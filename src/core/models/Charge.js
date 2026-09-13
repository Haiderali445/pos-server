const mongoose = require("mongoose");
const { softDeletePlugin } = require("./plugins/softDelete");

const chargeSchema = new mongoose.Schema(
  {
    description: {
      type: String,
      required: true,
      trim: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    category: {
      type: String,
      default: "general",
      trim: true,
    },
    date: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

chargeSchema.plugin(softDeletePlugin);

chargeSchema.index({ tenantId: 1, date: -1 });

const Charge = mongoose.models.Charge || mongoose.model("Charge", chargeSchema);

module.exports = Charge;
