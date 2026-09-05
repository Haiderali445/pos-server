const express = require("express");
const { createChargesController } = require("../controllers/chargesController");

function createChargesRoutes({ chargeService }) {
    const router = express.Router();
    const {
        getAllCharges,
        addCharge,
        updateCharge,
        deleteCharge,
    } = createChargesController({ chargeService });

    router.get("/get-charges", getAllCharges);
    router.post("/add-charge", addCharge);
    router.put("/edit-charge", updateCharge);
    router.post("/delete-charge", deleteCharge);

    return router;
}

module.exports = createChargesRoutes;
