class AppError extends Error {
  constructor(message, statusCode = 500, errorCode = "INTERNAL_ERROR", isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

class BadRequestError extends AppError {
  constructor(message = "Bad request", errorCode = "BAD_REQUEST") {
    super(message, 400, errorCode);
  }
}

class UnauthorizedError extends AppError {
  constructor(message = "Authentication required", errorCode = "UNAUTHORIZED") {
    super(message, 401, errorCode);
  }
}

class ForbiddenError extends AppError {
  constructor(message = "Access denied. Insufficient permissions.", errorCode = "FORBIDDEN") {
    super(message, 403, errorCode);
  }
}

class NotFoundError extends AppError {
  constructor(message = "Resource not found", errorCode = "NOT_FOUND") {
    super(message, 404, errorCode);
  }
}

class ConflictError extends AppError {
  constructor(message = "Resource conflict", errorCode = "CONFLICT") {
    super(message, 409, errorCode);
  }
}

class NetworkError extends AppError {
  constructor(
    message = "Unable to connect to the server. Please check your internet connection.",
    errorCode = "NETWORK_ERROR"
  ) {
    super(message, 503, errorCode);
  }
}

module.exports = {
  AppError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  NetworkError,
};