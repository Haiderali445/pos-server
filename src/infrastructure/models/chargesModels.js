const mongoose = require("mongoose");

const chargeSchema = new mongoose.Schema({
  description: {
    type: String,
    required: true,
  },
  amount: {
    type: Number,
    required: true,
  },
  date: {
    type: Date,
    default: Date.now,
  },
});

const Charge = mongoose.model("Charge", chargeSchema);

module.exports = Charge;
