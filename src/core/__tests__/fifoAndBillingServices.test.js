const assert = require("assert");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(__dirname, "../../../.env.local") });

const { connectDatabase, disconnectDatabase } = require("../database/connection");
const {
  Item,
  Account,
  Bill,
  StockMovement,
  ProductPriceAudit,
  Charge,
} = require("../models");
const BillingService = require("../../modules/billing/billing.service");
const InventoryService = require("../../modules/inventory/inventory.service");

async function runTests() {
  console.log("==================================================================");
  console.log("RUNNING FIFO BUSINESS LOGIC, KHATA LEDGER, & P&L INTEGRATION TESTS");
  console.log("==================================================================\n");

  await connectDatabase();

  const billingService = new BillingService();
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

    // Verify item updated
    const itemAfterPurchase = await Item.findById(testItem._id);
    assert.strictEqual(itemAfterPurchase.stock, 15, "Stock should be 5 + 10 = 15");
    assert.strictEqual(itemAfterPurchase.batches.length, 3, "Item should have 3 batches now");
    assert.strictEqual(itemAfterPurchase.batches[2].batchCode, "BATCH-PUR-NEW-01");
    assert.strictEqual(itemAfterPurchase.batches[2].unitCost, 180);
    assert.strictEqual(itemAfterPurchase.purchasePrice, 180, "Purchase price should update to 180");

    // Verify ProductPriceAudit was recorded
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

    console.log("  ✓ Purchase batch creation, price audit logging, and supplier Khata verified.\n");

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

    console.log("  ✓ Void reversal of stock and customer balance verified.\n");

    console.log("==================================================================");
    console.log("ALL INTEGRATION TESTS PASSED WITH 100% SUCCESS!");
    console.log("==================================================================");
  } finally {
    // Clean up test tenant records
    await Promise.all([
      Account.deleteMany({ tenantId: testTenantId }),
      Item.deleteMany({ tenantId: testTenantId }),
      Bill.deleteMany({ tenantId: testTenantId }),
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
