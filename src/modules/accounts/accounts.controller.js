const AccountsService = require("./accounts.service");

function createAccountsController(accountsService = new AccountsService()) {
  const getAccounts = async (req, res, next) => {
    try {
      const accounts = await accountsService.getAccounts({
        tenantId: req.tenantId,
        accountType: req.query.type || req.query.accountType,
        search: req.query.search,
      });
      return res.status(200).json(accounts);
    } catch (error) {
      next(error);
    }
  };

  const getAccountById = async (req, res, next) => {
    try {
      const account = await accountsService.getAccountById(req.params.id, req.tenantId);
      return res.status(200).json(account);
    } catch (error) {
      next(error);
    }
  };

  const createAccount = async (req, res, next) => {
    try {
      const account = await accountsService.createAccount(req.body, req.tenantId);
      return res.status(201).json(account);
    } catch (error) {
      next(error);
    }
  };

  const updateAccount = async (req, res, next) => {
    try {
      const account = await accountsService.updateAccount(
        req.params.id || req.body._id,
        req.body,
        req.tenantId
      );
      return res.status(200).json(account);
    } catch (error) {
      next(error);
    }
  };

  const recordPayment = async (req, res, next) => {
    try {
      const result = await accountsService.recordPayment(
        req.params.id,
        req.body,
        { tenantId: req.tenantId, operatorId: req.user?.userId || req.user?.name || "system" }
      );
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  const getAccountLedger = async (req, res, next) => {
    try {
      const ledger = await accountsService.getAccountLedger(req.params.id, {
        tenantId: req.tenantId,
      });
      return res.status(200).json(ledger);
    } catch (error) {
      next(error);
    }
  };

  return {
    getAccounts,
    getAccountById,
    createAccount,
    updateAccount,
    recordPayment,
    getAccountLedger,
  };
}

module.exports = { createAccountsController };
