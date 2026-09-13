const JoseTokenSigner = require("../security/JoseTokenSigner");
const { UnauthorizedError } = require("../errors/AppError");

const tokenSigner = new JoseTokenSigner();

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : req.headers["x-auth-token"] || "";

  if (!token) {
    return next(new UnauthorizedError("Authentication token required"));
  }

  const secret = process.env.JWT_SECRET || "pos-secret-key-change-in-production";

  tokenSigner
    .verify(token, secret)
    .then((payload) => {
      req.user = {
        _id: payload.sub,
        userId: payload.userId,
        role: payload.role || "cashier",
        tenantId: payload.tenantId || req.tenantId || "default-store",
        permissions: Array.isArray(payload.permissions) ? payload.permissions : [],
      };
      // Synchronize req.tenantId with user's tenant if specified in token
      if (payload.tenantId) {
        req.tenantId = payload.tenantId;
        req.tenant = { tenantId: payload.tenantId };
      }
      next();
    })
    .catch(() => {
      return next(new UnauthorizedError("Invalid or expired session token"));
    });
}

// Optional authentication middleware (for routes accessible by both guests and logged-in users)
function optionalAuthenticate(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : req.headers["x-auth-token"] || "";

  if (!token) {
    return next();
  }

  const secret = process.env.JWT_SECRET || "pos-secret-key-change-in-production";
  tokenSigner
    .verify(token, secret)
    .then((payload) => {
      req.user = {
        _id: payload.sub,
        userId: payload.userId,
        role: payload.role || "cashier",
        tenantId: payload.tenantId || req.tenantId || "default-store",
        permissions: Array.isArray(payload.permissions) ? payload.permissions : [],
      };
      next();
    })
    .catch(() => {
      next();
    });
}

module.exports = {
  authenticate,
  optionalAuthenticate,
};
