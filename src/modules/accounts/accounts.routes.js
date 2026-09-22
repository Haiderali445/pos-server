const express = require("express");
const { createAccountsController } = require("./accounts.controller");
const { authenticate, optionalAuthenticate } = require("../../core/middlewares/authenticate");
const { requirePermission } = require("../../core/middlewares/requirePermission");

function createAccountRoutes(accountsService) {
  const router = express.Router();
  const controller = createAccountsController(accountsService);

  router.get("/", optionalAuthenticate, controller.getAccounts);
  router.get("/get-accounts", optionalAuthenticate, controller.getAccounts);
  router.get("/:id", optionalAuthenticate, controller.getAccountById);
  router.get("/:id/ledger", optionalAuthenticate, controller.getAccountLedger);

  router.post("/", authenticate, requirePermission("dealers:manage", "pos:checkout"), controller.createAccount);
  router.post("/add-account", authenticate, requirePermission("dealers:manage", "pos:checkout"), controller.createAccount);
  router.post("/:id/payment", authenticate, requirePermission("dealers:manage", "pos:checkout"), controller.recordPayment);

  router.put("/:id", authenticate, requirePermission("dealers:manage"), controller.updateAccount);
  router.put("/edit-account", authenticate, requirePermission("dealers:manage"), controller.updateAccount);

  return router;
}

module.exports = createAccountRoutes;
