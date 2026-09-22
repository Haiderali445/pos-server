const express = require("express");
const { createInventoryController } = require("./inventory.controller");
const { authenticate, optionalAuthenticate } = require("../../core/middlewares/authenticate");
const { requirePermission } = require("../../core/middlewares/requirePermission");

function createInventoryRoutes(inventoryService) {
  const router = express.Router();
  const controller = createInventoryController(inventoryService);

  // Read catalog: base endpoints
  router.get("/get-item", optionalAuthenticate, controller.getItems);
  router.get("/", optionalAuthenticate, controller.getItems);

  // Deleted items audit trail & restore (MUST BE DECLARED BEFORE /:id)
  router.get("/deleted", authenticate, requirePermission("catalog:manage"), controller.getDeletedItems);
  router.post("/restore/:id", authenticate, requirePermission("catalog:manage"), controller.restoreItem);
  router.post("/restore", authenticate, requirePermission("catalog:manage"), controller.restoreItem);

  // Stock replenishment (MUST BE DECLARED BEFORE /:id)
  router.post("/receive-stock", authenticate, requirePermission("catalog:manage"), controller.receiveStock);

  // Dynamic ID endpoints
  router.get("/:id", optionalAuthenticate, controller.getItemById);
  router.get("/:id/price-audits", authenticate, requirePermission("catalog:read", "catalog:manage"), controller.getPriceAudits);
  router.get("/:id/movements", authenticate, requirePermission("catalog:read", "catalog:manage"), controller.getStockMovements);

  // Catalog mutations
  router.post("/add-item", authenticate, requirePermission("catalog:manage"), controller.addItem);
  router.post("/", authenticate, requirePermission("catalog:manage"), controller.addItem);

  router.put("/edit-item", authenticate, requirePermission("catalog:manage"), controller.editItem);
  router.put("/", authenticate, requirePermission("catalog:manage"), controller.editItem);
  router.put("/:id", authenticate, requirePermission("catalog:manage"), (req, res, next) => {
    req.body.itemId = req.params.id;
    controller.editItem(req, res, next);
  });

  // Deletions
  router.post("/delete-item", authenticate, requirePermission("catalog:manage", "catalog:delete"), controller.deleteItem);
  router.delete("/delete-item", authenticate, requirePermission("catalog:manage", "catalog:delete"), controller.deleteItem);
  router.delete("/:id", authenticate, requirePermission("catalog:manage", "catalog:delete"), controller.deleteItem);

  return router;
}

module.exports = createInventoryRoutes;