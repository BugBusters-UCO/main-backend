const { randomUUID } = require("crypto");
const fs = require("fs");

const { createJob, getJob, listJobs, updateJob } = require("../services/scanJobStore");
const { addLog, getLogs, subscribe } = require("../services/logStreamService");
const { listAgentScans, getAgentScan, adaptAgentScanToModule } = require("../services/agentService");
const { cloneRepository, sanitizeGitError } = require("../services/githubService");
const { getStoredGithubAccount, resolveSessionToken } = require("../services/githubAccountService");
const { extractZip } = require("../services/zipService");
const { runDependencyScan } = require("../services/dependencyScannerService");
const { sendScanReport } = require("../services/mailService");
const { enqueueDependencyScan, isRedisEnabled } = require("../services/redisScanQueue");
const { formatScanResult } = require("../services/scanArtifactService");
const { recordAudit } = require("../services/auditService");
const { createQuarantine } = require("../services/quarantineService");

async function startGithubScan(req, res, next) {
  try {
    const { repoCloneUrl, repoFullName, githubSession, email, includeDev, useOsv, failOn, importedRepositoryId } = req.body;
    const job = await createJob(_newJob("github", repoFullName || repoCloneUrl, req.user.id, importedRepositoryId));
    await recordAudit(req, "scan.created", "scan-job", job.id, { scannerType: "dependency", sourceType: "github", sourceLabel: repoFullName || repoCloneUrl });
    res.status(202).json(job);
    _dispatchDependencyJob(job.id, {
      sourceType: "github",
      sourceLabel: repoFullName,
      repoUrl: repoCloneUrl,
      githubSession,
      userId: req.user.id,
      email,
      includeDev,
      useOsv,
      failOn
    }).catch(next);
  } catch (error) {
    next(error);
  }
}

async function startZipScan(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Repository zip file is required" });
    }

    const { email, includeDev, useOsv, failOn } = req.body;
    const job = await createJob(_newJob("zip", req.file.originalname, req.user.id, null));
    await recordAudit(req, "scan.created", "scan-job", job.id, { scannerType: "dependency", sourceType: "zip", sourceLabel: req.file.originalname });
    res.status(202).json(job);
    _dispatchDependencyJob(job.id, {
      sourceType: "zip",
      zipPath: req.file.path,
      email,
      includeDev,
      useOsv,
      failOn
    }).catch(next);
  } catch (error) {
    next(error);
  }
}

async function _dispatchDependencyJob(jobId, input) {
  if (isRedisEnabled()) {
    await enqueueDependencyScan(jobId, input);
    return;
  }
  return _runJob(jobId, input);
}

async function runQueuedDependencyScan(jobId, input) {
  const result = await _runJob(jobId, input);
  if (!result) throw new Error("Dependency scan execution failed; retrying worker job");
  return result;
}

async function getScanJob(req, res) {
  let job = await getJob(req.params.jobId);
  
  if (!job) {
    const agentJob = await getAgentScan(req.user.id, req.params.jobId);
    if (agentJob) {
      job = adaptAgentScanToModule(agentJob, "dependency");
    }
  }

  if (!job || (job.scannerType && job.scannerType !== "dependency")) {
    return res.status(404).json({ message: "Scan job not found" });
  }
  if (job.userId && job.userId !== req.user.id) {
    return res.status(404).json({ message: "Scan job not found" });
  }
  return res.json({ ...job, logs: getLogs(job.id) });
}

async function getScanJobs(req, res) {
  const cloudJobs = await listJobs({ userId: req.user.id, scannerType: "dependency" });
  const agentJobs = await listAgentScans(req.user.id);
  
  const adaptedAgentJobs = agentJobs
    .map(job => adaptAgentScanToModule(job, "dependency"))
    .filter(Boolean);

  const allJobs = [...cloudJobs, ...adaptedAgentJobs].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(allJobs);
}

async function streamScanLogs(req, res) {
  const { jobId } = req.params;
  const job = await getJob(jobId);
  if (!job || (job.userId && job.userId !== req.user.id)) {
    return res.status(404).json({ message: "Scan job not found" });
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

async function getScanArtifact(req, res, next) {
  try {
    const job = await getJob(req.params.jobId);
    if (!job || job.scannerType !== "dependency" || (job.userId && job.userId !== req.user.id)) {
      return res.status(404).json({ message: "Scan job not found" });
    }
    if (job.status !== "completed" || !job.result) return res.status(409).json({ message: "Scan result is not ready" });
    const artifact = formatScanResult(job.result, req.params.format);
    res.type(artifact.contentType);
    res.setHeader("Content-Disposition", `attachment; filename=bugbusters-${job.id}.${artifact.extension}`);
    return res.send(artifact.body);
  } catch (error) {
    return next(error);
  }
}

async function getScanGate(req, res) {
  const job = await getJob(req.params.jobId);
  if (!job || job.scannerType !== "dependency" || (job.userId && job.userId !== req.user.id)) return res.status(404).json({ message: "Scan job not found" });
  if (job.status !== "completed" || !job.result) return res.status(409).json({ decision: "pending", status: job.status });
  const summary = job.result.summary || {};
  const allowed = summary.ci_status === "passed" && summary.banking_action !== "block";
  return res.status(allowed ? 200 : 409).json({ decision: allowed ? "allow" : "block", allowed, jobId: job.id, commitSha: job.commitSha || null, artifactDigest: job.result.artifact?.artifact_sha256 || null, riskScore: summary.risk_score ?? null, bankingAction: summary.banking_action || null, findingsBySeverity: summary.findings_by_severity || {} });
}

async function _runJob(jobId, input) {
  const jobStartedAt = Date.now();
  await updateJob(jobId, { status: "running" });
  addLog(jobId, "info", "Step 1/7 - Scan job created");
  addLog(jobId, "info", `Using ${input.sourceType === "github" ? "GitHub repository import" : "ZIP upload"} as the source`);
  addLog(jobId, "info", `Scan policy selected: ${_bool(input.includeDev, true) ? "include development dependencies" : "runtime dependencies only"}, ${_bool(input.useOsv, true) ? "OSV vulnerability lookup enabled" : "OSV vulnerability lookup disabled"}, fail on ${input.failOn || "high"}`);

  try {
    let projectPath;
    if (input.sourceType === "github") {
      const cloneStartedAt = Date.now();
      addLog(jobId, "info", "Step 2/7 - Importing repository from GitHub");
      addLog(jobId, "info", `Connecting to ${input.sourceLabel || "selected repository"} and downloading the latest source snapshot`);
      const provider = input.provider || "github";
      const providerToken = await _tokenForProvider(provider, input.githubSession, input.userId);
      projectPath = await cloneRepository(input.repoUrl, jobId, providerToken, provider, input.commitSha);
      addLog(jobId, "success", `Repository imported successfully in ${_seconds(Date.now() - cloneStartedAt)}`);
    } else {
      const extractStartedAt = Date.now();
      addLog(jobId, "info", "Step 2/7 - Extracting uploaded repository archive");
      addLog(jobId, "info", "Unpacking the uploaded ZIP into an isolated scan workspace");
      projectPath = extractZip(input.zipPath, jobId);
      addLog(jobId, "success", `Archive extracted successfully in ${_seconds(Date.now() - extractStartedAt)}`);
    }

    addLog(jobId, "info", "Step 3/9 - Preparing static dependency analysis");
    addLog(jobId, "info", "Handing the imported source to the FastAPI dependency scanner");
    const result = await runDependencyScan(projectPath, {
      includeDev: _bool(input.includeDev, true),
      useOsv: _bool(input.useOsv, true),
      failOn: input.failOn || "high"
    });
    await _quarantineCriticalFindings(reqUserForJob(input), result, jobId, addLog);
    const severityCounts = result.summary?.findings_by_severity || {};
    addLog(jobId, "info", "Step 4/9 - Discovering dependency manifests");
    addLog(jobId, "success", `Found ${result.summary?.total_manifests || 0} manifest files and ${result.summary?.total_dependencies || 0} dependencies`);
    addLog(jobId, "info", `Manifest types parsed: ${_manifestTypes(result.manifests)}`);
    addLog(jobId, "info", "Step 5/9 - Checking vulnerabilities and dependency hygiene");
    addLog(jobId, "success", `OSV and static checks completed in ${_seconds(result.orchestration?.durationMs || 0)}`);
    if ((result.findings || []).length) {
      addLog(jobId, "warning", `Detected ${result.findings.length} known vulnerability findings`);
    } else {
      addLog(jobId, "success", "No known CVE findings were returned by OSV");
    }
    if ((result.dependency_risks || []).length) {
      addLog(jobId, "warning", `Detected ${result.dependency_risks.length} dependency hygiene risks such as unpinned versions or missing lockfiles`);
    } else {
      addLog(jobId, "success", "No dependency hygiene risks were detected");
    }
    addLog(jobId, "info", "Step 6/9 - Fingerprinting malicious capabilities without CVEs");
    if ((result.capability_findings || []).length) {
      addLog(jobId, "warning", `Detected ${result.capability_findings.length} suspicious capability fingerprints such as shell, network, credential, or binary behavior`);
    } else {
      addLog(jobId, "success", "No suspicious no-CVE capability fingerprints were detected");
    }
    addLog(jobId, "info", "Step 7/9 - Checking namespace confusion and registry drift");
    if ((result.namespace_risks || []).length) {
      addLog(jobId, "warning", `Detected ${result.namespace_risks.length} namespace or registry trust risks`);
    } else {
      addLog(jobId, "success", "No namespace confusion or registry drift risks were detected");
    }
    if ((result.risk_chains || []).length) {
      addLog(jobId, "warning", `Mapped ${result.risk_chains.length} dependency blast-radius chains into sensitive banking code`);
      for (const chain of result.risk_chains.slice(0, 3)) {
        addLog(jobId, "warning", `Priority chain: ${chain.dependency_name} reaches ${chain.sensitive_contexts.slice(0, 3).join(", ")} code`);
      }
    } else {
      addLog(jobId, "success", "No dependency blast-radius chains reached sensitive banking code");
    }

    addLog(jobId, "info", "Step 8/9 - Calculating banking exposure decision");
    addLog(jobId, "info", `Severity summary: critical ${severityCounts.critical || 0}, high ${severityCounts.high || 0}, medium ${severityCounts.medium || 0}, low ${severityCounts.low || 0}, unknown ${severityCounts.unknown || 0}`);
    addLog(jobId, result.summary?.banking_action === "block" ? "warning" : "info", `Banking exposure decision: ${result.summary?.banking_action || "track"} with score ${result.summary?.banking_exposure_score ?? 0}`);
    addLog(jobId, result.summary?.ci_status === "failed" ? "warning" : "success", `CI gate result: ${result.summary?.ci_status || "unknown"} with risk score ${result.summary?.risk_score ?? 0}`);
    addLog(jobId, "success", `Step 9/9 - Scan completed in ${_seconds(Date.now() - jobStartedAt)}`);
    const updated = await updateJob(jobId, {
      status: "completed",
      result,
      completedAt: new Date().toISOString()
    });

    if (input.email) {
      addLog(jobId, "info", "Sending scan report email");
      const mailResult = await sendScanReport(input.email, "Dependency scan report", result);
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
    return null;
  } finally {
    if (input.zipPath) {
      fs.rm(input.zipPath, { force: true }, () => {});
    }
  }
}

function _newJob(sourceType, sourceLabel, userId, importedRepositoryId) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    userId,
    importedRepositoryId,
    scannerType: "dependency",
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

function _manifestTypes(manifests = []) {
  if (!manifests.length) return "none";
  const counts = manifests.reduce((acc, manifest) => {
    acc[manifest.type] = (acc[manifest.type] || 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts)
    .map(([type, count]) => `${type} (${count})`)
    .join(", ");
}

module.exports = {
  startGithubScan,
  startZipScan,
  getScanJob,
  getScanJobs,
  streamScanLogs,
  getScanArtifact,
  getScanGate,
  runQueuedDependencyScan
};

async function _githubTokenForUser(githubSession, userId) {
  try {
    return resolveSessionToken(githubSession);
  } catch (_error) {
    const account = await getStoredGithubAccount(userId);
    if (account?.accessToken) return account.accessToken;
    throw _error;
  }
}

async function _quarantineCriticalFindings(actor, result, jobId, log) {
  const digest = result?.artifact?.artifact_sha256;
  if (!digest) return;
  const findings = [
    ...(result.static_malware_findings || []).filter((finding) => ["critical", "high"].includes(finding.severity)),
    ...(result.behavior_findings || []).filter((finding) => ["critical", "high"].includes(finding.severity))
  ];
  for (const finding of findings.slice(0, 50)) {
    try {
      await createQuarantine({
        findingId: finding.id,
        artifactDigest: digest,
        packageName: finding.package_name || null,
        packageVersion: finding.version || null,
        severity: finding.severity,
        status: "blocked",
        reason: finding.title || "High-confidence malware or malicious behavior finding",
        evidence: finding.evidence || null,
        departmentId: actor.departmentId || null
      }, actor.id);
      log(jobId, "warning", `Artifact quarantined automatically for ${finding.id}`);
    } catch (error) {
      log(jobId, "error", `Automatic quarantine failed for ${finding.id}: ${error.message}`);
    }
  }
}

function reqUserForJob(input) {
  return { id: input.userId || null, departmentId: input.departmentId || null };
}

async function _tokenForProvider(provider, session, userId) {
  if (provider === "github") {
    return _githubTokenForUser(session, userId);
  }
  const token = require("../config/env").webhook.providerTokens[provider];
  if (!token) throw new Error(`No ${provider} clone credential is configured`);
  return token;
}
