const axios = require("axios");
const env = require("../config/env");

async function checkScannerHealth() {
  const response = await axios.get(`${env.dependencyScannerUrl}/health`, { timeout: 5000 });
  return response.data;
}

async function runDependencyScan(projectPath, options = {}) {
  const startedAt = Date.now();
  const response = await axios.post(
    `${env.dependencyScannerUrl}/api/v1/scans`,
    {
      project_path: projectPath,
      include_dev: options.includeDev ?? true,
      use_osv: options.useOsv ?? true,
      fail_on: options.failOn || "high",
      max_depth: options.maxDepth || 8
    },
    { timeout: 120000 }
  );
  return {
    ...response.data,
    orchestration: {
      scannerUrl: env.dependencyScannerUrl,
      durationMs: Date.now() - startedAt
    }
  };
}

module.exports = { checkScannerHealth, runDependencyScan };
