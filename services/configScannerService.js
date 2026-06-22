const axios = require("axios");
const env = require("../config/env");

async function checkConfigScannerHealth() {
  const response = await axios.get(`${env.configScannerUrl}/health`, { timeout: 5000 });
  return response.data;
}

async function runConfigScan(projectPath, options = {}) {
  const startedAt = Date.now();
  const response = await axios.post(
    `${env.configScannerUrl}/api/v1/scans`,
    {
      project_path: projectPath,
      fail_on: options.failOn || "high",
      max_depth: options.maxDepth || 12,
      include_low: options.includeLow ?? true
    },
    { timeout: 120000 }
  );
  return {
    ...response.data,
    orchestration: {
      scannerUrl: env.configScannerUrl,
      durationMs: Date.now() - startedAt
    }
  };
}

module.exports = { checkConfigScannerHealth, runConfigScan };
