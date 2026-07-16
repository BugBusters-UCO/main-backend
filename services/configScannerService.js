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
      include_low: options.includeLow ?? true,
      runtime_snapshot_path: options.runtimeSnapshotPath || null,
      policy_path: options.policyPath || null,
    },
    {
      timeout: Number(process.env.CONFIG_SCANNER_CLIENT_TIMEOUT_MS || 330000),
      headers: env.configScannerServiceToken
        ? { "x-scanner-service-token": env.configScannerServiceToken }
        : undefined
    }
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
