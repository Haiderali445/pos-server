const express = require("express");
const morgan = require("morgan");
const cors = require("cors");
const { createContainer } = require("./src/composition/container");

function createApp(container = createContainer()) {
   const app = express();

   app.disable("x-powered-by");
   app.use(cors());
   app.use(express.json());
   app.use(express.urlencoded({ extended: false }));
   app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

   app.get("/health", (_req, res) => {
      res.status(200).json({ status: "ok" });
   });

   app.use(
      "/api/items",
      require("./src/presentation/routes/itemRoutes")({
         itemService: container.services.itemService,
      })
   );
   app.use(
      "/api/users",
      require("./src/presentation/routes/userRoutes")({
         authService: container.services.authService,
      })
   );
   app.use(
      "/api/bill",
      require("./src/presentation/routes/billRoutes")({
         checkoutService: container.services.checkoutService,
         billRepository: container.repositories.billRepository,
      })
   );
   app.use(
      "/api/dealers",
      require("./src/presentation/routes/dealerRoutes")({
         dealerService: container.services.dealerService,
      })
   );
   app.use(
      "/api/charges",
      require("./src/presentation/routes/chargesRoutes")({
         chargeService: container.services.chargeService,
      })
   );

   return app;
}

module.exports = { createApp };
