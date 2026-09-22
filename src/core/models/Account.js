const mongoose = require("mongoose");
const { softDeletePlugin } = require("./plugins/softDelete");

const ACCOUNT_TYPES = ["Customer", "Supplier", "Expense"];

const accountSchema = new mongoose.Schema(
  {
    accountCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    accountType: {
      type: String,
      required: true,
      enum: ACCOUNT_TYPES,
      index: true,
    },
    phone: {
      type: String,
      trim: true,
      default: "",
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },
    address: {
      type: String,
      trim: true,
      default: "",
    },
    city: {
      type: String,
      trim: true,
      default: "",
    },
    /**
     * Real-time balance tracking:
     * - Customer: Positive = Receivable (Customer owes money). Negative = Advance payment / Store credit.
     * - Supplier: Positive = Payable (We owe supplier). Negative = Advance paid to supplier.
     * - Expense: Cumulative expense logged to this head.
     */
    currentBalance: {
      type: Number,
      default: 0,
    },
    openingBalance: {
      type: Number,
      default: 0,
    },
    creditLimit: {
      type: Number,
      default: 0,
      min: 0,
    },
    paymentTerms: {
      type: String,
      trim: true,
      default: "Immediate",
    },
    taxNumber: {
      type: String,
      trim: true,
      default: "",
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
    active: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

accountSchema.plugin(softDeletePlugin);

// Compound Indexes
accountSchema.index({ tenantId: 1, accountCode: 1 }, { unique: true });
accountSchema.index({ tenantId: 1, accountType: 1, active: 1 });
accountSchema.index({ tenantId: 1, phone: 1 });
accountSchema.index({ tenantId: 1, name: "text", phone: "text", accountCode: "text" });

/**
 * Instance method to atomically update current balance
 * @param {number} delta Amount to adjust (+ for increase, - for decrease)
 * @param {object} [options] Session and execution options
 */
accountSchema.methods.updateBalance = async function (delta, options = {}) {
  const numericDelta = Number(delta) || 0;
  this.currentBalance = Number((this.currentBalance + numericDelta).toFixed(2));
  return this.save(options);
};

/**
 * Static helpers for common Khata lookups
 */
accountSchema.statics.findByCode = function (accountCode, tenantId = "default-store", options = {}) {
  return this.findOne({ accountCode: String(accountCode).toUpperCase().trim(), tenantId }, null, options);
};

accountSchema.statics.getCustomers = function (tenantId = "default-store", filter = {}, options = {}) {
  return this.find({ tenantId, accountType: "Customer", active: true, ...filter }, null, options).sort({ name: 1 });
};

accountSchema.statics.getSuppliers = function (tenantId = "default-store", filter = {}, options = {}) {
  return this.find({ tenantId, accountType: "Supplier", active: true, ...filter }, null, options).sort({ name: 1 });
};

accountSchema.statics.getExpenseAccounts = function (tenantId = "default-store", filter = {}, options = {}) {
  return this.find({ tenantId, accountType: "Expense", active: true, ...filter }, null, options).sort({ name: 1 });
};

const Account = mongoose.models.Account || mongoose.model("Account", accountSchema);

module.exports = Account;
