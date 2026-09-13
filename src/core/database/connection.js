const dns = require("dns");
const mongoose = require("mongoose");
require("colors");

// Force Node to use Google and Cloudflare DNS to bypass local ISP DNS blocks on MongoDB SRV
try {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
} catch (e) {
  // Ignore in environments where setServers is restricted
}

let isConnected = false;

async function connectDatabase(uri = process.env.MONGOS_URI || process.env.MONGO_URI) {
  if (isConnected && mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (!uri) {
    throw new Error("MongoDB connection URI is not configured in environment variables.");
  }

  try {
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
    });
    isConnected = true;
    console.log(`[Database] MongoDB connected successfully: ${conn.connection.host}`.bgYellow.black);
    return conn.connection;
  } catch (error) {
    console.error(`[Database Error]: ${error.message}`.bgRed.white);
    throw error;
  }
}

async function disconnectDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    isConnected = false;
  }
}

module.exports = {
  connectDatabase,
  disconnectDatabase,
  mongoose,
};
