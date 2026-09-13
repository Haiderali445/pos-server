require("dns").setServers(["8.8.8.8", "1.1.1.1"]);

const path = require("path");
const http = require("http");
const dotenv = require("dotenv");
require("colors");

dotenv.config({ path: path.resolve(__dirname, ".env.local") });

const { connectDatabase } = require("./src/core/database/connection");
const { startKeepAliveJob } = require("./src/core/jobs/keepAlive");
const { createApp } = require("./app");

const port = Number(process.env.PORT) || 8080;

async function startServer() {
  await connectDatabase();

  const server = http.createServer(createApp());
  server.listen(port, () => {
    console.log(`Server running on port ${port}`.bgCyan.white);
    
    // Initialize 10-minute self-ping keep-alive job
    startKeepAliveJob();
  });

  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down gracefully`);
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