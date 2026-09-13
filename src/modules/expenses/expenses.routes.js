const express = require("express");
const { createDealersController } = require("./dealers.controller");
const { createChargesController } = require("./charges.controller");
const { authenticate, optionalAuthenticate } = require("../../core/middlewares/authenticate");
const { requirePermission } = require("../../core/middlewares/requirePermission");

function createDealerRoutes(dealersService) {
  const router = express.Router();
  const controller = createDealersController(dealersService);

  router.get("/get-dealers", optionalAuthenticate, controller.getDealers);
  router.get("/", optionalAuthenticate, controller.getDealers);
  router.get("/:id", optionalAuthenticate, controller.getDealerById);

  router.post("/add-dealer", authenticate, requirePermission("dealers:manage"), controller.addDealer);
  router.post("/", authenticate, requirePermission("dealers:manage"), controller.addDealer);

  router.put("/edit-dealer", authenticate, requirePermission("dealers:manage"), controller.editDealer);
  router.put("/", authenticate, requirePermission("dealers:manage"), controller.editDealer);
  router.put("/:id", authenticate, requirePermission("dealers:manage"), (req, res, next) => {
    req.body.dealerId = req.params.id;
    controller.editDealer(req, res, next);
  });

  router.post("/delete-dealer", authenticate, requirePermission("dealers:manage"), controller.deleteDealer);
  router.delete("/delete-dealer", authenticate, requirePermission("dealers:manage"), controller.deleteDealer);
  router.delete("/:id", authenticate, requirePermission("dealers:manage"), controller.deleteDealer);

  return router;
}

function createChargesRoutes(chargesService) {
  const router = express.Router();
  const controller = createChargesController(chargesService);

  router.get("/get-charges", optionalAuthenticate, controller.getCharges);
  router.get("/", optionalAuthenticate, controller.getCharges);
  router.get("/:id", optionalAuthenticate, controller.getChargeById);

  router.post("/add-charge", authenticate, requirePermission("expenses:manage"), controller.addCharge);
  router.post("/", authenticate, requirePermission("expenses:manage"), controller.addCharge);

  router.put("/edit-charge", authenticate, requirePermission("expenses:manage"), controller.editCharge);
  router.put("/", authenticate, requirePermission("expenses:manage"), controller.editCharge);
  router.put("/:id", authenticate, requirePermission("expenses:manage"), (req, res, next) => {
    req.body.chargeId = req.params.id;
    controller.editCharge(req, res, next);
  });

  router.post("/delete-charge", authenticate, requirePermission("expenses:manage"), controller.deleteCharge);
  router.delete("/delete-charge", authenticate, requirePermission("expenses:manage"), controller.deleteCharge);
  router.delete("/:id", authenticate, requirePermission("expenses:manage"), controller.deleteCharge);

  return router;
}

module.exports = {
  createDealerRoutes,
  createChargesRoutes,
};
