const PROVIDERS = new Set(["cmdb", "aws", "azure", "gcp", "kubernetes", "nginx", "apache", "iis", "haproxy", "envoy", "f5"]);

function normalizeProviderRecord(provider, input = {}) {
  const value = input.resource || input;
  const host = value.host || value.hostname || value.dns_name || value.dnsName || value.address || value.ip || value.load_balancer_hostname || value.service_host;
  const port = value.port || value.listener_port || value.listenerPort || value.portNumber || 443;
  if (!host) return null;
  return {
    host,
    port,
    scheme: value.scheme || (String(value.protocol || "https").toLowerCase() === "http" ? "http" : String(value.protocol || "https").toLowerCase().includes("https") ? "https" : "tls"),
    sni: value.sni || value.server_name || value.serverName || null,
    environment: value.environment || value.env || "unknown",
    owner: value.owner || value.application_owner || value.applicationOwner || "",
    criticality: value.criticality ?? value.business_criticality ?? 5,
    data_sensitivity: value.data_sensitivity ?? value.dataSensitivity ?? 5,
    provider,
    resource_id: value.resource_id || value.resourceId || value.id || value.arn || value.resourceName || null,
    region: value.region || value.location || value.zone || null,
    namespace: value.namespace || value.cluster || null,
    service: value.service || value.service_name || value.serviceName || value.application || null,
    tags: [provider, ...(Array.isArray(value.tags) ? value.tags.map(String) : [])]
  };
}

function normalizeProviderAssets(provider, records) {
  const normalizedProvider = String(provider || "").toLowerCase();
  if (!PROVIDERS.has(normalizedProvider)) {
    const error = new Error(`Unsupported inventory provider: ${normalizedProvider}`);
    error.statusCode = 400;
    throw error;
  }
  const items = Array.isArray(records) ? records : [];
  return items.map((record) => normalizeProviderRecord(normalizedProvider, record)).filter(Boolean);
}

module.exports = { normalizeProviderAssets, PROVIDERS };
