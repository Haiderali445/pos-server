const JoseTokenSigner = require("../../infrastructure/security/JoseTokenSigner");

const tokenSigner = new JoseTokenSigner();

function requireAuth(allowedRoles = []) {
  return async (req, res, next) => {
    try {
      const authHeader = req.headers.authorization || "";
      const token = authHeader.startsWith("Bearer ")
        ? authHeader.slice(7).trim()
        : req.headers["x-auth-token"] || "";

      if (!token) {
        return res.status(401).json({ error: "Authentication token required" });
      }

      const secret = process.env.JWT_SECRET || "pos-secret-key-change-in-production";
      const payload = await tokenSigner.verify(token, secret);
      req.user = payload;

      if (allowedRoles.length > 0 && !allowedRoles.includes(payload.role)) {
        return res.status(403).json({ error: "Access denied. Insufficient permissions." });
      }

      next();
    } catch (error) {
      return res.status(401).json({ error: "Invalid or expired session token" });
    }
  };
}

module.exports = { requireAuth };
