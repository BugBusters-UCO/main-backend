const axios = require("axios");
const env = require("../config/env");

async function checkCipherScannerHealth() {
  const response = await axios.get(`${env.cipherScannerUrl}/health`, { timeout: 5000 });
  return response.data;
}

async function runCipherScan(projectPath, options = {}) {
  const startedAt = Date.now();
  const response = await axios.post(
    `${env.cipherScannerUrl}/api/v1/scans`,
    {
      project_path: projectPath,
      fail_on: options.failOn || "high",
      max_depth: options.maxDepth || 14,
      max_files: options.maxFiles || 8000,
      max_file_size_bytes: options.maxFileSizeBytes || 5000000,
      targets: options.targets || [],
      scan_mode: options.scanMode || "incremental",
      cache_namespace: options.cacheNamespace || "default",
      include_low: options.includeLow ?? true,
      banking_profile: options.bankingProfile || "strict",
      enable_live_probe: options.enableLiveProbe ?? true,
      live_probe_timeout_seconds: options.liveProbeTimeoutSeconds || 2.5,
      max_live_probe_endpoints: options.maxLiveProbeEndpoints || 8
    },
    {
      timeout: 120000,
      headers: env.cipherScannerApiToken ? { "X-Scanner-Token": env.cipherScannerApiToken } : undefined
    }
  );

  return {
    ...response.data,
    orchestration: {
      scannerUrl: env.cipherScannerUrl,
      durationMs: Date.now() - startedAt
    }
  };
}

module.exports = { checkCipherScannerHealth, runCipherScan };
