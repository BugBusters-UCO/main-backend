const { listAuditEvents } = require("../services/auditService");

async function listAudit(req, res, next) {
  try { return res.json(await listAuditEvents(req.query.limit)); }
  catch (error) { return next(error); }
}

module.exports = { listAudit };
