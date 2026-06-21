const { randomUUID } = require("crypto");
const fs = require("fs");

const { createJob, getJob, listJobs, updateJob } = require("../services/scanJobStore");
const { addLog, getLogs, subscribe } = require("../services/logStreamService");
const { cloneRepository, sanitizeGitError } = require("../services/githubService");
const { resolveSessionToken } = require("../services/githubAccountService");
const { extractZip } = require("../services/zipService");
const { runDependencyScan } = require("../services/dependencyScannerService");
const { sendScanReport } = require("../services/mailService");

function startGithubScan(req, res, next) {
  try {
    const { repoCloneUrl, repoFullName, githubSession, email, includeDev, useOsv, failOn } = req.body;
    const githubToken = resolveSessionToken(githubSession);
    const job = createJob(_newJob("github", repoFullName || repoCloneUrl));
    res.status(202).json(job);
    _runJob(job.id, { sourceType: "github", sourceLabel: repoFullName, repoUrl: repoCloneUrl, githubToken, email, includeDev, useOsv, failOn }).catch(next);
  } catch (error) {
    next(error);
  }
}

function startZipScan(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Repository zip file is required" });
    }

    const { email, includeDev, useOsv, failOn } = req.body;
    const job = createJob(_newJob("zip", req.file.originalname));
    res.status(202).json(job);
    _runJob(job.id, {
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

function getScanJob(req, res) {
  const job = getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ message: "Scan job not found" });
  }
  return res.json({ ...job, logs: getLogs(job.id) });
}

function getScanJobs(_req, res) {
  res.json(listJobs());
}

function streamScanLogs(req, res) {
  const { jobId } = req.params;

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
  updateJob(jobId, { status: "running" });
  addLog(jobId, "info", "Step 1/7 - Scan job created");
  addLog(jobId, "info", `Using ${input.sourceType === "github" ? "GitHub repository import" : "ZIP upload"} as the source`);
  addLog(jobId, "info", `Scan policy selected: ${_bool(input.includeDev, true) ? "include development dependencies" : "runtime dependencies only"}, ${_bool(input.useOsv, true) ? "OSV vulnerability lookup enabled" : "OSV vulnerability lookup disabled"}, fail on ${input.failOn || "high"}`);

  try {
    let projectPath;
    if (input.sourceType === "github") {
      const cloneStartedAt = Date.now();
      addLog(jobId, "info", "Step 2/7 - Importing repository from GitHub");
      addLog(jobId, "info", `Connecting to ${input.sourceLabel || "selected repository"} and downloading the latest source snapshot`);
      projectPath = await cloneRepository(input.repoUrl, jobId, input.githubToken);
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
    const updated = updateJob(jobId, {
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
    updateJob(jobId, {
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

function _newJob(sourceType, sourceLabel) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
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
  streamScanLogs
};
