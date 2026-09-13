const { tenantManager } = require("../database/tenantManager");

function tenantResolver(req, _res, next) {
  const tenantId = tenantManager.resolveTenantId(req);
  req.tenantId = tenantId;
  req.tenant = {
    tenantId,
  };
  next();
}

module.exports = { tenantResolver };
