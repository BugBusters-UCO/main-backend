const jwt = require("jsonwebtoken");
const env = require("../config/env");

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : req.query.authToken || null;

  if (!token) {
    return res.status(401).json({ message: "Authentication token is required" });
  }

  try {
    req.user = jwt.verify(token, env.jwtSecret);
    return next();
  } catch (_error) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || !["admin", "security_admin"].includes(req.user.role)) return res.status(403).json({ message: "Administrator access is required" });
  return next();
}

function requireMfa(req, res, next) {
  if (env.identity.mfaRequired && !req.user?.mfaEnabled) return res.status(403).json({ message: "MFA enrollment is required" });
  if (env.identity.mfaRequired && req.user.mfaVerified !== true) return res.status(401).json({ message: "MFA verification is required" });
  return next();
}

function requireRoles(...roles) {
  return (req, res, next) => roles.includes(req.user?.role) ? next() : res.status(403).json({ message: "Insufficient role permissions" });
}

module.exports = { requireAdmin, requireAuth, requireMfa, requireRoles };
