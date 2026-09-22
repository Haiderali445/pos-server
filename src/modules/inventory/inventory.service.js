const Item = require("../../core/models/Item");
const StockMovement = require("../../core/models/StockMovement");
const ProductPriceAudit = require("../../core/models/ProductPriceAudit");
const { unitOfWork } = require("../../core/database/unitOfWork");
const { NotFoundError, BadRequestError } = require("../../core/errors/AppError");
const { appEvents } = require("../../core/events/eventEmitter");
const { EVENT_TYPES } = require("../../core/events/eventTypes");

class InventoryService {
  async getItems({ tenantId = "default-store", search = "", category = "" } = {}) {
    const query = { tenantId, isDeleted: { $ne: true } };

    if (category && category !== "all") {
      query.category = category;
    }

    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), "i");
      query.$or = [{ name: regex }, { sku: regex }, { barcode: regex }];
    }

    return Item.find(query).sort({ createdAt: -1 });
  }

  async getItemById(id, tenantId = "default-store") {
    const item = await Item.findOne({ _id: id, tenantId });
    if (!item) {
      throw new NotFoundError("Product not found");
    }
    return item;
  }

  async addItem(data, tenantId = "default-store") {
    if (!data.name || data.purchasePrice === undefined || data.salePrice === undefined || data.stock === undefined) {
      throw new BadRequestError("Product name, purchase price, sale price, and stock are required");
    }

    const initialStock = Number(data.stock || 0);
    const purchasePrice = Number(data.purchasePrice || 0);

    const initialBatches = [];
    if (initialStock > 0) {
      initialBatches.push({
        batchCode: data.batchCode || `INIT-${Date.now().toString().slice(-6)}`,
        qty: initialStock,
        availableQty: initialStock,
        unitCost: purchasePrice,
        createdAt: new Date(),
      });
    }

    const item = await Item.create({
      ...data,
      name: data.name.trim(),
      purchasePrice,
      salePrice: Number(data.salePrice || 0),
      stock: initialStock,
      category: data.category || "Others",
      image: data.image || "",
      barcode: data.barcode ? String(data.barcode).trim() : undefined,
      sku: data.sku ? String(data.sku).trim().toUpperCase() : undefined,
      batches: initialBatches,
      tenantId,
      active: true,
    });

    if (initialStock > 0) {
      await StockMovement.recordMovement({
        tenantId,
        productId: item._id,
        movementType: "Purchase",
        changeQty: initialStock,
        previousStock: 0,
        newStock: initialStock,
        unitCost: purchasePrice,
        unitPrice: item.salePrice,
        batchCode: initialBatches[0].batchCode,
        referenceId: item._id,
        referenceType: "InitialStock",
        reason: "Initial catalog inventory setup",
        performedBy: "system",
      });
    }

    if (item.stock <= (item.reorderLevel || 5)) {
      appEvents.emitEvent(EVENT_TYPES.STOCK_LOW, {
        productId: item._id,
        productName: item.name,
        currentStock: item.stock,
        tenantId,
      });
    }

    return item;
  }

  async editItem(data, tenantId = "default-store", operatorId = "system") {
    const id = data._id || data.itemId;
    if (!id) {
      throw new BadRequestError("Product ID is required for editing");
    }

    const item = await Item.findOne({ _id: id, tenantId });
    if (!item) {
      throw new NotFoundError("Product not found");
    }

    const oldPurchasePrice = Number(item.purchasePrice || 0);
    const oldSalePrice = Number(item.salePrice || 0);

    if (data.name) item.name = data.name.trim();

    // Purchase Price change tracking
    if (data.purchasePrice !== undefined && Number(data.purchasePrice) !== oldPurchasePrice) {
      const newPurchase = Number(data.purchasePrice);
      await ProductPriceAudit.recordAudit({
        productId: item._id,
        productName: item.name,
        oldPrice: oldPurchasePrice,
        newPrice: newPurchase,
        priceType: "purchasePrice",
        changeReason: data.priceChangeReason || "Manual catalog price edit",
        changedBy: operatorId,
        tenantId,
      });
      item.purchasePrice = newPurchase;
    }

    // Sale Price change tracking
    if (data.salePrice !== undefined && Number(data.salePrice) !== oldSalePrice) {
      const newSale = Number(data.salePrice);
      await ProductPriceAudit.recordAudit({
        productId: item._id,
        productName: item.name,
        oldPrice: oldSalePrice,
        newPrice: newSale,
        priceType: "salePrice",
        changeReason: data.priceChangeReason || "Manual catalog price edit",
        changedBy: operatorId,
        tenantId,
      });
      item.salePrice = newSale;
    }

    if (data.stock !== undefined) item.stock = Number(data.stock);
    if (data.category) item.category = data.category;
    if (data.image !== undefined) item.image = data.image;
    if (data.barcode !== undefined) item.barcode = data.barcode ? String(data.barcode).trim() : "";
    if (data.sku !== undefined) item.sku = data.sku ? String(data.sku).trim().toUpperCase() : "";
    if (data.dealers !== undefined) item.dealers = data.dealers;
    if (data.reorderLevel !== undefined) item.reorderLevel = Number(data.reorderLevel);
    if (data.active !== undefined) item.active = data.active;

    await item.save();

    if (item.stock <= (item.reorderLevel || 5)) {
      appEvents.emitEvent(EVENT_TYPES.STOCK_LOW, {
        productId: item._id,
        productName: item.name,
        currentStock: item.stock,
        tenantId,
      });
    }

    return item;
  }

  /**
   * Directly replenish or receive a new purchase stock batch
   */
  async receiveStock(data, { tenantId = "default-store", operatorId = "system" } = {}) {
    const { itemId, qty, unitCost, batchCode, supplierId, expiryDate, reason } = data;
    if (!itemId) {
      throw new BadRequestError("Item ID is required to receive stock");
    }

    const numericQty = Number(qty);
    if (isNaN(numericQty) || numericQty <= 0) {
      throw new BadRequestError("Quantity must be greater than zero");
    }

    return unitOfWork.runInTransaction(async (session) => {
      const item = await Item.findOne({ _id: itemId, tenantId }).session(session);
      if (!item) {
        throw new NotFoundError("Product not found");
      }

      const previousStock = item.stock;
      const oldPurchaseCost = Number(item.purchasePrice || 0);
      const newCost = unitCost !== undefined ? Number(unitCost) : oldPurchaseCost;

      const batch = item.addBatch({
        batchCode,
        qty: numericQty,
        unitCost: newCost,
        supplierId: supplierId || null,
        expiryDate: expiryDate || null,
      });

      if (oldPurchaseCost !== newCost) {
        await ProductPriceAudit.recordAudit(
          {
            productId: item._id,
            productName: item.name,
            oldPrice: oldPurchaseCost,
            newPrice: newCost,
            priceType: "purchasePrice",
            changeReason: reason || `Direct batch replenishment: ${batch.batchCode}`,
            batchCode: batch.batchCode,
            changedBy: operatorId,
            tenantId,
          },
          { session }
        );
      }

      await item.save({ session });

      await StockMovement.recordMovement(
        {
          tenantId,
          productId: item._id,
          movementType: "Purchase",
          changeQty: numericQty,
          previousStock,
          newStock: item.stock,
          unitCost: newCost,
          unitPrice: item.salePrice,
          batchId: batch._id,
          batchCode: batch.batchCode,
          referenceId: batch._id,
          referenceType: "PurchaseOrder",
          accountId: supplierId || null,
          reason: reason || "Direct stock batch receipt",
          performedBy: operatorId,
        },
        { session }
      );

      return { item, batch };
    });
  }

  async getPriceAudits(productId, tenantId = "default-store") {
    return ProductPriceAudit.find({ productId, tenantId }).sort({ date: -1, createdAt: -1 });
  }

  async getStockMovements(productId, tenantId = "default-store") {
    return StockMovement.find({ productId, tenantId })
      .populate("accountId", "name accountCode accountType")
      .sort({ date: -1, createdAt: -1 });
  }

  async deleteItem(id, tenantId = "default-store", deletedBy = "system", hardDelete = false) {
    if (!id) {
      throw new BadRequestError("Product ID is required");
    }

    const item = await Item.findOne({ _id: id, tenantId });
    if (!item) {
      throw new NotFoundError("Product not found");
    }

    if (hardDelete) {
      await Item.deleteOne({ _id: id, tenantId });
      return { message: "Item permanently removed from store database" };
    }

    await item.softDelete(deletedBy);
    return { message: "Item deleted successfully", item };
  }

  async getDeletedItems(tenantId = "default-store") {
    return Item.find({ tenantId, isDeleted: true }, null, { withDeleted: true })
      .populate("deletedBy", "name email username")
      .sort({ deletedAt: -1 });
  }

  async restoreItem(id, tenantId = "default-store") {
    if (!id) {
      throw new BadRequestError("Product ID is required to restore");
    }

    const item = await Item.findOne({ _id: id, tenantId }, null, { withDeleted: true });
    if (!item) {
      throw new NotFoundError("Product not found");
    }

    if (typeof item.restore === "function") {
      await item.restore();
    } else {
      item.isDeleted = false;
      item.deletedAt = null;
      item.deletedBy = null;
      await item.save();
    }

    return { message: "Product restored to catalog", item };
  }
}

module.exports = InventoryService;