// Force Node to use Google and Cloudflare DNS to bypass local ISP blocks
require("dns").setServers(["8.8.8.8", "1.1.1.1"]);

const mongoose = require("mongoose");
const dotenv = require("dotenv");
const bcrypt = require("bcrypt");
const path = require("path");
require("colors");

dotenv.config({ path: path.resolve(__dirname, ".env.local") });

const { connectDatabase } = require("./src/core/database/connection");
const Tenant = require("./src/core/models/Tenant");
const Item = require("./src/core/models/Item");
const User = require("./src/core/models/User");
const Dealer = require("./src/core/models/Dealer");
const Charge = require("./src/core/models/Charge");
const Bill = require("./src/core/models/Bill");
const items = require("./src/core/seedData/items");
const { ROLE_PERMISSIONS } = require("./src/core/middlewares/requirePermission");

const seedDatabase = async () => {
  try {
    await connectDatabase();

    const tenantId = "default-store";

    console.log(`\n[SEED] Clearing existing collections for fresh multi-tenant seed...`.yellow);
    await Promise.all([
      Tenant.deleteMany({}),
      Item.deleteMany({}),
      User.deleteMany({}),
      Dealer.deleteMany({}),
      Charge.deleteMany({}),
      Bill.deleteMany({}),
    ]);

    // 1. Seed Default Tenant
    const tenant = await Tenant.create({
      tenantId,
      name: "Hardware Point - Main Store",
      taxStrategy: "zero",
      taxRate: 0,
      receiptTemplate: "thermal80mm",
      currency: "PKR",
      contactPhone: "+92 (300) 123-4567",
      address: "Main Retail Terminal, Branch 01",
      active: true,
    });
    console.log(`[SEED] Default tenant '${tenant.tenantId}' created.`.bgGreen.black);

    // 2. Seed Inventory Items
    const itemsWithTenant = items.map((i) => ({
      ...i,
      tenantId,
      active: true,
      isDeleted: false,
    }));
    await Item.insertMany(itemsWithTenant);
    console.log(`[SEED] ${items.length} inventory products seeded successfully.`.bgGreen.black);

    // 3. Seed Sample Dealers
    await Dealer.insertMany([
      {
        dealerName: "Atlas Sanitary Supplies",
        contactName: "Tariq Mahmood (0300-1112233)",
        shopName: "Shop #14, Hardware Market",
        address: "Commercial Plaza, Lahore",
        products: "CPVC Pipes, Taps, Tanks",
        tenantId,
      },
      {
        dealerName: "Pak Steel & Fasteners",
        contactName: "Imran Khan (0321-4455667)",
        shopName: "Godown #3, Industrial Area",
        address: "GT Road, Rawalpindi",
        products: "Nails, Screws, Fasteners",
        tenantId,
      },
      {
        dealerName: "Orient Electricals",
        contactName: "Saleem Akhtar (0333-8899001)",
        shopName: "Orient Wholesale Center",
        address: "Electric Market, Karachi",
        products: "Wires, Breakers, Switches",
        tenantId,
      },
    ]);
    console.log(`[SEED] Sample suppliers & dealers seeded.`.bgGreen.black);

    // 4. Seed Sample Operating Expenses
    await Charge.insertMany([
      {
        description: "Store Electricity Bill (WAPDA)",
        amount: 8500,
        category: "utilities",
        date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        tenantId,
      },
      {
        description: "Monthly Staff Refreshments / Tea",
        amount: 2400,
        category: "operations",
        date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        tenantId,
      },
      {
        description: "Warehouse Freight & Unloading",
        amount: 4200,
        category: "logistics",
        date: new Date(),
        tenantId,
      },
    ]);
    console.log(`[SEED] Sample store expenses logged.`.bgGreen.black);

    // 5. Hash passwords for accounts
    const adminPasswordHash = await bcrypt.hash("admin@pas123", 12);
    const managerPasswordHash = await bcrypt.hash("manager@pas123", 12);
    const cashierPasswordHash = await bcrypt.hash("cashier@pas123", 12);

    // 6. Seed Master Admin, Manager, and Cashier
    const adminUser = await User.create({
      name: "haider",
      userId: "0",
      password: adminPasswordHash,
      role: "admin",
      permissions: ROLE_PERMISSIONS.admin,
      tenantId,
      active: true,
      verified: true,
    });

    const managerUser = await User.create({
      name: "Store Manager",
      userId: "1002",
      password: managerPasswordHash,
      role: "manager",
      permissions: ROLE_PERMISSIONS.manager,
      tenantId,
      active: true,
      verified: true,
    });

    const cashierUser = await User.create({
      name: "Counter Cashier",
      userId: "1001",
      password: cashierPasswordHash,
      role: "cashier",
      permissions: ROLE_PERMISSIONS.cashier,
      tenantId,
      active: true,
      verified: true,
    });

    console.log(`\n====================================================================`.cyan);
    console.log(`DATABASE SEEDED & AUTHENTICATION READY`.bgGreen.black);
    console.log(`====================================================================`.cyan);
    console.log(`[Master Admin]  User ID: ${adminUser.userId.padEnd(6)} | Name: ${adminUser.name.padEnd(10)} | Role: ${adminUser.role.padEnd(8)} | Password: admin@pas123`.green);
    console.log(`[Store Manager] User ID: ${managerUser.userId.padEnd(6)} | Name: ${managerUser.name.padEnd(10)} | Role: ${managerUser.role.padEnd(8)} | Password: manager@pas123`.blue);
    console.log(`[Cashier]       User ID: ${cashierUser.userId.padEnd(6)} | Name: ${cashierUser.name.padEnd(10)} | Role: ${cashierUser.role.padEnd(8)} | Password: cashier@pas123`.yellow);
    console.log(`====================================================================\n`.cyan);

    process.exit(0);
  } catch (error) {
    console.error(`[SEED ERROR] ${error.message}`.bgRed.white);
    process.exit(1);
  }
};

seedDatabase();