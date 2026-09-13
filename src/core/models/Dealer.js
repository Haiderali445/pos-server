const mongoose = require("mongoose");
const { softDeletePlugin } = require("./plugins/softDelete");

const dealerSchema = new mongoose.Schema(
  {
    dealerName: {
      type: String,
      required: true,
      trim: true,
    },
    contactName: {
      type: String,
      required: true,
      trim: true,
    },
    shopName: {
      type: String,
      required: true,
      trim: true,
    },
    address: {
      type: String,
      required: true,
      trim: true,
    },
    products: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

dealerSchema.plugin(softDeletePlugin);

dealerSchema.index({ tenantId: 1, dealerName: 1 });

const Dealer = mongoose.models.Dealer || mongoose.model("Dealer", dealerSchema);

module.exports = Dealer;
