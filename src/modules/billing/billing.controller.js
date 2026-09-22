const BillingService = require("./billing.service");

function createBillingController(billingService = new BillingService()) {
  const getBills = async (req, res, next) => {
    try {
      const bills = await billingService.getBills({
        tenantId: req.tenantId,
        search: req.query.search,
        paymentMethod: req.query.paymentMethod,
      });
      return res.status(200).json(bills);
    } catch (error) {
      next(error);
    }
  };

  const getBillById = async (req, res, next) => {
    try {
      const bill = await billingService.getBillById(req.params.id, req.tenantId);
      return res.status(200).json(bill);
    } catch (error) {
      next(error);
    }
  };

  const createBill = async (req, res, next) => {
    try {
      const bill = await billingService.createBill(req.body, {
        tenantId: req.tenantId,
        operatorId: req.user?.userId || "system",
      });
      return res.status(201).json(bill);
    } catch (error) {
      next(error);
    }
  };

  const editBill = async (req, res, next) => {
    try {
      const bill = await billingService.editBill(req.body, req.tenantId);
      return res.status(200).json(bill);
    } catch (error) {
      next(error);
    }
  };

  const voidBill = async (req, res, next) => {
    try {
      const billId = req.params.id || req.body.billId || req.body._id;
      const result = await billingService.voidBill(
        billId,
        req.tenantId,
        req.user?.userId || "system"
      );
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  const restoreBill = async (req, res, next) => {
    try {
      const billId = req.params.id || req.body.billId || req.body._id;
      const result = await billingService.restoreBill(billId, req.tenantId);
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  const deleteBill = async (req, res, next) => {
    try {
      const billId = req.params.id || req.body.billId || req.body._id;
      const result = await billingService.deleteBill(billId, req.tenantId);
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  const getReceipt = async (req, res, next) => {
    try {
      const formattedReceipt = await billingService.getFormattedReceipt(
        req.params.id,
        req.tenantId
      );
      return res.status(200).json(formattedReceipt);
    } catch (error) {
      next(error);
    }
  };

  const getVoidedBills = async (req, res, next) => {
    try {
      const bills = await billingService.getVoidedBills(req.tenantId);
      return res.status(200).json(bills);
    } catch (error) {
      next(error);
    }
  };

  const getProfitLoss = async (req, res, next) => {
    try {
      const report = await billingService.getProfitLoss({
        tenantId: req.tenantId,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
      });
      return res.status(200).json(report);
    } catch (error) {
      next(error);
    }
  };

  return {
    getBills,
    getBillById,
    createBill,
    editBill,
    voidBill,
    restoreBill,
    deleteBill,
    getReceipt,
    getVoidedBills,
    getProfitLoss,
  };
}

module.exports = { createBillingController };