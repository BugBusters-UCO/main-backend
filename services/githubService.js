const { execFile } = require("child_process");
const path = require("path");
const { promisify } = require("util");

const env = require("../config/env");

const execFileAsync = promisify(execFile);

function validateGithubUrl(repoUrl) {
  const trimmed = String(repoUrl || "").trim();
  const allowed = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(trimmed);

  if (!allowed) {
    const error = new Error("Enter a valid GitHub repository URL");
    error.statusCode = 400;
    throw error;
  }
  return trimmed;
}

async function cloneRepository(repoUrl, jobId, githubToken) {
  const safeUrl = validateGithubUrl(repoUrl);
  const targetDir = path.join(env.workspaceDir, jobId, "repo");
  const args = ["clone", "--depth", "1", safeUrl, targetDir];
  const gitEnv = { ...process.env };

  if (githubToken) {
    const basicAuth = Buffer.from(`x-access-token:${githubToken}`).toString("base64");
    gitEnv.GIT_CONFIG_COUNT = "1";
    gitEnv.GIT_CONFIG_KEY_0 = "http.https://github.com/.extraheader";
    gitEnv.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${basicAuth}`;
  }

  try {
    await execFileAsync("git", args, {
      env: gitEnv,
      timeout: 120000,
      maxBuffer: 1024 * 1024 * 10
    });
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
