const { execFile } = require("child_process");
const path = require("path");
const { promisify } = require("util");

const env = require("../config/env");

const execFileAsync = promisify(execFile);

function validateGithubUrl(repoUrl, provider = "github") {
  const trimmed = String(repoUrl || "").trim();
  let url;
  try { url = new URL(trimmed); } catch (_error) { url = null; }
  const strictBankMode = env.banking.internalOnly || (env.banking.strictOffline && env.nodeEnv === "production");
  const defaultHosts = strictBankMode ? { github: [], gitlab: [], bitbucket: [], azuredevops: [] } : {
    github: ["github.com"], gitlab: ["gitlab.com"], bitbucket: ["bitbucket.org"], azuredevops: ["dev.azure.com", "visualstudio.com"]
  };
  const hosts = new Set([...(defaultHosts[provider] || []), ...(env.webhook.providerHosts?.[provider] || [])]);
  const validPath = url && url.protocol === "https:" && url.hostname && url.pathname.length > 1;
  const allowed = Boolean(validPath && hosts.has(url.hostname.toLowerCase()) && !url.search && !url.hash);

  if (!allowed) {
    const error = new Error(`Enter a valid ${provider} repository URL`);
    error.statusCode = 400;
    throw error;
  }
  return trimmed;
}

async function cloneRepository(repoUrl, jobId, token, provider = "github", commitSha = null, cloneDepth = 1) {
  const safeUrl = validateGithubUrl(repoUrl, provider);
  const targetDir = path.join(env.workspaceDir, jobId, "repo");
  const requestedDepth = Number(cloneDepth);
  const fullHistory = requestedDepth === 0;
  const depth = Math.max(1, Math.min(500, requestedDepth || 1));
  const args = ["clone"];
  if (!fullHistory) args.push("--depth", String(depth));
  if (fullHistory || depth > 1) args.push("--no-single-branch");
  args.push(safeUrl, targetDir);
  const gitEnv = { ...process.env };

  if (token) {
    const parsed = new URL(safeUrl);
    const authValue = provider === "azuredevops"
      ? `Basic ${Buffer.from(`:${token}`).toString("base64")}`
      : `Bearer ${token}`;
    gitEnv.GIT_CONFIG_COUNT = "1";
    gitEnv.GIT_CONFIG_KEY_0 = `http.https://${parsed.host}/.extraheader`;
    gitEnv.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: ${authValue}`;
  }

  try {
    await execFileAsync("git", args, {
      env: gitEnv,
      timeout: 120000,
      maxBuffer: 1024 * 1024 * 10
    });
    if (commitSha) {
      await execFileAsync("git", ["-C", targetDir, "fetch", "--depth", "1", "origin", commitSha], {
        env: gitEnv,
        timeout: 120000,
        maxBuffer: 1024 * 1024 * 10
      });
      await execFileAsync("git", ["-C", targetDir, "checkout", "--detach", commitSha], {
        env: gitEnv,
        timeout: 120000,
        maxBuffer: 1024 * 1024 * 10
      });
    }
  } catch (error) {
    const message = sanitizeGitError(error.stderr || error.message || "Git clone failed");
    const cloneError = new Error(message);
    cloneError.statusCode = 502;
    throw cloneError;
  }

  return targetDir;
}

function sanitizeGitError(message) {
  return String(message)
    .replace(/gho_[A-Za-z0-9_]+/g, "[redacted-github-token]")
    .replace(/github_pat_[A-Za-z0-9_]+/g, "[redacted-github-token]")
    .replace(/AUTHORIZATION: basic [A-Za-z0-9+/=]+/gi, "AUTHORIZATION: basic [redacted]")
    .replace(/Authorization: Bearer [A-Za-z0-9_]+/gi, "Authorization: Bearer [redacted]")
    .trim();
}

module.exports = { cloneRepository, sanitizeGitError, validateGithubUrl };
