const { SecretFinding } = require("../models");

async function persistSecretFindings(scanJobId, result = {}) {
  if (!SecretFinding || !scanJobId) return { persisted: 0, durable: false };
  const rows = [
    ...(result.findings || []).map((finding) => normalize(scanJobId, finding, "secret")),
    ...(result.sensitive_data_findings || []).map((finding) => normalize(scanJobId, {
      ...finding,
      rule_id: `PII-${finding.data_type}`,
      secret_type: finding.data_type,
      category: "Sensitive Data",
      title: `Sensitive data: ${finding.data_type}`
    }, "sensitive-data"))
  ];
  await SecretFinding.destroy({ where: { scanJobId } });
  if (rows.length) await SecretFinding.bulkCreate(rows);
  return { persisted: rows.length, durable: true };
}

function normalize(scanJobId, finding, findingClass) {
  return {
    findingId: finding.id,
    scanJobId,
    fingerprint: finding.fingerprint || "unknown",
    ruleId: finding.rule_id || null,
    secretType: finding.secret_type || "unknown",
    category: finding.category || findingClass,
    severity: String(finding.severity || "info"),
    filePath: finding.file_path || null,
    lineNumber: finding.line_number || null,
    confidence: finding.confidence ?? null,
    validationStatus: finding.validation_status || null,
    context: finding.context || null,
    evidence: finding.evidence || null,
    metadata: { findingClass, title: finding.title || null }
  };
}

module.exports = { persistSecretFindings };
