const mongoose = require("mongoose");
const { softDeletePlugin } = require("./plugins/softDelete");

const TRANSACTION_TYPES = [
  "Invoice",
  "Payment",
  "Credit",
  "Debit",
  "Adjustment",
  "Refund",
  "Void",
  "Sale",
  "Purchase",
];

const accountTransactionSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      default: "default-store",
      index: true,
    },
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      required: true,
      index: true,
    },
    transactionType: {
      type: String,
      required: true,
      enum: TRANSACTION_TYPES,
      default: "Invoice",
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
      description: "Gross value of transaction",
    },
    debit: {
      type: Number,
      default: 0,
      min: 0,
      description: "Debit amount (+ for Customer receivables, - for Supplier payables)",
    },
    credit: {
      type: Number,
      default: 0,
      min: 0,
      description: "Credit amount (- for Customer receivables, + for Supplier payables)",
    },
    balanceAfter: {
      type: Number,
      default: 0,
      description: "Running balance of account immediately after this transaction",
    },
    // Required references for audit trail
    reference_table: {
      type: String,
      default: "Invoices",
      trim: true,
      index: true,
    },
    reference_id: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      index: true,
    },
    invoiceNumber: {
      type: String,
      trim: true,
      default: "",
    },
    paymentMethod: {
      type: String,
      trim: true,
      default: "cash",
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
    date: {
      type: Date,
      default: Date.now,
      index: true,
    },
    operatorId: {
      type: String,
      default: "system",
      trim: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual aliases for camelCase compatibility
accountTransactionSchema.virtual("referenceTable").get(function () {
  return this.reference_table;
});
accountTransactionSchema.virtual("referenceId").get(function () {
  return this.reference_id;
});

accountTransactionSchema.plugin(softDeletePlugin);

// Compound indexes for rapid ledger retrieval
accountTransactionSchema.index({ tenantId: 1, accountId: 1, date: -1 });
accountTransactionSchema.index({ tenantId: 1, reference_table: 1, reference_id: 1 });

/**
 * Static method to log an account transaction with ACID session support
 */
accountTransactionSchema.statics.recordTransaction = async function (data, options = {}) {
  const [record] = await this.create([data], options);
  return record;
};

const AccountTransaction =
  mongoose.models.AccountTransaction ||
  mongoose.model("AccountTransaction", accountTransactionSchema);

module.exports = AccountTransaction;
