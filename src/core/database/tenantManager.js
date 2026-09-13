const DEFAULT_TENANT_ID = "default-store";

class TenantManager {
  constructor() {
    this.tenantCache = new Map();
  }

  getDefaultTenantId() {
    return DEFAULT_TENANT_ID;
  }

  resolveTenantId(req) {
    // 1. Check custom HTTP Header (x-tenant-id)
    const headerTenant = req.headers["x-tenant-id"] || req.headers["tenant-id"];
    if (headerTenant && typeof headerTenant === "string" && headerTenant.trim()) {
      return headerTenant.trim().toLowerCase();
    }

    // 2. Check authenticated user's JWT payload if present
    if (req.user && req.user.tenantId) {
      return String(req.user.tenantId).trim().toLowerCase();
    }

    // 3. Check query param (?tenantId=...)
    if (req.query && req.query.tenantId) {
      return String(req.query.tenantId).trim().toLowerCase();
    }

    // 4. Default fallback for existing client single-tenant compatibility
    return DEFAULT_TENANT_ID;
  }

  cacheTenant(tenantId, tenantData) {
    this.tenantCache.set(tenantId, {
      data: tenantData,
      cachedAt: Date.now(),
    });
  }

  getCachedTenant(tenantId) {
    const cached = this.tenantCache.get(tenantId);
    if (!cached) return null;
    // Cache for 5 minutes
    if (Date.now() - cached.cachedAt > 5 * 60 * 1000) {
      this.tenantCache.delete(tenantId);
      return null;
    }
    return cached.data;
  }
}

const tenantManager = new TenantManager();

module.exports = {
  tenantManager,
  DEFAULT_TENANT_ID,
};
