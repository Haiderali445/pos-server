// Force Node to use Google and Cloudflare DNS to bypass local ISP blocks
require("dns").setServers(["8.8.8.8", "1.1.1.1"]);

const mongoose = require("mongoose");
const dotenv = require("dotenv");
const bcrypt = require("bcrypt");
const path = require("path");
require("colors");

dotenv.config({ path: path.resolve(__dirname, ".env.local") });
if (!process.env.MONGO_URI) {
  dotenv.config({ path: path.resolve(__dirname, ".env") });
}

const { connectDatabase } = require("./src/core/database/connection");
const {
  Tenant,
  Item,
  User,
  Account,
  Category,
  Unit,
  Dealer,
  Charge,
  Bill,
  Invoice,
  AccountTransaction,
  StockMovement,
  ProductPriceAudit,
} = require("./src/core/models");
const { ROLE_PERMISSIONS } = require("./src/core/middlewares/requirePermission");

const seedDatabase = async () => {
  try {
    console.log(`\n=============================================================`.cyan);
    console.log(`HARDWARE POINT POS - ENTERPRISE DATABASE SEEDER (SIMS AKURA)`.bgGreen.black);
    console.log(`=============================================================\n`.cyan);

    console.log(`[1/8] Connecting to MongoDB Database...`.yellow);
    await connectDatabase();
    console.log(`[1/8] Connected to database successfully.`.green);

    const tenantId = "default-store";

    console.log(`\n[2/8] Purging all existing collections for clean reset...`.yellow);
    await Promise.all([
      Tenant.deleteMany({}),
      Item.deleteMany({}),
      User.deleteMany({}),
      Account.deleteMany({}),
      Category.deleteMany({}),
      Unit.deleteMany({}),
      Dealer.deleteMany({}),
      Charge.deleteMany({}),
      Bill.deleteMany({}),
      AccountTransaction.deleteMany({}),
      StockMovement.deleteMany({}),
      ProductPriceAudit.deleteMany({}),
    ]);
    console.log(`[2/8] All collections (User, Item, Account, AccountTransaction, Category, Unit, Dealer, Charge, Bill, Invoice) purged cleanly.`.green);

    // 1. Seed Default Store Tenant
    console.log(`\n[3/8] Creating default enterprise tenant configuration...`.yellow);
    const tenant = await Tenant.create({
      tenantId,
      name: "Hardware Point - Main Store",
      taxStrategy: "flat",
      taxRate: 5, // 5% GST for hardware retail
      receiptTemplate: "thermal80mm",
      currency: "PKR",
      contactPhone: "+92 (300) 123-4567",
      address: "Main Commercial Market, Wholesale Gunj, Lahore",
      active: true,
    });
    console.log(`[3/8] Tenant '${tenant.name}' configured (GST: 5%).`.green);

    // 2. Seed Categories & Units
    console.log(`\n[4/8] Seeding Hardware Categories & Units of Measure...`.yellow);
    const categories = await Category.insertMany([
      { name: "PVC & Drainage Pipes", code: "CAT-PVC", description: "UPVC, CPVC pipes and fittings", tenantId },
      { name: "Sanitary & Faucets", code: "CAT-SAN", description: "Bath fixtures, mixers, and sanitaryware", tenantId },
      { name: "Electrical & Wiring", code: "CAT-ELEC", description: "Cables, breakers, switches, and conduits", tenantId },
      { name: "Hand Tools & Fasteners", code: "CAT-TOOL", description: "Wrenches, screwdrivers, screws, and fasteners", tenantId },
      { name: "Paints & Adhesives", code: "CAT-PNT", description: "Primers, enamels, PVC solvent cement", tenantId },
    ]);

    const units = await Unit.insertMany([
      { name: "Pieces", code: "pcs", tenantId },
      { name: "Kilograms", code: "kg", tenantId },
      { name: "Bundles", code: "bundle", tenantId },
      { name: "Boxes", code: "box", tenantId },
      { name: "Meters / Length", code: "meter", tenantId },
    ]);
    console.log(`[4/8] ${categories.length} Categories and ${units.length} Units seeded.`.green);

    // 3. Seed Master Users & Roles
    console.log(`\n[5/8] Generating hashed staff accounts & roles (password: test123)...`.yellow);
    const passwordHash = await bcrypt.hash("test123", 10);

    const adminUser = await User.create({
      name: "Haider Ali (Master Admin)",
      userId: "admin",
      password: passwordHash,
      role: "admin",
      permissions: ROLE_PERMISSIONS.admin,
      tenantId,
      active: true,
      verified: true,
    });

    const cashierUser = await User.create({
      name: "Counter Cashier 1",
      userId: "1001",
      password: passwordHash,
      role: "cashier",
      permissions: ROLE_PERMISSIONS.cashier,
      tenantId,
      active: true,
      verified: true,
    });

    const managerUser = await User.create({
      name: "Wholesale Floor Manager",
      userId: "1002",
      password: passwordHash,
      role: "manager",
      permissions: ROLE_PERMISSIONS.manager,
      tenantId,
      active: true,
      verified: true,
    });
    console.log(`[5/8] Staff accounts created: admin (Admin), 1001 (Cashier), 1002 (Manager) with password 'test123'.`.green);

    // 4. Seed Accounts: Suppliers and Customer Khata Ledgers
    console.log(`\n[6/8] Seeding Customer Khata ledgers & Supplier Accounts...`.yellow);
    const supplierPipes = await Account.create({
      accountCode: "SUPP001",
      name: "Master Pipes & PVC Industries",
      accountType: "Supplier",
      phone: "0300-8451122",
      email: "sales@masterpipes.pk",
      address: "Plot 42, Industrial Area, Sheikhupura",
      currentBalance: 45000, // We owe them PKR 45,000
      openingBalance: 45000,
      tenantId,
      active: true,
    });

    const supplierSanitary = await Account.create({
      accountCode: "SUPP002",
      name: "Crown Sanitary Ware Ltd.",
      accountType: "Supplier",
      phone: "0321-9988771",
      email: "info@crownsanitary.pk",
      address: "Small Industries Estate, Gujranwala",
      currentBalance: 0,
      openingBalance: 0,
      tenantId,
      active: true,
    });

    const supplierCables = await Account.create({
      accountCode: "SUPP003",
      name: "Pakistan Cables & Electric Co.",
      accountType: "Supplier",
      phone: "0333-5544332",
      email: "orders@pakcables.com",
      address: "Brandreth Road, Lahore",
      currentBalance: 12500, // We owe them PKR 12,500
      openingBalance: 12500,
      tenantId,
      active: true,
    });

    // Populate legacy Dealer records for backward compatibility
    await Dealer.insertMany([
      {
        dealerName: supplierPipes.name,
        contactName: "Tariq Mahmood (0300-8451122)",
        shopName: "Master Pipes Depot",
        address: supplierPipes.address,
        products: "CPVC, UPVC Pipes, Fittings",
        tenantId,
      },
      {
        dealerName: supplierSanitary.name,
        contactName: "Imran Khan (0321-9988771)",
        shopName: "Crown Sanitary Showroom",
        address: supplierSanitary.address,
        products: "Faucets, Mixers, Basins, Commodes",
        tenantId,
      },
      {
        dealerName: supplierCables.name,
        contactName: "Muhammad Bilal (0333-5544332)",
        shopName: "Pak Cables Agency",
        address: supplierCables.address,
        products: "Copper Wire, Armored Cables, Distribution Boards",
        tenantId,
      },
    ]);

    // Customer Khata Accounts (Receivables)
    const customerAslam = await Account.create({
      accountCode: "CUST001",
      name: "Haji Muhammad Aslam & Sons (Contractors)",
      accountType: "Customer",
      phone: "0300-1234567",
      address: "DHA Phase 6 Site Office, Lahore",
      creditLimit: 150000,
      currentBalance: 24500, // Customer owes PKR 24,500
      openingBalance: 24500,
      tenantId,
      active: true,
      notes: "VIP commercial plumbing contractor. 30-day payment cycle.",
    });

    const customerRehman = await Account.create({
      accountCode: "CUST002",
      name: "Al-Rehman Construction Co.",
      accountType: "Customer",
      phone: "0312-7654321",
      address: "Bahria Town Sector C, Lahore",
      creditLimit: 250000,
      currentBalance: 82000, // Customer owes PKR 82,000
      openingBalance: 82000,
      tenantId,
      active: true,
      notes: "Bulk apartment builder. Fortnightly clearance.",
    });

    const customerMalik = await Account.create({
      accountCode: "CUST003",
      name: "Malik Electric & Plumbers",
      accountType: "Customer",
      phone: "0345-9876543",
      address: "Main Bazar Hardware Lane",
      creditLimit: 50000,
      currentBalance: 0, // Cleared account
      openingBalance: 0,
      tenantId,
      active: true,
    });

    console.log(`[6/8] 3 Suppliers & 3 Khata Customers seeded. Total Receivables: PKR 106,500.`.green);

    // 5. Seed Hardware Items with Multi-Batch FIFO Inventory
    console.log(`\n[7/8] Seeding 18 hardware items with multi-batch FIFO inventory...`.yellow);

    const now = new Date();
    const daysAgo = (d) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);

    const rawProducts = [
      {
        name: "PVC Pipe 4-inch (Class B 10ft)",
        sku: "PIPE-PVC-4IN",
        barcode: "890101000101",
        category: "PVC & Drainage Pipes",
        unit: "bundle",
        salePrice: 480,
        reorderLevel: 15,
        batches: [
          { batchCode: "BATCH-PVC-001", qty: 60, availableQty: 20, unitCost: 380, receivedDate: daysAgo(20), supplierId: supplierPipes._id },
          { batchCode: "BATCH-PVC-002", qty: 80, availableQty: 80, unitCost: 400, receivedDate: daysAgo(5), supplierId: supplierPipes._id },
        ],
      },
      {
        name: "PVC Elbow 4-inch 90-Degree",
        sku: "FIT-ELB-4IN",
        barcode: "890101000102",
        category: "PVC & Drainage Pipes",
        unit: "pcs",
        salePrice: 85,
        reorderLevel: 30,
        batches: [
          { batchCode: "BATCH-ELB-001", qty: 150, availableQty: 90, unitCost: 55, receivedDate: daysAgo(14), supplierId: supplierPipes._id },
          { batchCode: "BATCH-ELB-002", qty: 150, availableQty: 150, unitCost: 58, receivedDate: daysAgo(2), supplierId: supplierPipes._id },
        ],
      },
      {
        name: "PPRC Cold/Hot Water Pipe 25mm",
        sku: "PIPE-PPRC-25",
        barcode: "890101000103",
        category: "PVC & Drainage Pipes",
        unit: "bundle",
        salePrice: 340,
        reorderLevel: 20,
        batches: [
          { batchCode: "BATCH-PPR-001", qty: 100, availableQty: 65, unitCost: 260, receivedDate: daysAgo(18), supplierId: supplierPipes._id },
          { batchCode: "BATCH-PPR-002", qty: 100, availableQty: 100, unitCost: 275, receivedDate: daysAgo(4), supplierId: supplierPipes._id },
        ],
      },
      {
        name: "PPRC Equal Tee 25mm",
        sku: "FIT-TEE-25",
        barcode: "890101000104",
        category: "PVC & Drainage Pipes",
        unit: "pcs",
        salePrice: 65,
        reorderLevel: 25,
        batches: [
          { batchCode: "BATCH-TEE-001", qty: 200, availableQty: 140, unitCost: 42, receivedDate: daysAgo(12), supplierId: supplierPipes._id },
        ],
      },
      {
        name: "Brass Single-Lever Basin Mixer Tap",
        sku: "SAN-MIX-01",
        barcode: "890101000201",
        category: "Sanitary & Faucets",
        unit: "pcs",
        salePrice: 3800,
        reorderLevel: 5,
        batches: [
          { batchCode: "BATCH-MIX-001", qty: 15, availableQty: 4, unitCost: 2800, receivedDate: daysAgo(30), supplierId: supplierSanitary._id },
          { batchCode: "BATCH-MIX-002", qty: 25, availableQty: 25, unitCost: 2950, receivedDate: daysAgo(7), supplierId: supplierSanitary._id },
        ],
      },
      {
        name: "Stainless Steel Kitchen Sink Double Bowl",
        sku: "SAN-SNK-DBL",
        barcode: "890101000202",
        category: "Sanitary & Faucets",
        unit: "pcs",
        salePrice: 7500,
        reorderLevel: 3,
        batches: [
          { batchCode: "BATCH-SNK-001", qty: 10, availableQty: 6, unitCost: 5600, receivedDate: daysAgo(15), supplierId: supplierSanitary._id },
        ],
      },
      {
        name: "Concealed Ceramic Flush Tank Mechanism",
        sku: "SAN-FLS-01",
        barcode: "890101000203",
        category: "Sanitary & Faucets",
        unit: "pcs",
        salePrice: 2200,
        reorderLevel: 8,
        batches: [
          { batchCode: "BATCH-FLS-001", qty: 30, availableQty: 18, unitCost: 1650, receivedDate: daysAgo(10), supplierId: supplierSanitary._id },
        ],
      },
      {
        name: "Pure Copper Electric Cable 3/.029 (90m Coil)",
        sku: "ELEC-CBL-3029",
        barcode: "890101000301",
        category: "Electrical & Wiring",
        unit: "bundle",
        salePrice: 4200,
        reorderLevel: 10,
        batches: [
          { batchCode: "BATCH-CBL-001", qty: 40, availableQty: 12, unitCost: 3400, receivedDate: daysAgo(25), supplierId: supplierCables._id },
          { batchCode: "BATCH-CBL-002", qty: 50, availableQty: 50, unitCost: 3550, receivedDate: daysAgo(3), supplierId: supplierCables._id },
        ],
      },
      {
        name: "Pure Copper Electric Cable 7/.029 (90m Coil)",
        sku: "ELEC-CBL-7029",
        barcode: "890101000302",
        category: "Electrical & Wiring",
        unit: "bundle",
        salePrice: 8900,
        reorderLevel: 8,
        batches: [
          { batchCode: "BATCH-CBL-003", qty: 30, availableQty: 15, unitCost: 7400, receivedDate: daysAgo(22), supplierId: supplierCables._id },
          { batchCode: "BATCH-CBL-004", qty: 30, availableQty: 30, unitCost: 7600, receivedDate: daysAgo(3), supplierId: supplierCables._id },
        ],
      },
      {
        name: "Miniature Circuit Breaker (MCB) 32A Single Pole",
        sku: "ELEC-MCB-32A",
        barcode: "890101000303",
        category: "Electrical & Wiring",
        unit: "pcs",
        salePrice: 420,
        reorderLevel: 25,
        batches: [
          { batchCode: "BATCH-MCB-001", qty: 100, availableQty: 45, unitCost: 290, receivedDate: daysAgo(19), supplierId: supplierCables._id },
          { batchCode: "BATCH-MCB-002", qty: 100, availableQty: 100, unitCost: 310, receivedDate: daysAgo(6), supplierId: supplierCables._id },
        ],
      },
      {
        name: "Distribution Box 8-Way Acrylic Door",
        sku: "ELEC-DB-8WAY",
        barcode: "890101000304",
        category: "Electrical & Wiring",
        unit: "pcs",
        salePrice: 1350,
        reorderLevel: 6,
        batches: [
          { batchCode: "BATCH-DB-001", qty: 25, availableQty: 14, unitCost: 980, receivedDate: daysAgo(16), supplierId: supplierCables._id },
        ],
      },
      {
        name: "Heavy Duty Claw Hammer 16oz Steel Handle",
        sku: "TOOL-HMR-16OZ",
        barcode: "890101000401",
        category: "Hand Tools & Fasteners",
        unit: "pcs",
        salePrice: 750,
        reorderLevel: 10,
        batches: [
          { batchCode: "BATCH-HMR-001", qty: 35, availableQty: 22, unitCost: 520, receivedDate: daysAgo(28), supplierId: supplierPipes._id },
        ],
      },
      {
        name: "Self-Tapping Wood Screws 1.5-inch (Box of 500)",
        sku: "FAST-SCR-15IN",
        barcode: "890101000402",
        category: "Hand Tools & Fasteners",
        unit: "box",
        salePrice: 650,
        reorderLevel: 15,
        batches: [
          { batchCode: "BATCH-SCR-001", qty: 80, availableQty: 48, unitCost: 450, receivedDate: daysAgo(21), supplierId: supplierPipes._id },
        ],
      },
      {
        name: "Concrete Steel Nails 2-inch (1kg Pack)",
        sku: "FAST-NAL-2IN",
        barcode: "890101000403",
        category: "Hand Tools & Fasteners",
        unit: "kg",
        salePrice: 380,
        reorderLevel: 20,
        batches: [
          { batchCode: "BATCH-NAL-001", qty: 100, availableQty: 62, unitCost: 280, receivedDate: daysAgo(17), supplierId: supplierPipes._id },
        ],
      },
      {
        name: "Heavy Duty Pipe Wrench 14-inch Drop Forged",
        sku: "TOOL-WRN-14IN",
        barcode: "890101000404",
        category: "Hand Tools & Fasteners",
        unit: "pcs",
        salePrice: 1250,
        reorderLevel: 6,
        batches: [
          { batchCode: "BATCH-WRN-001", qty: 20, availableQty: 11, unitCost: 880, receivedDate: daysAgo(24), supplierId: supplierPipes._id },
        ],
      },
      {
        name: "PVC Solvent Cement Can 500g (Heavy Duty)",
        sku: "PNT-SOL-500G",
        barcode: "890101000501",
        category: "Paints & Adhesives",
        unit: "pcs",
        salePrice: 420,
        reorderLevel: 15,
        batches: [
          { batchCode: "BATCH-SOL-001", qty: 60, availableQty: 38, unitCost: 290, receivedDate: daysAgo(11), supplierId: supplierPipes._id },
        ],
      },
      {
        name: "Teflon Thread Seal Tape 12mm x 10m (Box of 10)",
        sku: "SAN-TEF-BOX",
        barcode: "890101000204",
        category: "Sanitary & Faucets",
        unit: "box",
        salePrice: 280,
        reorderLevel: 25,
        batches: [
          { batchCode: "BATCH-TEF-001", qty: 120, availableQty: 85, unitCost: 175, receivedDate: daysAgo(9), supplierId: supplierSanitary._id },
        ],
      },
      {
        name: "Angle Valve 1/2-inch Heavy Chrome Plated",
        sku: "SAN-VAL-ANG",
        barcode: "890101000205",
        category: "Sanitary & Faucets",
        unit: "pcs",
        salePrice: 390,
        reorderLevel: 20,
        batches: [
          { batchCode: "BATCH-VAL-001", qty: 100, availableQty: 70, unitCost: 255, receivedDate: daysAgo(13), supplierId: supplierSanitary._id },
        ],
      },
    ];

    const seededProducts = [];
    for (const prodData of rawProducts) {
      const stockBatches = prodData.batches.map((b) => ({
        batchCode: b.batchCode,
        qty: b.qty,
        availableQty: b.availableQty,
        unitCost: b.unitCost,
        receivedDate: b.receivedDate,
        supplierId: b.supplierId,
      }));

      const totalStock = stockBatches.reduce((acc, b) => acc + b.availableQty, 0);
      const latestCost = stockBatches[stockBatches.length - 1]?.unitCost || 0;

      const item = await Item.create({
        name: prodData.name,
        sku: prodData.sku,
        barcode: prodData.barcode,
        category: prodData.category,
        unit: prodData.unit || "pcs",
        salePrice: prodData.salePrice,
        purchasePrice: latestCost,
        stock: totalStock,
        reorderLevel: prodData.reorderLevel,
        batches: stockBatches,
        tenantId,
        active: true,
      });

      seededProducts.push(item);
    }
    console.log(`[7/8] 18 products seeded with 29 active FIFO batches.`.green);

    // 6. Seed Operational Expenses (Charges)
    console.log(`\n[8/8] Seeding operating expenses, invoices & stock movements...`.yellow);
    await Charge.insertMany([
      {
        description: "Store Electricity Bill (WAPDA Commercial)",
        amount: 14800,
        category: "utilities",
        date: daysAgo(5),
        tenantId,
      },
      {
        description: "Shop & Warehouse Rent (Main Gunj)",
        amount: 65000,
        category: "rent",
        date: daysAgo(10),
        tenantId,
      },
      {
        description: "Loading & Unloading Labor Wages",
        amount: 8500,
        category: "payroll",
        date: daysAgo(2),
        tenantId,
      },
      {
        description: "Shop Tea, Drinking Water & Client Hospitality",
        amount: 3200,
        category: "operations",
        date: daysAgo(1),
        tenantId,
      },
    ]);

    // 7. Seed Sample Sales Invoice (Credit Sale to CUST001 with FIFO batch allocation)
    const itemPipe = seededProducts[0];
    const itemMixer = seededProducts[4];

    const saleBill = await Bill.create({
      invoiceNumber: "INV-2026-0001",
      invoiceType: "Sale",
      accountId: customerAslam._id,
      costumerName: customerAslam.name,
      costumerNumber: customerAslam.phone,
      subtotal: 19400,
      totalDiscount: 400,
      taxAmount: 950, // 5% GST
      fare: 500,
      totalAmount: 20450,
      paidAmount: 5000, // PKR 5,000 cash paid, PKR 15,450 added to Khata
      dueAmount: 15450,
      paymentMethod: "borrow",
      date: daysAgo(3),
      status: "completed",
      tenantId,
      operatorId: "1001",
      cartItems: [
        {
          productId: itemPipe._id,
          name: itemPipe.name,
          sku: itemPipe.sku,
          quantity: 20,
          unitPrice: 480,
          salePrice: 480,
          unitCost: 380,
          subtotal: 9600,
          unitProfit: 100,
          totalProfit: 2000,
          profitMarginPercentage: 20.8,
          batchAllocations: [
            { batchId: itemPipe.batches[0]._id, batchCode: itemPipe.batches[0].batchCode, quantity: 20, unitCost: 380 },
          ],
        },
        {
          productId: itemMixer._id,
          name: itemMixer.name,
          sku: itemMixer.sku,
          quantity: 2,
          unitPrice: 3800,
          salePrice: 3800,
          unitCost: 2800,
          subtotal: 7600,
          unitProfit: 1000,
          totalProfit: 2000,
          profitMarginPercentage: 26.3,
          batchAllocations: [
            { batchId: itemMixer.batches[0]._id, batchCode: itemMixer.batches[0].batchCode, quantity: 2, unitCost: 2800 },
          ],
        },
      ],
    });

    // 8. Seed Sample Purchase Invoice (GRN from Master Pipes)
    await Bill.create({
      invoiceNumber: "PUR-2026-0001",
      invoiceType: "Purchase",
      accountId: supplierPipes._id,
      costumerName: supplierPipes.name,
      costumerNumber: supplierPipes.phone,
      subtotal: 32000,
      totalDiscount: 0,
      taxAmount: 0,
      fare: 1500,
      totalAmount: 33500,
      paidAmount: 20000,
      dueAmount: 13500,
      paymentMethod: "borrow",
      date: daysAgo(5),
      status: "completed",
      tenantId,
      operatorId: "admin",
      cartItems: [
        {
          productId: itemPipe._id,
          name: itemPipe.name,
          sku: itemPipe.sku,
          quantity: 80,
          unitPrice: 400,
          unitCost: 400,
          subtotal: 32000,
          batchAllocations: [
            { batchId: itemPipe.batches[1]._id, batchCode: itemPipe.batches[1].batchCode, quantity: 80, unitCost: 400 },
          ],
        },
      ],
    });

    // 9. Seed Stock Movements
    await StockMovement.create([
      {
        productId: itemPipe._id,
        movementType: "Sale",
        changeQty: -20,
        previousStock: 120,
        newStock: 100,
        unitCost: 380,
        unitPrice: 480,
        totalCostValue: 7600,
        totalSaleValue: 9600,
        batchCode: "BATCH-PVC-001",
        referenceType: "Bill",
        referenceId: saleBill._id,
        tenantId,
        createdAt: daysAgo(3),
      },
      {
        productId: itemPipe._id,
        movementType: "Purchase",
        changeQty: 80,
        previousStock: 40,
        newStock: 120,
        unitCost: 400,
        totalCostValue: 32000,
        batchCode: "BATCH-PVC-002",
        referenceType: "Bill",
        referenceId: purchaseBill._id,
        tenantId,
        createdAt: daysAgo(5),
      },
    ]);

    // 10. Seed Account Transactions (Khata Ledger Audit Trail)
    await AccountTransaction.create([
      {
        tenantId,
        accountId: custAslam._id,
        transactionType: "Credit",
        amount: 24500,
        debit: 24500,
        credit: 0,
        balanceAfter: 24500,
        reference_table: "Invoices",
        reference_id: saleBill._id,
        invoiceNumber: saleBill.invoiceNumber,
        paymentMethod: "borrow",
        description: `Credit Sale to ${custAslam.name}`,
        notes: `Initial seeded credit sale`,
        date: daysAgo(3),
        operatorId: "1001",
      },
      {
        tenantId,
        accountId: suppMaster._id,
        transactionType: "Purchase",
        amount: 33500,
        debit: 0,
        credit: 33500,
        balanceAfter: 13500,
        reference_table: "Invoices",
        reference_id: purchaseBill._id,
        invoiceNumber: purchaseBill.invoiceNumber,
        paymentMethod: "borrow",
        description: `Purchase from ${suppMaster.name}`,
        notes: `Initial seeded supplier bill payable`,
        date: daysAgo(5),
        operatorId: "admin",
      },
      {
        tenantId,
        accountId: suppMaster._id,
        transactionType: "Payment",
        amount: 20000,
        debit: 20000,
        credit: 0,
        balanceAfter: 13500,
        reference_table: "Invoices",
        reference_id: purchaseBill._id,
        invoiceNumber: purchaseBill.invoiceNumber,
        paymentMethod: "cash",
        description: `Cash payment against ${purchaseBill.invoiceNumber}`,
        notes: `Partial payment tendered at GRN`,
        date: daysAgo(5),
        operatorId: "admin",
      },
    ]);

    console.log(`[8/8] Expenses, Invoices, AccountTransactions, & Stock movements generated successfully.`.green);

    console.log(`\n====================================================================`.cyan);
    console.log(`ENTERPRISE ERP DATABASE SEEDING COMPLETED SUCCESSFULLY!`.bgGreen.black);
    console.log(`====================================================================`.cyan);
    console.log(`[Staff Credentials]`.bold);
    console.log(`  * Master Admin : userId: 'admin' | password: 'test123' | Role: admin`.green);
    console.log(`  * Cashier      : userId: '1001'  | password: 'test123' | Role: cashier`.yellow);
    console.log(`  * Store Manager: userId: '1002'  | password: 'test123' | Role: manager`.blue);
    console.log(`\n[Enterprise Assets Summary]`.bold);
    console.log(`  * Categories Seeded : ${categories.length} (PVC, Sanitary, Electrical, Tools, Paints)`);
    console.log(`  * Units Seeded      : ${units.length} (pcs, kg, bundle, box, meter)`);
    console.log(`  * Products Seeded   : ${seededProducts.length} items with multi-batch FIFO records`);
    console.log(`  * Active Khata Debt : PKR 106,500 (Aslam: PKR 24.5k | Rehman: PKR 82k)`);
    console.log(`  * Supplier Payables : PKR 57,500 (Master Pipes: PKR 45k | Cables: PKR 12.5k)`);
    console.log(`  * Default Store GST : 5% Flat Tax Strategy configured`);
    console.log(`====================================================================\n`.cyan);

    process.exit(0);
  } catch (error) {
    console.error(`\n[SEEDER FATAL ERROR] ${error.message}`.bgRed.white);
    console.error(error);
    process.exit(1);
  }
};

seedDatabase();