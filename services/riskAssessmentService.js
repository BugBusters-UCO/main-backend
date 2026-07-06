const { randomUUID } = require("crypto");
const { RiskAssessment } = require("../models");
const { getJob } = require("./scanJobStore");
const { getAgentScan } = require("./agentService");
const {
  analyzeRisk,
  generateRiskRemedies,
  scannerJobEnvelopesFromScanJobs,
  toSnakeBusinessContext
} = require("./riskEngineService");

const memoryAssessments = new Map();
const scheduledAssessments = new Set();
const SCANNERS = new Set(["dependency", "config", "secret", "cipher"]);
const TERMINAL_SCAN_STATUSES = new Set(["completed", "failed", "cancelled", "canceled", "stopped"]);
const TERMINAL_AGENT_STATUSES = new Set(["completed", "failed", "cancelled", "canceled", "stopping", "stopped"]);
const POLL_DELAY_MS = 3000;
const MAX_EMPTY_RETRIES = 4;

async function createRiskAssessment(userId, input = {}) {
  const now = new Date().toISOString();
  const assessment = {
    id: randomUUID(),
    userId,
    sourceType: _sourceType(input.sourceType || input.source_type),
    sourceLabel: String(input.sourceLabel || input.source_label || "unknown-source"),
    status: "waiting",
    scanJobIds: _ids(input.scanJobIds || input.scan_job_ids),
    agentScanJobIds: _ids(input.agentScanJobIds || input.agent_scan_job_ids),
    businessContext: input.businessContext || input.business_context || null,
    weights: input.weights || null,
    includeAiRecommendation: false,
    result: null,
    error: null,
    startedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now
  };

  if (!assessment.scanJobIds.length && !assessment.agentScanJobIds.length) {
    const error = new Error("At least one scanner job id or VM agent scan job id is required");
    error.statusCode = 400;
    throw error;
  }

  if (RiskAssessment) {
    await RiskAssessment.create(_dbAssessment(assessment));
  } else {
    memoryAssessments.set(assessment.id, assessment);
  }

  scheduleRiskAssessment(assessment.id);
  return getRiskAssessment(userId, assessment.id);
}

async function listRiskAssessments(userId, filters = {}) {
  if (RiskAssessment) {
    const where = { userId };
    if (filters.status) where.status = filters.status;
    const rows = await RiskAssessment.findAll({
      where,
      order: [["createdAt", "DESC"]],
      limit: filters.limit || 100
    });
    return rows.map(_plain);
  }

  return Array.from(memoryAssessments.values())
    .filter((assessment) => assessment.userId === userId)
    .filter((assessment) => !filters.status || assessment.status === filters.status)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, filters.limit || 100);
}

async function getRiskAssessment(userId, assessmentId) {
  if (RiskAssessment) {
    const row = await RiskAssessment.findOne({ where: { id: assessmentId, userId } });
    return row ? _plain(row) : null;
  }
  const assessment = memoryAssessments.get(assessmentId);
  return assessment && assessment.userId === userId ? assessment : null;
}

function scheduleRiskAssessment(assessmentId, delayMs = POLL_DELAY_MS) {
  if (!assessmentId || scheduledAssessments.has(assessmentId)) return;
  scheduledAssessments.add(assessmentId);
  setTimeout(async () => {
    scheduledAssessments.delete(assessmentId);
    try {
      await runRiskAssessment(assessmentId);
    } catch (error) {
      console.error(`Risk assessment ${assessmentId} failed:`, error.message);
    }
  }, delayMs).unref?.();
}

async function resumePendingAssessments() {
  const pendingStatuses = new Set(["waiting", "running"]);
  if (RiskAssessment) {
    const rows = await RiskAssessment.findAll({
      where: { status: ["waiting", "running"] },
      limit: 200
    });
    for (const row of rows) scheduleRiskAssessment(row.id, 1000);
    return rows.length;
  }

  let count = 0;
  for (const assessment of memoryAssessments.values()) {
    if (pendingStatuses.has(assessment.status)) {
      scheduleRiskAssessment(assessment.id, 1000);
      count += 1;
    }
  }
  return count;
}

async function runRiskAssessment(assessmentId, state = {}) {
  const assessment = await _getAssessmentById(assessmentId);
  if (!assessment || ["completed", "failed", "cancelled"].includes(assessment.status)) return assessment;

  await _updateAssessment(assessment.id, {
    status: assessment.status === "waiting" ? "waiting" : "running",
    error: null
  });

  const scanJobs = await _loadScanJobs(assessment.scanJobIds);
  const agentJobs = await _loadAgentScanJobs(assessment.userId, assessment.agentScanJobIds);
  const readiness = _readiness(scanJobs, agentJobs);

  if (!readiness.ready) {
    scheduleRiskAssessment(assessment.id);
    return _getAssessmentById(assessment.id);
  }

  if (_hasCancelledOrStoppedJob(scanJobs, agentJobs)) {
    return _cancelAssessment(
      assessment,
      "Risk analysis was skipped because at least one selected scan was stopped or cancelled before completion.",
      readiness.skipped
    );
  }

  const scannerJobs = [
    ...scannerJobEnvelopesFromScanJobs(scanJobs.filter((job) => job?.status === "completed")),
    ..._scannerJobsFromAgentScans(agentJobs.filter((job) => job?.status === "completed"))
  ];

  if (!scannerJobs.length) {
    const attempts = Number(state.emptyAttempts || 0) + 1;
    if (attempts < MAX_EMPTY_RETRIES && readiness.hasRunningOrQueued) {
      scheduleRiskAssessment(assessment.id);
      return _getAssessmentById(assessment.id);
    }
    return _failAssessment(
      assessment,
      "No completed scanner result payloads were available for risk analysis."
    );
  }

  await _updateAssessment(assessment.id, {
    status: "running",
    startedAt: assessment.startedAt || new Date().toISOString()
  });

  try {
    const risk = await analyzeRisk({
      project_name: assessment.sourceLabel,
      environment: assessment.sourceType,
      scanner_jobs: scannerJobs,
      business_context: toSnakeBusinessContext(assessment.businessContext || {}),
      weights: assessment.weights || { technical: 0.7, business: 0.3 },
      include_ai_recommendation: false
    });

    return _updateAssessment(assessment.id, {
      status: "completed",
      result: {
        risk,
        input: {
          scannerJobs: scannerJobs.map((job) => ({
            job_id: job.job_id,
            scanner: job.scanner,
            source_label: job.source_label,
            source_type: job.source_type,
            completed_at: job.completed_at
          })),
          skipped: readiness.skipped
        }
      },
      error: null,
      completedAt: new Date().toISOString()
    });
  } catch (error) {
    return _failAssessment(assessment, error.message || "Risk engine failed");
  }
}

async function generateAssessmentRemedies(userId, assessmentId, input = {}) {
  const assessment = await getRiskAssessment(userId, assessmentId);
  if (!assessment) return null;
  if (assessment.status !== "completed" || !assessment.result?.risk) {
    const error = new Error("AI remedies can be generated only after risk assessment is completed");
    error.statusCode = 400;
    throw error;
  }

  const remedies = await generateRiskRemedies({
    risk: _minimalRiskPayload(assessment.result.risk),
    finding_ids: _ids(input.findingIds || input.finding_ids),
    limit: Math.max(1, Math.min(5, Number(input.limit || 3))),
  });

  const tokenUsage = remedies.token_usage || {};
  console.log(
    `Assessment ${assessment.id} OpenAI token usage: prompt=${tokenUsage.prompt_tokens || 0}, completion=${tokenUsage.completion_tokens || 0}, total=${tokenUsage.total_tokens || 0}`
  );

  return _updateAssessment(assessment.id, {
    result: {
      ...(assessment.result || {}),
      aiRemedies: remedies.recommendations || [],
      aiTokenUsage: tokenUsage,
      aiPromptPolicy: remedies.prompt_policy,
      aiGeneratedAt: new Date().toISOString()
    }
  });
}

async function _loadScanJobs(jobIds) {
  const jobs = [];
  for (const id of jobIds || []) {
    const job = await getJob(id);
    if (job) jobs.push(job);
  }
  return jobs;
}

async function _loadAgentScanJobs(userId, jobIds) {
  const jobs = [];
  for (const id of jobIds || []) {
    const job = await getAgentScan(userId, id);
    if (job) jobs.push(job);
  }
  return jobs;
}

function _readiness(scanJobs, agentJobs) {
  const allJobs = [...scanJobs, ...agentJobs];
  const hasRunningOrQueued = allJobs.some((job) => job && !TERMINAL_SCAN_STATUSES.has(job.status) && !TERMINAL_AGENT_STATUSES.has(job.status));
  const scanPending = scanJobs.some((job) => job && !TERMINAL_SCAN_STATUSES.has(job.status));
  const agentPending = agentJobs.some((job) => job && !TERMINAL_AGENT_STATUSES.has(job.status));
  const skipped = [
    ...scanJobs.filter((job) => ["failed", "cancelled", "canceled", "stopped"].includes(job?.status)).map((job) => ({ job_id: job.id, type: "scanner", reason: job.error || `scanner ${job.status}` })),
    ...agentJobs.filter((job) => ["failed", "cancelled", "canceled", "stopping", "stopped"].includes(job?.status)).map((job) => ({ job_id: job.id, type: "vm-agent", reason: job.error || `agent scan ${job.status}` }))
  ];
  return {
    ready: !scanPending && !agentPending,
    hasRunningOrQueued,
    skipped
  };
}

function _hasCancelledOrStoppedJob(scanJobs, agentJobs) {
  const blockedStatuses = new Set(["cancelled", "canceled", "stopping", "stopped"]);
  return [...scanJobs, ...agentJobs].some((job) => blockedStatuses.has(job?.status));
}

function _scannerJobsFromAgentScans(agentJobs) {
  const envelopes = [];
  for (const agentJob of agentJobs || []) {
    const reports = Array.isArray(agentJob.result?.reports) ? agentJob.result.reports : [];
    for (const [index, report] of reports.entries()) {
      const scanner = report?.module;
      const result = report?.result || report?.raw_result || report?.output || agentJob.result?.[scanner] || agentJob.result?.summary?.[scanner] || report || null;
      if (!SCANNERS.has(scanner) || !result) continue;
      envelopes.push({
        job_id: `${agentJob.id}:${scanner}:${index}`,
        scanner,
        source_label: agentJob.sourceLabel,
        source_type: "vm-agent",
        created_at: agentJob.createdAt,
        completed_at: agentJob.completedAt,
        result
      });
    }
  }
  return envelopes;
}

async function _failAssessment(assessment, message) {
  return _updateAssessment(assessment.id, {
    status: "failed",
    error: message,
    completedAt: new Date().toISOString()
  });
}

async function _cancelAssessment(assessment, message, skipped = []) {
  return _updateAssessment(assessment.id, {
    status: "cancelled",
    result: {
      risk: null,
      input: {
        scannerJobs: [],
        skipped
      }
    },
    error: message,
    completedAt: new Date().toISOString()
  });
}

async function _getAssessmentById(assessmentId) {
  if (RiskAssessment) {
    const row = await RiskAssessment.findByPk(assessmentId);
    return row ? _plain(row) : null;
  }
  return memoryAssessments.get(assessmentId) || null;
}

async function _updateAssessment(assessmentId, patch) {
  const nextPatch = { ...patch, updatedAt: new Date().toISOString() };
  if (RiskAssessment) {
    await RiskAssessment.update(nextPatch, { where: { id: assessmentId } });
    return _getAssessmentById(assessmentId);
  }
  const existing = memoryAssessments.get(assessmentId);
  if (!existing) return null;
  const updated = { ...existing, ...nextPatch };
  memoryAssessments.set(assessmentId, updated);
  return updated;
}

function _sourceType(raw) {
  const value = String(raw || "github");
  return ["github", "zip", "local", "vm-agent"].includes(value) ? value : "github";
}

function _ids(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(String).filter(Boolean).slice(0, 25);
}

function _minimalRiskPayload(risk) {
  return {
    project_name: risk.project_name,
    environment: risk.environment,
    technical_risk_score: risk.technical_risk_score,
    business_risk_score: risk.business_risk_score,
    final_risk_score: risk.final_risk_score,
    risk_level: risk.risk_level,
    formula: risk.formula,
    business_inputs: risk.business_inputs || [],
    scanner_scores: risk.scanner_scores || {},
    top_findings: (risk.top_findings || []).slice(0, 5).map((finding) => ({
      id: finding.id,
      scanner: finding.scanner,
      source_job_id: finding.source_job_id,
      source_label: finding.source_label,
      title: finding.title,
      severity: finding.severity,
      category: finding.category,
      file_path: finding.file_path,
      line_number: finding.line_number,
      confidence: finding.confidence,
      evidence: null,
      remediation: finding.remediation,
      technical_score: finding.technical_score,
      business_adjusted_score: finding.business_adjusted_score,
      risk_level: finding.risk_level,
      plain_language_summary: finding.plain_language_summary,
    })),
    correlation_paths: [],
    executive_summary: risk.executive_summary,
    developer_summary: risk.developer_summary,
    remediation_priorities: (risk.remediation_priorities || []).slice(0, 5),
    overall_priorities: (risk.overall_priorities || []).slice(0, 5),
    scanner_priorities: risk.scanner_priorities || {},
    executive_brief: risk.executive_brief || null,
    ai_recommendation: null,
    ai_recommendations: [],
  };
}

function _dbAssessment(assessment) {
  return {
    id: assessment.id,
    userId: assessment.userId,
    sourceType: assessment.sourceType,
    sourceLabel: assessment.sourceLabel,
    status: assessment.status,
    scanJobIds: assessment.scanJobIds,
    agentScanJobIds: assessment.agentScanJobIds,
    businessContext: assessment.businessContext,
    weights: assessment.weights,
    includeAiRecommendation: assessment.includeAiRecommendation,
    result: assessment.result,
    error: assessment.error,
    startedAt: assessment.startedAt,
    completedAt: assessment.completedAt
  };
}

function _plain(row) {
  const plain = typeof row.toJSON === "function" ? row.toJSON() : row;
  for (const key of ["createdAt", "updatedAt", "startedAt", "completedAt"]) {
    if (plain[key] instanceof Date) plain[key] = plain[key].toISOString();
  }
  return plain;
}

module.exports = {
  createRiskAssessment,
  generateAssessmentRemedies,
  getRiskAssessment,
  listRiskAssessments,
  resumePendingAssessments,
  runRiskAssessment,
  scheduleRiskAssessment
};
