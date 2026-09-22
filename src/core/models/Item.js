const mongoose = require("mongoose");
const { softDeletePlugin } = require("./plugins/softDelete");

/**
 * Sub-document schema for FIFO stock batches
 */
const stockBatchSchema = new mongoose.Schema(
  {
    batchCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    qty: {
      type: Number,
      required: true,
      min: 0,
      description: "Original quantity purchased in this batch",
    },
    availableQty: {
      type: Number,
      required: true,
      min: 0,
      description: "Unconsumed stock remaining in this batch",
    },
    unitCost: {
      type: Number,
      required: true,
      min: 0,
      description: "Purchase price per unit for this batch",
    },
    supplierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      default: null,
    },
    purchaseInvoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bill",
      default: null,
    },
    expiryDate: {
      type: Date,
      default: null,
    },
    receivedDate: {
      type: Date,
      default: Date.now,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true }
);

const itemSchema = new mongoose.Schema(
  {
    sku: {
      type: String,
      trim: true,
      uppercase: true,
      sparse: true,
      alias: "productCode",
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
    unit: {
      type: String,
      default: "pcs",
      trim: true,
    },
    purchasePrice: {
      type: Number,
      required: true,
      min: 0,
      description: "Default or latest purchase unit cost",
      alias: "defaultPurchasePrice",
    },
    salePrice: {
      type: Number,
      required: true,
      min: 0,
      alias: "defaultSalesPrice",
    },
    stock: {
      type: Number,
      required: true,
      min: 0,
      description: "Total available stock across all active batches",
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
      alias: "minimumStock",
    },
    active: {
      type: Boolean,
      default: true,
      index: true,
    },
    valuationMethod: {
      type: String,
      enum: ["FIFO", "LIFO", "AVCO"],
      default: "FIFO",
    },
    batches: {
      type: [stockBatchSchema],
      alias: "stockBatches",
    },
    supplierAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      default: null,
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
itemSchema.index({ tenantId: 1, "batches.batchCode": 1 });

/**
 * Add a new purchase stock batch
 * Automatically increments item stock and updates purchasePrice to latest unit cost
 */
itemSchema.methods.addBatch = function ({
  batchCode,
  qty,
  unitCost,
  supplierId = null,
  purchaseInvoiceId = null,
  expiryDate = null,
  receivedDate = new Date(),
}) {
  const numericQty = Number(qty);
  const numericCost = Number(unitCost);

  if (isNaN(numericQty) || numericQty <= 0) {
    throw new Error("Batch quantity must be a positive number");
  }
  if (isNaN(numericCost) || numericCost < 0) {
    throw new Error("Batch unit cost must be a non-negative number");
  }

  const generatedBatchCode =
    batchCode ? String(batchCode).trim().toUpperCase() : `BATCH-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  const newBatch = {
    batchCode: generatedBatchCode,
    qty: numericQty,
    availableQty: numericQty,
    unitCost: numericCost,
    supplierId,
    purchaseInvoiceId,
    expiryDate: expiryDate ? new Date(expiryDate) : null,
    receivedDate: receivedDate ? new Date(receivedDate) : new Date(),
    createdAt: new Date(),
  };

  this.batches.push(newBatch);
  this.stock = Number((this.stock + numericQty).toFixed(3));
  this.purchasePrice = numericCost;

  return this.batches[this.batches.length - 1];
};

/**
 * Consumes stock using First-In-First-Out (FIFO) strategy
 * Consumes from oldest batch where availableQty > 0
 *
 * @param {number} qtyRequested Quantity to deduct
 * @returns {{ allocations: Array, totalCost: number, unitCost: number }}
 */
itemSchema.methods.consumeFIFO = function (qtyRequested) {
  const qtyNeeded = Number(qtyRequested);
  if (isNaN(qtyNeeded) || qtyNeeded <= 0) {
    throw new Error("Requested quantity must be greater than zero");
  }

  if (this.stock < qtyNeeded) {
    throw new Error(
      `Insufficient stock for '${this.name}'. Total Available: ${this.stock}, Requested: ${qtyNeeded}`
    );
  }

  // If item has no explicit batches but has legacy stock, fallback to default batch consumption
  if (!this.batches || this.batches.length === 0) {
    this.stock = Number((this.stock - qtyNeeded).toFixed(3));
    const cost = Number(this.purchasePrice || 0);
    return {
      allocations: [
        {
          batchId: null,
          batchCode: "LEGACY-STOCK",
          quantity: qtyNeeded,
          unitCost: cost,
          totalCost: Number((qtyNeeded * cost).toFixed(2)),
        },
      ],
      totalCost: Number((qtyNeeded * cost).toFixed(2)),
      unitCost: cost,
    };
  }

  // Sort batches by oldest creation / receipt date (FIFO)
  const sortedBatches = this.batches
    .filter((b) => b.availableQty > 0)
    .sort((a, b) => new Date(a.createdAt || a.receivedDate) - new Date(b.createdAt || b.receivedDate));

  let remaining = qtyNeeded;
  let totalCost = 0;
  const allocations = [];

  for (const batch of sortedBatches) {
    if (remaining <= 0) break;

    const takeQty = Math.min(remaining, batch.availableQty);
    batch.availableQty = Number((batch.availableQty - takeQty).toFixed(3));
    remaining = Number((remaining - takeQty).toFixed(3));

    const batchCost = Number((takeQty * batch.unitCost).toFixed(2));
    totalCost += batchCost;

    allocations.push({
      batchId: batch._id,
      batchCode: batch.batchCode,
      quantity: takeQty,
      unitCost: batch.unitCost,
      totalCost: batchCost,
    });
  }

  // If batches didn't have enough to cover (due to unbatched legacy discrepancy), deduct remainder at standard purchasePrice
  if (remaining > 0) {
    const fallbackCost = Number(this.purchasePrice || 0);
    const remainderCost = Number((remaining * fallbackCost).toFixed(2));
    totalCost += remainderCost;
    allocations.push({
      batchId: null,
      batchCode: "LEGACY-STOCK",
      quantity: remaining,
      unitCost: fallbackCost,
      totalCost: remainderCost,
    });
    remaining = 0;
  }

  this.stock = Number((this.stock - qtyNeeded).toFixed(3));
  const effectiveUnitCost = qtyNeeded > 0 ? Number((totalCost / qtyNeeded).toFixed(2)) : 0;

  return {
    allocations,
    totalCost: Number(totalCost.toFixed(2)),
    unitCost: effectiveUnitCost,
  };
};

/**
 * Synchronizes the item's total stock counter with unconsumed batch quantities
 */
itemSchema.methods.syncStockFromBatches = function () {
  if (Array.isArray(this.batches) && this.batches.length > 0) {
    const totalBatchStock = this.batches.reduce((sum, b) => sum + Number(b.availableQty || 0), 0);
    this.stock = Number(totalBatchStock.toFixed(3));
  }
  return this.stock;
};

/**
 * Returns available batches sorted in FIFO order
 */
itemSchema.methods.getAvailableBatches = function () {
  if (!Array.isArray(this.batches)) return [];
  return this.batches
    .filter((b) => b.availableQty > 0)
    .sort((a, b) => new Date(a.createdAt || a.receivedDate) - new Date(b.createdAt || b.receivedDate));
};

const Items = mongoose.models.Items || mongoose.model("Items", itemSchema);

module.exports = Items;
module.exports.stockBatchSchema = stockBatchSchema;
