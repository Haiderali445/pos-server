const mongoose = require("mongoose");
const Account = require("../../core/models/Account");
const AccountTransaction = require("../../core/models/AccountTransaction");
const Bill = require("../../core/models/Bill");
const { unitOfWork } = require("../../core/database/unitOfWork");
const { NotFoundError, BadRequestError } = require("../../core/errors/AppError");

const roundMoney = (value) => Number(Number(value || 0).toFixed(2));

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
      currentBalance: roundMoney(data.currentBalance || data.openingBalance || 0),
      openingBalance: roundMoney(data.openingBalance || 0),
      creditLimit: roundMoney(data.creditLimit || 0),
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
    const payAmount = roundMoney(amount);
    if (!Number.isFinite(payAmount) || payAmount <= 0) {
      throw new BadRequestError("Valid payment amount greater than zero is required");
    }

    return unitOfWork.runInTransaction(async (session) => {
      const account = await Account.findOne({ _id: id, tenantId }).session(session);
      if (!account) {
        throw new NotFoundError("Account not found");
      }

      const previousBalance = roundMoney(account.currentBalance);

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

  async recordBalanceAdjustment(
    id,
    { amount, reason, direction = "reduce", relatedInvoiceId = null } = {},
    { tenantId = "default-store", operatorId = "system" } = {}
  ) {
    const adjustmentAmount = roundMoney(amount);
    if (!id) throw new BadRequestError("Account ID is required");
    if (!Number.isFinite(adjustmentAmount) || adjustmentAmount <= 0) {
      throw new BadRequestError("Adjustment amount must be greater than zero");
    }
    if (!reason || !String(reason).trim()) {
      throw new BadRequestError("A reason is required for the balance adjustment");
    }
    if (!["reduce", "increase"].includes(direction)) {
      throw new BadRequestError("Adjustment direction must be reduce or increase");
    }

    return unitOfWork.runInTransaction(async (session) => {
      const account = await Account.findOne({ _id: id, tenantId }).session(session);
      if (!account) throw new NotFoundError("Account not found");

      let invoice = null;
      if (relatedInvoiceId) {
        invoice = await Bill.findOne({
          _id: relatedInvoiceId,
          accountId: account._id,
          tenantId,
          invoiceType: { $in: ["Sale", "Purchase"] },
          status: "completed",
        }).session(session);
        if (!invoice) {
          throw new BadRequestError("The selected invoice does not belong to this account or is not editable");
        }
      }

      const balanceChange = direction === "reduce" ? -adjustmentAmount : adjustmentAmount;
      if (direction === "reduce" && adjustmentAmount - Number(account.currentBalance || 0) > 0.005) {
        throw new BadRequestError(
          `Adjustment exceeds the outstanding balance of PKR ${Number(account.currentBalance || 0).toFixed(2)}`
        );
      }
      const updatedAccount = await Account.findOneAndUpdate(
        { _id: account._id, tenantId },
        { $inc: { currentBalance: balanceChange } },
        { new: true, session }
      );

      const customer = account.accountType === "Customer";
      const reducesBalance = direction === "reduce";
      const adjustmentId = new mongoose.Types.ObjectId();
      const transaction = await AccountTransaction.create(
        [
          {
            _id: adjustmentId,
            tenantId,
            accountId: account._id,
            transactionType: "Adjustment",
            amount: adjustmentAmount,
            debit: customer ? (reducesBalance ? 0 : adjustmentAmount) : (reducesBalance ? adjustmentAmount : 0),
            credit: customer ? (reducesBalance ? adjustmentAmount : 0) : (reducesBalance ? 0 : adjustmentAmount),
            balanceAfter: updatedAccount.currentBalance,
            reference_table: "Adjustments",
            reference_id: adjustmentId,
            relatedInvoiceId: invoice?._id || null,
            invoiceNumber: invoice?.invoiceNumber || "",
            description: reducesBalance ? "Agreed balance reduction" : "Additional balance charge",
            notes: String(reason).trim(),
            date: new Date(),
            operatorId,
          },
        ],
        { session }
      );

      return { account: updatedAccount, transaction: transaction[0] };
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
        billId: inv._id,
        invoiceNumber: inv.invoiceNumber,
        invoiceType: inv.invoiceType,
        date: inv.date || inv.createdAt,
        totalAmount: totalAmt,
        paidAmount: paidAmt,
        dueAmount: dueAmt,
        debit,
        credit,
        balanceChange: Number(((isPayment ? -paidAmt : totalAmt - paidAmt)).toFixed(2)),
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
        const balanceChange = isCustomer
          ? Number(tx.debit || 0) - Number(tx.credit || 0)
          : Number(tx.credit || 0) - Number(tx.debit || 0);
        unifiedTransactions.push({
          _id: tx._id,
          invoiceNumber: tx.invoiceNumber || "",
          invoiceType: tx.transactionType || "Adjustment",
          date: tx.date || tx.createdAt,
          totalAmount: tx.amount,
          paidAmount: tx.transactionType === "Payment" ? tx.amount : 0,
          dueAmount: 0,
          debit: tx.debit,
          credit: tx.credit,
          balanceChange,
          paymentMethod: tx.paymentMethod || "manual",
          paymentStatus: "completed",
          notes: tx.description || tx.notes,
          reference_table: tx.reference_table,
          reference_id: tx.reference_id,
          billId: tx.relatedInvoiceId || (tx.reference_table === "Invoices" ? tx.reference_id : null),
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
