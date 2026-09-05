const dns = require("dns");
const mongoose = require("mongoose");
require("colors");

// Force Node to use Google and Cloudflare DNS to bypass local ISP DNS blocks on MongoDB SRV
try {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
} catch (e) {
  // Ignore in environments where setServers is restricted
}

const connectDb = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGOS_URI);
    console.log(`mongodb connected ${conn.connection.host}`.bgYellow);
    return conn;
  } catch (error) {
    console.log(`error : ${error.message}`.bgRed);
    throw error;
  }
};

module.exports = connectDb;