const env = require("../config/env");

function requireAgentToken(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : req.headers["x-agent-token"];
  if (!token || token !== env.agentToken) {
    return res.status(401).json({ message: "Valid agent token is required" });
  }
  return next();
}

module.exports = { requireAgentToken };
