const { AppError } = require("./AppError");

function errorHandler(err, req, res, _next) {
  // Operational, trusted error: send message to client
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: err.message,
      errorCode: err.errorCode,
    });
  }

  // Handle Mongoose CastError / ValidationError / MongoServerError
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

  // Programming or unknown error: log & return generic 500
  console.error("[Unhandled Error]:", err);
  return res.status(err.statusCode || 500).json({
    error: err.message || "Internal server error",
    errorCode: "INTERNAL_SERVER_ERROR",
  });
}

module.exports = { errorHandler };
