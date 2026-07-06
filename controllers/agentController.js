const {
  getAgent,
  appendAgentLog,
  completeAgentScan,
  getAgentCommands,
  getAgentScan,
  heartbeatAgent,
  listAgentScans,
  listAgents,
  registerAgent,
  startAgentScan,
  stopAgentScan,
  updateAgentScanStatus
} = require("../services/agentService");
const { getLogs, subscribe } = require("../services/logStreamService");

async function registerVmAgent(req, res, next) {
  try {
    res.status(201).json(await registerAgent(req.body || {}));
  } catch (error) {
    next(error);
  }
}

async function heartbeatVmAgent(req, res, next) {
  try {
    const agent = await heartbeatAgent(req.params.agentId, req.body || {});
    if (!agent) return res.status(404).json({ message: "Agent not found" });
    res.json(agent);
  } catch (error) {
    next(error);
  }
}

async function pollAgentCommands(req, res, next) {
  try {
    const payload = await getAgentCommands(req.params.agentId);
    if (!payload) return res.status(404).json({ message: "Agent not found" });
    res.json(payload);
  } catch (error) {
    next(error);
  }
}

async function postAgentLog(req, res, next) {
  try {
    const job = await appendAgentLog(req.params.agentId, req.params.scanId, req.body || {});
    if (!job) return res.status(404).json({ message: "Agent scan not found" });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
}

async function postAgentScanStatus(req, res, next) {
  try {
    const job = await updateAgentScanStatus(req.params.agentId, req.params.scanId, req.body || {});
    if (!job) return res.status(404).json({ message: "Agent scan not found" });
    res.json(job);
  } catch (error) {
    next(error);
  }
}

async function postAgentScanResult(req, res, next) {
  try {
    const job = await completeAgentScan(req.params.agentId, req.params.scanId, req.body || {});
    if (!job) return res.status(404).json({ message: "Agent scan not found" });
    res.json({ ...job, logs: getLogs(job.id) });
  } catch (error) {
    next(error);
  }
}

async function getAgents(req, res, next) {
  try {
    res.json(await listAgents(req.user.id));
  } catch (error) {
    next(error);
  }
}

async function getAgentInventory(req, res, next) {
  try {
    const agent = await getAgent(req.user.id, req.params.agentId);
    if (!agent) return res.status(404).json({ message: "Agent not found" });
    res.json({
      agent,
      inventory: agent.inventory || { paths: [], services: [], ports: [] }
    });
  } catch (error) {
    next(error);
  }
}

async function getAgentScanReports(req, res, next) {
  try {
    res.json(await listAgentScans(req.user.id, { limit: 100 }));
  } catch (error) {
    next(error);
  }
}

async function getAgentScans(req, res, next) {
  try {
    const agent = await getAgent(req.user.id, req.params.agentId);
    if (!agent) return res.status(404).json({ message: "Agent not found" });
    res.json(await listAgentScans(req.user.id, { agentId: agent.id, limit: 100 }));
  } catch (error) {
    next(error);
  }
}

async function createAgentScan(req, res, next) {
  try {
    const job = await startAgentScan(req.user.id, req.params.agentId, req.body || {});
    if (!job) return res.status(404).json({ message: "Agent not found" });
    res.status(202).json({ ...job, logs: getLogs(job.id) });
  } catch (error) {
    next(error);
  }
}

async function getAgentScanJob(req, res, next) {
  try {
    const job = await getAgentScan(req.user.id, req.params.scanId);
    if (!job) return res.status(404).json({ message: "Agent scan not found" });
    res.json({ ...job, logs: getLogs(job.id) });
  } catch (error) {
    next(error);
  }
}

async function stopAgentScanJob(req, res, next) {
  try {
    const job = await stopAgentScan(req.user.id, req.params.scanId);
    if (!job) return res.status(404).json({ message: "Agent scan not found" });
    res.json({ ...job, logs: getLogs(job.id) });
  } catch (error) {
    next(error);
  }
}

async function streamAgentScanLogs(req, res) {
  const job = await getAgentScan(req.user.id, req.params.scanId);
  if (!job) {
    return res.status(404).json({ message: "Agent scan not found" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  for (const entry of getLogs(job.id)) {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  }

  const unsubscribe = subscribe(job.id, (entry) => {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  });

  req.on("close", unsubscribe);
}

module.exports = {
  registerVmAgent,
  heartbeatVmAgent,
  pollAgentCommands,
  postAgentLog,
  postAgentScanStatus,
  postAgentScanResult,
  getAgents,
  getAgentInventory,
  getAgentScanReports,
  getAgentScans,
  createAgentScan,
  getAgentScanJob,
  stopAgentScanJob,
  streamAgentScanLogs
};
