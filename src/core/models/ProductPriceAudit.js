const mongoose = require("mongoose");
const { softDeletePlugin } = require("./plugins/softDelete");

const productPriceAuditSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Items",
      required: true,
      index: true,
    },
    productName: {
      type: String,
      trim: true,
      default: "",
    },
    oldPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    newPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    priceType: {
      type: String,
      enum: ["purchasePrice", "salePrice"],
      default: "purchasePrice",
      index: true,
    },
    priceChange: {
      type: Number,
      default: 0,
    },
    percentageChange: {
      type: Number,
      default: 0,
    },
    changeReason: {
      type: String,
      trim: true,
      default: "",
    },
    batchCode: {
      type: String,
      trim: true,
      default: "",
    },
    referenceId: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
      index: true,
    },
    referenceType: {
      type: String,
      default: "Bill",
    },
    changedBy: {
      type: String,
      trim: true,
      default: "system",
    },
    date: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

productPriceAuditSchema.plugin(softDeletePlugin);

productPriceAuditSchema.index({ tenantId: 1, productId: 1, date: -1 });
productPriceAuditSchema.index({ tenantId: 1, priceType: 1, date: -1 });

productPriceAuditSchema.pre("save", function (next) {
  const oldVal = Number(this.oldPrice || 0);
  const newVal = Number(this.newPrice || 0);

  this.priceChange = Number((newVal - oldVal).toFixed(2));
  this.percentageChange = oldVal > 0 ? Number((((newVal - oldVal) / oldVal) * 100).toFixed(2)) : 0;
  next();
});

productPriceAuditSchema.statics.recordAudit = async function (auditData, options = {}) {
  const {
    productId,
    productName = "",
    oldPrice,
    newPrice,
    priceType = "purchasePrice",
    changeReason = "",
    batchCode = "",
    referenceId = null,
    referenceType = "Bill",
    changedBy = "system",
    tenantId = "default-store",
    date = new Date(),
  } = auditData;

  const oldVal = Number(oldPrice || 0);
  const newVal = Number(newPrice || 0);
  const priceChange = Number((newVal - oldVal).toFixed(2));
  const percentageChange = oldVal > 0 ? Number((((newVal - oldVal) / oldVal) * 100).toFixed(2)) : 0;

  const record = new this({
    productId,
    productName,
    oldPrice: oldVal,
    newPrice: newVal,
    priceType,
    priceChange,
    percentageChange,
    changeReason,
    batchCode,
    referenceId,
    referenceType,
    changedBy,
    tenantId,
    date,
  });

  return record.save(options);
};

const ProductPriceAudit =
  mongoose.models.ProductPriceAudit || mongoose.model("ProductPriceAudit", productPriceAuditSchema);

module.exports = ProductPriceAudit;
