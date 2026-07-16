const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { promisify } = require("util");

const env = require("../config/env");

const execFileAsync = promisify(execFile);
const MAX_FILES = 3000;
const MAX_FINDINGS = 500;
const SUPPORTED = new Set([".tf", ".tfvars", ".yaml", ".yml", ".json"]);
const SKIP = new Set([".git", "node_modules", "vendor", ".terraform", "dist", "build"]);

async function scanIacTarget(input = {}) {
  if (!input.projectPath) throw new Error("projectPath is required");
  const root = assertSafeRoot(input.projectPath);
  const external = await runExternalIacScanner(root);
  if (external) return { scan_id: crypto.randomUUID(), target: root, tool: external.tool, findings: external.findings, summary: summarize(external.findings), ci_status: gateStatus(external.findings), admission: gateStatus(external.findings) === "passed" ? "allow" : "block", limitations: [] };
  const findings = await fallbackScan(root);
  return {
    scan_id: crypto.randomUUID(),
    target: root,
    tool: "static-iac-fallback",
    findings,
    summary: summarize(findings),
    ci_status: gateStatus(findings),
    admission: gateStatus(findings) === "passed" ? "allow" : "block",
    limitations: ["Install Checkov or Trivy in scanner workers for broader policy coverage and provider-specific checks."]
  };
}

async function runExternalIacScanner(root) {
  const timeout = Number(process.env.IAC_SCAN_TIMEOUT_SECONDS || 120) * 1000;
  try {
    const result = await execToolWithFindings(process.env.CHECKOV_PATH || "checkov", ["-d", root, "-o", "json", "--quiet"], timeout);
    const documents = JSON.parse(result.stdout);
    const findings = [];
    for (const document of Array.isArray(documents) ? documents : [documents]) {
      for (const failed of document.results?.failed || []) findings.push({ id: failed.check_id, framework: document.check_type, severity: "high", title: failed.check_name, description: failed.check_name, file_path: failed.file_path, line_number: failed.file_line_range?.[0], code: failed.code_block?.join("\n"), fix: "Review and remediate the failed IaC policy." });
    }
    return { tool: "checkov", findings };
  } catch (error) {
    if (error.code !== "ENOENT" && !String(error.message).includes("Command failed") && !error.stdout) throw new Error(`IaC scanner failed: ${String(error.stderr || error.message).slice(0, 1000)}`);
  }

  try {
    const result = await execToolWithFindings(process.env.TRIVY_PATH || "trivy", ["config", "--format", "json", "--quiet", root], timeout);
    const document = JSON.parse(result.stdout);
    const findings = [];
    for (const target of document.Results || []) for (const finding of target.Misconfigurations || []) findings.push({ id: finding.ID, framework: finding.Type, severity: String(finding.Severity || "unknown").toLowerCase(), title: finding.Title, description: finding.Message, file_path: target.Target, line_number: finding.CauseMetadata?.StartLine, fix: finding.Resolution });
    return { tool: "trivy-config", findings };
  } catch (error) {
    if (error.code !== "ENOENT" && !String(error.message).includes("Command failed") && !error.stdout) throw new Error(`Trivy config scan failed: ${String(error.stderr || error.message).slice(0, 1000)}`);
  }
  return null;
}

async function execToolWithFindings(command, args, timeout) {
  try { return await execFileAsync(command, args, { timeout, maxBuffer: 50 * 1024 * 1024 }); }
  catch (error) { if (error.stdout) return { stdout: error.stdout, stderr: error.stderr, exitCode: error.code }; throw error; }
}

async function fallbackScan(root) {
  const files = await collectFiles(root);
  const findings = [];
  for (const file of files) {
    const text = await fs.readFile(file, "utf8").catch(() => "");
    if (!text) continue;
    const relative = path.relative(root, file);
    const lower = relative.toLowerCase();
    const rules = lower.endsWith(".tf") || lower.endsWith(".tfvars") ? terraformRules : kubernetesRules;
    for (const rule of rules) {
      const match = rule.pattern.exec(text);
      if (!match) continue;
      const line = text.slice(0, match.index).split(/\r?\n/).length;
      findings.push({ id: `${rule.id}:${relative}:${line}`, framework: lower.endsWith(".tf") || lower.endsWith(".tfvars") ? "terraform" : lower.includes("templates") || lower.includes("chart.yaml") ? "helm/kubernetes" : "kubernetes", severity: rule.severity, title: rule.title, description: rule.description, file_path: relative, line_number: line, code: text.split(/\r?\n/)[line - 1]?.trim(), fix: rule.fix });
      if (findings.length >= MAX_FINDINGS) return findings;
    }
  }
  return findings;
}

const terraformRules = [
  { id: "terraform-public-ingress", severity: "high", pattern: /cidr_blocks\s*=\s*\[[^\]]*0\.0\.0\.0\/0/i, title: "Terraform ingress is open to the Internet", description: "A security-group ingress rule permits all IPv4 sources.", fix: "Restrict CIDR ranges to approved network zones." },
  { id: "terraform-public-storage", severity: "high", pattern: /publicly_accessible\s*=\s*true|acl\s*=\s*["']public-read["']/i, title: "Terraform resource is publicly accessible", description: "Storage or database exposure can disclose banking data.", fix: "Disable public access and use private endpoints." },
  { id: "terraform-wildcard-iam", severity: "critical", pattern: /("|')Action("|')\s*:\s*(\[\s*)?["']\*["']/i, title: "Terraform IAM policy uses wildcard actions", description: "Wildcard permissions violate least privilege and increase blast radius.", fix: "Replace wildcard actions/resources with an approved permission set." },
  { id: "terraform-unencrypted", severity: "high", pattern: /encrypted\s*=\s*false|storage_encrypted\s*=\s*false/i, title: "Terraform resource encryption is disabled", description: "Sensitive banking data may be stored without encryption.", fix: "Enable encryption using an approved KMS key." }
];

const kubernetesRules = [
  { id: "k8s-privileged", severity: "critical", pattern: /privileged\s*:\s*true/i, title: "Kubernetes container is privileged", description: "Privileged containers can escape isolation and access the node.", fix: "Remove privileged mode and use the minimum required capabilities." },
  { id: "k8s-host-network", severity: "high", pattern: /hostNetwork\s*:\s*true|hostPID\s*:\s*true/i, title: "Kubernetes workload uses host namespace", description: "Host namespace access weakens workload isolation.", fix: "Disable host networking/PID access unless formally approved." },
  { id: "k8s-host-path", severity: "high", pattern: /hostPath\s*:/i, title: "Kubernetes workload mounts a host path", description: "Host filesystem mounts can expose node and credential data.", fix: "Use managed persistent volumes and restrict host mounts." },
  { id: "k8s-public-load-balancer", severity: "high", pattern: /type\s*:\s*LoadBalancer/i, title: "Kubernetes service may be Internet-facing", description: "A load balancer can expose an internal banking service.", fix: "Use an approved ingress, private load balancer, and network policy." },
  { id: "k8s-wildcard-rbac", severity: "critical", pattern: /(?:verbs|resources)\s*:\s*\[?\s*["']\*["']/i, title: "Kubernetes RBAC uses a wildcard permission", description: "Wildcard RBAC permissions create excessive cluster access.", fix: "Grant only the exact verbs and resources required." },
  { id: "k8s-latest-image", severity: "medium", pattern: /image\s*:\s*[^\s#]+:latest\s*$/im, title: "Kubernetes image uses the latest tag", description: "Mutable image tags weaken release reproducibility.", fix: "Pin an approved immutable version or digest." }
];

async function collectFiles(root) {
  const files = [];
  async function walk(current) {
    if (files.length >= MAX_FILES) return;
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (SUPPORTED.has(path.extname(entry.name).toLowerCase()) || entry.name === "Chart.yaml") files.push(full);
    }
  }
  await walk(root);
  return files;
}

function assertSafeRoot(rawRoot) {
  const root = path.resolve(String(rawRoot));
  const approved = [env.workspaceDir, ...(String(process.env.IAC_SCAN_ROOTS || "").split(",").filter(Boolean).map((item) => path.resolve(item)))];
  if (!approved.some((item) => root === item || root.startsWith(`${item}${path.sep}`))) throw new Error("IaC path is outside an approved scan root");
  return root;
}
function summarize(findings) { return findings.reduce((summary, finding) => { summary.total += 1; summary[finding.severity] = (summary[finding.severity] || 0) + 1; return summary; }, { total: 0, critical: 0, high: 0, medium: 0, low: 0, unknown: 0 }); }
function gateStatus(findings) { return findings.some((finding) => ["critical", "high"].includes(finding.severity)) ? "failed" : "passed"; }

module.exports = { fallbackScan, scanIacTarget };
