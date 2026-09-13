const ChargesService = require("./charges.service");

function createChargesController(chargesService = new ChargesService()) {
  const getCharges = async (req, res, next) => {
    try {
      const charges = await chargesService.getCharges({
        tenantId: req.tenantId,
        search: req.query.search,
      });
      return res.status(200).json(charges);
    } catch (error) {
      next(error);
    }
  };

  const getChargeById = async (req, res, next) => {
    try {
      const charge = await chargesService.getChargeById(req.params.id, req.tenantId);
      return res.status(200).json(charge);
    } catch (error) {
      next(error);
    }
  };

  const addCharge = async (req, res, next) => {
    try {
      const charge = await chargesService.addCharge(req.body, req.tenantId);
      return res.status(201).json(charge);
    } catch (error) {
      next(error);
    }
  };

  const editCharge = async (req, res, next) => {
    try {
      const charge = await chargesService.editCharge(req.body, req.tenantId);
      return res.status(200).json(charge);
    } catch (error) {
      next(error);
    }
  };

  const deleteCharge = async (req, res, next) => {
    try {
      const id = req.params.id || req.body.chargeId || req.body._id;
      const result = await chargesService.deleteCharge(id, req.tenantId, req.user?.userId || "system");
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  return {
    getCharges,
    getChargeById,
    addCharge,
    editCharge,
    deleteCharge,
  };
}

module.exports = { createChargesController };
