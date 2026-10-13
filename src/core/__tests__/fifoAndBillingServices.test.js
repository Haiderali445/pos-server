const assert = require("assert");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(__dirname, "../../../.env.local") });

const { connectDatabase, disconnectDatabase } = require("../database/connection");
const {
  Item,
  Account,
  AccountTransaction,
  Bill,
  BillAdjustment,
  StockMovement,
  ProductPriceAudit,
  Charge,
  GoodsReceipt,
} = require("../models");
const BillingService = require("../../modules/billing/billing.service");
const AccountsService = require("../../modules/accounts/accounts.service");
const InventoryService = require("../../modules/inventory/inventory.service");

async function runTests() {
  console.log("==================================================================");
  console.log("RUNNING FIFO BUSINESS LOGIC, KHATA LEDGER, & P&L INTEGRATION TESTS");
  console.log("==================================================================\n");

  await connectDatabase();

  const billingService = new BillingService();
  const accountsService = new AccountsService();
  const inventoryService = new InventoryService();
  const testTenantId = `test-tenant-${Date.now()}`;

  try {
    // -------------------------------------------------------------
    // SETUP: Create Customer and Item with 2 Batches
    // -------------------------------------------------------------
    console.log("[SETUP] Seeding test customer, supplier, and multi-batch item...");

    // 1. Seed Customer Account
    const customer = await Account.create({
      accountCode: "CUST-T01",
      name: "Ali Hardware Trader",
      phone: "03009998877",
      accountType: "Customer",
      currentBalance: 0,
      tenantId: testTenantId,
    });

    // 2. Seed Supplier Account
    const supplier = await Account.create({
      accountCode: "SUPP-T01",
      name: "National Steel Mills",
      phone: "03215554433",
      accountType: "Supplier",
      currentBalance: 0,
      tenantId: testTenantId,
    });

    // 3. Seed Inventory Item with 2 initial batches
    // Batch 1: 10 units @ PKR 100 (oldest)
    // Batch 2: 10 units @ PKR 150 (newer)
    const testItem = new Item({
      name: "Galvanized Steel Bolt 10mm",
      sku: "BOLT-GS-10",
      category: "Fasteners",
      purchasePrice: 150,
      salePrice: 200,
      stock: 0,
      tenantId: testTenantId,
    });

    testItem.addBatch({
      batchCode: "BATCH-TEST-001",
      qty: 10,
      unitCost: 100,
      receivedDate: new Date("2026-01-01"),
    });

    testItem.addBatch({
      batchCode: "BATCH-TEST-002",
      qty: 10,
      unitCost: 150,
      receivedDate: new Date("2026-02-01"),
    });

    await testItem.save();
    assert.strictEqual(testItem.stock, 20, "Initial stock should be 20");

    console.log("  ✓ Setup completed successfully.\n");

    // -------------------------------------------------------------
    // TEST 1: FIFO Batch Consumption on Sale Checkout & Khata Debt
    // -------------------------------------------------------------
    console.log("[TEST 1] Testing FIFO Batch Consumption and Khata Credit Checkout...");
    // Request 15 units:
    // - 10 units from BATCH-TEST-001 @ 100 = 1000
    // - 5 units from BATCH-TEST-002 @ 150 = 750
    // Total COGS = 1750
    // Sale Price = 200 * 15 = 3000
    // Customer pays 2000 cash; 1000 goes to Khata (borrow/credit)
    const saleBill = await billingService.createBill(
      {
        invoiceType: "Sale",
        accountId: customer._id,
        costumerName: customer.name,
        costumerNumber: customer.phone,
        paymentMethod: "borrow",
        paidAmount: 2000,
        totalAmount: 3000,
        cartItems: [
          {
            _id: testItem._id,
            name: testItem.name,
            quantity: 15,
            salePrice: 200,
          },
        ],
      },
      { tenantId: testTenantId, operatorId: "cashier-01" }
    );

    assert.ok(saleBill._id, "Sale bill should be created");
    assert.strictEqual(saleBill.totalAmount, 3000);
    assert.strictEqual(saleBill.paidAmount, 2000);
    assert.strictEqual(saleBill.dueAmount, 1000);
    assert.strictEqual(saleBill.paymentStatus, "partial");

    // Verify FIFO decrements on the item
    const refreshedItem = await Item.findById(testItem._id);
    assert.strictEqual(refreshedItem.stock, 5, "Stock should be 20 - 15 = 5");
    assert.strictEqual(
      refreshedItem.batches[0].availableQty,
      0,
      "Batch 1 should be completely exhausted (availableQty = 0)"
    );
    assert.strictEqual(
      refreshedItem.batches[1].availableQty,
      5,
      "Batch 2 should have 5 units remaining (10 - 5 = 5)"
    );

    // Verify line item calculations in bill
    const billItem = saleBill.cartItems[0];
    assert.strictEqual(billItem.quantity, 15);
    assert.strictEqual(billItem.unitPrice, 200);
    assert.strictEqual(billItem.unitCost, 116.67, "Weighted unitCost: 1750 / 15 = 116.67");
    assert.strictEqual(billItem.totalProfit, 1250, "Total profit: 3000 - 1750 = 1250");
    assert.strictEqual(billItem.batchAllocations.length, 2, "Allocations should span across both batches");

    // Verify Customer Khata balance updated
    const refreshedCustomer = await Account.findById(customer._id);
    assert.strictEqual(
      refreshedCustomer.currentBalance,
      1000,
      "Customer Khata currentBalance should increase by 1000"
    );

    // Verify Stock Movements
    const movements = await StockMovement.find({
      tenantId: testTenantId,
      productId: testItem._id,
      movementType: "Sale",
    }).sort({ createdAt: 1 });
    assert.strictEqual(movements.length, 2, "Should have 2 stock movement entries for the 2 batch allocations");
    const totalChangeQty = movements.reduce((sum, m) => sum + m.changeQty, 0);
    assert.strictEqual(totalChangeQty, -15, "Total stock deducted should be -15");

    console.log("  ✓ FIFO batch consumption, profit margins, Khata debt, and stock movements verified.\n");

    // -------------------------------------------------------------
    // TEST 2: Purchase Invoice, Batch Generation & ProductPriceAudit
    // -------------------------------------------------------------
    console.log("[TEST 2] Testing Purchase Invoice, Batch Generation & Price Audit...");
    // Purchase 10 units @ new unit cost PKR 180 (previously 150)
    // Total = 1800, Paid = 1000, Due to supplier = 800
    const purchaseBill = await billingService.createBill(
      {
        invoiceType: "Purchase",
        accountId: supplier._id,
        costumerName: supplier.name,
        paymentMethod: "cash",
        paidAmount: 1000,
        totalAmount: 1800,
        cartItems: [
          {
            _id: testItem._id,
            name: testItem.name,
            quantity: 10,
            unitCost: 180,
            batchCode: "BATCH-PUR-NEW-01",
          },
        ],
      },
      { tenantId: testTenantId, operatorId: "manager-01" }
    );

    assert.ok(purchaseBill._id, "Purchase bill should be created");

    // A purchase invoice updates the supplier ledger, not inventory.
    const itemAfterPurchase = await Item.findById(testItem._id);
    assert.strictEqual(itemAfterPurchase.stock, 5, "Purchase invoice must not receive stock");
    assert.strictEqual(itemAfterPurchase.batches.length, 2, "Invoice must not create stock batches");

    // Stock is recorded separately, and partial GRNs may complete the invoice later.
    const firstReceipt = await inventoryService.receivePurchaseInvoice(
      {
        purchaseInvoiceId: purchaseBill._id,
        items: [{ productId: testItem._id, quantity: 4 }],
      },
      { tenantId: testTenantId, operatorId: "manager-01" }
    );
    assert.strictEqual(firstReceipt.totalCost, 720);
    const secondReceipt = await inventoryService.receivePurchaseInvoice(
      {
        purchaseInvoiceId: purchaseBill._id,
        items: [{ productId: testItem._id, quantity: 6 }],
      },
      { tenantId: testTenantId, operatorId: "manager-01" }
    );
    assert.notStrictEqual(firstReceipt._id.toString(), secondReceipt._id.toString());

    const itemAfterReceipts = await Item.findById(testItem._id);
    assert.strictEqual(itemAfterReceipts.stock, 15, "Two GRNs should receive 10 units into stock");
    assert.strictEqual(itemAfterReceipts.batches.length, 4, "Each GRN should create its own stock batch");
    assert.ok(firstReceipt.items[0].batchId, "GRN lines must retain their exact stock batch IDs");
    assert.strictEqual(itemAfterReceipts.batches[2].unitCost, 180);
    assert.strictEqual(itemAfterReceipts.purchasePrice, 180, "GRN updates the latest purchase cost");

    await assert.rejects(
      inventoryService.receivePurchaseInvoice(
        {
          purchaseInvoiceId: purchaseBill._id,
          items: [{ productId: testItem._id, quantity: 1 }],
        },
        { tenantId: testTenantId, operatorId: "manager-01" }
      ),
      /exceeds the 0 remaining/
    );

    // Verify ProductPriceAudit was recorded for stock receipt.
    const priceAudits = await ProductPriceAudit.find({
      tenantId: testTenantId,
      productId: testItem._id,
    });
    assert.strictEqual(priceAudits.length, 1, "Should have 1 ProductPriceAudit entry");
    assert.strictEqual(priceAudits[0].oldPrice, 150);
    assert.strictEqual(priceAudits[0].newPrice, 180);
    assert.strictEqual(priceAudits[0].priceChange, 30);
    assert.strictEqual(priceAudits[0].percentageChange, 20, "Percentage change: (30/150)*100 = 20%");

    // Verify Supplier Khata balance updated (Payable = 800)
    const refreshedSupplier = await Account.findById(supplier._id);
    assert.strictEqual(
      refreshedSupplier.currentBalance,
      800,
      "Supplier Khata currentBalance should increase by 800 payable"
    );

    console.log("  ✓ Purchase invoice, separate partial GRNs, stock, price audit, and supplier Khata verified.\n");

    // -------------------------------------------------------------
    // TEST 3: Financial Intelligence (Profit & Loss Statement)
    // -------------------------------------------------------------
    console.log("[TEST 3] Testing Financial Intelligence / Profit & Loss Report...");

    // Seed sample operating expense
    await Charge.create({
      description: "Warehouse Generator Fuel",
      amount: 250,
      category: "utilities",
      tenantId: testTenantId,
      date: new Date(),
    });

    const pnlReport = await billingService.getProfitLoss({
      tenantId: testTenantId,
    });

    assert.ok(pnlReport.summary, "P&L report should contain summary");
    assert.strictEqual(pnlReport.summary.grossSales, 3000, "Gross sales should be 3000");
    assert.strictEqual(pnlReport.summary.cogs, 1750, "COGS should be 1750");
    assert.strictEqual(pnlReport.summary.grossProfit, 1250, "Gross profit should be 1250");
    assert.strictEqual(pnlReport.summary.totalOperatingExpenses, 250, "Expenses should be 250");
    assert.strictEqual(pnlReport.summary.netProfit, 1000, "Net profit should be 1250 - 250 = 1000");
    assert.strictEqual(pnlReport.summary.grossMarginPercentage, 41.67, "Gross margin: (1250/3000)*100 = 41.67%");
    assert.strictEqual(pnlReport.summary.netMarginPercentage, 33.33, "Net margin: (1000/3000)*100 = 33.33%");
    assert.strictEqual(pnlReport.expensesByCategory["utilities"], 250);

    console.log("  ✓ Profit & Loss calculations (Gross Sales, COGS, Operating Expenses, Net Profit) verified.\n");

    // -------------------------------------------------------------
    // TEST 4: Void Invoice & Khata Balance Reversal
    // -------------------------------------------------------------
    console.log("[TEST 4] Testing Invoice Void and Khata Balance Reversal...");
    await billingService.voidBill(saleBill._id, testTenantId, "manager-01");

    // Verify stock restored
    const itemAfterVoid = await Item.findById(testItem._id);
    assert.strictEqual(itemAfterVoid.stock, 30, "Stock should restore 15 units back (15 + 15 = 30)");

    // Verify Customer Khata debt reversed back to 0
    const customerAfterVoid = await Account.findById(customer._id);
    assert.strictEqual(
      customerAfterVoid.currentBalance,
      0,
      "Customer Khata balance should reverse back to 0"
    );

    // Exercise a newer sale against the received stock. Voiding the purchase
    // must fail until that sale is reversed, then restore both stock and debt.
    const stockUseSale = await billingService.createBill(
      {
        invoiceType: "Sale",
        paymentMethod: "cash",
        paidAmount: 4200,
        cartItems: [
          {
            _id: testItem._id,
            name: testItem.name,
            quantity: 21,
            salePrice: 200,
          },
        ],
      },
      { tenantId: testTenantId, operatorId: "manager-01" }
    );
    await assert.rejects(
      billingService.voidBill(purchaseBill._id, testTenantId, "manager-01"),
      /already been sold or used/
    );
    await billingService.voidBill(stockUseSale._id, testTenantId, "manager-01");

    await billingService.voidBill(purchaseBill._id, testTenantId, "manager-01");
    const itemAfterPurchaseVoid = await Item.findById(testItem._id);
    const supplierAfterPurchaseVoid = await Account.findById(supplier._id);
    assert.strictEqual(itemAfterPurchaseVoid.stock, 20, "Voiding a purchase removes only its received stock");
    assert.strictEqual(supplierAfterPurchaseVoid.currentBalance, 0, "Voiding reverses the unpaid supplier balance");

    await billingService.restoreBill(purchaseBill._id, testTenantId);
    const itemAfterPurchaseRestore = await Item.findById(testItem._id);
    const supplierAfterPurchaseRestore = await Account.findById(supplier._id);
    assert.strictEqual(itemAfterPurchaseRestore.stock, 30, "Restoring a purchase re-applies its GRNs");
    assert.strictEqual(supplierAfterPurchaseRestore.currentBalance, 800, "Restoring reinstates the supplier balance");

    await billingService.restoreBill(saleBill._id, testTenantId);
    const itemAfterSaleRestore = await Item.findById(testItem._id);
    const customerAfterSaleRestore = await Account.findById(customer._id);
    assert.strictEqual(itemAfterSaleRestore.stock, 15, "Restoring a sale consumes its original batch allocations");
    assert.strictEqual(customerAfterSaleRestore.currentBalance, 1000, "Restoring reinstates the customer balance");

    const returnAdjustment = await billingService.createAdjustment(
      saleBill._id,
      {
        reason: "One resellable item returned",
        items: [{ action: "return", sourceItemIndex: 0, quantity: 1, condition: "resellable" }],
      },
      { tenantId: testTenantId, operatorId: "manager-01" }
    );
    assert.strictEqual(returnAdjustment.returnedAmount, 200, "Return value should use the original invoice price");
    assert.strictEqual(returnAdjustment.items[0].totalCost, 116.67, "Return COGS should use original FIFO cost");
    const customerAfterReturn = await Account.findById(customer._id);
    const itemAfterReturn = await Item.findById(testItem._id);
    assert.strictEqual(customerAfterReturn.currentBalance, 800, "A return should reduce customer debt by its value");
    assert.strictEqual(itemAfterReturn.stock, 16, "A resellable return should restore one unit to stock");

    const pnlAfterReturn = await billingService.getProfitLoss({ tenantId: testTenantId });
    assert.strictEqual(pnlAfterReturn.summary.grossSales, 2800, "P&L should subtract sales returns");
    assert.strictEqual(pnlAfterReturn.summary.cogs, 1633.33, "P&L should reverse returned resellable stock cost");

    const stockBeforeMoneyAdjustments = itemAfterReturn.stock;
    const linkedSettlement = await accountsService.recordBalanceAdjustment(
      customer._id,
      {
        amount: 50,
        direction: "reduce",
        reason: "Agreed customer settlement",
        relatedInvoiceId: saleBill._id,
      },
      { tenantId: testTenantId, operatorId: "manager-01" }
    );
    assert.strictEqual(linkedSettlement.account.currentBalance, 750);
    assert.strictEqual(String(linkedSettlement.transaction.relatedInvoiceId), String(saleBill._id));
    const ledgerAfterSettlement = await accountsService.getAccountLedger(customer._id, {
      tenantId: testTenantId,
    });
    const linkedLedgerEntry = ledgerAfterSettlement.transactions.find(
      (transaction) => String(transaction._id) === String(linkedSettlement.transaction._id)
    );
    assert.strictEqual(linkedLedgerEntry.balanceChange, -50);
    assert.strictEqual(String(linkedLedgerEntry.billId), String(saleBill._id));

    const accountIncrease = await accountsService.recordBalanceAdjustment(
      customer._id,
      { amount: 10, direction: "increase", reason: "Agreed extra charge" },
      { tenantId: testTenantId, operatorId: "manager-01" }
    );
    assert.strictEqual(accountIncrease.account.currentBalance, 760);
    const itemAfterMoneyAdjustments = await Item.findById(testItem._id);
    assert.strictEqual(
      itemAfterMoneyAdjustments.stock,
      stockBeforeMoneyAdjustments,
      "Money-only settlements must never change product stock"
    );
    await assert.rejects(
      accountsService.recordBalanceAdjustment(
        customer._id,
        { amount: 1000, direction: "reduce", reason: "Must not over-settle" },
        { tenantId: testTenantId, operatorId: "manager-01" }
      ),
      /exceeds the outstanding balance/
    );

    console.log("  ✓ Item returns, linked and standalone money adjustments, and stock/balance safeguards verified.\n");

    console.log("==================================================================");
    console.log("ALL INTEGRATION TESTS PASSED WITH 100% SUCCESS!");
    console.log("==================================================================");
  } finally {
    // Clean up test tenant records
    await Promise.all([
      Account.deleteMany({ tenantId: testTenantId }),
      AccountTransaction.deleteMany({ tenantId: testTenantId }),
      Item.deleteMany({ tenantId: testTenantId }),
      Bill.deleteMany({ tenantId: testTenantId }),
      BillAdjustment.deleteMany({ tenantId: testTenantId }),
      GoodsReceipt.deleteMany({ tenantId: testTenantId }),
      StockMovement.deleteMany({ tenantId: testTenantId }),
      ProductPriceAudit.deleteMany({ tenantId: testTenantId }),
      Charge.deleteMany({ tenantId: testTenantId }),
    ]);
    await disconnectDatabase();
  }
}

runTests().catch((err) => {
  console.error("\n[INTEGRATION TEST FAILURE]:", err);
  disconnectDatabase().finally(() => process.exit(1));
});
