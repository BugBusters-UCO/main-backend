const { randomUUID } = require("crypto");
const fs = require("fs");
const path = require("path");

const { createJob, getJob, listJobs, updateJob, countActiveJobs } = require("../services/scanJobStore");
const { addLog, getLogs, subscribe } = require("../services/logStreamService");
const { listAgentScans, getAgentScan, adaptAgentScanToModule } = require("../services/agentService");
const { cloneRepository, sanitizeGitError } = require("../services/githubService");
const { getStoredGithubAccount, resolveSessionToken } = require("../services/githubAccountService");
const { extractZip } = require("../services/zipService");
const { runConfigScan } = require("../services/configScannerService");
const { sendScanReport } = require("../services/mailService");
const { enqueueConfigScan } = require("../services/configScanQueue");
const cancellationRequests = new Set();

async function _assertCapacity(userId) {
  const perUser = await countActiveJobs({ userId });
  const global = await countActiveJobs();
  const maxPerUser = Math.max(1, Number(process.env.CONFIG_SCAN_MAX_ACTIVE_PER_USER || 5));
  const maxGlobal = Math.max(maxPerUser, Number(process.env.CONFIG_SCAN_MAX_ACTIVE_GLOBAL || 100));
  if (perUser >= maxPerUser || global >= maxGlobal) {
    const error = new Error("Configuration scan capacity is temporarily full; retry later");
    error.statusCode = 429;
    throw error;
  }
}

async function startGithubConfigScan(req, res, next) {
  try {
    const { repoCloneUrl, repoFullName, githubSession, email, failOn, includeLow, runtimeSnapshotPath, policyPath, importedRepositoryId } = req.body;
    await _assertCapacity(req.user.id);
    const githubToken = await _githubTokenForUser(githubSession, req.user.id);
    const job = await createJob(_newJob("github", repoFullName || repoCloneUrl, req.user.id, importedRepositoryId));
    res.status(202).json(job);
    enqueueConfigScan(job.id, { sourceType: "github", sourceLabel: repoFullName, repoUrl: repoCloneUrl, githubToken, userId: req.user.id, email, failOn, includeLow, runtimeSnapshotPath, policyPath }).catch((error) => _markQueueFailure(job.id, error));
  } catch (error) {
    next(error);
  }
}

async function startZipConfigScan(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Repository zip file is required" });
    }
    try {
      await _assertCapacity(req.user.id);
    } catch (error) {
      fs.rm(req.file.path, { force: true }, () => {});
      throw error;
    }

    const { email, failOn, includeLow, runtimeSnapshotPath, policyPath } = req.body;
    const job = await createJob(_newJob("zip", req.file.originalname, req.user.id, null));
    res.status(202).json(job);
    enqueueConfigScan(job.id, {
      sourceType: "zip",
      zipPath: req.file.path,
      userId: req.user.id,
      email,
      failOn,
      includeLow,
      runtimeSnapshotPath,
      policyPath
    }).catch((error) => _markQueueFailure(job.id, error));
  } catch (error) {
    next(error);
  }
}

async function getConfigScanJob(req, res) {
  let job = await getJob(req.params.jobId);
  
  if (!job) {
    const agentJob = await getAgentScan(req.user.id, req.params.jobId);
    if (agentJob) {
      job = adaptAgentScanToModule(agentJob, "config");
    }
  }

  if (!job || job.scannerType !== "config") {
    return res.status(404).json({ message: "Configuration scan job not found" });
  }
  if (job.userId && job.userId !== req.user.id) {
    return res.status(404).json({ message: "Configuration scan job not found" });
  }
  return res.json({ ...job, logs: getLogs(job.id) });
}

async function cancelConfigScan(req, res) {
  const job = await getJob(req.params.jobId);
  if (!job || job.scannerType !== "config" || (job.userId && job.userId !== req.user.id)) {
    return res.status(404).json({ message: "Configuration scan job not found" });
  }
  if (["completed", "failed", "cancelled"].includes(job.status)) {
    return res.status(409).json({ message: `Configuration scan is already ${job.status}` });
  }
  cancellationRequests.add(job.id);
  const now = new Date().toISOString();
  const updated = await updateJob(job.id, {
    cancelRequested: true,
    status: job.status === "queued" ? "cancelled" : job.status,
    completedAt: job.status === "queued" ? now : null,
    cancelledAt: job.status === "queued" ? now : null
  });
  addLog(job.id, "warning", "Cancellation requested by the owner");
  return res.json(updated);
}

async function getConfigScanJobs(req, res) {
  const cloudJobs = await listJobs({ userId: req.user.id, scannerType: "config" });
  const agentJobs = await listAgentScans(req.user.id);
  
  const adaptedAgentJobs = agentJobs
    .map(job => adaptAgentScanToModule(job, "config"))
    .filter(Boolean);

  const allJobs = [...cloudJobs, ...adaptedAgentJobs].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(allJobs);
}

async function streamConfigScanLogs(req, res) {
  const { jobId } = req.params;
  const job = await getJob(jobId);
  if (!job || job.scannerType !== "config" || (job.userId && job.userId !== req.user.id)) {
    return res.status(404).json({ message: "Configuration scan job not found" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
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
  let projectPath = null;
  if (await _isCancellationRequested(jobId)) {
    cancellationRequests.delete(jobId);
    return updateJob(jobId, { status: "cancelled", completedAt: new Date().toISOString(), cancelledAt: new Date().toISOString() });
  }
  await updateJob(jobId, { status: "running" });
  addLog(jobId, "info", "Step 1/8 - Configuration scan job created");
  addLog(jobId, "info", `Using ${input.sourceType === "github" ? "GitHub repository import" : "ZIP upload"} as the source`);
  addLog(jobId, "info", `Policy selected: include low severity ${_bool(input.includeLow, true) ? "yes" : "no"}, fail on ${input.failOn || "high"}`);

  try {
    if (input.sourceType === "github" && !input.githubToken) {
      input.githubToken = await _githubTokenForUser(undefined, input.userId);
    }
    if (input.sourceType === "github") {
      const cloneStartedAt = Date.now();
      addLog(jobId, "info", "Step 2/8 - Importing repository from GitHub");
      addLog(jobId, "info", `Connecting to ${input.sourceLabel || "selected repository"} and downloading the latest source snapshot`);
      projectPath = await cloneRepository(input.repoUrl, jobId, input.githubToken);
      if (await _isCancellationRequested(jobId)) return _cancelRunningJob(jobId);
      addLog(jobId, "success", `Repository imported successfully in ${_seconds(Date.now() - cloneStartedAt)}`);
    } else {
      const extractStartedAt = Date.now();
      addLog(jobId, "info", "Step 2/8 - Extracting uploaded repository archive");
      addLog(jobId, "info", "Unpacking the uploaded ZIP into an isolated scan workspace");
      projectPath = extractZip(input.zipPath, jobId);
      if (await _isCancellationRequested(jobId)) return _cancelRunningJob(jobId);
      addLog(jobId, "success", `Archive extracted successfully in ${_seconds(Date.now() - extractStartedAt)}`);
    }

    addLog(jobId, "info", "Step 3/8 - Preparing configuration security analysis");
    addLog(jobId, "info", "Handing the imported source to the FastAPI configuration scanner");
    const result = await runConfigScan(projectPath, {
      failOn: input.failOn || "high",
      includeLow: _bool(input.includeLow, true),
      runtimeSnapshotPath: input.runtimeSnapshotPath,
      policyPath: input.policyPath
    });
    if (await _isCancellationRequested(jobId)) return _cancelRunningJob(jobId);

    const severityCounts = result.summary?.findings_by_severity || {};
    const categoryCounts = result.summary?.findings_by_category || {};
    addLog(jobId, "info", "Step 4/8 - Discovering supported configuration files");
    addLog(jobId, "success", `Scanned ${result.summary?.supported_files_scanned || 0} supported config files from ${result.summary?.total_files_seen || 0} repository files`);
    addLog(jobId, "info", `Configuration types parsed: ${_fileTypes(result.files)}`);

    addLog(jobId, "info", "Step 5/8 - Evaluating banking security misconfiguration rules");
    addLog(jobId, "success", `Rule evaluation completed in ${_seconds(result.orchestration?.durationMs || 0)}`);
    if ((result.findings || []).length) {
      addLog(jobId, "warning", `Detected ${result.findings.length} configuration security findings`);
      for (const finding of result.findings.slice(0, 4)) {
        addLog(jobId, "warning", `${finding.rule_id}: ${finding.title} in ${finding.file_path}${finding.line_number ? `:${finding.line_number}` : ""}`);
      }
    } else {
      addLog(jobId, "success", "No insecure configuration findings were detected");
    }

    addLog(jobId, "info", "Step 6/8 - Grouping findings by risk category");
    addLog(jobId, "info", `Top categories: ${_topCategories(categoryCounts)}`);
    addLog(jobId, "info", `Semantic facts extracted: ${result.normalized_config_facts?.length || 0}`);
    addLog(jobId, "info", `Config graph built: ${result.config_graph?.nodes?.length || 0} nodes, ${result.config_graph?.edges?.length || 0} edges`);
    addLog(jobId, result.environment_drifts?.length ? "warning" : "success", `Environment drift issues: ${result.environment_drifts?.length || 0}`);
    addLog(jobId, result.attack_paths?.length ? "warning" : "success", `Dynamic attack paths correlated: ${result.attack_paths?.length || 0}`);

    addLog(jobId, "info", "Step 7/8 - Calculating configuration risk score and CI decision");
    addLog(jobId, "info", `Severity summary: critical ${severityCounts.critical || 0}, high ${severityCounts.high || 0}, medium ${severityCounts.medium || 0}, low ${severityCounts.low || 0}, info ${severityCounts.info || 0}`);
    if (result.policy_decision) {
      addLog(jobId, result.policy_decision.status === "failed" ? "warning" : "success", `Policy engine result: ${result.policy_decision.status}; waiver required: ${result.policy_decision.waiver_required ? "yes" : "no"}`);
      for (const reason of (result.policy_decision.reasons || []).slice(0, 3)) {
        addLog(jobId, "warning", `Policy reason: ${reason}`);
      }
    }
    addLog(jobId, "info", `Remediation actions generated: ${result.remediation_plan?.length || 0}`);
    addLog(jobId, "info", `Compliance mappings generated: ${result.compliance_mapping?.length || 0}`);
    addLog(jobId, "info", `Evidence bundle confidence: ${Math.round((result.evidence_bundle?.confidence_average || 0) * 100)}%`);
    addLog(jobId, result.summary?.ci_status === "failed" ? "warning" : "success", `CI gate result: ${result.summary?.ci_status || "unknown"} with config risk score ${result.summary?.risk_score ?? 0}`);
    addLog(jobId, "success", `Step 8/8 - Configuration scan completed in ${_seconds(Date.now() - jobStartedAt)}`);

    const updated = await updateJob(jobId, {
      status: "completed",
      result,
      completedAt: new Date().toISOString(),
      cancelRequested: false
    });

    if (input.email) {
      addLog(jobId, "info", "Sending configuration scan report email");
      const mailResult = await sendScanReport(input.email, "Configuration scan report", result);
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
    if (input.throwOnFailure) throw error;
    return null;
  } finally {
    if (input.zipPath) {
      fs.rm(input.zipPath, { force: true }, () => {});
    }
    if (projectPath) {
      await _cleanupWorkspace(projectPath);
    }
  }
}

async function _markQueueFailure(jobId, error) {
  const message = sanitizeGitError(error.message || "Configuration scan could not be queued");
  await updateJob(jobId, { status: "failed", error: message, completedAt: new Date().toISOString() });
  addLog(jobId, "error", message);
}

async function _cleanupWorkspace(projectPath) {
  const workspaceRoot = path.resolve(process.env.WORKSPACE_DIR || path.join(__dirname, "..", "workspace"));
  const resolvedProject = path.resolve(projectPath);
  const relative = path.relative(workspaceRoot, resolvedProject);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return;
  await fs.promises.rm(resolvedProject, { recursive: true, force: true });
}

function _newJob(sourceType, sourceLabel, userId, importedRepositoryId) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    userId,
    importedRepositoryId,
    scannerType: "config",
    sourceType,
    sourceLabel,
    status: "queued",
    cancelRequested: false,
    cancelledAt: null,
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
  return Object.entries(counts)
    .map(([type, count]) => `${type} (${count})`)
    .join(", ");
}

function _topCategories(categories = {}) {
  const entries = Object.entries(categories).sort((a, b) => b[1] - a[1]).slice(0, 4);
  if (!entries.length) return "none";
  return entries.map(([category, count]) => `${category} (${count})`).join(", ");
}

module.exports = {
  startGithubConfigScan,
  startZipConfigScan,
  getConfigScanJob,
  getConfigScanJobs,
  streamConfigScanLogs,
  cancelConfigScan,
  runConfigJob: _runJob
};

async function _isCancellationRequested(jobId) {
  if (cancellationRequests.has(jobId)) return true;
  const job = await getJob(jobId);
  return Boolean(job?.cancelRequested || job?.status === "cancelled");
}

async function _cancelRunningJob(jobId) {
  cancellationRequests.delete(jobId);
  addLog(jobId, "warning", "Configuration scan cancelled; cleaning up workspace");
  return updateJob(jobId, { status: "cancelled", completedAt: new Date().toISOString(), cancelledAt: new Date().toISOString() });
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
