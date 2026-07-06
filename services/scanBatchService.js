const { randomUUID } = require("crypto");

const { createJob, updateJob } = require("./scanJobStore");
const { addLog } = require("./logStreamService");
const { cloneRepository, sanitizeGitError } = require("./githubService");
const { runDependencyScan } = require("./dependencyScannerService");
const { runConfigScan } = require("./configScannerService");
const { runSecretScan } = require("./secretScannerService");
const { runCipherScan } = require("./cipherScannerService");
const { createRiskAssessment } = require("./riskAssessmentService");

const SCANNER_SET = new Set(["dependency", "config", "secret", "cipher"]);

async function startGithubScanBatch(userId, input = {}) {
  const repository = input.repository || {};
  const scanners = normalizeScanners(input.scanners);
  if (!scanners.length) {
    const error = new Error("Select at least one scanner");
    error.statusCode = 400;
    throw error;
  }
  if (!repository.cloneUrl || !repository.fullName) {
    const error = new Error("A valid imported repository is required");
    error.statusCode = 400;
    throw error;
  }

  const jobs = [];
  for (const scanner of scanners) {
    const job = await createJob(newJob({
      scanner,
      userId,
      importedRepositoryId: repository.id,
      sourceLabel: repository.fullName
    }));
    jobs.push(job);
  }

  const assessment = await createRiskAssessment(userId, {
    sourceType: "github",
    sourceLabel: repository.fullName,
    scanJobIds: jobs.map((job) => job.id),
    businessContext: input.businessContext,
    weights: input.weights || { technical: 0.7, business: 0.3 }
  });

  const completion = Promise.all(
    jobs.map((job) =>
      runScannerJob(job.id, {
        scanner: job.scannerType,
        repository,
        githubToken: input.githubToken,
        policy: input.policy || {}
      })
    )
  );

  return { jobs, assessment, completion };
}

async function runScannerJob(jobId, input) {
  const startedAt = Date.now();
  await updateJob(jobId, { status: "running" });
  addLog(jobId, "info", `${label(input.scanner)} scheduled scan started`);
  addLog(jobId, "info", `Source repository: ${input.repository.fullName}`);
  addLog(jobId, "info", `Policy: fail on ${input.policy.failOn || "high"}, include low ${bool(input.policy.includeLow, true) ? "yes" : "no"}`);

  try {
    addLog(jobId, "info", "Step 1/5 - Downloading latest repository snapshot");
    const projectPath = await cloneRepository(input.repository.cloneUrl, jobId, input.githubToken);
    addLog(jobId, "success", `Repository snapshot ready in ${seconds(Date.now() - startedAt)}`);

    addLog(jobId, "info", `Step 2/5 - Sending source to ${label(input.scanner)} FastAPI service`);
    const result = await runScanner(input.scanner, projectPath, input.policy);
    addLog(jobId, "success", `${label(input.scanner)} analysis returned successfully`);

    addLog(jobId, "info", "Step 3/5 - Summarizing findings and policy status");
    const summary = result.summary || {};
    addLog(jobId, summary.ci_status === "failed" ? "warning" : "success", `CI status: ${summary.ci_status || "unknown"}; risk score: ${summary.risk_score ?? summary.banking_exposure_score ?? 0}`);
    addLog(jobId, "info", `Total findings: ${summary.total_findings ?? summary.vulnerable_dependencies ?? (result.findings || []).length ?? 0}`);

    addLog(jobId, "info", "Step 4/5 - Saving result into scan history");
    const updated = await updateJob(jobId, {
      status: "completed",
      result,
      completedAt: new Date().toISOString()
    });
    addLog(jobId, "success", `Step 5/5 - ${label(input.scanner)} scheduled scan completed in ${seconds(Date.now() - startedAt)}`);
    return updated;
  } catch (error) {
    const safeMessage = sanitizeGitError(error.message || `${label(input.scanner)} scan failed`);
    addLog(jobId, "error", safeMessage);
    await updateJob(jobId, {
      status: "failed",
      error: safeMessage,
      completedAt: new Date().toISOString()
    });
    return null;
  }
}

function runScanner(scanner, projectPath, policy = {}) {
  const failOn = policy.failOn || "high";
  if (scanner === "dependency") {
    return runDependencyScan(projectPath, {
      includeDev: bool(policy.includeDev, true),
      useOsv: bool(policy.useOsv, true),
      failOn
    });
  }
  if (scanner === "config") {
    return runConfigScan(projectPath, { includeLow: bool(policy.includeLow, true), failOn });
  }
  if (scanner === "secret") {
    return runSecretScan(projectPath, { includeLow: bool(policy.includeLow, true), failOn });
  }
  return runCipherScan(projectPath, {
    includeLow: bool(policy.includeLow, true),
    failOn,
    bankingProfile: policy.bankingProfile || "strict",
    enableLiveProbe: bool(policy.enableLiveProbe, true)
  });
}

function normalizeScanners(scanners) {
  const values = Array.isArray(scanners) ? scanners : ["dependency", "config", "secret", "cipher"];
  return Array.from(new Set(values.map(String).filter((scanner) => SCANNER_SET.has(scanner))));
}

function newJob({ scanner, userId, importedRepositoryId, sourceLabel }) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    userId,
    importedRepositoryId,
    scannerType: scanner,
    sourceType: "github",
    sourceLabel,
    status: "queued",
    result: null,
    error: null,
    createdAt: now,
    updatedAt: now
  };
}

function label(scanner) {
  return {
    dependency: "Dependency scanner",
    config: "Configuration scanner",
    secret: "Secret scanner",
    cipher: "Pre-cipher suite scanner"
  }[scanner] || "Scanner";
}

function bool(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return String(value).toLowerCase() === "true";
}

function seconds(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

module.exports = {
  normalizeScanners,
  startGithubScanBatch
};
