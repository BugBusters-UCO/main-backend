const env = require("./env");

function validateProductionConfig() {
  if (env.nodeEnv !== "production") return;
  const missing = [];
  if (!env.jwtSecret || env.jwtSecret.length < 32 || env.jwtSecret === "change-this-secret") missing.push("JWT_SECRET (32+ characters)");
  if (!env.agentToken || env.agentToken === "dev-agent-token") missing.push("AGENT_SHARED_TOKEN");
  if (!env.configScannerServiceToken) missing.push("CONFIG_SCANNER_SERVICE_TOKEN");
  if (!env.scannerApiToken || env.scannerApiToken.length < 32) missing.push("SCANNER_API_TOKEN (32+ characters)");
  if (!process.env.CLIENT_ORIGIN || process.env.CLIENT_ORIGIN === "*") missing.push("CLIENT_ORIGIN");
  if (!env.dbEnabled || !env.databaseUrl) missing.push("DB_ENABLED=true and DATABASE_URL");
  if (!env.databaseSsl) missing.push("DB_SSL=true");
  if (!env.banking.strictOffline) missing.push("BANKING_STRICT_OFFLINE=true");
  if (env.banking.allowMetadataRedisQueue) missing.push("BANKING_ALLOW_METADATA_REDIS_QUEUE=false for strict bank mode");
  if (String(process.env.SECRET_ROTATION_EXECUTE || "false").toLowerCase() === "true" && (!env.rotation.brokerUrl || !env.rotation.brokerToken)) missing.push("SECRET_ROTATION_BROKER_URL and SECRET_ROTATION_BROKER_TOKEN when rotation execution is enabled");
  if (missing.length) throw new Error(`Production banking configuration is incomplete: ${missing.join(", ")}`);
}

module.exports = { validateProductionConfig };
