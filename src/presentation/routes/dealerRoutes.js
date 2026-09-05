const express = require('express');
const { createDealerController } = require('../controllers/dealerController');

function createDealerRoutes({ dealerService }) {
  const router = express.Router();
  const {
    getAllDealers,
    addDealer,
    getDealerById,
    updateDealerById,
    deleteDealerById,
  } = createDealerController({ dealerService });

  router.get('/get-dealers', getAllDealers);
  router.post('/add-dealer', addDealer);
  router.put('/edit-dealer', updateDealerById);
  router.post('/delete-dealer', deleteDealerById);

  return router;
}

module.exports = createDealerRoutes;
