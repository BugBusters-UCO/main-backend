const { listAssets, removeAsset, upsertAssets } = require("../services/cipherAssetInventoryService");
const { createCipherAssetScan } = require("../services/cipherAssetScanService");
const { normalizeProviderAssets } = require("../services/cipherProviderInventoryService");

function getAssets(req, res) {
  res.json(listAssets(req.user.id));
}

function saveAssets(req, res, next) {
  try {
    res.json(upsertAssets(req.user.id, req.body.assets || req.body));
  } catch (error) {
    next(error);
  }
}

function deleteAsset(req, res) {
  res.json(removeAsset(req.user.id, req.params.assetId));
}

async function startAssetScan(req, res, next) {
  try {
    res.status(202).json(await createCipherAssetScan(req.user.id, req.body || {}));
  } catch (error) {
    next(error);
  }
}

function importProviderAssets(req, res, next) {
  try {
    const provider = String(req.body.provider || "").toLowerCase();
    const normalized = normalizeProviderAssets(provider, req.body.assets || req.body.resources || []);
    const assets = upsertAssets(req.user.id, normalized);
    res.status(202).json({ provider, imported: normalized.length, total: assets.length, assets });
  } catch (error) {
    next(error);
  }
}

async function receiveAssetWebhook(req, res, next) {
  try {
    const expected = process.env.CIPHER_ASSET_WEBHOOK_TOKEN;
    const supplied = req.headers["x-cipher-asset-token"];
    if (!expected || supplied !== expected) return res.status(401).json({ message: "Invalid cipher asset webhook token" });
    const job = await createCipherAssetScan(String(req.body.userId || ""), {
      assetIds: req.body.assetIds,
      sourceLabel: `Event-driven asset scan: ${req.body.reason || "configuration change"}`
    });
    res.status(202).json({ accepted: true, jobId: job.id });
  } catch (error) {
    next(error);
  }
}

module.exports = { deleteAsset, getAssets, importProviderAssets, receiveAssetWebhook, saveAssets, startAssetScan };
