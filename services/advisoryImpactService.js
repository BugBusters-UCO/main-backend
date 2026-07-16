const { ScanJob } = require("../models");

async function analyzeAdvisoryImpact(advisories = []) {
  const rows = ScanJob ? await ScanJob.findAll({ where: { scannerType: "dependency", status: "completed" }, limit: 10000 }) : [];
  const impacted = [];
  for (const row of rows) {
    const job = row.toJSON(); const result = job.result || {};
    const candidates = [...(result.dependencies || []), ...(result.findings || [])];
    const matches = advisories.filter((advisory) => candidates.some((item) => _matches(advisory, item)));
    if (matches.length) impacted.push({ scanJobId: job.id, userId: job.userId, departmentId: job.departmentId || null, sourceType: job.sourceType, sourceLabel: job.sourceLabel, repoUrl: job.repoUrl || null, commitSha: job.commitSha || null, advisories: matches.map((item) => ({ id: item.id, source: item.source, severity: item.severity, cisaKev: item.cisaKev })), action: matches.some((item) => item.cisaKev || ["critical", "high"].includes(item.severity)) ? "emergency_rescan" : "review" });
  }
  return impacted;
}

async function enqueueEmergencyRescans(impacted = []) {
  const { createJob } = require("./scanJobStore");
  const { enqueueDependencyScan, isRedisEnabled } = require("./redisScanQueue");
  if (!isRedisEnabled()) return { queued: 0, skipped: impacted.filter((item) => item.action === "emergency_rescan").length, reason: "durable queue is disabled" };
  let queued = 0;
  for (const item of impacted.filter((entry) => entry.action === "emergency_rescan" && entry.repoUrl && entry.commitSha)) {
    const id = require("crypto").randomUUID();
    await createJob({ id, userId: item.userId || null, importedRepositoryId: null, scannerType: "dependency", sourceType: item.sourceType || "github", sourceLabel: item.sourceLabel || item.repoUrl, repoUrl: item.repoUrl, commitSha: item.commitSha, departmentId: item.departmentId || null, status: "queued", result: null, error: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    await enqueueDependencyScan(id, { sourceType: item.sourceType || "github", provider: item.sourceType || "github", sourceLabel: item.sourceLabel || item.repoUrl, repoUrl: item.repoUrl, commitSha: item.commitSha, userId: item.userId || null, includeDev: true, useOsv: true, failOn: "high", departmentId: item.departmentId || null });
    queued += 1;
  }
  return { queued, skipped: impacted.filter((item) => item.action === "emergency_rescan").length - queued };
}

function _matches(advisory, item) {
  const ids = new Set([advisory.id, ...(advisory.aliases || [])].filter(Boolean).map(String));
  if (ids.has(String(item.id || "")) || (item.aliases || []).some((alias) => ids.has(String(alias)))) return true;
  const name = item.package_name || item.name;
  return Boolean(name && (advisory.affected || []).some((affected) => {
    const packageName = affected.package?.name || affected.packageName || affected.product;
    return packageName && String(packageName).toLowerCase() === String(name).toLowerCase();
  }));
}

module.exports = { analyzeAdvisoryImpact, enqueueEmergencyRescans };
