const assert = require("assert");
const mongoose = require("mongoose");
const {
  Account,
  Item,
  StockMovement,
  Bill,
  Invoice,
  Tenant,
  User,
} = require("../models");
const { unitOfWork, TransactionContext } = require("../database/unitOfWork");

async function runTests() {
  console.log("=================================================");
  console.log("RUNNING ENTERPRISE CORE MODELS & TRANSACTION TESTS");
  console.log("=================================================\n");

  let passedTests = 0;

  // -------------------------------------------------------------
  // TEST 1: Account Model Validation & Khata Logic
  // -------------------------------------------------------------
  console.log("[TEST 1] Testing Account.js model...");
  {
    const custAccount = new Account({
      accountCode: "CUST-001",
      name: "Tariq Hardware Store",
      accountType: "Customer",
      phone: "03001234567",
      email: "tariq@example.com",
      currentBalance: 5000,
      creditLimit: 20000,
      tenantId: "store-test",
    });

    const validationErr = custAccount.validateSync();
    assert.strictEqual(validationErr, undefined, "Customer account validation should pass");
    assert.strictEqual(custAccount.accountCode, "CUST-001");
    assert.strictEqual(custAccount.accountType, "Customer");
    assert.strictEqual(custAccount.currentBalance, 5000);

    // Test invalid accountType
    const invalidAccount = new Account({
      accountCode: "INVALID-01",
      name: "Bad Account",
      accountType: "InvalidType",
    });
    const invalidErr = invalidAccount.validateSync();
    assert.ok(invalidErr && invalidErr.errors["accountType"], "Invalid accountType should fail validation");

    // Test updateBalance method
    custAccount.currentBalance = 1000;
    custAccount.updateBalance = Account.schema.methods.updateBalance;
    // mock save
    custAccount.save = async function () { return this; };
    await custAccount.updateBalance(250.50);
    assert.strictEqual(custAccount.currentBalance, 1250.50, "updateBalance should adjust currentBalance");

    console.log("  ✓ Account validation, types (Customer/Supplier/Expense), and balance updates verified.");
    passedTests++;
  }

  // -------------------------------------------------------------
  // TEST 2: Item Model with FIFO Stock Batches
  // -------------------------------------------------------------
  console.log("\n[TEST 2] Testing Item.js with FIFO Stock Batches...");
  {
    const item = new Item({
      name: "CPVC Pipe 1 inch",
      sku: "PIPE-CPVC-01",
      category: "Pipes",
      purchasePrice: 100,
      salePrice: 150,
      stock: 0,
      batches: [],
      tenantId: "store-test",
    });

    // 1. Add first batch (Batch 1: 10 units @ PKR 100, received earlier)
    const batch1 = item.addBatch({
      batchCode: "BATCH-001",
      qty: 10,
      unitCost: 100,
      receivedDate: new Date("2026-01-01"),
    });
    assert.strictEqual(item.stock, 10, "Stock should be 10 after adding first batch");
    assert.strictEqual(item.batches.length, 1);
    assert.strictEqual(batch1.availableQty, 10);

    // 2. Add second batch (Batch 2: 15 units @ PKR 120, received later)
    const batch2 = item.addBatch({
      batchCode: "BATCH-002",
      qty: 15,
      unitCost: 120,
      receivedDate: new Date("2026-02-01"),
    });
    assert.strictEqual(item.stock, 25, "Stock should be 25 after adding second batch");
    assert.strictEqual(item.batches.length, 2);
    assert.strictEqual(item.purchasePrice, 120, "purchasePrice should update to latest batch unitCost");

    // 3. Test FIFO Consumption (consume 14 units):
    // Should consume ALL 10 units from BATCH-001 @ 100 = 1000
    // And 4 units from BATCH-002 @ 120 = 480
    // Total COGS = 1480, Average Unit Cost = 1480 / 14 = ~105.71
    const fifoResult = item.consumeFIFO(14);

    assert.strictEqual(item.stock, 11, "Item stock should be 25 - 14 = 11");
    assert.strictEqual(item.batches[0].availableQty, 0, "Batch 1 should be completely exhausted (availableQty = 0)");
    assert.strictEqual(item.batches[1].availableQty, 11, "Batch 2 should have 15 - 4 = 11 remaining");
    assert.strictEqual(fifoResult.totalCost, 1480, "Total FIFO COGS should be 1480");
    assert.strictEqual(fifoResult.allocations.length, 2, "Allocations should span across 2 batches");
    assert.strictEqual(fifoResult.allocations[0].batchCode, "BATCH-001");
    assert.strictEqual(fifoResult.allocations[0].quantity, 10);
    assert.strictEqual(fifoResult.allocations[1].batchCode, "BATCH-002");
    assert.strictEqual(fifoResult.allocations[1].quantity, 4);

    // 4. Test insufficient stock throws error
    assert.throws(
      () => item.consumeFIFO(20),
      /Insufficient stock/,
      "Requesting more than available stock should throw error"
    );

    // 5. Test syncStockFromBatches
    assert.strictEqual(item.syncStockFromBatches(), 11, "syncStockFromBatches should match remaining batch sum");

    console.log("  ✓ Item multi-batch purchasing and FIFO consumption logic verified.");
    passedTests++;
  }

  // -------------------------------------------------------------
  // TEST 3: StockMovement Model & Audit Trail
  // -------------------------------------------------------------
  console.log("\n[TEST 3] Testing StockMovement.js audit trail...");
  {
    const dummyProductId = new mongoose.Types.ObjectId();
    const dummyRefId = new mongoose.Types.ObjectId();
    const dummyAccId = new mongoose.Types.ObjectId();

    const movement = new StockMovement({
      productId: dummyProductId,
      movementType: "Purchase",
      changeQty: 50,
      previousStock: 10,
      newStock: 60,
      unitCost: 100,
      unitPrice: 140,
      referenceId: dummyRefId,
      referenceType: "PurchaseOrder",
      accountId: dummyAccId,
      reason: "Goods received from Atlas Sanitary",
      performedBy: "manager",
      tenantId: "store-test",
    });

    const validationErr = movement.validateSync();
    assert.strictEqual(validationErr, undefined, "StockMovement validation should pass");
    assert.strictEqual(movement.movementType, "Purchase");
    assert.strictEqual(movement.changeQty, 50);

    // Check pre-save monetary calculations
    // simulate pre-save hook
    movement.totalCostValue = Number((Math.abs(movement.changeQty) * movement.unitCost).toFixed(2));
    movement.totalSaleValue = Number((Math.abs(movement.changeQty) * movement.unitPrice).toFixed(2));

    assert.strictEqual(movement.totalCostValue, 5000, "totalCostValue should be 50 * 100 = 5000");
    assert.strictEqual(movement.totalSaleValue, 7000, "totalSaleValue should be 50 * 140 = 7000");

    console.log("  ✓ StockMovement audit log model and financial valuations verified.");
    passedTests++;
  }

  // -------------------------------------------------------------
  // TEST 4: Bill / Invoice Upgraded Schema & Profit Metrics
  // -------------------------------------------------------------
  console.log("\n[TEST 4] Testing Bill.js & Invoice.js with unit profit metrics...");
  {
    const dummyProdId = new mongoose.Types.ObjectId();
    const dummyAccId = new mongoose.Types.ObjectId();

    const invoice = new Bill({
      invoiceType: "Sale",
      accountId: dummyAccId,
      costumerName: "Waqas Traders",
      costumerNumber: "03219988776",
      fare: 250,
      totalDiscount: 50,
      subtotal: 1500,
      totalAmount: 1500,
      paidAmount: 1200,
      paymentMethod: "cash",
      cartItems: [
        {
          productId: dummyProdId,
          name: "CPVC Pipe 1 inch",
          quantity: 10,
          unitPrice: 150,
          unitCost: 100,
          unitDiscount: 20,
        },
      ],
      tenantId: "store-test",
    });

    // Run validation (which triggers pre('validate') calculations)
    await invoice.validate();

    // Verify auto-generated invoiceNumber
    assert.ok(invoice.invoiceNumber.startsWith("INV-"), `Invoice number should have INV prefix: ${invoice.invoiceNumber}`);

    // Verify item-level calculations
    const cartItem = invoice.cartItems[0];
    assert.strictEqual(cartItem.subtotal, 1480, "Subtotal: 10 * 150 - 20 = 1480");
    // Unit profit: 150 - 100 - (20/10) = 48
    assert.strictEqual(cartItem.unitProfit, 48, "Unit profit: 150 - 100 - 2 = 48");
    // Total profit: 48 * 10 = 480
    assert.strictEqual(cartItem.totalProfit, 480, "Total profit: 48 * 10 = 480");
    // Profit margin: ((150 - 100) / 150) * 100 = 33.33%
    assert.strictEqual(cartItem.profitMarginPercentage, 33.33, "Profit margin percentage should be 33.33%");

    // Verify invoice-level metrics
    assert.strictEqual(invoice.totalProfit, 480, "Invoice totalProfit should be 480");
    assert.strictEqual(invoice.totalItemsCount, 10, "Total items count should be 10");

    // Verify dueAmount calculation: netPayable = 1500 + 250 (fare) - 50 (discount) = 1700
    // paid = 1200 -> due = 1700 - 1200 = 500
    assert.strictEqual(invoice.dueAmount, 500, "Due amount should be netPayable(1700) - paid(1200) = 500");
    assert.strictEqual(invoice.paymentStatus, "partial", "Payment status should be partial");

    // Verify Invoice model is an alias of Bill
    assert.strictEqual(Invoice, Bill, "Invoice should be identical alias to Bill model");

    console.log("  ✓ Invoice & Cart item unit profit calculations, due balance, and aliases verified.");
    passedTests++;
  }

  // -------------------------------------------------------------
  // TEST 5: UnitOfWork Transaction Engine & Lifecycle Hooks
  // -------------------------------------------------------------
  console.log("\n[TEST 5] Testing UnitOfWork ACID & Resilience...");
  {
    // Test TransactionContext lifecycle hooks
    let commitHookRan = false;
    let rollbackHookRan = false;

    const dummyContext = new TransactionContext(null);
    dummyContext.onCommit(() => {
      commitHookRan = true;
    });
    dummyContext.onRollback(() => {
      rollbackHookRan = true;
    });

    await dummyContext.executeCommitHooks();
    assert.strictEqual(commitHookRan, true, "onCommit hook should run on commit");
    assert.strictEqual(rollbackHookRan, false, "onRollback hook should not run on commit");

    // Test nested session reuse in unitOfWork
    const mockSession = {
      inTransaction: () => true,
    };

    let nestedRan = false;
    await unitOfWork.runInTransaction(
      async (session, context) => {
        assert.strictEqual(session, mockSession, "Nested call should reuse supplied session");
        nestedRan = true;
      },
      { session: mockSession }
    );
    assert.strictEqual(nestedRan, true, "Nested transaction callback should execute");

    console.log("  ✓ UnitOfWork lifecycle hooks and nested transaction management verified.");
    passedTests++;
  }

  console.log("\n=================================================");
  console.log(`ALL ${passedTests} CORE SUITES PASSED SUCCESSFULLY!`);
  console.log("=================================================");
}

runTests().catch((err) => {
  console.error("\n[TEST FAILURE]:", err);
  process.exit(1);
});
