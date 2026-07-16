const fs = require("fs");
const path = require("path");
const { createClient } = require("redis");
const { Redis } = require("@upstash/redis");

const env = require("../config/env");
const metrics = require("./operationalMetricsService");

const stream = process.env.CIPHER_REDIS_STREAM || "bugbusters:cipher-scan-jobs";
const deadLetterStream = process.env.CIPHER_REDIS_DLQ_STREAM || "bugbusters:cipher-scan-jobs:dead-letter";
const group = process.env.CIPHER_REDIS_GROUP || "bugbusters-cipher-workers";
const queueDir = () => path.join(env.workspaceDir, ".cipher-scan-queue");
const concurrency = () => Math.max(1, Math.min(8, Number(process.env.CIPHER_SCAN_WORKER_CONCURRENCY || env.redis.concurrency || 2)));
const maxQueueDepth = () => Math.max(1, Number(process.env.CIPHER_SCAN_MAX_QUEUE_DEPTH || 100));
const maxAttempts = () => Math.max(1, Number(process.env.CIPHER_SCAN_MAX_ATTEMPTS || env.redis.maxAttempts || 3));

let redisPromise = null;
let redisWorkerStarted = false;
let localStarted = false;
let localHandler = null;
let localActive = 0;
const localPending = new Map();
const workerState = { started: false, transport: "stopped", active: 0, pending: 0, consumers: 0, lastError: null };

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
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ jobId, input: safeInput(input), attempts }), { mode: 0o600 });
  fs.renameSync(temporary, target);
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
        socket: env.redis.url ? undefined : { host: env.redis.host, port: env.redis.port, tls: env.redis.tls },
        username: env.redis.username,
        password: env.redis.password
      });
      client.on("error", (error) => { workerState.lastError = error.message; console.error("Cipher Redis queue error:", error.message); });
      redisPromise = client.connect().then(() => adapter("tcp", client));
    }
  }
  return redisPromise;
}

async function enqueueCipherScan(jobId, input) {
  if (redisAllowed()) {
    try {
      const queue = await getQueue();
      await queue.add({ type: "cipher-scan", jobId, attempts: "0", payload: JSON.stringify(safeInput(input)), queuedAt: new Date().toISOString() });
      metrics.increment("cipher_queue_enqueued_total");
      return true;
    } catch (error) {
      workerState.lastError = String(error.message || "Redis enqueue failure").slice(0, 500);
      metrics.increment("cipher_queue_redis_enqueue_failures_total");
      if (!localStarted) throw error;
    }
  }
  if (!localStarted) throw new Error("Cipher scan worker is not started");
  if (localPending.size + localActive >= maxQueueDepth()) {
    const error = new Error("Local cipher scan queue is full; retry later");
    error.statusCode = 429;
    throw error;
  }
  persistLocal(jobId, input);
  localPending.set(jobId, { jobId, input: safeInput(input), attempts: 0 });
  workerState.pending = localPending.size;
  metrics.increment("cipher_queue_local_enqueued_total");
  pumpLocal();
  return true;
}

async function startCipherScanWorker(handler) {
  if (redisAllowed()) {
    try {
      if (redisWorkerStarted) return false;
      const queue = await getQueue();
      await queue.createGroup();
      redisWorkerStarted = true;
      workerState.started = true;
      workerState.transport = queue.kind;
      workerState.consumers = concurrency();
      for (let index = 0; index < concurrency(); index += 1) consume(queue, handler, `${process.env.HOSTNAME || "backend"}-${process.pid}-${index}`).catch((error) => {
        workerState.lastError = String(error.message || "Cipher worker stopped").slice(0, 500);
        redisWorkerStarted = false;
        startLocalWorker(handler, "local-failover");
      });
      return true;
    } catch (error) {
      workerState.lastError = String(error.message || "Cipher Redis startup failure").slice(0, 500);
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
    try {
      const task = JSON.parse(fs.readFileSync(path.join(queueDir(), file), "utf8"));
      if (task.jobId && task.input) localPending.set(task.jobId, task);
    } catch (error) { workerState.lastError = error.message; }
  }
  pumpLocal();
  return true;
}

async function consume(queue, handler, consumer) {
  while (true) {
    await processMessages(queue, handler, await queue.claim(consumer));
    const messages = await queue.read(consumer);
    if (!messages?.length && queue.kind === "upstash") await delay(env.redis.pollMs);
    await processMessages(queue, handler, messages);
  }
}

async function processMessages(queue, handler, streams) {
  for (const streamItem of streams || []) for (const message of streamItem.messages || []) {
    const fields = message.message || message[1] || {};
    try {
      if (fields.type !== "cipher-scan") throw new Error(`Unknown cipher job type: ${fields.type}`);
      await handler(fields.jobId, JSON.parse(fields.payload || "{}"));
      await queue.ack(message.id);
      metrics.increment("cipher_queue_jobs_completed_total");
    } catch (error) {
      const attempts = Number(fields.attempts || 0) + 1;
      metrics.increment("cipher_queue_jobs_failed_total");
      if (attempts < maxAttempts()) {
        await delay(Math.min(30000, 1000 * (2 ** (attempts - 1))));
        await queue.add({ ...fields, attempts: String(attempts), retryOf: message.id, retryAt: new Date().toISOString() });
        metrics.increment("cipher_queue_retries_total");
      } else {
        await queue.addDead({ jobId: fields.jobId || "unknown", attempts: String(attempts), error: String(error.message || "worker failure").slice(0, 1000), failedAt: new Date().toISOString() });
        metrics.increment("cipher_queue_dead_letters_total");
      }
      await queue.ack(message.id);
    }
  }
}

function pumpLocal() {
  while (localStarted && localHandler && localActive < concurrency() && localPending.size) {
    const task = localPending.values().next().value;
    localPending.delete(task.jobId);
    localActive += 1;
    workerState.active = localActive;
    workerState.pending = localPending.size;
    Promise.resolve(localHandler(task.jobId, { ...task.input, throwOnFailure: true }))
      .then(() => metrics.increment("cipher_queue_jobs_completed_total"))
      .catch((error) => {
        const attempts = Number(task.attempts || 0) + 1;
        metrics.increment("cipher_queue_jobs_failed_total");
        if (attempts < maxAttempts()) {
          persistLocal(task.jobId, task.input, attempts);
          localPending.set(task.jobId, { ...task, attempts });
          metrics.increment("cipher_queue_retries_total");
        } else {
          try { fs.writeFileSync(path.join(queueDir(), `${task.jobId}.dead-letter.json`), JSON.stringify({ jobId: task.jobId, attempts, error: String(error.message || "worker failure").slice(0, 1000), failedAt: new Date().toISOString() }), { mode: 0o600 }); } catch (_error) {}
          metrics.increment("cipher_queue_dead_letters_total");
        }
      })
      .finally(() => {
        localActive -= 1;
        workerState.active = localActive;
        workerState.pending = localPending.size;
        if (!localPending.has(task.jobId) || Number(task.attempts || 0) + 1 >= maxAttempts()) {
          try { fs.rmSync(path.join(queueDir(), `${task.jobId}.json`), { force: true }); } catch (_error) {}
        }
        pumpLocal();
      });
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

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function getCipherScanQueueStatus() {
  return { ...workerState, active: localActive, pending: localPending.size, capturedAt: new Date().toISOString() };
}

module.exports = { enqueueCipherScan, getCipherScanQueueStatus, startCipherScanWorker };
