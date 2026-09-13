const { AppError } = require("./AppError");

function errorHandler(err, req, res, _next) {
  // 1. Detect MongoDB & DNS Network Failures
  const networkErrorCodes = ["ENOTFOUND", "ETIMEDOUT", "ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH"];
  const isNetworkFailure =
    err.name === "MongoServerSelectionError" ||
    err.name === "MongoNetworkError" ||
    err.errorCode === "NETWORK_ERROR" ||
    networkErrorCodes.some((code) => err.message && err.message.includes(code));

  if (isNetworkFailure) {
    // Log complete raw error internally for backend debugging
    console.error(`[Database Network Loss] ${req.method} ${req.url}:`, err);

    return res.status(503).json({
      error: "Internet connection error. Please check your network connection and try again.",
      errorCode: "NETWORK_ERROR",
    });
  }

  // 2. Operational, trusted domain errors
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: err.message,
      errorCode: err.errorCode,
    });
  }

  // 3. Handle Mongoose CastError / ValidationError / MongoServerError
  if (err.name === "CastError") {
    return res.status(400).json({
      error: `Invalid resource identifier format: ${err.value}`,
      errorCode: "INVALID_ID",
    });
  }

  if (err.name === "ValidationError") {
    const messages = Object.values(err.errors || {}).map((e) => e.message);
    return res.status(400).json({
      error: messages.join(", ") || "Validation failed",
      errorCode: "VALIDATION_ERROR",
    });
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || "field";
    return res.status(409).json({
      error: `A record with this ${field} already exists.`,
      errorCode: "DUPLICATE_KEY",
    });
  }

  // 4. Programming or unknown error: log & return generic 500
  console.error("[Unhandled Error]:", err);
  return res.status(err.statusCode || 500).json({
    error: err.message || "Internal server error",
    errorCode: "INTERNAL_SERVER_ERROR",
  });
}

module.exports = { errorHandler };