const { randomUUID } = require("crypto");
const fs = require("fs");

const { createJob, getJob, listJobs, updateJob } = require("../services/scanJobStore");
const { addLog, getLogs, subscribe } = require("../services/logStreamService");
const { listAgentScans, getAgentScan, adaptAgentScanToModule } = require("../services/agentService");
const { cloneRepository, sanitizeGitError } = require("../services/githubService");
const { getStoredGithubAccount, resolveSessionToken } = require("../services/githubAccountService");
const { extractZip } = require("../services/zipService");
const { runSecretScan } = require("../services/secretScannerService");
const { sendScanReport } = require("../services/mailService");
const { enqueueSecretScan } = require("../services/secretScanQueue");
const env = require("../config/env");
const { formatScanResult } = require("../services/scanArtifactService");
const { recordAudit, recordAuditEvent } = require("../services/auditService");
const { persistSecretFindings } = require("../services/secretFindingStore");
const { approveRotation, requestRotation } = require("../services/secretRotationService");

async function startGithubSecretScan(req, res, next) {
  try {
    const { repoCloneUrl, repoFullName, githubSession, email, failOn, includeLow, importedRepositoryId } = req.body;
    const job = await createJob(_newJob("github", repoFullName || repoCloneUrl, req.user.id, importedRepositoryId));
    await recordAudit(req, "secret-scan.created", "secret-scan", job.id, { sourceType: "github", sourceLabel: repoFullName || repoCloneUrl });
    res.status(202).json(job);
    _dispatchSecretJob(job.id, { sourceType: "github", sourceLabel: repoFullName, repoUrl: repoCloneUrl, githubSession, userId: req.user.id, email, failOn, includeLow }).catch((error) => _markQueueFailure(job.id, error));
  } catch (error) {
    next(error);
  }
}

async function startZipSecretScan(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Repository zip file is required" });
    }

    const { email, failOn, includeLow } = req.body;
    const job = await createJob(_newJob("zip", req.file.originalname, req.user.id, null));
    await recordAudit(req, "secret-scan.created", "secret-scan", job.id, { sourceType: "zip", sourceLabel: req.file.originalname });
    res.status(202).json(job);
    _dispatchSecretJob(job.id, {
      sourceType: "zip",
      zipPath: req.file.path,
      userId: req.user.id,
      email,
      failOn,
      includeLow
    }).catch(next);
  } catch (error) {
    next(error);
  }
}

async function _dispatchSecretJob(jobId, input) {
  return enqueueSecretScan(jobId, input);
}

async function runQueuedSecretScan(jobId, input) {
  const result = await _runJob(jobId, input);
  if (!result) throw new Error("Secret scan execution failed; retrying worker job");
  return result;
}

async function getSecretScanJob(req, res) {
  let job = await getJob(req.params.jobId);
  
  if (!job) {
    const agentJob = await getAgentScan(req.user.id, req.params.jobId);
    if (agentJob) {
      job = adaptAgentScanToModule(agentJob, "secret");
    }
  }

  if (!job || job.scannerType !== "secret") {
    return res.status(404).json({ message: "Secret scan job not found" });
  }
  if (job.userId && job.userId !== req.user.id) {
    return res.status(404).json({ message: "Secret scan job not found" });
  }
  return res.json({ ...job, logs: getLogs(job.id) });
}

async function getSecretScanJobs(req, res) {
  const cloudJobs = await listJobs({ userId: req.user.id, scannerType: "secret" });
  const agentJobs = await listAgentScans(req.user.id);
  
  const adaptedAgentJobs = agentJobs
    .map(job => adaptAgentScanToModule(job, "secret"))
    .filter(Boolean);

  const allJobs = [...cloudJobs, ...adaptedAgentJobs].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(allJobs);
}

async function streamSecretScanLogs(req, res) {
  const { jobId } = req.params;
  const job = await getJob(jobId);
  if (!job || job.scannerType !== "secret" || (job.userId && job.userId !== req.user.id)) {
    return res.status(404).json({ message: "Secret scan job not found" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  for (const entry of getLogs(jobId)) {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  }

  const unsubscribe = subscribe(jobId, (entry) => {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  });

  req.on("close", unsubscribe);
}

async function _runJob(jobId, input) {
  const jobStartedAt = Date.now();
  await updateJob(jobId, { status: "running" });
  addLog(jobId, "info", "Step 1/8 - Secret scan job created");
  addLog(jobId, "info", `Using ${input.sourceType === "github" ? "GitHub repository import" : "ZIP upload"} as the source`);
  addLog(jobId, "info", `Policy selected: include low severity ${_bool(input.includeLow, true) ? "yes" : "no"}, fail on ${input.failOn || "high"}`);

  try {
    let projectPath;
    if (input.sourceType === "github") {
      const cloneStartedAt = Date.now();
      addLog(jobId, "info", "Step 2/8 - Importing repository from GitHub");
      addLog(jobId, "info", `Connecting to ${input.sourceLabel || "selected repository"} and downloading the latest source snapshot`);
      const githubToken = input.userId
        ? await _githubTokenForUser(input.githubSession, input.userId)
        : env.webhook.providerTokens[input.provider || "github"];
      const historyDepth = _bool(input.completeGitHistory, false)
        ? 0
        : _bool(input.includeGitHistory, true)
          ? Math.min(500, Math.max(1, Number(input.maxHistoryCommits || 100) + 1))
          : 1;
      projectPath = await cloneRepository(input.repoUrl, jobId, githubToken, input.provider || "github", input.commitSha || null, historyDepth);
      addLog(jobId, "success", `Repository imported successfully in ${_seconds(Date.now() - cloneStartedAt)}`);
    } else {
      const extractStartedAt = Date.now();
      addLog(jobId, "info", "Step 2/8 - Extracting uploaded repository archive");
      addLog(jobId, "info", "Unpacking the uploaded ZIP into an isolated scan workspace");
      projectPath = extractZip(input.zipPath, jobId);
      addLog(jobId, "success", `Archive extracted successfully in ${_seconds(Date.now() - extractStartedAt)}`);
    }

    addLog(jobId, "info", "Step 3/8 - Preparing banking-grade secret discovery");
    addLog(jobId, "info", "Handing the imported source to the FastAPI secret scanner");
    const result = await runSecretScan(projectPath, {
      failOn: input.failOn || "high",
      includeLow: _bool(input.includeLow, true),
      includeGitHistory: _bool(input.includeGitHistory, true),
      maxHistoryCommits: Number(input.maxHistoryCommits || 100),
      completeGitHistory: _bool(input.completeGitHistory, false),
      changedFiles: Array.isArray(input.changedFiles) ? input.changedFiles : null,
      maxFiles: Number(input.maxFiles || 8000),
      maxTotalBytes: Number(input.maxTotalBytes || 1000000000),
      maxFileBytes: Number(input.maxFileBytes || 5000000)
    });

    const summary = result.summary || {};
    const severityCounts = summary.findings_by_severity || {};
    addLog(jobId, "info", "Step 4/8 - Discovering source, config, key, certificate, and registry files");
    addLog(jobId, "success", `Scanned ${summary.files_scanned || 0} supported files from ${summary.total_files_seen || 0} repository files`);
    addLog(jobId, "info", `File families parsed: ${_fileTypes(result.files)}`);

    addLog(jobId, "info", "Step 5/8 - Running provider rules, entropy checks, and AST/source-structure analysis");
    addLog(jobId, "success", `Secret rule evaluation completed in ${_seconds(result.orchestration?.durationMs || 0)}`);
    addLog(jobId, "info", `Unique secret fingerprints: ${summary.unique_secrets || 0}`);
    addLog(jobId, "info", `High-confidence findings: ${result.risk?.high_confidence_findings || 0}`);
    addLog(jobId, result.sensitive_data_findings?.length ? "warning" : "success", `Sensitive banking data findings: ${result.sensitive_data_findings?.length || 0}`);
    addLog(jobId, result.historical_exposures?.length ? "warning" : "success", `Historical Git exposures: ${result.historical_exposures?.length || 0}`);
    addLog(jobId, result.compromised_matches?.length ? "warning" : "success", `Offline compromised-secret matches: ${result.compromised_matches?.length || 0}`);
    addLog(jobId, result.usage_paths?.length ? "warning" : "success", `Sensitive usage paths: ${result.usage_paths?.length || 0}`);

    if ((result.findings || []).length) {
      addLog(jobId, "warning", `Detected ${result.findings.length} secret exposure findings`);
      for (const finding of result.findings.slice(0, 5)) {
        addLog(jobId, "warning", `${finding.rule_id}: ${finding.title} in ${finding.file_path}${finding.line_number ? `:${finding.line_number}` : ""}`);
      }
    } else {
      addLog(jobId, "success", "No hardcoded secret findings were detected");
    }

    addLog(jobId, "info", "Step 6/8 - Classifying secret blast radius and rotation priority");
    addLog(jobId, "info", `Secret types: ${_topMap(summary.findings_by_secret_type)}`);
    addLog(jobId, "info", `Categories: ${_topMap(summary.findings_by_category)}`);
    addLog(jobId, result.exposure_paths?.length ? "warning" : "success", `Secret exposure paths built: ${result.exposure_paths?.length || 0}`);
    addLog(jobId, result.rotation_playbooks?.length ? "warning" : "success", `Rotation playbooks generated: ${result.rotation_playbooks?.length || 0}`);
    addLog(jobId, "info", `Secret graph built: ${result.secret_graph?.nodes?.length || 0} nodes, ${result.secret_graph?.edges?.length || 0} edges`);
    if (result.exposure_paths?.length) {
      for (const path of result.exposure_paths.slice(0, 3)) {
        addLog(jobId, "warning", `Exposure path: ${path.provider_family} ${path.secret_type} can affect ${path.exposed_asset}; priority ${path.containment_priority}`);
      }
    }
    if (result.usage_paths?.length) {
      for (const usage of result.usage_paths.slice(0, 3)) {
        addLog(jobId, "warning", `Usage path: ${usage.variable_hint} reaches ${usage.sink_type} in ${usage.usage_file}:${usage.line_number || "-"}`);
      }
    }
    if (result.risk?.reasons?.length) {
      for (const reason of result.risk.reasons.slice(0, 4)) {
        addLog(jobId, "warning", `Risk reason: ${reason}`);
      }
    }

    addLog(jobId, "info", "Step 7/8 - Calculating secret exposure risk and CI decision");
    addLog(jobId, "info", `Severity summary: critical ${severityCounts.critical || 0}, high ${severityCounts.high || 0}, medium ${severityCounts.medium || 0}, low ${severityCounts.low || 0}, info ${severityCounts.info || 0}`);
    if (result.policy_decision) {
      addLog(jobId, result.policy_decision.status === "failed" ? "warning" : "success", `Secret policy gate: ${result.policy_decision.status}; gate ${result.policy_decision.gate}`);
      for (const action of (result.policy_decision.required_actions || []).slice(0, 4)) {
        addLog(jobId, "warning", `Required action: ${action}`);
      }
    }
    addLog(jobId, result.risk?.rotation_required ? "warning" : "success", `Rotation required: ${result.risk?.rotation_required ? "yes" : "no"}`);
    addLog(jobId, result.summary?.ci_status === "failed" ? "warning" : "success", `CI gate result: ${result.summary?.ci_status || "unknown"} with secret risk score ${result.summary?.risk_score ?? 0}; action ${result.risk?.action || "track"}`);
    addLog(jobId, "success", `Step 8/8 - Secret scan completed in ${_seconds(Date.now() - jobStartedAt)}`);

    const updated = await updateJob(jobId, {
      status: "completed",
      result,
      completedAt: new Date().toISOString()
    });

    const persisted = await persistSecretFindings(jobId, result);
    await recordAuditEvent({ actorId: input.userId || null }, "secret-scan.completed", "secret-scan", jobId, {
      totalFindings: summary.total_findings || 0,
      persistedFindings: persisted.persisted,
      riskScore: summary.risk_score || 0,
      ciStatus: summary.ci_status || "unknown"
    });

    if (input.email) {
      addLog(jobId, "info", "Sending secret scan report email");
      const mailResult = await sendScanReport(input.email, "Secret scan report", result);
      addLog(jobId, mailResult.skipped ? "warning" : "success", mailResult.skipped ? mailResult.reason : "Report email sent");
    }

    return updated;
  } catch (error) {
    const safeMessage = sanitizeGitError(error.message);
    addLog(jobId, "error", safeMessage);
    await updateJob(jobId, {
      status: "failed",
      error: safeMessage,
      completedAt: new Date().toISOString()
    });
    await recordAuditEvent({ actorId: input.userId || null }, "secret-scan.failed", "secret-scan", jobId, { error: safeMessage.slice(0, 500) });
    return null;
  } finally {
    if (input.zipPath) {
      fs.rm(input.zipPath, { force: true }, () => {});
    }
  }
}

async function getSecretScanArtifact(req, res, next) {
  try {
    const job = await getJob(req.params.jobId);
    if (!job || job.scannerType !== "secret" || (job.userId && job.userId !== req.user.id)) {
      return res.status(404).json({ message: "Secret scan job not found" });
    }
    if (!job.result) return res.status(409).json({ message: "Secret scan has not completed" });
    await recordAudit(req, "secret-scan.artifact_accessed", "secret-scan", job.id, { format: req.params.format });
    const artifact = formatScanResult(job.result, req.params.format);
    res.setHeader("Content-Type", artifact.contentType);
    res.setHeader("Content-Disposition", `attachment; filename=secret-scan-${job.id}.${artifact.extension}`);
    return res.send(artifact.body);
  } catch (error) {
    return next(error);
  }
}

async function requestSecretRotation(req, res, next) {
  try {
    const action = await requestRotation(req, req.params.jobId, req.params.findingId, req.body || {});
    if (!action) return res.status(404).json({ message: "Secret finding not found" });
    return res.status(action.status === "pending_approval" ? 202 : 200).json(action);
  } catch (error) { return next(error); }
}

async function approveSecretRotation(req, res, next) {
  try {
    const action = await approveRotation(req, req.params.actionId);
    if (!action) return res.status(404).json({ message: "Secret rotation action not found" });
    return res.json(action);
  } catch (error) { return next(error); }
}

async function _markQueueFailure(jobId, error) {
  const safeMessage = sanitizeGitError(error.message || "Secret scan could not be queued");
  await updateJob(jobId, { status: "failed", error: safeMessage, completedAt: new Date().toISOString() });
  addLog(jobId, "error", safeMessage);
}

function _newJob(sourceType, sourceLabel, userId, importedRepositoryId) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    userId,
    importedRepositoryId,
    scannerType: "secret",
    sourceType,
    sourceLabel,
    status: "queued",
    result: null,
    error: null,
    createdAt: now,
    updatedAt: now
  };
}

function _bool(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return String(value).toLowerCase() === "true";
}

function _seconds(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function _fileTypes(files = []) {
  if (!files.length) return "none";
  const counts = files.reduce((acc, file) => {
    acc[file.type] = (acc[file.type] || 0) + 1;
    return acc;
  }, {});
  return _topMap(counts);
}

function _topMap(map = {}) {
  const entries = Object.entries(map || {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (!entries.length) return "none";
  return entries.map(([key, count]) => `${key} (${count})`).join(", ");
}

async function _githubTokenForUser(githubSession, userId) {
  try {
    return resolveSessionToken(githubSession);
  } catch (_error) {
    const account = await getStoredGithubAccount(userId);
    if (account?.accessToken) return account.accessToken;
    throw _error;
  }
}

module.exports = {
  startGithubSecretScan,
  startZipSecretScan,
  getSecretScanJob,
  getSecretScanJobs,
  streamSecretScanLogs,
  getSecretScanArtifact,
  requestSecretRotation,
  approveSecretRotation,
  runQueuedSecretScan
};
