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
  updateAgentScanStatus,
  queueAgentBrowseCommand,
  submitAgentBrowseResult,
  getAgentBrowseResult
} = require("../services/agentService");
const { getLogs, subscribe } = require("../services/logStreamService");
const { spawnAgent, killAgent } = require("../services/spawnService");

async function registerVmAgent(req, res, next) {
  try {
    const { mfaCode, ownerEmail, ...agentData } = req.body;
    if (!mfaCode) return res.status(400).json({ error: "MFA code is required to register." });
    if (!ownerEmail) return res.status(400).json({ error: "ownerEmail is required to register." });

    const { User } = require("../models");
    const { decrypt, verifyTotp } = require("../services/mfaService");
    const env = require("../config/env");

    const user = await User.findOne({ where: { email: ownerEmail } });
    if (!user) return res.status(404).json({ error: "User not found." });

    if (!user.mfaSecretEncrypted || !user.mfaEnabled) {
      return res.status(403).json({ error: "MFA must be enabled for this user." });
    }

    const secret = decrypt(user.mfaSecretEncrypted, env.identity.mfaEncryptionKey);
    if (!verifyTotp(secret, mfaCode)) {
      return res.status(401).json({ error: "Invalid MFA code." });
    }

    const agent = await registerAgent({ ...agentData, ownerEmail });
    res.status(201).json({ ...agent, token: env.agentToken });
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

async function streamAgentScanLogs(req, res, next) {
  try {
    const { scanId } = req.params;
    const job = await getAgentScan(req.user.id, scanId);
    if (!job) {
      return res.status(404).json({ message: "Agent scan not found" });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const previousLogs = getLogs(scanId);
    for (const entry of previousLogs) {
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    }

    const unsubscribe = subscribe(scanId, (entry) => {
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    });

    req.on("close", unsubscribe);
  } catch (error) {
    next(error);
  }
}

async function connectAgent(req, res, next) {
  try {
    const { mfaCode } = req.body;
    if (!mfaCode) return res.status(400).json({ error: "MFA code is required from your Authenticator app." });

    const { User } = require("../models");
    const { decrypt, verifyTotp } = require("../services/mfaService");
    const env = require("../config/env");

    const user = await User.findByPk(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (!user.mfaSecretEncrypted || !user.mfaEnabled) {
      return res.status(403).json({ error: "MFA must be enabled to connect to a VM agent." });
    }

    const secret = decrypt(user.mfaSecretEncrypted, env.identity.mfaEncryptionKey);
    if (!verifyTotp(secret, mfaCode)) {
      return res.status(401).json({ error: "Invalid MFA code." });
    }

    res.json(spawnAgent(mfaCode, req.user?.email || "auto@bugbusters.local"));
  } catch (error) {
    next(error);
  }
}

async function disconnectAgent(req, res, next) {
  try {
    const { listAgents, heartbeatAgent } = require("../services/agentService");
    const agents = await listAgents(req.user.id);
    for (const a of agents) {
      if (a.status === 'online' && !a.hostname.includes("demo")) {
        await heartbeatAgent(a.id, { status: 'offline' });
      }
    }
    res.json(killAgent());
  } catch (error) {
    next(error);
  }
}

async function requestAgentBrowse(req, res, next) {
  try {
    const { path } = req.body;
    if (!path) return res.status(400).json({ error: "Path is required" });
    const response = await queueAgentBrowseCommand(req.user.id, req.params.agentId, path);
    if (!response) return res.status(404).json({ message: "Agent not found" });
    res.json(response);
  } catch (error) {
    next(error);
  }
}

async function pollAgentBrowse(req, res, next) {
  try {
    const response = await getAgentBrowseResult(req.user.id, req.params.agentId, req.params.requestId);
    if (!response) return res.status(404).json({ message: "Agent or request not found" });
    res.json(response);
  } catch (error) {
    next(error);
  }
}

async function postAgentBrowseResult(req, res, next) {
  try {
    const response = await submitAgentBrowseResult(req.params.agentId, req.params.requestId, req.body.result);
    if (!response) return res.status(404).json({ message: "Agent or request not found" });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
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
  streamAgentScanLogs,
  connectAgent,
  disconnectAgent,
  requestAgentBrowse,
  pollAgentBrowse,
  postAgentBrowseResult
};
