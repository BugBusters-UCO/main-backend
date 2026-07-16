const crypto = require("crypto");

const FORMATTERS = new Set(["sarif", "cyclonedx", "spdx", "junit"]);

function formatScanResult(result, format) {
  const normalized = String(format || "").toLowerCase();
  if (!FORMATTERS.has(normalized)) throw new Error(`Unsupported scan artifact format: ${format}`);
  if (normalized === "sarif") return { body: JSON.stringify(toSarif(result), null, 2), contentType: "application/sarif+json", extension: "sarif.json" };
  if (normalized === "cyclonedx") return { body: JSON.stringify(toCycloneDx(result), null, 2), contentType: "application/vnd.cyclonedx+json", extension: "cdx.json" };
  if (normalized === "spdx") return { body: JSON.stringify(toSpdx(result), null, 2), contentType: "application/spdx+json", extension: "spdx.json" };
  return { body: toJunit(result), contentType: "application/xml", extension: "xml" };
}

function toSarif(result = {}) {
  const findings = allFindings(result);
  const rules = new Map();
  const results = findings.map((finding) => {
    const ruleId = finding.id || `finding-${hash(JSON.stringify(finding))}`;
    rules.set(ruleId, {
      id: ruleId,
      name: finding.title || finding.summary || ruleId,
      shortDescription: { text: finding.title || finding.summary || "Dependency security finding" },
      fullDescription: { text: finding.description || finding.summary || "" },
      helpUri: finding.details_url || undefined,
      properties: { severity: severity(finding.severity), category: finding.category || finding.capability || "vulnerability" }
    });
    const location = finding.file_path || finding.manifest_path;
    return {
      ruleId,
      level: sarifLevel(finding.severity),
      message: { text: finding.summary || finding.description || finding.title || "Security finding" },
      locations: location ? [{ physicalLocation: { artifactLocation: { uri: location }, region: finding.line_number ? { startLine: finding.line_number } : undefined } }] : undefined,
      fingerprints: { primaryLocationLineHash: hash(`${ruleId}:${location || ""}:${finding.line_number || 0}`) },
      properties: { package: finding.package_name || finding.dependency_name, fix: finding.fix?.description }
    };
  });
  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [{
      tool: { driver: { name: "BugBusters Dependency Scanner", informationUri: "https://osv.dev", rules: Array.from(rules.values()) } },
      results,
      properties: { scan_id: result.scan_id, risk_score: result.summary?.risk_score, ci_status: result.summary?.ci_status }
    }]
  };
}

function toCycloneDx(result = {}) {
  const components = (result.dependencies || []).map((dependency) => {
    const purl = dependency.package_url || packageUrl(dependency);
    return {
      type: dependency.ecosystem === "Docker" ? "container" : "library",
      "bom-ref": purl || `${dependency.ecosystem}:${dependency.name}@${dependency.version || "unknown"}`,
      group: dependency.ecosystem,
      name: dependency.name,
      version: dependency.version || "unknown",
      scope: dependency.scope === "development" ? "optional" : "required",
      purl: purl || undefined,
      properties: [{ name: "bugbusters:manifest", value: dependency.manifest_path }]
    };
  });
  const vulnerabilities = (result.findings || []).map((finding) => ({
    id: finding.id,
    source: { name: "OSV", url: finding.details_url || "https://osv.dev" },
    ratings: [{ severity: severity(finding.severity) }],
    recommendation: finding.fix?.description,
    affects: [{ ref: packageUrl(finding) || `${finding.ecosystem}:${finding.package_name}@${finding.installed_version || "unknown"}` }]
  }));
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber: `urn:uuid:${result.scan_id || crypto.randomUUID()}`,
    version: 1,
    metadata: { timestamp: new Date().toISOString(), tools: [{ vendor: "BugBusters", name: "Dependency Scanner" }] },
    components,
    vulnerabilities
  };
}

function toSpdx(result = {}) {
  const packages = (result.dependencies || []).map((dependency, index) => ({
    SPDXID: `SPDXRef-Package-${index + 1}`,
    name: dependency.name,
    versionInfo: dependency.version || "NOASSERTION",
    downloadLocation: "NOASSERTION",
    filesAnalyzed: false,
    supplier: "NOASSERTION",
    externalRefs: dependency.package_url || packageUrl(dependency) ? [{ referenceCategory: "PACKAGE-MANAGER", referenceType: "purl", referenceLocator: dependency.package_url || packageUrl(dependency) }] : []
  }));
  return {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: `BugBusters scan ${result.scan_id || "unknown"}`,
    documentNamespace: `https://bugbusters.local/scans/${result.scan_id || hash(JSON.stringify(result))}`,
    creationInfo: { created: new Date().toISOString(), creators: ["Tool: BugBusters Dependency Scanner"] },
    documentDescribes: packages.map((item) => item.SPDXID),
    packages,
    annotations: (result.findings || []).map((finding) => ({ annotationDate: new Date().toISOString(), annotationType: "OTHER", annotator: "Tool: BugBusters Dependency Scanner", SPDXID: "SPDXRef-DOCUMENT", comment: `${finding.id}: ${finding.summary || finding.description || "vulnerability"}` }))
  };
}

function toJunit(result = {}) {
  const findings = allFindings(result);
  const failures = findings.filter((finding) => ["critical", "high"].includes(severity(finding.severity))).length;
  const cases = findings.length ? findings.map((finding) => `<testcase classname="${xml(finding.category || finding.capability || "dependency")}" name="${xml(finding.id || finding.package_name || "finding")}">${failures && ["critical", "high"].includes(severity(finding.severity)) ? `<failure message="${xml(finding.summary || finding.description || finding.title || "security finding")}"/>` : ""}</testcase>`).join("") : "<testcase classname=\"dependency\" name=\"no-findings\"/>";
  return `<?xml version="1.0" encoding="UTF-8"?><testsuite name="BugBusters Dependency Scanner" tests="${findings.length || 1}" failures="${failures}" errors="0" time="0">${cases}</testsuite>`;
}

function allFindings(result) {
  return [
    ...(result.findings || []),
    ...(result.sensitive_data_findings || []).map((finding) => ({ ...finding, title: `Sensitive data: ${finding.data_type}`, category: "Sensitive Data" })),
    ...(result.dependency_risks || []),
    ...(result.capability_findings || []),
    ...(result.namespace_risks || []),
    ...(result.risk_chains || [])
  ];
}
function severity(value) { return String(value || "unknown").toLowerCase(); }
function sarifLevel(value) { return ["critical", "high"].includes(severity(value)) ? "error" : severity(value) === "medium" ? "warning" : "note"; }
function hash(value) { return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 32); }
function xml(value) { return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;"); }
function packageUrl(dependency) {
  const ecosystem = String(dependency.ecosystem || "");
  const name = dependency.name || dependency.package_name;
  const version = dependency.version || dependency.installed_version;
  if (!name || !version) return null;
  const types = { npm: "npm", PyPI: "pypi", Maven: "maven", Go: "golang", "crates.io": "cargo", RubyGems: "gem", Packagist: "composer", NuGet: "nuget", Docker: "docker" };
  return types[ecosystem] ? `pkg:${types[ecosystem]}/${name}@${version}` : null;
}

module.exports = { FORMATTERS, formatScanResult };
