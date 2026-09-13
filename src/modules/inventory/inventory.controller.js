const InventoryService = require("./inventory.service");

function createInventoryController(inventoryService = new InventoryService()) {
  const getItems = async (req, res, next) => {
    try {
      const items = await inventoryService.getItems({
        tenantId: req.tenantId,
        search: req.query.search,
        category: req.query.category,
      });
      return res.status(200).json(items);
    } catch (error) {
      next(error);
    }
  };

  const getItemById = async (req, res, next) => {
    try {
      const item = await inventoryService.getItemById(req.params.id, req.tenantId);
      return res.status(200).json(item);
    } catch (error) {
      next(error);
    }
  };

  const addItem = async (req, res, next) => {
    try {
      const item = await inventoryService.addItem(req.body, req.tenantId);
      return res.status(201).json(item);
    } catch (error) {
      next(error);
    }
  };

  const editItem = async (req, res, next) => {
    try {
      const item = await inventoryService.editItem(req.body, req.tenantId);
      return res.status(200).json(item);
    } catch (error) {
      next(error);
    }
  };

  const deleteItem = async (req, res, next) => {
    try {
      const itemId = req.params.id || req.body.itemId || req.body._id;
      const hardDelete = req.user?.role === "admin" && (req.query.hard === "true" || req.body.hard === true);
      const result = await inventoryService.deleteItem(
        itemId,
        req.tenantId,
        req.user?.userId || "system",
        hardDelete
      );
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  const getDeletedItems = async (req, res, next) => {
    try {
      const items = await inventoryService.getDeletedItems(req.tenantId);
      return res.status(200).json(items);
    } catch (error) {
      next(error);
    }
  };

  const restoreItem = async (req, res, next) => {
    try {
      const itemId = req.params.id || req.body.itemId || req.body._id;
      const result = await inventoryService.restoreItem(itemId, req.tenantId);
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  return {
    getItems,
    getItemById,
    addItem,
    editItem,
    deleteItem,
    getDeletedItems,
    restoreItem,
  };
}

module.exports = { createInventoryController };