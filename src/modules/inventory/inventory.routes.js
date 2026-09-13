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

  // Dynamic ID endpoint
  router.get("/:id", optionalAuthenticate, controller.getItemById);

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