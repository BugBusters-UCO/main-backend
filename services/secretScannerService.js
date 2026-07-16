const axios = require("axios");
const env = require("../config/env");

async function checkSecretScannerHealth() {
  const response = await axios.get(`${env.secretScannerUrl}/health`, { timeout: 5000 });
  return response.data;
}

async function runSecretScan(projectPath, options = {}) {
  const startedAt = Date.now();
  const response = await axios.post(
    `${env.secretScannerUrl}/api/v1/scans`,
    {
      project_path: projectPath,
      fail_on: options.failOn || "high",
      max_depth: options.maxDepth || 14,
      include_low: options.includeLow ?? true,
      scan_binary_files: options.scanBinaryFiles ?? false,
      include_git_history: options.includeGitHistory ?? true,
      max_history_commits: options.maxHistoryCommits ?? 100,
      complete_git_history: options.completeGitHistory ?? false,
      changed_files: options.changedFiles || null,
      max_file_bytes: options.maxFileBytes || 5000000,
      max_files: options.maxFiles || 8000,
      max_total_bytes: options.maxTotalBytes || 1000000000
    },
    {
      timeout: 120000,
      headers: { "x-scanner-token": env.scannerApiToken || "" }
    }
  );
  return {
    ...response.data,
    orchestration: {
      scannerUrl: env.secretScannerUrl,
      durationMs: Date.now() - startedAt
    }
  };
}

module.exports = { checkSecretScannerHealth, runSecretScan };
