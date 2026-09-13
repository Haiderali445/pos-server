const express = require("express");
const { createTenantController } = require("./tenant.controller");
const { authenticate } = require("../../core/middlewares/authenticate");
const { requirePermission } = require("../../core/middlewares/requirePermission");

function createUserManagementRoutes(tenantService) {
  const router = express.Router();
  const controller = createTenantController(tenantService);

  // User management endpoints: strictly requires users:manage (Admin)
  router.get("/all", authenticate, requirePermission("users:manage"), controller.getAllUsers);
  router.get("/get-users", authenticate, requirePermission("users:manage"), controller.getAllUsers);
  router.get("/get-all-users", authenticate, requirePermission("users:manage"), controller.getAllUsers);
  router.get("/", authenticate, requirePermission("users:manage"), controller.getAllUsers);

  router.post("/admin-create", authenticate, requirePermission("users:manage"), controller.adminCreateUser);
  router.post("/add-user", authenticate, requirePermission("users:manage"), controller.adminCreateUser);

  router.patch("/toggle-status", authenticate, requirePermission("users:manage"), controller.toggleStatus);
  router.post("/toggle-status", authenticate, requirePermission("users:manage"), controller.toggleStatus);

  router.patch("/update-role", authenticate, requirePermission("users:manage"), controller.updateRole);
  router.post("/update-role", authenticate, requirePermission("users:manage"), controller.updateRole);

  router.delete("/delete/:userId", authenticate, requirePermission("users:manage"), controller.deleteUser);
  router.delete("/:userId", authenticate, requirePermission("users:manage"), controller.deleteUser);
  router.post("/delete-user", authenticate, requirePermission("users:manage"), controller.deleteUser);

  return router;
}

function createTenantConfigRoutes(tenantService) {
  const router = express.Router();
  const controller = createTenantController(tenantService);

  router.get("/settings", authenticate, requirePermission("tenant:config"), controller.getTenantSettings);
  router.put("/settings", authenticate, requirePermission("tenant:config"), controller.updateTenantSettings);

  return router;
}

module.exports = {
  createUserManagementRoutes,
  createTenantConfigRoutes,
};
