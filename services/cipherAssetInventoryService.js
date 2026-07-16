const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const net = require("net");

const env = require("../config/env");

const inventoryDir = () => path.join(env.workspaceDir, ".cipher-asset-inventory");

function assetFile(userId) {
  const key = crypto.createHash("sha256").update(String(userId)).digest("hex");
  return path.join(inventoryDir(), `${key}.json`);
}

function validateAsset(input = {}) {
  const host = String(input.host || "").trim().toLowerCase();
  const port = Number(input.port || 443);
  if (!host || host.length > 253 || (!net.isIP(host) && !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/i.test(host))) {
    const error = new Error("A valid hostname or IP address is required");
    error.statusCode = 400;
    throw error;
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    const error = new Error("Asset port must be between 1 and 65535");
    error.statusCode = 400;
    throw error;
  }
  return {
    id: String(input.id || crypto.randomUUID()),
    host,
    port,
    scheme: ["https", "http", "tls"].includes(String(input.scheme)) ? String(input.scheme) : "https",
    sni: input.sni ? String(input.sni).trim().toLowerCase().slice(0, 253) : null,
    environment: String(input.environment || "unknown").slice(0, 64),
    owner: String(input.owner || "").slice(0, 160),
    criticality: Math.max(0, Math.min(10, Number(input.criticality ?? 5))),
    data_sensitivity: Math.max(0, Math.min(10, Number(input.data_sensitivity ?? 5))),
    provider: String(input.provider || "manual").slice(0, 64),
    resource_id: input.resource_id ? String(input.resource_id).slice(0, 255) : null,
    region: input.region ? String(input.region).slice(0, 128) : null,
    namespace: input.namespace ? String(input.namespace).slice(0, 128) : null,
    service: input.service ? String(input.service).slice(0, 160) : null,
    enabled: input.enabled !== false,
    tags: Array.isArray(input.tags) ? input.tags.map(String).slice(0, 20) : [],
    updated_at: new Date().toISOString()
  };
}

function read(userId) {
  try {
    const value = JSON.parse(fs.readFileSync(assetFile(userId), "utf8"));
    return Array.isArray(value) ? value : [];
  } catch (_error) {
    return [];
  }
}

function write(userId, assets) {
  fs.mkdirSync(inventoryDir(), { recursive: true, mode: 0o700 });
  const target = assetFile(userId);
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(assets), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, target);
}

function listAssets(userId) {
  return read(userId);
}

function upsertAssets(userId, inputs) {
  const incoming = Array.isArray(inputs) ? inputs : [inputs];
  const assets = read(userId);
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  for (const input of incoming) {
    const asset = validateAsset(input);
    byId.set(asset.id, asset);
  }
  const result = Array.from(byId.values()).sort((a, b) => a.host.localeCompare(b.host) || a.port - b.port);
  write(userId, result);
  return result;
}

function removeAsset(userId, assetId) {
  const result = read(userId).filter((asset) => asset.id !== assetId);
  write(userId, result);
  return result;
}

module.exports = { listAssets, removeAsset, upsertAssets };
