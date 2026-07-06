const { randomUUID } = require("crypto");
const { Agent, AgentScanJob, User } = require("../models");
const { addLog } = require("./logStreamService");

const memoryAgents = new Map();
const memoryJobs = new Map();
const memoryInteractiveCommands = new Map(); // Store browse requests: requestId -> command data

async function listAgents(userId) {
  await cleanupDemoAgents(userId);
  if (Agent) {
    const rows = await Agent.findAll({ where: { userId }, order: [["lastSeenAt", "DESC"], ["createdAt", "DESC"]] });
    return rows.map(_plain);
  }
  return Array.from(memoryAgents.values()).filter((agent) => agent.userId === userId && !_isDemoAgent(agent));
}

async function getAgent(userId, agentId) {
  if (Agent) {
    const row = await Agent.findOne({ where: { id: agentId, userId } });
    return row ? _plain(row) : null;
  }
  return Array.from(memoryAgents.values()).find((agent) => agent.id === agentId && agent.userId === userId) || null;
}

async function registerAgent(input) {
  const ownerEmail = String(input.ownerEmail || input.owner_email || "").toLowerCase();
  if (!ownerEmail) {
    const error = new Error("ownerEmail is required for agent registration");
    error.statusCode = 400;
    throw error;
  }

  const user = await _resolveOwner(ownerEmail);
  const hostname = String(input.hostname || "unknown-host");
  const now = new Date();
  const payload = {
    userId: user.id,
    name: input.name || hostname,
    hostname,
    os: input.os || null,
    version: input.version || null,
    status: "online",
    lastSeenAt: now,
    inventory: _normalizeInventory(input.inventory)
  };

  if (Agent) {
    const existing = await Agent.findOne({ where: { userId: user.id, hostname } });
    if (existing) {
      await existing.update(payload);
      return _plain(existing);
    }
    return _plain(await Agent.create(payload));
  }

  const existing = Array.from(memoryAgents.values()).find((agent) => agent.userId === user.id && agent.hostname === hostname);
  const agent = {
    ...(existing || { id: randomUUID(), createdAt: now.toISOString() }),
    ...payload,
    lastSeenAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
  memoryAgents.set(agent.id, agent);
  return agent;
}

async function heartbeatAgent(agentId, input = {}) {
  const agent = await getAgentById(agentId);
  if (!agent) return null;
  const patch = {
    status: input.status || "online",
    lastSeenAt: new Date(),
    ...(input.inventory ? { inventory: _normalizeInventory(input.inventory) } : {})
  };
  if (Agent) {
    await Agent.update(patch, { where: { id: agentId } });
    return getAgentById(agentId);
  }
  const updated = { ...agent, ...patch, lastSeenAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  memoryAgents.set(agentId, updated);
  return updated;
}

async function getAgentById(agentId) {
  if (Agent) {
    const row = await Agent.findByPk(agentId);
    return row ? _plain(row) : null;
  }
  return memoryAgents.get(agentId) || null;
}

async function startAgentScan(userId, agentId, input) {
  const agent = await getAgent(userId, agentId);
  if (!agent) return null;

  const modules = _modules(input.modules);
  const selectedPaths = _paths(input.paths, agent.inventory?.paths || []);
  const scope = _scope(input.scope);
  const id = randomUUID();
  const command = {
    type: "start_scan",
    scanId: id,
    scope,
    modules,
    paths: selectedPaths,
    maxDepth: Number(input.maxDepth || 14),
    createdAt: new Date().toISOString()
  };
  const job = {
    id,
    userId,
    agentId,
    sourceLabel: input.projectName || `${agent.name} OS scan`,
    scope,
    selectedPaths,
    modules,
    status: "queued",
    command,
    result: _initialResult(agent, scope, selectedPaths, modules),
    error: null,
    startedAt: null,
    completedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (AgentScanJob) {
    await AgentScanJob.create(_dbJob(job));
  } else {
    memoryJobs.set(id, job);
  }

  addLog(id, "info", "VM agent scan command created");
  addLog(id, "info", `Agent: ${agent.name} (${agent.hostname})`);
  addLog(id, "info", `Scope: ${scope}; modules: ${modules.join(", ")}`);
  addLog(id, "info", `Selected paths: ${selectedPaths.join(", ") || "agent defaults"}`);
  addLog(id, "warning", "Waiting for the VM bash agent to poll this command and start OS-level scanning");
  return getAgentScan(userId, id);
}

async function getAgentCommands(agentId) {
  const agent = await getAgentById(agentId);
  if (!agent) return null;
  await heartbeatAgent(agentId, { status: "online" });

  // 1. Check for pending interactive commands (e.g. browse)
  for (const cmd of memoryInteractiveCommands.values()) {
    if (cmd.agentId === agentId && cmd.status === "pending") {
      cmd.status = "sent";
      return { agentId, command: { type: cmd.type, requestId: cmd.requestId, path: cmd.path } };
    }
  }

  // 2. Check for scan commands
  const jobs = await listAgentScans(agent.userId, { agentId, limit: 20 });
  const job = jobs.find((item) => ["queued", "stopping"].includes(item.status));
  if (!job) return { agentId, command: null };
  if (job.status === "stopping") {
    return { agentId, command: { type: "stop_scan", scanId: job.id } };
  }
  await updateAgentScan(agent.userId, job.id, { status: "running", startedAt: new Date().toISOString() });
  addLog(job.id, "success", "VM agent picked up scan command");
  return { agentId, command: { ...(job.command || {}), type: "start_scan" } };
}

async function appendAgentLog(agentId, scanId, input = {}) {
  const job = await getAgentScanById(scanId);
  if (!job || job.agentId !== agentId) return null;
  addLog(scanId, input.level || "info", input.message || "Agent event", input.meta || {});
  return job;
}

async function updateAgentScanStatus(agentId, scanId, input = {}) {
  const job = await getAgentScanById(scanId);
  if (!job || job.agentId !== agentId) return null;
  const status = ["queued", "running", "stopping", "stopped", "completed", "failed"].includes(input.status) ? input.status : job.status;
  const patch = { status };
  if (status === "completed" || status === "failed" || status === "stopped") patch.completedAt = new Date().toISOString();
  if (input.error) patch.error = String(input.error);
  const updated = await updateAgentScan(job.userId, scanId, patch);
  addLog(scanId, status === "failed" ? "error" : status === "stopped" ? "warning" : "info", `Agent status: ${status}`);
  return updated;
}

async function completeAgentScan(agentId, scanId, input = {}) {
  const job = await getAgentScanById(scanId);
  if (!job || job.agentId !== agentId) return null;
  const status = input.status === "failed" ? "failed" : "completed";
  const updated = await updateAgentScan(job.userId, scanId, {
    status,
    result: input.result || job.result,
    error: input.error || null,
    completedAt: new Date().toISOString()
  });
  addLog(scanId, status === "failed" ? "error" : "success", status === "failed" ? "VM agent scan failed" : "VM agent scan completed");
  return updated;
}

async function getAgentScanById(scanId) {
  if (AgentScanJob) {
    const row = await AgentScanJob.findByPk(scanId);
    return row ? _plain(row) : null;
  }
  return memoryJobs.get(scanId) || null;
}

async function stopAgentScan(userId, scanId) {
  const job = await getAgentScan(userId, scanId);
  if (!job) return null;
  const patch = {
    status: job.status === "completed" || job.status === "failed" ? job.status : "stopping",
    command: { ...(job.command || {}), stopRequested: true, stopRequestedAt: new Date().toISOString() }
  };
  const updated = await updateAgentScan(userId, scanId, patch);
  addLog(scanId, "warning", "Stop requested from dashboard; waiting for agent acknowledgement");
  return updated;
}

async function listAgentScans(userId, filters = {}) {
  await cleanupDemoAgents(userId);
  if (AgentScanJob) {
    const where = { userId };
    if (filters.agentId) where.agentId = filters.agentId;
    const rows = await AgentScanJob.findAll({ where, order: [["createdAt", "DESC"]], limit: filters.limit || 100 });
    return rows.map(_plain).filter((job) => !_isDemoJob(job));
  }
  return Array.from(memoryJobs.values())
    .filter((job) => job.userId === userId)
    .filter((job) => !_isDemoJob(job))
    .filter((job) => !filters.agentId || job.agentId === filters.agentId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function cleanupDemoAgents(userId) {
  if (Agent && AgentScanJob) {
    const demoAgents = await Agent.findAll({ where: { userId, version: "agent-not-installed-demo" } });
    const demoIds = demoAgents.map((agent) => agent.id);
    if (demoIds.length) {
      await AgentScanJob.destroy({ where: { userId, agentId: demoIds } });
      await Agent.destroy({ where: { userId, id: demoIds } });
    }
    return;
  }

  for (const [id, agent] of memoryAgents.entries()) {
    if (agent.userId === userId && _isDemoAgent(agent)) {
      memoryAgents.delete(id);
      for (const [jobId, job] of memoryJobs.entries()) {
        if (job.agentId === id) memoryJobs.delete(jobId);
      }
    }
  }
}

async function getAgentScan(userId, scanId) {
  if (AgentScanJob) {
    const row = await AgentScanJob.findOne({ where: { id: scanId, userId } });
    return row ? _plain(row) : null;
  }
  const job = memoryJobs.get(scanId);
  return job && job.userId === userId ? job : null;
}

async function updateAgentScan(userId, scanId, patch) {
  if (AgentScanJob) {
    await AgentScanJob.update({ ...patch, updatedAt: new Date() }, { where: { id: scanId, userId } });
    return getAgentScan(userId, scanId);
  }
  const existing = memoryJobs.get(scanId);
  if (!existing || existing.userId !== userId) return null;
  const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  memoryJobs.set(scanId, updated);
  return updated;
}

function _modules(raw) {
  const allowed = new Set(["dependency", "config", "secret", "cipher"]);
  const modules = Array.isArray(raw) ? raw.filter((item) => allowed.has(item)) : [];
  return modules.length ? modules : ["dependency", "config", "secret", "cipher"];
}

function _paths(raw, inventoryPaths) {
  if (Array.isArray(raw) && raw.length) return raw.map(String).slice(0, 50);
  return inventoryPaths.filter((item) => item.recommended).map((item) => item.path);
}

function _scope(raw) {
  return ["full-os", "root", "selected", "application"].includes(raw) ? raw : "selected";
}

function _initialResult(agent, scope, paths, modules) {
  return {
    source: "vm-agent",
    agent: { id: agent.id, name: agent.name, hostname: agent.hostname, os: agent.os },
    scope,
    selectedPaths: paths,
    modules,
    summary: {
      status: "waiting-for-agent",
      total_findings: 0,
      risk_score: 0,
      dependency: null,
      config: null,
      secret: null,
      cipher: null
    },
    reports: modules.map((module) => ({ module, status: "queued", findings: 0, risk_score: 0 }))
  };
}

async function _resolveOwner(ownerEmail) {
  if (User) {
    const user = await User.findOne({ where: { email: ownerEmail } });
    if (!user) {
      const error = new Error(`No dashboard user found for ownerEmail ${ownerEmail}`);
      error.statusCode = 404;
      throw error;
    }
    return _plain(user);
  }

  return { id: ownerEmail, email: ownerEmail, name: ownerEmail };
}

function _normalizeInventory(inventory = {}) {
  return {
    paths: Array.isArray(inventory.paths) ? inventory.paths.slice(0, 500) : [],
    services: Array.isArray(inventory.services) ? inventory.services.slice(0, 300) : [],
    ports: Array.isArray(inventory.ports) ? inventory.ports.slice(0, 300) : [],
    updatedAt: inventory.updatedAt || new Date().toISOString()
  };
}

function _isDemoAgent(agent) {
  return agent.version === "agent-not-installed-demo" || agent.hostname === "payment-vm-01.bank.local" || String(agent.userId).startsWith("demo-");
}

function adaptAgentScanToModule(agentJob, module) {
  if (!agentJob || !agentJob.command || !agentJob.command.modules || !agentJob.command.modules.includes(module)) return null;
  
  let result = null;
  let status = agentJob.status;
  if (agentJob.result && Array.isArray(agentJob.result.reports)) {
    const report = agentJob.result.reports.find(r => r.module === module);
    if (report) {
       result = report.result || null;
       status = report.status === "completed" ? "completed" : report.status === "failed" ? "failed" : status;
    }
  }

  return {
    id: agentJob.id,
    userId: agentJob.userId,
    scannerType: module,
    sourceType: "vm-agent",
    sourceLabel: agentJob.command.paths ? agentJob.command.paths[0] : "VM Agent Scan",
    status: status,
    result: result,
    error: agentJob.error,
    createdAt: agentJob.createdAt,
    completedAt: agentJob.completedAt,
    isVmAgent: true,
  };
}

function _isDemoJob(job) {
  const resultAgent = job.result?.agent || {};
  return resultAgent.hostname === "payment-vm-01.bank.local" || resultAgent.version === "agent-not-installed-demo";
}

function _dbJob(job) {
  return {
    id: job.id,
    userId: job.userId,
    agentId: job.agentId,
    sourceLabel: job.sourceLabel,
    scope: job.scope,
    selectedPaths: job.selectedPaths,
    modules: job.modules,
    status: job.status,
    command: job.command,
    result: job.result,
    error: job.error,
    startedAt: job.startedAt,
    completedAt: job.completedAt
  };
}

function _plain(row) {
  const plain = typeof row.toJSON === "function" ? row.toJSON() : row;
  for (const key of ["createdAt", "updatedAt", "lastSeenAt", "startedAt", "completedAt"]) {
    if (plain[key] instanceof Date) plain[key] = plain[key].toISOString();
  }
  
  // Dynamically set offline status if heartbeat missed
  // Increased to 10 minutes (600000) to account for long synchronous scans blocking heartbeats
  if (plain.lastSeenAt && plain.status === "online") {
    const lastSeen = new Date(plain.lastSeenAt).getTime();
    if (Date.now() - lastSeen > 600000) {
      plain.status = "offline";
    }
  }
  
  return plain;
}

function adaptAgentScanToModule(agentJob, module) {
  if (!agentJob || !agentJob.command || !agentJob.command.modules || !agentJob.command.modules.includes(module)) return null;
  
  let result = null;
  let status = agentJob.status;
  if (agentJob.result && Array.isArray(agentJob.result.reports)) {
    const report = agentJob.result.reports.find(r => r.module === module);
    if (report) {
       result = report.result || null;
       status = report.status === "completed" ? "completed" : report.status === "failed" ? "failed" : status;
    }
  }

  return {
    id: agentJob.id,
    userId: agentJob.userId,
    scannerType: module,
    sourceType: "vm-agent",
    sourceLabel: agentJob.command.paths ? agentJob.command.paths[0] : "VM Agent Scan",
    status: status,
    result: result,
    error: agentJob.error,
    createdAt: agentJob.createdAt,
    completedAt: agentJob.completedAt,
    isVmAgent: true,
  };
}

async function queueAgentBrowseCommand(userId, agentId, path) {
  const agent = await getAgent(userId, agentId);
  if (!agent) return null;

  const requestId = randomUUID();
  const command = {
    requestId,
    agentId,
    type: "browse",
    path,
    status: "pending",
    result: null,
    createdAt: new Date().toISOString()
  };
  memoryInteractiveCommands.set(requestId, command);
  return { requestId };
}

async function submitAgentBrowseResult(agentId, requestId, result) {
  const command = memoryInteractiveCommands.get(requestId);
  if (!command || command.agentId !== agentId) return null;

  command.status = "completed";
  command.result = result;
  command.completedAt = new Date().toISOString();
  return command;
}

async function getAgentBrowseResult(userId, agentId, requestId) {
  const command = memoryInteractiveCommands.get(requestId);
  if (!command || command.agentId !== agentId) return null;
  
  if (command.status === "completed") {
    return { pending: false, result: command.result };
  }
  return { pending: true };
}

module.exports = {
  listAgents,
  getAgent,
  getAgentById,
  registerAgent,
  heartbeatAgent,
  cleanupDemoAgents,
  startAgentScan,
  stopAgentScan,
  getAgentCommands,
  appendAgentLog,
  updateAgentScanStatus,
  completeAgentScan,
  listAgentScans,
  getAgentScan,
  adaptAgentScanToModule,
  queueAgentBrowseCommand,
  submitAgentBrowseResult,
  getAgentBrowseResult,
};
