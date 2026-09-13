const Item = require("../../core/models/Item");
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

    const item = await Item.create({
      ...data,
      name: data.name.trim(),
      purchasePrice: Number(data.purchasePrice || 0),
      salePrice: Number(data.salePrice || 0),
      stock: Number(data.stock || 0),
      category: data.category || "Others",
      image: data.image || "",
      barcode: data.barcode ? String(data.barcode).trim() : undefined,
      sku: data.sku ? String(data.sku).trim().toUpperCase() : undefined,
      tenantId,
      active: true,
    });

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

  async editItem(data, tenantId = "default-store") {
    const id = data._id || data.itemId;
    if (!id) {
      throw new BadRequestError("Product ID is required for editing");
    }

    const item = await Item.findOne({ _id: id, tenantId });
    if (!item) {
      throw new NotFoundError("Product not found");
    }

    if (data.name) item.name = data.name.trim();
    if (data.purchasePrice !== undefined) item.purchasePrice = Number(data.purchasePrice);
    if (data.salePrice !== undefined) item.salePrice = Number(data.salePrice);
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