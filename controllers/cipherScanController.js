const { randomUUID } = require("crypto");
const fs = require("fs");

const { createJob, getJob, listJobs, updateJob } = require("../services/scanJobStore");
const { addLog, getLogs, subscribe } = require("../services/logStreamService");
const { listAgentScans, getAgentScan, adaptAgentScanToModule } = require("../services/agentService");
const { cloneRepository, sanitizeGitError } = require("../services/githubService");
const { getStoredGithubAccount, resolveSessionToken } = require("../services/githubAccountService");
const { extractZip } = require("../services/zipService");
const { runCipherScan } = require("../services/cipherScannerService");
const { sendScanReport } = require("../services/mailService");

async function startGithubCipherScan(req, res, next) {
  try {
    const { repoCloneUrl, repoFullName, githubSession, email, failOn, includeLow, bankingProfile, importedRepositoryId } = req.body;
    const githubToken = await _githubTokenForUser(githubSession, req.user.id);
    const job = await createJob(_newJob("github", repoFullName || repoCloneUrl, req.user.id, importedRepositoryId));
    res.status(202).json(job);
    _runJob(job.id, { sourceType: "github", sourceLabel: repoFullName, repoUrl: repoCloneUrl, githubToken, email, failOn, includeLow, bankingProfile }).catch(next);
  } catch (error) {
    next(error);
  }
}

async function startZipCipherScan(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Repository zip file is required" });
    }

    const { email, failOn, includeLow, bankingProfile } = req.body;
    const job = await createJob(_newJob("zip", req.file.originalname, req.user.id, null));
    res.status(202).json(job);
    _runJob(job.id, {
      sourceType: "zip",
      zipPath: req.file.path,
      email,
      failOn,
      includeLow,
      bankingProfile
    }).catch(next);
  } catch (error) {
    next(error);
  }
}

async function getCipherScanJob(req, res) {
  let job = await getJob(req.params.jobId);
  
  if (!job) {
    const agentJob = await getAgentScan(req.user.id, req.params.jobId);
    if (agentJob) {
      job = adaptAgentScanToModule(agentJob, "cipher");
    }
  }

  if (!job || job.scannerType !== "cipher") {
    return res.status(404).json({ message: "Cipher scan job not found" });
  }
  if (job.userId && job.userId !== req.user.id) {
    return res.status(404).json({ message: "Cipher scan job not found" });
  }
  return res.json({ ...job, logs: getLogs(job.id) });
}

async function getCipherScanJobs(req, res) {
  const cloudJobs = await listJobs({ userId: req.user.id, scannerType: "cipher" });
  const agentJobs = await listAgentScans(req.user.id);
  
  const adaptedAgentJobs = agentJobs
    .map(job => adaptAgentScanToModule(job, "cipher"))
    .filter(Boolean);

  const allJobs = [...cloudJobs, ...adaptedAgentJobs].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(allJobs);
}

async function streamCipherScanLogs(req, res) {
  const { jobId } = req.params;
  const job = await getJob(jobId);
  if (!job || job.scannerType !== "cipher" || (job.userId && job.userId !== req.user.id)) {
    return res.status(404).json({ message: "Cipher scan job not found" });
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
  addLog(jobId, "info", "Step 1/8 - Pre-deployment cipher scan job created");
  addLog(jobId, "info", `Using ${input.sourceType === "github" ? "GitHub repository import" : "ZIP upload"} as the source`);
  addLog(jobId, "info", `Policy selected: banking profile ${input.bankingProfile || "strict"}, include low severity ${_bool(input.includeLow, true) ? "yes" : "no"}, fail on ${input.failOn || "high"}`);

  try {
    let projectPath;
    if (input.sourceType === "github") {
      const cloneStartedAt = Date.now();
      addLog(jobId, "info", "Step 2/8 - Importing repository from GitHub");
      addLog(jobId, "info", `Downloading the latest source snapshot for ${input.sourceLabel || "selected repository"}`);
      projectPath = await cloneRepository(input.repoUrl, jobId, input.githubToken);
      addLog(jobId, "success", `Repository imported successfully in ${_seconds(Date.now() - cloneStartedAt)}`);
    } else {
      const extractStartedAt = Date.now();
      addLog(jobId, "info", "Step 2/8 - Extracting uploaded repository archive");
      addLog(jobId, "info", "Unpacking the uploaded ZIP into an isolated scan workspace");
      projectPath = extractZip(input.zipPath, jobId);
      addLog(jobId, "success", `Archive extracted successfully in ${_seconds(Date.now() - extractStartedAt)}`);
    }

    addLog(jobId, "info", "Step 3/8 - Preparing TLS and cipher policy analysis");
    addLog(jobId, "info", "Handing the imported source to the FastAPI pre-cipher scanner");
    const result = await runCipherScan(projectPath, {
      failOn: input.failOn || "high",
      includeLow: _bool(input.includeLow, true),
      bankingProfile: input.bankingProfile || "strict"
    });

    const summary = result.summary || {};
    const severityCounts = summary.findings_by_severity || {};
    addLog(jobId, "info", "Step 4/8 - Discovering TLS edge, cloud, app, and deployment configuration files");
    addLog(jobId, "success", `Scanned ${summary.supported_files_scanned || 0} supported files from ${summary.total_files_seen || 0} repository files`);
    addLog(jobId, "info", `TLS facts extracted: ${summary.tls_facts || 0}`);

    addLog(jobId, "info", "Step 5/8 - Evaluating protocols, cipher suites, certificate verification, and managed cloud TLS policies");
    addLog(jobId, "success", `Cipher rule evaluation completed in ${_seconds(result.orchestration?.durationMs || 0)}`);
    if ((result.findings || []).length) {
      addLog(jobId, "warning", `Detected ${result.findings.length} TLS/cipher pre-deployment finding(s)`);
      for (const finding of result.findings.slice(0, 5)) {
        addLog(jobId, "warning", `${finding.rule_id}: ${finding.title} in ${finding.file_path}${finding.line_number ? `:${finding.line_number}` : ""}`);
      }
    } else {
      addLog(jobId, "success", "No weak TLS or cipher configuration findings were detected");
    }

    addLog(jobId, "info", "Step 6/8 - Grading endpoint TLS posture and building cipher attack paths");
    addLog(jobId, "info", `Endpoint policies graded: ${result.endpoint_policies?.length || 0}`);
    for (const policy of (result.endpoint_policies || []).slice(0, 4)) {
      addLog(jobId, policy.grade === "A" || policy.grade === "B" ? "success" : "warning", `Endpoint grade ${policy.grade}: ${policy.endpoint} (${policy.weak_items?.length || 0} weak item(s))`);
    }
    addLog(jobId, result.attack_paths?.length ? "warning" : "success", `Cipher attack paths built: ${result.attack_paths?.length || 0}`);
    addLog(jobId, result.environment_drifts?.length ? "warning" : "success", `Environment TLS drifts detected: ${result.environment_drifts?.length || 0}`);
    addLog(jobId, result.agility_risks?.length ? "warning" : "success", `Cipher agility risks detected: ${result.agility_risks?.length || 0}`);
    addLog(jobId, result.compatibility_risks?.length ? "warning" : "success", `Client compatibility risks detected: ${result.compatibility_risks?.length || 0}`);
    addLog(jobId, result.mtls_readiness?.length ? "warning" : "success", `mTLS readiness gaps detected: ${result.mtls_readiness?.length || 0}`);
    addLog(jobId, result.domain_inventory?.length ? "info" : "success", `Domain/API endpoints discovered: ${result.domain_inventory?.length || 0}`);
    addLog(jobId, result.live_tls_probes?.length ? "info" : "success", `Live TLS probes completed: ${result.live_tls_probes?.length || 0}`);
    for (const probe of (result.live_tls_probes || []).slice(0, 5)) {
      const renewal = probe.certificate_days_remaining === null || probe.certificate_days_remaining === undefined ? "unknown renewal" : `${probe.certificate_days_remaining} day(s) to expiry`;
      addLog(
        jobId,
        probe.static_policy_match === "drift" || probe.accepted_legacy_protocols?.length || probe.renewal_window_status === "urgent" || probe.renewal_window_status === "expired" ? "warning" : "info",
        `Live endpoint ${probe.host}:${probe.port} is ${probe.deployment_status}; ${probe.negotiated_protocol || "no TLS"} ${probe.negotiated_cipher || ""}; ${renewal}; static match ${probe.static_policy_match}`
      );
    }
    if (result.deployment_readiness) {
      addLog(jobId, result.deployment_readiness.status === "blocked" ? "warning" : "info", `Deployment readiness: ${result.deployment_readiness.status} with score ${result.deployment_readiness.score}`);
    }
    for (const path of (result.attack_paths || []).slice(0, 3)) {
      addLog(jobId, "warning", `Attack path: ${path.title}; score ${path.score}`);
    }

    addLog(jobId, "info", "Step 7/8 - Generating remediation plan, compliance gaps, and CI decision");
    addLog(jobId, "info", `Severity summary: critical ${severityCounts.critical || 0}, high ${severityCounts.high || 0}, medium ${severityCounts.medium || 0}, low ${severityCounts.low || 0}, info ${severityCounts.info || 0}`);
    addLog(jobId, "info", `Remediation actions: ${result.remediation_plan?.length || 0}; compliance gaps: ${result.compliance_mapping?.length || 0}`);
    if (result.policy_decision) {
      addLog(jobId, result.policy_decision.status === "failed" ? "warning" : "success", `Cipher policy gate: ${result.policy_decision.status}; profile ${result.policy_decision.profile}`);
      for (const action of (result.policy_decision.required_actions || []).slice(0, 4)) {
        addLog(jobId, "warning", `Required action: ${action}`);
      }
    }
    addLog(jobId, result.summary?.ci_status === "failed" ? "warning" : "success", `CI gate result: ${result.summary?.ci_status || "unknown"} with cipher risk score ${result.summary?.risk_score ?? 0}`);
    addLog(jobId, "success", `Step 8/8 - Pre-deployment cipher scan completed in ${_seconds(Date.now() - jobStartedAt)}`);

    const updated = await updateJob(jobId, {
      status: "completed",
      result,
      completedAt: new Date().toISOString()
    });

    if (input.email) {
      addLog(jobId, "info", "Sending cipher scan report email");
      const mailResult = await sendScanReport(input.email, "Pre-deployment cipher scan report", result);
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
    scannerType: "cipher",
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
  startGithubCipherScan,
  startZipCipherScan,
  getCipherScanJob,
  getCipherScanJobs,
  streamCipherScanLogs
};
