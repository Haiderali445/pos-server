require("dns").setServers(["8.8.8.8", "1.1.1.1"]);

const path = require("path");
const http = require("http");
const dotenv = require("dotenv");
const { bgCyan } = require("colors");

require("colors");
dotenv.config({ path: path.resolve(__dirname, ".env.local") });

const connectDb = require("./config/config");
const { createApp } = require("./app");

const port = Number(process.env.PORT) || 8080;

async function startServer() {
   await connectDb();

   const server = http.createServer(createApp());
   server.listen(port, () => {
      console.log(`server running on port ${port}`.bgCyan.white);
   });

   const shutdown = (signal) => {
      console.log(`${signal} received, shutting down`);
      server.close(() => process.exit(0));
   };

   process.once("SIGINT", () => shutdown("SIGINT"));
   process.once("SIGTERM", () => shutdown("SIGTERM"));

   return server;
}

if (require.main === module) {
   startServer().catch((error) => {
      console.error("Failed to start server:", error.message);
      process.exitCode = 1;
   });
}

module.exports = { startServer };
