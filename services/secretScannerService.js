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
      scan_binary_files: options.scanBinaryFiles ?? false
    },
    { timeout: 120000 }
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
