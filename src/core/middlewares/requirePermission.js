const { ForbiddenError, UnauthorizedError } = require("../errors/AppError");

// Comprehensive Role-to-Capability Hierarchy Mapping
const ROLE_PERMISSIONS = {
  cashier: [
    "pos:checkout",
    "bills:read",
    "catalog:read",
  ],
  manager: [
    "pos:checkout",
    "bills:read",
    "bills:edit",
    "bills:void",
    "catalog:read",
    "catalog:manage",
    "expenses:manage",
    "dealers:manage",
    "analytics:read",
  ],
  admin: [
    "pos:checkout",
    "bills:read",
    "bills:edit",
    "bills:void",
    "bills:delete",
    "catalog:read",
    "catalog:manage",
    "catalog:delete",
    "expenses:manage",
    "dealers:manage",
    "analytics:read",
    "users:manage",
    "tenant:config",
  ],
};

function hasCapability(user, capability) {
  if (!user) return false;
  const role = (user.role || "cashier").toLowerCase();

  // Master Admin has all capabilities
  if (role === "admin" || user.userId === "admin") return true;

  // Check custom granted permissions
  if (Array.isArray(user.permissions) && user.permissions.includes(capability)) {
    return true;
  }

  // Check role-based capabilities
  const granted = ROLE_PERMISSIONS[role] || [];
  return granted.includes(capability);
}

function requirePermission(...requiredCapabilities) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(new UnauthorizedError("Authentication required for this resource"));
    }

    const authorized = requiredCapabilities.some((cap) => hasCapability(req.user, cap));
    if (!authorized) {
      return next(
        new ForbiddenError(
          `Access denied. Requires capability: ${requiredCapabilities.join(" or ")}`
        )
      );
    }

    next();
  };
}

function requireRole(allowedRoles = []) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(new UnauthorizedError("Authentication required for this resource"));
    }

    const userRole = (req.user.role || "cashier").toLowerCase();
    if (userRole === "admin" || req.user.userId === "admin") {
      return next();
    }

    if (allowedRoles.length > 0 && !allowedRoles.map((r) => r.toLowerCase()).includes(userRole)) {
      return next(new ForbiddenError("Access denied. Insufficient role permissions."));
    }

    next();
  };
}

module.exports = {
  requirePermission,
  requireRole,
  hasCapability,
  ROLE_PERMISSIONS,
};
