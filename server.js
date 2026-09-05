// Force Node to use Google and Cloudflare DNS to bypass local ISP blocks
require("dns").setServers(["8.8.8.8", "1.1.1.1"]);

require("dns").setServers(["8.8.8.8", "1.1.1.1"]);

const path = require("path");
const express = require("express");
const morgan = require("morgan");
const cors = require("cors");
const dotenv = require("dotenv");
const { bgCyan } = require("colors");
const connectDb = require("./config/config");
const { createContainer } = require("./src/composition/container");
require("colors");

dotenv.config({ path: path.resolve(__dirname, ".env") });

function createApp(container = createContainer()) {
   const app = express();

   app.use(cors());
   app.use(express.json());
   app.use(express.urlencoded({ extended: false }));
   app.use(morgan("dev"));

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

async function bootstrap() {
   await connectDb();

   const app = createApp();
   const port = process.env.PORT || 8080;

   app.listen(port, () => {
      console.log(`server running on port ${port}`.bgCyan.white);
   });
}

if (require.main === module) {
   bootstrap();
}

module.exports = { createApp, bootstrap };
