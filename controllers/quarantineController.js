const service = require("../services/quarantineService");
const { recordAudit } = require("../services/auditService");

async function create(req, res, next) {
  try {
    const row = await service.createQuarantine({ ...req.body, departmentId: req.body?.departmentId || req.user.departmentId || null }, req.user.id);
    await recordAudit(req, "artifact.quarantined", "quarantine", row.id, { artifactDigest: row.artifactDigest, status: row.status });
    return res.status(201).json(row);
  } catch (error) { return res.status(400).json({ message: error.message }); }
}

async function list(req, res, next) {
  try { return res.json(await service.listQuarantines({ status: req.query.status, departmentId: req.user.role === "admin" || req.user.role === "security_admin" ? req.query.departmentId : req.user.departmentId, limit: req.query.limit })); } catch (error) { return next(error); }
}

async function approve(req, res, next) {
  try {
    const row = await service.approveQuarantine(req.params.id, req.user.id, req.body?.expiresAt);
    if (!row) return res.status(404).json({ message: "Quarantine record not found" });
    await recordAudit(req, "artifact.quarantine_exception_approved", "quarantine", req.params.id, { expiresAt: req.body?.expiresAt || null });
    return res.json(row);
  } catch (error) { return next(error); }
}

async function check(req, res, next) {
  try { return res.json(await service.admissionDecision({ ...req.body, departmentId: req.body?.departmentId || req.user.departmentId })); } catch (error) { return res.status(400).json({ message: error.message }); }
}

module.exports = { create, list, approve, check };
