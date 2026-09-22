const express = require("express");
const { createBillingController } = require("./billing.controller");
const { authenticate, optionalAuthenticate } = require("../../core/middlewares/authenticate");
const { requirePermission } = require("../../core/middlewares/requirePermission");

function createBillingRoutes(billingService) {
  const router = express.Router();
  const controller = createBillingController(billingService);

  // Read invoices: base endpoints
  router.get("/get-bill", optionalAuthenticate, controller.getBills);
  router.get("/", optionalAuthenticate, controller.getBills);

  // Voided bills audit trail & restore (MUST BE DECLARED BEFORE /:id)
  router.get("/voided", authenticate, requirePermission("bills:void"), controller.getVoidedBills);
  router.post("/restore/:id", authenticate, requirePermission("bills:edit"), controller.restoreBill);
  router.post("/restore", authenticate, requirePermission("bills:edit"), controller.restoreBill);

  // Financial Intelligence & Profit-Loss Statements (MUST BE DECLARED BEFORE /:id)
  router.get("/reports/profit-loss", optionalAuthenticate, controller.getProfitLoss);
  router.get("/profit-loss", optionalAuthenticate, controller.getProfitLoss);

  // Dynamic ID endpoints
  router.get("/:id", optionalAuthenticate, controller.getBillById);
  router.get("/:id/receipt", optionalAuthenticate, controller.getReceipt);

  // Mutations
  router.post("/add-bill", optionalAuthenticate, controller.createBill);
  router.post("/", optionalAuthenticate, controller.createBill);

  router.put("/edit-bill", authenticate, requirePermission("bills:edit"), controller.editBill);
  router.put("/", authenticate, requirePermission("bills:edit"), controller.editBill);

  router.post("/void-bill", authenticate, requirePermission("bills:void"), controller.voidBill);
  router.post("/void-bill/:id", authenticate, requirePermission("bills:void"), controller.voidBill);
  router.patch("/void/:id", authenticate, requirePermission("bills:void"), controller.voidBill);

  router.delete("/delete-bill/:id", authenticate, requirePermission("bills:delete"), controller.deleteBill);
  router.delete("/:id", authenticate, requirePermission("bills:delete"), controller.deleteBill);

  return router;
}

module.exports = createBillingRoutes;