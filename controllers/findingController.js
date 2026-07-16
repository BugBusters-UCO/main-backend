const { FindingReview, ScanJob } = require("../models");
const { recordAudit } = require("../services/auditService");

const VALID = new Set(["open", "confirmed", "in_progress", "fixed", "accepted_risk", "false_positive", "waived", "reopened"]);

async function reviewFinding(req, res, next) {
  try {
    const { scanJobId, status, note, dueAt } = req.body || {};
    if (!scanJobId || !VALID.has(status)) return res.status(400).json({ message: "scanJobId and a valid finding status are required" });
    if (!FindingReview || !ScanJob) return res.status(503).json({ message: "Finding lifecycle requires PostgreSQL" });
    const job = await ScanJob.findByPk(scanJobId);
    if (!job || !_canAccessJob(job, req.user)) return res.status(404).json({ message: "Scan job not found" });
    const review = await FindingReview.create({ findingId: req.params.findingId, scanJobId, departmentId: req.user.departmentId || null, status, note: note || null, dueAt: dueAt || null, reviewerId: req.user.id });
    await recordAudit(req, "finding.reviewed", "finding", req.params.findingId, { scanJobId, status, dueAt: dueAt || null });
    return res.status(201).json(review.toJSON());
  } catch (error) { return next(error); }
}

async function listFindingReviews(req, res, next) {
  try {
    if (!FindingReview) return res.json([]);
    const rows = await FindingReview.findAll({ where: { findingId: req.params.findingId, ...(req.user.departmentId && !["admin", "security_admin", "auditor"].includes(req.user.role) ? { departmentId: req.user.departmentId } : {}) }, order: [["createdAt", "DESC"]], limit: 100 });
    return res.json(rows.map((row) => row.toJSON()));
  } catch (error) { return next(error); }
}

function _canAccessJob(job, user) {
  if (["admin", "security_admin", "auditor"].includes(user.role)) return true;
  if (job.userId && job.userId !== user.id) return false;
  return !job.departmentId || !user.departmentId || job.departmentId === user.departmentId;
}

module.exports = { listFindingReviews, reviewFinding };
