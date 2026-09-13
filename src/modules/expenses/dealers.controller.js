const DealersService = require("./dealers.service");

function createDealersController(dealersService = new DealersService()) {
  const getDealers = async (req, res, next) => {
    try {
      const dealers = await dealersService.getDealers({
        tenantId: req.tenantId,
        search: req.query.search,
      });
      return res.status(200).json(dealers);
    } catch (error) {
      next(error);
    }
  };

  const getDealerById = async (req, res, next) => {
    try {
      const dealer = await dealersService.getDealerById(req.params.id, req.tenantId);
      return res.status(200).json(dealer);
    } catch (error) {
      next(error);
    }
  };

  const addDealer = async (req, res, next) => {
    try {
      const dealer = await dealersService.addDealer(req.body, req.tenantId);
      return res.status(201).json(dealer);
    } catch (error) {
      next(error);
    }
  };

  const editDealer = async (req, res, next) => {
    try {
      const dealer = await dealersService.editDealer(req.body, req.tenantId);
      return res.status(200).json(dealer);
    } catch (error) {
      next(error);
    }
  };

  const deleteDealer = async (req, res, next) => {
    try {
      const id = req.params.id || req.body.dealerId || req.body._id;
      const result = await dealersService.deleteDealer(id, req.tenantId, req.user?.userId || "system");
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  return {
    getDealers,
    getDealerById,
    addDealer,
    editDealer,
    deleteDealer,
  };
}

module.exports = { createDealersController };
