const express = require("express");
const morgan = require("morgan");
const cors = require("cors");

// Core Middlewares & Errors
const { tenantResolver } = require("./src/core/middlewares/tenantResolver");
const { errorHandler } = require("./src/core/errors/errorHandler");

// Feature Module Services
const AuthService = require("./src/modules/auth/auth.service");
const InventoryService = require("./src/modules/inventory/inventory.service");
const BillingService = require("./src/modules/billing/billing.service");
const DealersService = require("./src/modules/expenses/dealers.service");
const ChargesService = require("./src/modules/expenses/charges.service");
const TenantService = require("./src/modules/tenant-admin/tenant.service");
const AccountsService = require("./src/modules/accounts/accounts.service");

// Feature Module Route Factories
const createAuthRoutes = require("./src/modules/auth/auth.routes");
const createInventoryRoutes = require("./src/modules/inventory/inventory.routes");
const createBillingRoutes = require("./src/modules/billing/billing.routes");
const createAccountRoutes = require("./src/modules/accounts/accounts.routes");
const { createDealerRoutes, createChargesRoutes } = require("./src/modules/expenses/expenses.routes");
const { createUserManagementRoutes, createTenantConfigRoutes } = require("./src/modules/tenant-admin/tenant.routes");

function createApp(dependencies = {}) {
  const app = express();

  // Instantiate feature services
  const authService = dependencies.authService || new AuthService();
  const inventoryService = dependencies.inventoryService || new InventoryService();
  const billingService = dependencies.billingService || new BillingService();
  const dealersService = dependencies.dealersService || new DealersService();
  const chargesService = dependencies.chargesService || new ChargesService();
  const tenantService = dependencies.tenantService || new TenantService();
  const accountsService = dependencies.accountsService || new AccountsService();

  // Core Express Settings
  app.disable("x-powered-by");

  // Dynamic CORS configuration allowing credentials
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow non-browser agents (Postman, curl) and echo back any browser origin
        if (!origin) return callback(null, true);
        return callback(null, true);
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "x-tenant-id"],
    })
  );

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  if (process.env.NODE_ENV !== "test") {
    app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
  }

  // Tenant Resolution Context Middleware
  app.use(tenantResolver);

  // Health check endpoint
  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Combined User & Authentication Router (Maintains 100% backward compatibility)
  const authRouter = createAuthRoutes(authService);
  const userMgmtRouter = createUserManagementRoutes(tenantService);
  const combinedUserRouter = express.Router();
  combinedUserRouter.use(authRouter);
  combinedUserRouter.use(userMgmtRouter);

  app.use("/api/users", combinedUserRouter);
  app.use("/api/items", createInventoryRoutes(inventoryService));
  app.use("/api/bill", createBillingRoutes(billingService));
  app.use("/api/dealers", createDealerRoutes(dealersService));
  app.use("/api/charges", createChargesRoutes(chargesService));
  const accountRouter = createAccountRoutes(accountsService);
  app.use("/api/accounts", accountRouter);
  app.use("/api/account", accountRouter);
  app.use("/api/tenant", createTenantConfigRoutes(tenantService));

  // Centralized Error Handling Middleware (must be last)
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };