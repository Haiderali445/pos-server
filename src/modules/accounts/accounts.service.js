const mongoose = require("mongoose");
const Account = require("../../core/models/Account");
const AccountTransaction = require("../../core/models/AccountTransaction");
const Bill = require("../../core/models/Bill");
const { unitOfWork } = require("../../core/database/unitOfWork");
const { NotFoundError, BadRequestError } = require("../../core/errors/AppError");

class AccountsService {
  async getAccounts({ tenantId = "default-store", accountType = "", search = "" } = {}) {
    const query = { tenantId, isDeleted: { $ne: true } };

    if (accountType && accountType !== "all") {
      query.accountType = accountType;
    }

    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), "i");
      query.$or = [{ name: regex }, { phone: regex }, { accountCode: regex }];
    }

    return Account.find(query).sort({ name: 1, createdAt: -1 });
  }

  async getAccountById(id, tenantId = "default-store") {
    const account = await Account.findOne({ _id: id, tenantId });
    if (!account) {
      throw new NotFoundError("Account not found");
    }
    return account;
  }

  async createAccount(data, tenantId = "default-store") {
    if (!data.name || !data.accountType) {
      throw new BadRequestError("Account name and account type are required");
    }

    let code = data.accountCode ? data.accountCode.trim().toUpperCase() : "";
    if (!code) {
      const prefix = data.accountType === "Customer" ? "CUST" : data.accountType === "Supplier" ? "SUPP" : "EXP";
      const count = await Account.countDocuments({ tenantId, accountType: data.accountType });
      code = `${prefix}-${String(count + 1).padStart(4, "0")}`;
    }

    return Account.create({
      ...data,
      accountCode: code,
      name: data.name.trim(),
      accountType: data.accountType,
      phone: data.phone ? data.phone.trim() : "",
      email: data.email ? data.email.trim().toLowerCase() : "",
      address: data.address ? data.address.trim() : "",
      currentBalance: Number(data.currentBalance || data.openingBalance || 0),
      openingBalance: Number(data.openingBalance || 0),
      creditLimit: Number(data.creditLimit || 0),
      tenantId,
      active: true,
    });
  }

  async updateAccount(id, data, tenantId = "default-store") {
    if (!id) {
      throw new BadRequestError("Account ID is required");
    }

    const account = await Account.findOne({ _id: id, tenantId });
    if (!account) {
      throw new NotFoundError("Account not found");
    }

    if (data.name) account.name = data.name.trim();
    if (data.phone !== undefined) account.phone = data.phone ? data.phone.trim() : "";
    if (data.email !== undefined) account.email = data.email ? data.email.trim().toLowerCase() : "";
    if (data.address !== undefined) account.address = data.address.trim();
    if (data.creditLimit !== undefined) account.creditLimit = Number(data.creditLimit);
    if (data.active !== undefined) account.active = data.active;
    if (data.notes !== undefined) account.notes = data.notes;

    await account.save();
    return account;
  }

  /**
   * Atomically records an account payment (Customer collection or Supplier payment),
   * updates currentBalance, creates the payment invoice/receipt, and logs an AccountTransaction.
   */
  async recordPayment(
    id,
    { amount, paymentMethod = "cash", notes = "" } = {},
    { tenantId = "default-store", operatorId = "system" } = {}
  ) {
    if (!id) {
      throw new BadRequestError("Account ID is required");
    }
    const payAmount = Number(amount);
    if (!payAmount || payAmount <= 0) {
      throw new BadRequestError("Valid payment amount greater than zero is required");
    }

    return unitOfWork.runInTransaction(async (session) => {
      const account = await Account.findOne({ _id: id, tenantId }).session(session);
      if (!account) {
        throw new NotFoundError("Account not found");
      }

      const previousBalance = Number(account.currentBalance || 0);

      // Customer payment reduces receivable; Supplier payment reduces payable
      const updatedAccount = await Account.findOneAndUpdate(
        { _id: id, tenantId },
        { $inc: { currentBalance: -payAmount } },
        { new: true, session }
      );

      const billId = new mongoose.Types.ObjectId();
      const [bill] = await Bill.create(
        [
          {
            _id: billId,
            invoiceType: "Payment",
            accountId: account._id,
            costumerName: account.name,
            costumerNumber: account.phone || "",
            subtotal: 0,
            taxAmount: 0,
            totalAmount: payAmount,
            paidAmount: payAmount,
            dueAmount: 0,
            paymentMethod,
            paymentStatus: "paid",
            cartItems: [
              {
                name: `Khata Payment (${account.accountType}) - Prev: ${previousBalance.toFixed(2)}`,
                quantity: 1,
                unitPrice: payAmount,
                salePrice: payAmount,
                subtotal: payAmount,
                unitProfit: 0,
                totalProfit: 0,
              },
            ],
            notes: notes || `Payment recorded against ${account.accountCode}`,
            tenantId,
            operatorId,
            date: new Date(),
            status: "completed",
          },
        ],
        { session }
      );

      // Log AccountTransaction audit entry
      await AccountTransaction.create(
        [
          {
            tenantId,
            accountId: account._id,
            transactionType: "Payment",
            amount: payAmount,
            debit: account.accountType === "Supplier" ? payAmount : 0,
            credit: account.accountType === "Customer" ? payAmount : 0,
            balanceAfter: updatedAccount.currentBalance,
            reference_table: "Invoices",
            reference_id: bill._id,
            invoiceNumber: bill.invoiceNumber,
            paymentMethod,
            description: `Payment ${account.accountType === "Customer" ? "Received from" : "Issued to"} ${account.name}`,
            notes: notes || `Settlement against ${account.accountCode}`,
            date: bill.date || new Date(),
            operatorId,
          },
        ],
        { session }
      );

      return {
        account: updatedAccount,
        receipt: bill,
        previousBalance,
        currentBalance: updatedAccount.currentBalance,
        paidAmount: payAmount,
      };
    });
  }

  /**
   * Fetches account details along with all related Invoices (filtered by account_id)
   * and AccountTransactions to provide a complete, accurate financial audit trail.
   */
  async getAccountLedger(id, { tenantId = "default-store" } = {}) {
    if (!id) {
      throw new BadRequestError("Account ID is required");
    }

    const account = await Account.findOne({ _id: id, tenantId });
    if (!account) {
      throw new NotFoundError("Account not found");
    }

    // Build query supporting ObjectId and string representation
    const accountQuery = {
      tenantId,
      $or: [{ accountId: id }],
    };
    if (mongoose.Types.ObjectId.isValid(id)) {
      accountQuery.$or.push({ accountId: new mongoose.Types.ObjectId(id) });
    }

    // 1. Fetch Invoices / Bills for this account
    const invoices = await Bill.find({
      ...accountQuery,
      status: { $ne: "voided" },
    }).sort({ date: -1, createdAt: -1 });

    // 2. Fetch AccountTransactions for this account
    const accountTransactions = await AccountTransaction.find({
      ...accountQuery,
    }).sort({ date: -1, createdAt: -1 });

    // 3. Build unified transactions list for frontend statement and running balance
    const isCustomer = account.accountType === "Customer";

    const unifiedTransactions = invoices.map((inv) => {
      const isPayment = inv.invoiceType === "Payment";
      const totalAmt = Number(inv.totalAmount || 0);
      const paidAmt = Number(inv.paidAmount || 0);
      const dueAmt = Number(inv.dueAmount !== undefined ? inv.dueAmount : Math.max(0, totalAmt - paidAmt));

      let debit = 0;
      let credit = 0;

      if (isCustomer) {
        if (isPayment) {
          credit = paidAmt || totalAmt;
        } else {
          // Sale invoice
          debit = totalAmt;
          credit = paidAmt;
        }
      } else {
        // Supplier
        if (isPayment) {
          debit = paidAmt || totalAmt;
        } else {
          // Purchase bill
          credit = totalAmt;
          debit = paidAmt;
        }
      }

      return {
        _id: inv._id,
        invoiceNumber: inv.invoiceNumber,
        invoiceType: inv.invoiceType,
        date: inv.date || inv.createdAt,
        totalAmount: totalAmt,
        paidAmount: paidAmt,
        dueAmount: dueAmt,
        debit,
        credit,
        paymentMethod: inv.paymentMethod,
        paymentStatus: inv.paymentStatus,
        cartItems: inv.cartItems,
        notes: inv.notes,
        reference_table: "Invoices",
        reference_id: inv._id,
        createdAt: inv.createdAt,
      };
    });

    // Merge any standalone AccountTransactions (e.g. adjustments, manual notes) not tied to an invoice
    for (const tx of accountTransactions) {
      const refIdStr = String(tx.reference_id || "");
      const alreadyPresent = unifiedTransactions.some((item) => String(item._id) === refIdStr);
      if (!alreadyPresent) {
        unifiedTransactions.push({
          _id: tx._id,
          invoiceNumber: tx.invoiceNumber || (tx.reference_id ? `REF-${String(tx.reference_id).slice(-6)}` : "TX"),
          invoiceType: tx.transactionType || "Adjustment",
          date: tx.date || tx.createdAt,
          totalAmount: tx.amount,
          paidAmount: tx.transactionType === "Payment" ? tx.amount : 0,
          dueAmount: 0,
          debit: tx.debit,
          credit: tx.credit,
          paymentMethod: tx.paymentMethod || "manual",
          paymentStatus: "completed",
          notes: tx.description || tx.notes,
          reference_table: tx.reference_table,
          reference_id: tx.reference_id,
          createdAt: tx.createdAt,
        });
      }
    }

    // Sort newest first
    unifiedTransactions.sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0));

    return {
      account,
      invoices,
      accountTransactions,
      transactions: unifiedTransactions,
    };
  }
}

module.exports = AccountsService;
