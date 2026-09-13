// src/core/database/connection.js
const dns = require("dns");
const mongoose = require("mongoose");
const AppError = require("../errors/AppError"); // Ensure AppError exists in this path
require("colors");

try {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
} catch (e) {
  // Ignore in environments where setServers is restricted
}

let isConnected = false;

function isNetworkError(error) {
  const netCodes = ["ENOTFOUND", "ETIMEDOUT", "ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH"];
  return (
    error.name === "MongoServerSelectionError" ||
    error.name === "MongoNetworkError" ||
    netCodes.some((code) => error.message.includes(code))
  );
}

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
    // Internal server logging retains raw Mongoose output
    console.error(`[Database Internal Error]: ${error.stack || error.message}`.bgRed.white);

    if (isNetworkError(error)) {
      throw new AppError(
        "Unable to connect to the server. Please check your internet connection.",
        503,
        "NETWORK_ERROR"
      );
    }

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