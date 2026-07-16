const fs = require("fs");
const path = require("path");
const { createClient } = require("redis");
const { Redis } = require("@upstash/redis");

const env = require("../config/env");
const metrics = require("./operationalMetricsService");
const runtimeEnv = globalThis.process?.env || {};

const stream = runtimeEnv.SECRET_REDIS_STREAM || "bugbusters:secret-scan-jobs";
const deadLetterStream = runtimeEnv.SECRET_REDIS_DLQ_STREAM || "bugbusters:secret-scan-jobs:dead-letter";
const group = runtimeEnv.SECRET_REDIS_GROUP || "bugbusters-secret-workers";
const consumerPrefix = runtimeEnv.SECRET_REDIS_CONSUMER || `${runtimeEnv.HOSTNAME || "backend"}-${globalThis.process?.pid || "0"}`;
const queueDir = () => env.secretScanQueueDir || path.join(env.workspaceDir, ".secret-scan-queue");
const concurrency = () => Math.max(1, Math.min(8, Number(runtimeEnv.SECRET_SCAN_WORKER_CONCURRENCY || env.redis.concurrency || 2)));

let redisPromise = null;
let workerStarted = false;
let localStarted = false;
let localHandler = null;
let localActive = 0;
const localPending = new Map();
const workerState = { started: false, transport: "stopped", active: 0, pending: 0, consumers: 0, lastActivityAt: null, lastError: null };

function redisAllowed() {
  return env.redis.enabled && (!env.banking?.strictOffline || env.banking?.allowMetadataRedisQueue === true);
}

function safeInput(input = {}) {
  const copy = { ...input };
  delete copy.githubToken;
  delete copy.githubSession;
  return copy;
}

function persistLocal(jobId, input, attempts = 0) {
  fs.mkdirSync(queueDir(), { recursive: true, mode: 0o700 });
  const target = path.join(queueDir(), `${jobId}.json`);
  const temp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ jobId, input: safeInput(input), attempts }), { mode: 0o600 });
  fs.renameSync(temp, target);
}

async function getQueue() {
  if (!redisAllowed()) return null;
  if (!redisPromise) {
    if (env.redis.provider === "upstash-rest" || (env.redis.upstashUrl && env.redis.upstashToken)) {
      redisPromise = Promise.resolve(adapter("upstash", new Redis({ url: env.redis.upstashUrl, token: env.redis.upstashToken })));
    } else {
      const client = createClient({
        url: env.redis.url,
        database: env.redis.database,
        socket: {
          ...(env.redis.url ? {} : { host: env.redis.host, port: env.redis.port }),
          ...(env.redis.tls ? { tls: true } : {}),
          connectTimeout: Math.max(1000, Number(runtimeEnv.SECRET_REDIS_CONNECT_TIMEOUT_MS || 3000)),
          reconnectStrategy: false
        },
        username: env.redis.username,
        password: env.redis.password
      });
      client.on("error", (error) => console.error("Secret Redis queue error:", error.message));
      redisPromise = client.connect().then(() => adapter("tcp", client));
    }
  }
  return redisPromise;
}

async function enqueueSecretScan(jobId, input) {
  if (redisAllowed()) {
    try {
      const queue = await getQueue();
      await queue.add({ type: "secret-scan", jobId, attempts: "0", payload: JSON.stringify(safeInput(input)), queuedAt: new Date().toISOString() });
      workerState.lastActivityAt = new Date().toISOString();
      metrics.increment("secret_queue_enqueued_total");
      return true;
    } catch (error) {
      workerState.lastError = String(error.message || "Redis enqueue failure").slice(0, 500);
      metrics.increment("secret_queue_redis_enqueue_failures_total");
      if (!localStarted) throw error;
      metrics.increment("secret_queue_failover_total");
      return enqueueLocal(jobId, input);
    }
  }
  return enqueueLocal(jobId, input);
}

function enqueueLocal(jobId, input) {
  if (!localStarted) throw new Error("Secret scan worker is not started");
  if (localPending.size + localActive >= Math.max(1, Number(runtimeEnv.SECRET_SCAN_MAX_QUEUE_DEPTH || 100))) {
    const error = new Error("Local secret scan queue is full; retry later");
    error.statusCode = 429;
    throw error;
  }
  persistLocal(jobId, input);
  localPending.set(jobId, { jobId, input: { ...input }, attempts: 0 });
  workerState.pending = localPending.size;
  metrics.increment("secret_queue_local_enqueued_total");
  pumpLocal();
  return true;
}

async function startSecretScanWorker(handler) {
  if (redisAllowed()) {
    if (workerStarted) return false;
    try {
      const queue = await getQueue();
      await queue.createGroup();
      workerStarted = true;
      workerState.started = true;
      workerState.transport = queue.kind;
      workerState.consumers = concurrency();
      metrics.increment("secret_queue_worker_starts_total");
      for (let i = 0; i < concurrency(); i += 1) consume(queue, handler, `${consumerPrefix}-${i}`).catch((error) => { workerState.lastError = String(error.message || "Redis worker stopped").slice(0, 500); metrics.increment("secret_queue_worker_failures_total"); console.error("Secret Redis worker stopped; enabling local failover:", error.message); workerStarted = false; startLocalWorker(handler, "local-failover"); });
      return true;
    } catch (error) {
      workerState.lastError = String(error.message || "Redis worker startup failure").slice(0, 500);
      metrics.increment("secret_queue_redis_start_failures_total");
      console.error("Secret Redis unavailable; switching to durable local queue:", error.message);
      return startLocalWorker(handler, "local-failover");
    }
  }
  return startLocalWorker(handler, "local");
}

function startLocalWorker(handler, transport) {
  if (localStarted) return false;
  localHandler = handler;
  localStarted = true;
  workerState.started = true;
  workerState.transport = transport;
  workerState.consumers = concurrency();
  fs.mkdirSync(queueDir(), { recursive: true, mode: 0o700 });
  for (const file of fs.readdirSync(queueDir()).filter((name) => name.endsWith(".json"))) {
    try { const task = JSON.parse(fs.readFileSync(path.join(queueDir(), file), "utf8")); if (task.jobId && task.input) localPending.set(task.jobId, task); } catch (error) { console.error(`Unable to recover local secret task ${file}:`, error.message); }
  }
  pumpLocal();
  metrics.increment("secret_queue_worker_starts_total");
  return true;
}

async function consume(queue, handler, consumer) {
  while (true) {
    const reclaimed = await queue.claim(consumer);
    await process(queue, handler, reclaimed);
    const messages = await queue.read(consumer);
    if (!messages?.length && queue.kind === "upstash") await new Promise((resolve) => setTimeout(resolve, env.redis.pollMs));
    await process(queue, handler, messages);
  }
}

async function process(queue, handler, streams) {
  for (const streamItem of streams || []) for (const message of streamItem.messages || []) {
    const fields = message.message || message[1] || {};
    try {
      if (fields.type !== "secret-scan") throw new Error(`Unknown secret job type: ${fields.type}`);
      await handler(fields.jobId, JSON.parse(fields.payload || "{}"));
      await queue.ack(message.id);
      metrics.increment("secret_queue_jobs_completed_total");
    } catch (error) {
      const attempts = Number(fields.attempts || 0) + 1;
      metrics.increment("secret_queue_jobs_failed_total");
      if (attempts < env.redis.maxAttempts) {
        const delayMs = Math.min(30000, Math.max(100, Number(runtimeEnv.SECRET_SCAN_RETRY_BASE_MS || 1000) * (2 ** (attempts - 1))));
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        await queue.add({ ...fields, attempts: String(attempts), retryOf: message.id, retryAt: new Date().toISOString() });
        metrics.increment("secret_queue_retries_total");
      } else {
        await queue.addDead({ jobId: fields.jobId || "unknown", attempts: String(attempts), error: String(error.message || "worker failure").slice(0, 1000), failedAt: new Date().toISOString() });
        metrics.increment("secret_queue_dead_letters_total");
      }
      await queue.ack(message.id);
    }
  }
}

function pumpLocal() {
  while (localStarted && localHandler && localActive < concurrency() && localPending.size) {
    const task = localPending.values().next().value;
    localPending.delete(task.jobId); localActive += 1; workerState.active = localActive; workerState.pending = localPending.size; workerState.lastActivityAt = new Date().toISOString();
    let retainTaskFile = false;
    Promise.resolve(localHandler(task.jobId, { ...task.input, throwOnFailure: true }))
      .then(() => metrics.increment("secret_queue_jobs_completed_total"))
      .catch((error) => {
        const attempts = Number(task.attempts || 0) + 1;
        metrics.increment("secret_queue_jobs_failed_total");
        if (attempts < env.redis.maxAttempts) { persistLocal(task.jobId, task.input, attempts); localPending.set(task.jobId, { ...task, attempts }); retainTaskFile = true; metrics.increment("secret_queue_retries_total"); }
        else { try { fs.writeFileSync(path.join(queueDir(), `${task.jobId}.dead-letter.json`), JSON.stringify({ jobId: task.jobId, attempts, error: String(error.message || "worker failure").slice(0, 1000), failedAt: new Date().toISOString() }), { mode: 0o600 }); metrics.increment("secret_queue_dead_letters_total"); } catch (_error) {} }
      })
      .finally(() => { localActive -= 1; workerState.active = localActive; workerState.pending = localPending.size; if (!retainTaskFile) { try { fs.rmSync(path.join(queueDir(), `${task.jobId}.json`), { force: true }); } catch (_error) {} } pumpLocal(); });
  }
}

function adapter(kind, client) {
  if (kind === "upstash") return {
    kind, client,
    add(fields) { return client.xadd(stream, "*", fields); },
    addDead(fields) { return client.xadd(deadLetterStream, "*", fields); },
    async createGroup() { try { return await client.xgroup(stream, { type: "CREATE", group, id: "0", options: { MKSTREAM: true } }); } catch (error) { if (!String(error.message).includes("BUSYGROUP")) throw error; } },
    read(consumer) { return client.xreadgroup(group, consumer, stream, ">", { count: 1 }); },
    async claim(consumer) { const result = await client.xautoclaim(stream, group, consumer, env.redis.claimIdleMs, "0-0", { count: 1 }); return Array.isArray(result) ? [{ name: stream, messages: result[1] || [] }] : []; },
    ack(id) { return client.xack(stream, group, id); }
  };
  return {
    kind, client,
    add(fields) { return client.xAdd(stream, "*", fields); },
    addDead(fields) { return client.xAdd(deadLetterStream, "*", fields); },
    async createGroup() { try { return await client.xGroupCreate(stream, group, "0", { MKSTREAM: true }); } catch (error) { if (!String(error.message).includes("BUSYGROUP")) throw error; } },
    read(consumer) { return client.xReadGroup(group, consumer, [{ key: stream, id: ">" }], { COUNT: 1, BLOCK: env.redis.blockMs }); },
    async claim(consumer) { const result = await client.xAutoClaim(stream, group, consumer, env.redis.claimIdleMs, "0-0", { COUNT: 1 }); return [{ name: stream, messages: result.messages || [] }]; },
    ack(id) { return client.xAck(stream, group, id); }
  };
}

module.exports = { enqueueSecretScan, startSecretScanWorker };

module.exports.getSecretScanQueueStatus = function getSecretScanQueueStatus() {
  return {
    ...workerState,
    started: redisAllowed() ? workerStarted || localStarted : localStarted,
    transport: workerState.transport,
    active: localActive,
    pending: localPending.size,
    capturedAt: new Date().toISOString()
  };
};
