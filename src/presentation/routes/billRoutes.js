const express = require("express");
const { createBillController } = require("../controllers/billController");

function createBillRoutes({ checkoutService, billRepository }) {
  const router = express.Router();
  const {
    addbillController,
    getbillController,
    editBillController,
    deleteBillController,
  } = createBillController({ checkoutService, billRepository });

  router.get("/get-bill", getbillController);
  router.post("/add-bill", addbillController);
  router.put("/edit-bill", editBillController);
  router.delete("/delete-bill/:id", deleteBillController);

  return router;
}

module.exports = createBillRoutes;
