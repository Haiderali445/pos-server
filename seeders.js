// Force Node to use Google and Cloudflare DNS to bypass local ISP blocks
require("dns").setServers(["8.8.8.8", "1.1.1.1"]);

const mongoose = require("mongoose");
const dotenv = require("dotenv");
const bcrypt = require("bcrypt");
const path = require("path");
const connectDb = require("./config/config");
const itemModel = require("./src/infrastructure/models/itemModels");
const userModel = require("./src/infrastructure/models/userModels");
const items = require("./src/infrastructure/seedData/items");
require("colors");

dotenv.config({ path: path.resolve(__dirname, ".env") });

const seedDatabase = async () => {
  try {
    await connectDb();

    // 1. Seed Inventory Items
    await itemModel.deleteMany();
    await itemModel.insertMany(items);
    console.log(`[SEED] ${items.length} inventory products seeded successfully.`.bgGreen.black);

    // 2. Hash password for operators
    const passwordHash = await bcrypt.hash("test123", 12);

    // 3. Upsert Master Admin: "haider ali", pass: "test123"
    await userModel.deleteMany({ userId: { $in: ["admin", "1001"] } });

    const adminUser = await userModel.create({
      name: "haider ali",
      userId: "admin",
      password: passwordHash,
      role: "admin",
      active: true,
      verified: true,
    });

    // 4. Seed sample cashier operator
    const cashierUser = await userModel.create({
      name: "Counter Cashier",
      userId: "1001",
      password: passwordHash,
      role: "cashier",
      active: true,
      verified: true,
    });

    console.log(`\n==================================================`.cyan);
    console.log(`MASTER ADMIN & OPERATORS SEEDED SUCCESSFULLY`.bgCyan.black);
    console.log(`==================================================`.cyan);
    console.log(`[Master Admin] Name: ${adminUser.name} | User ID: ${adminUser.userId} | Role: ${adminUser.role} | Password: test123`.green);
    console.log(`[Test Cashier] Name: ${cashierUser.name} | User ID: ${cashierUser.userId} | Role: ${cashierUser.role} | Password: test123`.yellow);
    console.log(`==================================================\n`.cyan);

    process.exit(0);
  } catch (error) {
    console.error(`[SEED ERROR] ${error.message}`.bgRed.white);
    process.exit(1);
  }
};

seedDatabase();