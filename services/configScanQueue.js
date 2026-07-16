// Queue transport for configuration jobs. This file belongs to the Node main
// backend; the FastAPI Configuration Scanner remains local-only and never
// imports or contacts Redis/Upstash.
const fs = require("fs");
const path = require("path");
const { createClient } = require("redis");
const { Redis } = require("@upstash/redis");

const env = require("../config/env");

const stream = process.env.CONFIG_REDIS_STREAM || "bugbusters:config-scan-jobs";
const deadLetterStream = process.env.CONFIG_REDIS_DLQ_STREAM || "bugbusters:config-scan-jobs:dead-letter";
const group = process.env.CONFIG_REDIS_GROUP || "bugbusters-config-workers";
const consumerPrefix = process.env.CONFIG_REDIS_CONSUMER || `${process.env.HOSTNAME || "backend"}-${process.pid}`;
let redisPromise = null;
let redisWorkerStarted = false;
let localStarted = false;
let localHandler = null;
let localActive = 0;
const localPending = new Map();
const localWaiters = new Map();
const workerState = { started: false, transport: "stopped", active: 0, pending: 0, consumers: 0, lastActivityAt: null };

function redisAllowed() {
  return env.redis.enabled && (!env.banking?.strictOffline || env.banking?.allowMetadataRedisQueue === true);
}

function queueDir() { return env.configScanQueueDir || path.join(env.workspaceDir, ".config-scan-queue"); }
function taskPath(jobId) { return path.join(queueDir(), `${jobId}.json`); }
function concurrency() { return Math.max(1, Math.min(8, Number(process.env.CONFIG_SCAN_WORKER_CONCURRENCY || env.redis.concurrency || 2))); }

function safeInput(input = {}) {
  const copy = { ...input };
  delete copy.githubToken;
  delete copy.githubSession;
  return copy;
}

function persistLocal(jobId, input, attempts = 0) {
  fs.mkdirSync(queueDir(), { recursive: true, mode: 0o700 });
  const target = taskPath(jobId);
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ jobId, input: safeInput(input), attempts, queuedAt: new Date().toISOString() }), { mode: 0o600 });
  fs.renameSync(temporary, target);
}

async function enqueueConfigScan(jobId, input) {
  if (redisAllowed()) {
    const queue = await getRedisQueue();
    await queue.add(stream, {
      type: "config-scan",
      jobId,
      attempts: "0",
      payload: JSON.stringify(safeInput(input)),
      queuedAt: new Date().toISOString()
    });
    workerState.lastActivityAt = new Date().toISOString();
    return true;
  }

  const maxPending = Math.max(1, Number(process.env.CONFIG_SCAN_MAX_QUEUE_DEPTH || 100));
  if (localPending.size + localActive >= maxPending) {
    const error = new Error("Local configuration scan queue is full; retry later");
    error.statusCode = 429;
    throw error;
  }
  persistLocal(jobId, input, 0);
  localPending.set(jobId, { jobId, input: { ...input, githubToken: input.githubToken }, attempts: 0 });
  const result = new Promise((resolve, reject) => {
    const entries = localWaiters.get(jobId) || [];
    entries.push({ resolve, reject });
    localWaiters.set(jobId, entries);
  });
  pumpLocal();
  return result;
}

async function startConfigScanWorker(handler) {
  if (redisAllowed()) return startRedisWorker(handler);
  if (localStarted) return false;
  localHandler = handler;
  localStarted = true;
  workerState.started = true;
  workerState.transport = "local";
  fs.mkdirSync(queueDir(), { recursive: true, mode: 0o700 });
  for (const file of fs.readdirSync(queueDir()).filter((name) => name.endsWith(".json"))) {
    try {
      const task = JSON.parse(fs.readFileSync(path.join(queueDir(), file), "utf8"));
      if (task?.jobId && task?.input) localPending.set(task.jobId, task);
    } catch (error) {
      console.error(`Unable to recover local configuration task ${file}:`, error.message);
    }
  }
  pumpLocal();
  console.log(`Local configuration workers started: ${concurrency()}`);
  return true;
}

async function getRedisQueue() {
  if (!redisAllowed()) return null;
  if (!redisPromise) {
    if (env.redis.provider === "upstash-rest" || (env.redis.upstashUrl && env.redis.upstashToken)) {
      redisPromise = Promise.resolve(adapter("upstash", new Redis({ url: env.redis.upstashUrl, token: env.redis.upstashToken })));
    } else {
      const client = createClient({
        url: env.redis.url,
        database: env.redis.database,
        socket: env.redis.url ? (env.redis.tls ? { tls: true } : undefined) : { host: env.redis.host, port: env.redis.port, tls: env.redis.tls },
        username: env.redis.username,
        password: env.redis.password
      });
      client.on("error", (error) => console.error("Configuration Redis queue error:", error.message));
      redisPromise = client.connect().then(() => adapter("tcp", client));
    }
  }
  return redisPromise;
}

async function startRedisWorker(handler) {
  if (redisWorkerStarted) return false;
  const queue = await getRedisQueue();
  await queue.createGroup(stream, group);
  redisWorkerStarted = true;
  workerState.started = true;
  workerState.transport = queue.kind;
  workerState.consumers = concurrency();
  for (let i = 0; i < concurrency(); i += 1) {
    consume(queue, handler, `${consumerPrefix}-${i}`).catch((error) => {
      console.error("Configuration Redis worker stopped:", error.message);
      redisWorkerStarted = false;
    });
  }
  console.log(`Redis configuration workers started: ${concurrency()} (${queue.kind}); metadata-only payloads`);
  return true;
}

async function consume(queue, handler, consumer) {
  let lastClaim = 0;
  while (true) {
    if (Date.now() - lastClaim >= env.redis.claimIdleMs) {
      lastClaim = Date.now();
      await processMessages(queue, handler, await queue.claim(consumer));
    }
    const messages = await queue.read(group, consumer);
    if (!messages?.length) {
      if (queue.kind === "upstash") await delay(env.redis.pollMs);
      continue;
    }
    await processMessages(queue, handler, messages);
  }
}

async function processMessages(queue, handler, streams) {
  for (const item of streams || []) {
    for (const message of item.messages || []) {
      const fields = message.message || message[1] || {};
      try {
        workerState.lastActivityAt = new Date().toISOString();
        if (fields.type !== "config-scan") throw new Error(`Unknown configuration job type: ${fields.type}`);
        await handler(fields.jobId, { ...JSON.parse(fields.payload || "{}"), throwOnFailure: true });
        await queue.ack(message.id);
      } catch (error) {
        const attempts = Number(fields.attempts || 0) + 1;
        if (attempts < env.redis.maxAttempts) {
          await queue.add(stream, { ...fields, attempts: String(attempts), retryOf: message.id, retryAt: new Date().toISOString() });
        } else {
          await queue.add(deadLetterStream, { jobId: fields.jobId || "unknown", attempts: String(attempts), error: String(error.message || "worker failure").slice(0, 1000), failedAt: new Date().toISOString() });
        }
        await queue.ack(message.id);
        console.error(`Configuration scan ${fields.jobId || message.id} attempt ${attempts} failed:`, error.message);
      }
    }
  }
}

function adapter(kind, client) {
  if (kind === "upstash") {
    return {
      kind,
      client,
      async add(key, fields) { return client.xadd(key, "*", fields); },
      async createGroup(key, name) { try { return await client.xgroup(key, { type: "CREATE", group: name, id: "0", options: { MKSTREAM: true } }); } catch (error) { if (!String(error.message).includes("BUSYGROUP")) throw error; return null; } },
      async read(name, consumer) { return client.xreadgroup(name, consumer, stream, ">", { count: 1 }); },
      async claim(consumer) { const result = await client.xautoclaim(stream, group, consumer, env.redis.claimIdleMs, "0-0", { count: 1 }); return Array.isArray(result) ? [{ name: stream, messages: result[1] || [] }] : []; },
      async ack(id) { return client.xack(stream, group, id); }
    };
  }
  return {
    kind,
    client,
    async add(key, fields) { return client.xAdd(key, "*", fields); },
    async createGroup(key, name) { try { return await client.xGroupCreate(key, name, "0", { MKSTREAM: true }); } catch (error) { if (!String(error.message).includes("BUSYGROUP")) throw error; return null; } },
    async read(name, consumer) { return client.xReadGroup(name, consumer, [{ key: stream, id: ">" }], { COUNT: 1, BLOCK: env.redis.blockMs }); },
    async claim(consumer) { const result = await client.xAutoClaim(stream, group, consumer, env.redis.claimIdleMs, "0-0", { COUNT: 1 }); return [{ name: stream, messages: result.messages || [] }]; },
    async ack(id) { return client.xAck(stream, group, id); }
  };
}

function pumpLocal() {
  if (!localStarted || !localHandler) return;
  while (localActive < concurrency() && localPending.size) {
    const task = localPending.values().next().value;
    localPending.delete(task.jobId);
    localActive += 1;
    workerState.active = localActive;
    workerState.pending = localPending.size;
    Promise.resolve(localHandler(task.jobId, { ...task.input, throwOnFailure: true }))
      .then((result) => finishLocal(task.jobId, null, result))
      .catch((error) => {
        const attempts = Number(task.attempts || 0) + 1;
        if (attempts < env.redis.maxAttempts) {
          persistLocal(task.jobId, task.input, attempts);
          localPending.set(task.jobId, { ...task, attempts });
          console.error(`Local configuration scan ${task.jobId} attempt ${attempts} failed; retrying:`, error.message);
        } else {
          const deadLetter = path.join(queueDir(), `${task.jobId}.dead-letter.json`);
          try {
            fs.writeFileSync(deadLetter, JSON.stringify({ jobId: task.jobId, attempts, error: String(error.message || "worker failure").slice(0, 1000), failedAt: new Date().toISOString() }), { mode: 0o600 });
          } catch (writeError) {
            console.error(`Unable to persist local configuration dead letter ${task.jobId}:`, writeError.message);
          }
          finishLocal(task.jobId, error);
          console.error(`Local configuration scan ${task.jobId} exhausted retries:`, error.message);
        }
      })
      .finally(() => { localActive -= 1; workerState.active = localActive; workerState.pending = localPending.size; pumpLocal(); });
  }
}

function finishLocal(jobId, error, result) {
  try { fs.rmSync(taskPath(jobId), { force: true }); } catch (_error) { /* best effort */ }
  const entries = localWaiters.get(jobId) || [];
  localWaiters.delete(jobId);
  for (const entry of entries) error ? entry.reject(error) : entry.resolve(result);
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function getConfigScanQueueStatus() {
  return { ...workerState, active: localActive, pending: localPending.size, capturedAt: new Date().toISOString() };
}

module.exports = { enqueueConfigScan, startConfigScanWorker, getConfigScanQueueStatus };
