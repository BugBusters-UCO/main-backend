const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const env = require("../config/env");

const execFileAsync = promisify(execFile);
const IMAGE_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*(?::[A-Za-z0-9._-]+|@sha256:[a-f0-9]{64})?$/;
const SOURCE_SUFFIXES = new Set([".json", ".xml"]);

async function scanContainerTarget(input = {}) {
  const target = input.image || input.dockerfilePath || input.sbomPath || input.projectPath;
  if (!target) throw new Error("image, dockerfilePath, sbomPath, or projectPath is required");
  const scanId = crypto.randomUUID();

  if (input.sbomPath) return scanSbom(input.sbomPath, scanId);
  if (input.dockerfilePath || input.projectPath) {
    const dockerfile = input.dockerfilePath || path.join(input.projectPath, "Dockerfile");
    const fallback = await scanDockerfile(dockerfile, scanId);
    if (!input.image && !input.projectPath) return fallback;
    if (!input.image && fallback.baseImages.length === 0) return fallback;
  }

  if (input.image) {
    if (!IMAGE_RE.test(String(input.image))) throw new Error("Invalid container image reference");
    const trivy = await runTrivy(input.image);
    const sbom = await runSyft(input.image);
    const findings = trivy ? normalizeTrivy(trivy) : [];
    const digest = trivy?.Metadata?.ImageID || trivy?.Metadata?.RepoDigests?.[0] || null;
    return {
      scan_id: scanId,
      target: input.image,
      tool: trivy ? "trivy" : "fallback",
      findings,
      sbom: sbom ? normalizeCycloneDx(sbom) : null,
      summary: summarize(findings),
      artifact_digest: digest,
      ci_status: gateStatus(findings),
      admission: gateStatus(findings) === "passed" ? "allow" : "block",
      evidence: trivy ? "Trivy image scan" : "No Trivy binary available",
      limitations: trivy ? [] : ["Install Trivy in the scanner worker for image-layer vulnerability detection."]
    };
  }
  return scanDockerfile(input.dockerfilePath || path.join(input.projectPath, "Dockerfile"), scanId);
}

async function scanSbom(sbomPath, scanId = crypto.randomUUID()) {
  const safePath = assertSafePath(sbomPath);
  const document = JSON.parse(await fs.readFile(safePath, "utf8"));
  const components = normalizeComponents(document);
  return {
    scan_id: scanId,
    target: safePath,
    tool: "sbom-parser",
    findings: [],
    sbom: { format: detectSbomFormat(document), components },
    summary: summarize([]),
    evidence: `Parsed ${components.length} SBOM components`,
    limitations: ["SBOM parsing inventories components; vulnerability matching requires the internal advisory matcher phase."]
  };
}

async function scanDockerfile(dockerfilePath, scanId = crypto.randomUUID()) {
  const safePath = assertSafePath(dockerfilePath);
  const text = await fs.readFile(safePath, "utf8");
  const baseImages = Array.from(text.matchAll(/^\s*FROM\s+(?:--platform=\S+\s+)?([^\s]+)\s*$/gim)).map((match) => match[1]);
  const findings = baseImages.filter((image) => /:(latest|stable|edge|alpine)$/i.test(image)).map((image) => ({
    id: `container-mutable-tag:${image}`,
    type: "container-base-image",
    severity: "high",
    title: "Mutable container base-image tag",
    package_name: image,
    description: `${image} can change without a source-code change. Pin an approved immutable tag or digest.`,
    location: { file: safePath }
  }));
  return {
    scan_id: scanId,
    target: safePath,
    tool: "dockerfile-fallback",
    baseImages,
    findings,
    sbom: null,
    summary: summarize(findings),
    ci_status: gateStatus(findings),
    admission: gateStatus(findings) === "passed" ? "allow" : "block",
    evidence: `Discovered ${baseImages.length} Dockerfile base image(s)`,
    limitations: ["Dockerfile analysis does not inspect image layers or operating-system packages."]
  };
}

async function runTrivy(image) {
  try {
    const args = ["image", "--quiet", "--format", "json", "--scanners", "vuln,secret,misconfig", "--timeout", `${Number(process.env.CONTAINER_SCAN_TIMEOUT_SECONDS || 120)}s`];
    if (String(process.env.TRIVY_OFFLINE_SCAN || "true").toLowerCase() === "true") args.push("--skip-db-update", "--skip-java-db-update");
    args.push(image);
    const result = await execFileAsync(process.env.TRIVY_PATH || "trivy", args, { timeout: Number(process.env.CONTAINER_SCAN_TIMEOUT_SECONDS || 120) * 1000, maxBuffer: 50 * 1024 * 1024 });
    return JSON.parse(result.stdout);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    if (error.stdout) {
      try { return JSON.parse(error.stdout); } catch (_parseError) { /* fall through */ }
    }
    throw new Error(`Trivy scan failed: ${String(error.stderr || error.message).slice(0, 1000)}`);
  }
}

async function runSyft(image) {
  try {
    const result = await execFileAsync(process.env.SYFT_PATH || "syft", [image, "-o", "cyclonedx-json"], { timeout: Number(process.env.CONTAINER_SCAN_TIMEOUT_SECONDS || 120) * 1000, maxBuffer: 50 * 1024 * 1024 });
    return JSON.parse(result.stdout);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    return null;
  }
}

function normalizeTrivy(document = {}) {
  const findings = [];
  for (const result of document.Results || []) {
    for (const vuln of result.Vulnerabilities || []) findings.push({ id: vuln.VulnerabilityID, type: "vulnerability", severity: String(vuln.Severity || "unknown").toLowerCase(), title: vuln.Title || vuln.PkgName, package_name: vuln.PkgName, installed_version: vuln.InstalledVersion, fixed_version: vuln.FixedVersion, description: vuln.Description || vuln.Title, location: { file: result.Target } });
    for (const secret of result.Secrets || []) findings.push({ id: secret.RuleID || `secret:${secret.Title}`, type: "secret", severity: "high", title: secret.Title || "Secret in image", description: secret.Match || secret.Title, location: { file: result.Target, line: secret.StartLine } });
    for (const misconfig of result.Misconfigurations || []) findings.push({ id: misconfig.ID, type: "misconfiguration", severity: String(misconfig.Severity || "unknown").toLowerCase(), title: misconfig.Title, description: misconfig.Message, location: { file: result.Target, line: misconfig.CauseMetadata?.StartLine } });
  }
  return findings;
}

function normalizeComponents(document = {}) {
  return (document.components || document.packages || []).map((component) => ({ name: component.name || component.packageName, version: component.versionInfo || component.version || "unknown", purl: component.purl || component.externalRefs?.[0]?.referenceLocator || null, ecosystem: component.type || "library" }));
}
function gateStatus(findings) { return findings.some((finding) => ["critical", "high"].includes(finding.severity)) ? "failed" : "passed"; }
function detectSbomFormat(document) { return document.bomFormat ? `CycloneDX ${document.specVersion || ""}`.trim() : document.spdxVersion ? `SPDX ${document.spdxVersion}` : "unknown"; }
function summarize(findings) { return findings.reduce((summary, finding) => { summary.total += 1; summary[finding.severity] = (summary[finding.severity] || 0) + 1; return summary; }, { total: 0, critical: 0, high: 0, medium: 0, low: 0, unknown: 0 }); }
function assertSafePath(rawPath) {
  const resolved = path.resolve(String(rawPath));
  const roots = [env.workspaceDir, ...(String(process.env.CONTAINER_SCAN_ROOTS || "").split(",").filter(Boolean).map((root) => path.resolve(root)))];
  if (!roots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`))) throw new Error("Container/SBOM path is outside an approved scan root");
  if (!SOURCE_SUFFIXES.has(path.extname(resolved).toLowerCase()) && path.basename(resolved).toLowerCase() !== "dockerfile") throw new Error("Only Dockerfile, JSON, or XML SBOM files are supported");
  return resolved;
}

module.exports = { scanContainerTarget, scanDockerfile, scanSbom };
