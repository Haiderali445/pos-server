const express = require("express");
const { createItemController } = require("../controllers/itemController");

function createItemRoutes({ itemService }) {
  const router = express.Router();
  const {
    getItemController,
    addItemController,
    edititemController,
    deleteitemController,
  } = createItemController({ itemService });

  router.get("/get-item", getItemController);
  router.post("/add-item", addItemController);
  router.put("/edit-item", edititemController);
  router.post("/delete-item", deleteitemController);

  return router;
}

module.exports = createItemRoutes;
