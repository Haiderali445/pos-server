const http = require("http");
const https = require("https");

function startKeepAliveJob() {
  // 10 minutes in milliseconds
  const INTERVAL_MS = 10 * 60 * 1000;

  setInterval(() => {
    const serverUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 8080}`;
    const healthUrl = `${serverUrl}/health`;
    
    const client = healthUrl.startsWith("https") ? https : http;

    client.get(healthUrl, (res) => {
      if (res.statusCode === 200) {
        console.log(`[KeepAlive Job] Self-ping successful to ${healthUrl}`);
      } else {
        console.warn(`[KeepAlive Job] Self-ping returned status code: ${res.statusCode}`);
      }
    }).on("error", (err) => {
      console.error(`[KeepAlive Job Error]: ${err.message}`);
    });
  }, INTERVAL_MS);

  console.log("[Jobs] Keep-Alive 10-minute self-ping scheduled successfully.".green);
}

module.exports = { startKeepAliveJob };