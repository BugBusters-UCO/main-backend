const axios = require("axios");
const env = require("../config/env");
const { listJobs } = require("./scanJobStore");

const SCANNERS = ["dependency", "config", "secret", "cipher"];

async function checkRiskEngineHealth() {
  const response = await axios.get(`${env.riskEngineUrl}/health`, { timeout: 5000 });
  return response.data;
}

async function getRiskBusinessInputs() {
  const response = await axios.get(`${env.riskEngineUrl}/api/v1/risk/business-inputs`, { timeout: 5000 });
  return response.data;
}

async function analyzeRisk(payload) {
  const startedAt = Date.now();
  const response = await axios.post(`${env.riskEngineUrl}/api/v1/risk/analyze`, payload, { timeout: 30000 });
  return {
    ...response.data,
    orchestration: {
      riskEngineUrl: env.riskEngineUrl,
      durationMs: Date.now() - startedAt
    }
  };
}

async function generateRiskRemedies(payload) {
  const startedAt = Date.now();
  const response = await axios.post(`${env.riskEngineUrl}/api/v1/risk/remedies`, payload, { timeout: 45000 });
  const tokenUsage = response.data?.token_usage || {};
  console.log(
    `OpenAI remediation token usage: prompt=${tokenUsage.prompt_tokens || 0}, completion=${tokenUsage.completion_tokens || 0}, total=${tokenUsage.total_tokens || 0}`
  );
  return {
    ...response.data,
    orchestration: {
      riskEngineUrl: env.riskEngineUrl,
      durationMs: Date.now() - startedAt
    }
  };
}

async function buildRiskOverview(userId, options = {}) {
  const jobs = await listJobs({ userId, limit: 300 });
  const completed = jobs.filter((job) => job.status === "completed" && job.result && SCANNERS.includes(job.scannerType));
  const groups = _groupCompletedJobs(completed);
  const selectedGroup = _selectGroup(groups, options.sourceLabel, options.jobIds || options.job_ids);

  if (!selectedGroup) {
    return {
      status: "empty",
      message: "No completed scanner results are available yet.",
      groups,
      selectedSourceLabel: options.sourceLabel || null,
      risk: null
    };
  }

  const scannerJobs = _scannerJobEnvelopes(selectedGroup);

  const risk = await analyzeRisk({
    project_name: selectedGroup.sourceLabel,
    environment: options.environment || "unknown",
    scanner_jobs: scannerJobs,
    business_context: _toSnakeBusinessContext(options.businessContext || options.business_context || {}),
    weights: options.weights || { technical: 0.7, business: 0.3 },
    include_ai_recommendation: false
  });

  return {
    status: "ok",
    groups,
    selectedSourceLabel: selectedGroup.sourceLabel,
    selectedSourceType: selectedGroup.sourceType,
    scannerJobs: selectedGroup.latestByScanner,
    selectedJobIds: scannerJobs.map((job) => job.job_id),
    missingScanners: SCANNERS.filter((scanner) => !scannerJobs.some((job) => job.scanner === scanner)),
    risk
  };
}

function _groupCompletedJobs(jobs) {
  const map = new Map();
  for (const job of jobs) {
    const key = `${job.sourceType || "unknown"}:${job.sourceLabel}`;
    const existing = map.get(key) || {
      sourceLabel: job.sourceLabel,
      sourceType: job.sourceType,
      latestCreatedAt: job.createdAt,
      jobIds: [],
      scanners: [],
      latestByScanner: {}
    };

    const scanner = job.scannerType;
    const current = existing.latestByScanner[scanner];
    if (!current || new Date(job.createdAt).getTime() > new Date(current.createdAt).getTime()) {
      existing.latestByScanner[scanner] = job;
    }
    if (!existing.scanners.includes(scanner)) existing.scanners.push(scanner);
    if (!existing.jobIds.includes(job.id)) existing.jobIds.push(job.id);
    if (new Date(job.createdAt).getTime() > new Date(existing.latestCreatedAt).getTime()) {
      existing.latestCreatedAt = job.createdAt;
    }
    map.set(key, existing);
  }

  return Array.from(map.values())
    .map((group) => ({
      ...group,
      jobIds: _jobIds(group.latestByScanner),
      scanners: SCANNERS.filter((scanner) => group.scanners.includes(scanner))
    }))
    .sort((a, b) => new Date(b.latestCreatedAt).getTime() - new Date(a.latestCreatedAt).getTime());
}

function _selectGroup(groups, sourceLabel, jobIds) {
  if (!groups.length) return null;
  if (Array.isArray(jobIds) && jobIds.length) {
    const ids = new Set(jobIds.map(String));
    const group = groups.find((item) => item.jobIds.some((id) => ids.has(id)));
    if (group) {
      const selected = { ...group, latestByScanner: {} };
      for (const scanner of SCANNERS) {
        const job = group.latestByScanner[scanner];
        if (job && ids.has(job.id)) selected.latestByScanner[scanner] = job;
      }
      selected.scanners = SCANNERS.filter((scanner) => selected.latestByScanner[scanner]);
      selected.jobIds = _jobIds(selected.latestByScanner);
      return selected;
    }
  }
  if (sourceLabel) {
    return groups.find((group) => group.sourceLabel === sourceLabel) || groups[0];
  }
  return groups[0];
}

function _scannerJobEnvelopes(group) {
  return scannerJobEnvelopesFromScanJobs(
    SCANNERS.map((scanner) => group.latestByScanner[scanner]).filter(Boolean)
  );
}

function scannerJobEnvelopesFromScanJobs(jobs) {
  return (jobs || [])
    .filter((job) => job && job.result && SCANNERS.includes(job.scannerType))
    .map((job) => ({
      job_id: job.id,
      scanner: job.scannerType,
      source_label: job.sourceLabel,
      source_type: job.sourceType,
      created_at: job.createdAt,
      completed_at: job.completedAt,
      result: job.result
    }));
}

function _jobIds(latestByScanner) {
  return SCANNERS
    .map((scanner) => latestByScanner[scanner]?.id)
    .filter(Boolean);
}

function _toSnakeBusinessContext(input) {
  const value = input || {};
  return {
    asset_criticality: _bounded(value.asset_criticality ?? value.assetCriticality, 5),
    data_sensitivity: _bounded(value.data_sensitivity ?? value.dataSensitivity, 5),
    business_impact: _bounded(value.business_impact ?? value.businessImpact, 5),
    internet_exposure: _bounded(value.internet_exposure ?? value.internetExposure, 5),
    compliance_requirement: _bounded(value.compliance_requirement ?? value.complianceRequirement, 5),
    exploit_window: _bounded(value.exploit_window ?? value.exploitWindow, 5)
  };
}

function _bounded(raw, fallback) {
  const value = Number(raw ?? fallback);
  if (Number.isNaN(value)) return fallback;
  return Math.max(0, Math.min(10, Math.round(value)));
}

module.exports = {
  checkRiskEngineHealth,
  getRiskBusinessInputs,
  analyzeRisk,
  generateRiskRemedies,
  buildRiskOverview,
  scannerJobEnvelopesFromScanJobs,
  toSnakeBusinessContext: _toSnakeBusinessContext
};
