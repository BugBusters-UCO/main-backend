const { createJob } = require("./scanJobStore");
const { enqueueCipherScan } = require("./cipherScanQueue");
const { listAssets } = require("./cipherAssetInventoryService");

async function createCipherAssetScan(userId, input = {}) {
  const assets = listAssets(userId).filter((asset) => asset.enabled !== false);
  const requested = Array.isArray(input.assetIds) && input.assetIds.length
    ? new Set(input.assetIds.map(String))
    : null;
  const selected = assets.filter((asset) => !requested || requested.has(asset.id));
  if (!selected.length) {
    const error = new Error("No enabled cipher assets matched the scan request");
    error.statusCode = 400;
    throw error;
  }

  const targets = selected.slice(0, Math.max(1, Math.min(50, Number(input.maxEndpoints || selected.length)))).map((asset) => ({
    host: asset.host,
    port: asset.port,
    scheme: asset.scheme,
    sni: asset.sni,
    endpoint_type: asset.tags?.includes("payment") ? "payment-api" : "inventory-asset"
  }));
  const job = await createJob({
    id: require("crypto").randomUUID(),
    userId,
    importedRepositoryId: null,
    scannerType: "cipher",
    sourceType: "asset-inventory",
    sourceLabel: input.sourceLabel || `Cipher asset inventory (${targets.length} target(s))`,
    status: "queued",
    result: null,
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  await enqueueCipherScan(job.id, {
    sourceType: "assets",
    sourceLabel: job.sourceLabel,
    userId,
    targets,
    failOn: input.failOn || "high",
    includeLow: input.includeLow !== false,
    bankingProfile: input.bankingProfile || "strict",
    enableLiveProbe: true,
    maxLiveProbeEndpoints: targets.length
  });
  return job;
}

module.exports = { createCipherAssetScan };
