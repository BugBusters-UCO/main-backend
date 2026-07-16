const crypto = require("crypto");
const axios = require("axios");
const metrics = require("./operationalMetricsService");

function targets() {
  const raw = process.env.CIPHER_NOTIFICATION_WEBHOOKS || "[]";
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((target) => target && target.name && target.url && ["webhook", "ticket"].includes(target.kind || "webhook"));
  } catch (_error) {
    metrics.increment("cipher_notification_config_errors_total");
    return [];
  }
}

function notificationPayload(job) {
  const result = job?.result || {};
  const summary = result.summary || {};
  const findings = Array.isArray(result.findings) ? result.findings : [];
  return {
    event: "cipher.scan.completed",
    event_version: "1",
    occurred_at: new Date().toISOString(),
    job_id: job?.id,
    source: job?.sourceLabel || job?.sourceType || "unknown",
    status: job?.status || "completed",
    policy_status: result.policy_decision?.status || summary.ci_status || "unknown",
    severity: summary.findings_by_severity || {},
    risk_score: summary.risk_score ?? null,
    business_adjusted_risk_score: summary.business_adjusted_risk_score ?? null,
    finding_count: findings.filter((finding) => !finding.suppressed).length,
    suppressed_finding_count: summary.suppressed_findings || 0,
    remediation_actions: summary.remediation_actions || 0,
    deployment_status: result.deployment_readiness?.status || null
  };
}

function signature(body, secret) {
  return `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
}

async function deliver(target, payload) {
  const body = JSON.stringify({ ...payload, integration: target.kind || "webhook" });
  const headers = { "Content-Type": "application/json", "User-Agent": "pre-cipher-backend/1.0" };
  if (target.secret) headers["X-Cipher-Signature"] = signature(body, target.secret);
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await axios.post(target.url, body, { headers, timeout: 5000, maxContentLength: 100000, maxBodyLength: 100000 });
      metrics.increment("cipher_notifications_delivered_total");
      return { name: target.name, delivered: true, attempts: attempt + 1 };
    } catch (error) {
      lastError = error;
      metrics.increment("cipher_notification_retries_total");
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** attempt)));
    }
  }
  metrics.increment("cipher_notifications_failed_total");
  return { name: target.name, delivered: false, error: String(lastError?.message || "delivery failed").slice(0, 300) };
}

async function notifyCipherScan(job, selectedNames = null) {
  const configured = targets().filter((target) => !selectedNames || selectedNames.includes(target.name));
  if (!configured.length) return { configured: 0, delivered: 0, failed: 0, results: [] };
  const payload = notificationPayload(job);
  const results = await Promise.all(configured.map((target) => deliver(target, payload)));
  return {
    configured: results.length,
    delivered: results.filter((result) => result.delivered).length,
    failed: results.filter((result) => !result.delivered).length,
    results
  };
}

function getNotificationStatus() {
  return { configuredTargets: targets().map(({ name, kind = "webhook" }) => ({ name, kind })) };
}

module.exports = { getNotificationStatus, notifyCipherScan, notificationPayload };
