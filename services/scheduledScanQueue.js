const { createClient } = require("redis");
const { Redis } = require("@upstash/redis");

const env = require("../config/env");
const metrics = require("./operationalMetricsService");

let connectionPromise = null;
let workerStarted = false;

const stream = process.env.REDIS_SCHEDULE_STREAM || "bugbusters:scheduled-scans";
const deadLetterStream = process.env.REDIS_SCHEDULE_DLQ_STREAM || "bugbusters:scheduled-scans:dead-letter";
const group = process.env.REDIS_SCHEDULE_GROUP || "bugbusters-scheduled-workers";
const maxAttempts = Math.max(1, Number(process.env.REDIS_SCHEDULE_MAX_ATTEMPTS || env.redis.maxAttempts || 3));

function enabled() { return env.redis.enabled && (!env.banking?.strictOffline || env.banking?.allowMetadataRedisQueue === true); }

function upstash() {
  return env.redis.provider === "upstash-rest" || Boolean(env.redis.upstashUrl && env.redis.upstashToken);
}

async function connection() {
  if (!enabled()) return null;
  if (!connectionPromise) {
    if (upstash()) {
      connectionPromise = Promise.resolve({ kind: "upstash", client: new Redis({ url: env.redis.upstashUrl, token: env.redis.upstashToken }) });
    } else {
      const client = createClient({
        url: env.redis.url,
        socket: env.redis.url ? undefined : { host: env.redis.host, port: env.redis.port, tls: env.redis.tls },
        username: env.redis.username,
        password: env.redis.password,
        database: env.redis.database
      });
      client.on("error", (error) => console.error("Scheduled scan Redis error:", error.message));
      connectionPromise = client.connect().then(() => ({ kind: "tcp", client }));
    }
  }
  return connectionPromise;
}

async function enqueueScheduledScan(scheduleId) {
  const queue = await connection();
  if (!queue) return false;
  const fields = { type: "scheduled-scan", scheduleId, attempts: "0", queuedAt: new Date().toISOString() };
  const result = queue.kind === "upstash" ? await queue.client.xadd(stream, "*", fields) : await queue.client.xAdd(stream, "*", fields);
  metrics.increment("scheduled_jobs_enqueued"); return result;
}

async function startScheduledScanQueueWorker(handler) {
  if (!enabled() || workerStarted) return false;
  const queue = await connection();
  if (queue.kind === "upstash") {
    try { await queue.client.xgroup(stream, { type: "CREATE", group, id: "0", options: { MKSTREAM: true } }); }
    catch (error) { if (!String(error.message).includes("BUSYGROUP")) throw error; }
  } else {
    try { await queue.client.xGroupCreate(stream, group, "0", { MKSTREAM: true }); }
    catch (error) { if (!String(error.message).includes("BUSYGROUP")) throw error; }
  }

  workerStarted = true;
  for (let index = 0; index < env.redis.concurrency; index += 1) {
    consume(queue, handler, `${env.redis.consumer}-schedule-${index}`).catch((error) => {
      console.error("Scheduled scan worker stopped:", error.message);
      workerStarted = false;
    });
  }
  console.log(`Scheduled scan workers started: ${env.redis.concurrency} (${queue.kind})`);
  return true;
}

async function consume(queue, handler, consumer) {
  let lastClaimAt = 0;
  while (true) {
    if (Date.now() - lastClaimAt >= env.redis.claimIdleMs) {
      lastClaimAt = Date.now();
      await processMessages(queue, handler, await claimPending(queue, consumer));
    }
    const messages = queue.kind === "upstash"
      ? await queue.client.xreadgroup(group, consumer, stream, ">", { count: 1 })
      : await queue.client.xReadGroup(group, consumer, [{ key: stream, id: ">" }], { COUNT: 1, BLOCK: env.redis.blockMs });
    if (!messages?.length) {
      if (queue.kind === "upstash") await delay(env.redis.pollMs);
      continue;
    }

    await processMessages(queue, handler, messages);
  }
}

async function claimPending(queue, consumer) {
  const result = queue.kind === "upstash"
    ? await queue.client.xautoclaim(stream, group, consumer, env.redis.claimIdleMs, "0-0", { count: 1 })
    : await queue.client.xAutoClaim(stream, group, consumer, env.redis.claimIdleMs, "0-0", { COUNT: 1 });
  const messages = Array.isArray(result) ? (queue.kind === "upstash" ? result[1] : result.messages) : [];
  return [{ name: stream, messages: messages || [] }];
}

async function processMessages(queue, handler, messages) {
  for (const bucket of messages || []) {
    for (const message of bucket.messages || []) {
      const fields = message.message || {};
      const attempts = Number(fields.attempts || 0) + 1;
      try {
        if (fields.type !== "scheduled-scan") throw new Error(`Unknown scheduled job type: ${fields.type}`);
        await handler(fields.scheduleId);
        await acknowledge(queue, message.id);
        metrics.increment("scheduled_jobs_succeeded");
      } catch (error) {
        if (attempts < maxAttempts) {
          await add(queue, stream, { ...fields, attempts: String(attempts), retryOf: message.id, retryAt: new Date().toISOString() });
          metrics.increment("scheduled_jobs_retried");
        } else {
          await add(queue, deadLetterStream, { ...fields, attempts: String(attempts), error: error.message, failedAt: new Date().toISOString() });
          metrics.increment("scheduled_jobs_dead_lettered");
        }
        metrics.increment("scheduled_jobs_failed");
        await acknowledge(queue, message.id);
        console.error(`Scheduled scan ${fields.scheduleId || message.id} attempt ${attempts} failed:`, error.message);
      }
    }
  }
}

async function add(queue, key, fields) {
  if (queue.kind === "upstash") return queue.client.xadd(key, "*", fields);
  return queue.client.xAdd(key, "*", fields);
}

async function acknowledge(queue, id) {
  if (queue.kind === "upstash") return queue.client.xack(stream, group, id);
  return queue.client.xAck(stream, group, id);
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

module.exports = { enqueueScheduledScan, startScheduledScanQueueWorker };
