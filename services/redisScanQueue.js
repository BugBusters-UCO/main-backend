const { createClient } = require("redis");
const { Redis } = require("@upstash/redis");

const env = require("../config/env");
const metrics = require("./operationalMetricsService");

let clientPromise = null;
let workerStarted = false;

function isRedisEnabled() {
  return env.redis.enabled && (!env.banking?.strictOffline || env.banking?.allowMetadataRedisQueue === true);
}

function isUpstash() {
  return env.redis.provider === "upstash-rest"
    || Boolean(env.redis.upstashUrl && env.redis.upstashToken);
}

function redisOptions() {
  if (env.redis.url) {
    return {
      url: env.redis.url,
      database: env.redis.database,
      socket: env.redis.tls ? { tls: true } : undefined
    };
  }

  return {
    socket: { host: env.redis.host, port: env.redis.port, tls: env.redis.tls },
    username: env.redis.username,
    password: env.redis.password,
    database: env.redis.database
  };
}

async function getRedisClient() {
  if (!isRedisEnabled()) return null;
  if (!clientPromise) {
    if (isUpstash()) {
      const client = new Redis({ url: env.redis.upstashUrl, token: env.redis.upstashToken });
      clientPromise = Promise.resolve(createQueueAdapter("upstash", client));
    } else {
      const client = createClient(redisOptions());
      client.on("error", (error) => console.error("Redis scan queue error:", error.message));
      clientPromise = client.connect().then(() => createQueueAdapter("tcp", client));
    }
  }
  return clientPromise;
}

async function enqueueDependencyScan(jobId, input) {
  const queue = await getRedisClient();
  if (!queue) return false;

  // Never put GitHub access tokens in Redis. Workers resolve credentials at execution time.
  const safeInput = { ...input };
  delete safeInput.githubToken;
  await queue.xAdd(env.redis.stream, {
    type: "dependency-scan",
    jobId,
    attempts: "0",
    payload: JSON.stringify(safeInput)
  });
  metrics.increment("dependency_jobs_enqueued");
  return true;
}

async function startDependencyScanWorker(handler) {
  if (!isRedisEnabled() || workerStarted) return false;
  const queue = await getRedisClient();
  await queue.xGroupCreate(env.redis.stream, env.redis.group);

  workerStarted = true;
  for (let index = 0; index < env.redis.concurrency; index += 1) {
    consume(queue, handler, `${env.redis.consumer}-${index}`).catch((error) => {
      console.error("Redis dependency worker stopped:", error.message);
      workerStarted = false;
    });
  }
  console.log(`Redis dependency scan workers started: ${env.redis.concurrency} (${queue.kind})`);
  return true;
}

async function consume(queue, handler, consumer) {
  let lastClaimAt = 0;
  while (true) {
    if (Date.now() - lastClaimAt >= env.redis.claimIdleMs) {
      lastClaimAt = Date.now();
      const reclaimed = await queue.xAutoClaim(consumer);
      await processMessages(queue, handler, reclaimed, consumer);
    }

    const messages = await queue.xReadGroup(env.redis.group, consumer);
    if (!messages?.length) {
      if (queue.kind === "upstash") await delay(env.redis.pollMs);
      continue;
    }

    await processMessages(queue, handler, messages, consumer);
  }
}

async function processMessages(queue, handler, messages, consumer) {
  for (const stream of messages || []) {
    for (const message of stream.messages || []) {
      const fields = message.message || message[1] || {};
      try {
        if (fields.type !== "dependency-scan") throw new Error(`Unknown scan job type: ${fields.type}`);
        const attempts = Number(fields.attempts || 0);
        await handler(fields.jobId, JSON.parse(fields.payload || "{}"));
        await queue.xAck(message.id);
        metrics.increment("dependency_jobs_succeeded");
      } catch (error) {
        const attempts = Number(fields.attempts || 0) + 1;
        if (attempts < env.redis.maxAttempts) {
          await queue.xAdd(env.redis.stream, {
            type: fields.type || "dependency-scan",
            jobId: fields.jobId || "unknown",
            attempts: String(attempts),
            payload: fields.payload || "{}",
            retryOf: message.id,
            retryAt: new Date().toISOString()
          });
          metrics.increment("dependency_jobs_retried");
        } else {
          await queue.xAdd(env.redis.deadLetterStream, {
            originalStream: env.redis.stream,
            originalMessageId: message.id,
            jobId: fields.jobId || "unknown",
            attempts: String(attempts),
            error: error.message || "worker failure",
            payload: fields.payload || "{}",
            failedAt: new Date().toISOString()
          });
          metrics.increment("dependency_jobs_dead_lettered");
        }
        metrics.increment("dependency_jobs_failed");
        await queue.xAck(message.id);
        console.error(`Dependency scan ${fields.jobId || message.id} attempt ${attempts} failed:`, error.message);
      }
    }
  }
}

function createQueueAdapter(kind, client) {
  if (kind === "upstash") {
    return {
      kind,
      client,
      async xAdd(stream, fields) { return client.xadd(stream, "*", fields); },
      async xGroupCreate(stream, group) {
        try {
          return await client.xgroup(stream, { type: "CREATE", group, id: "0", options: { MKSTREAM: true } });
        } catch (error) {
          if (!String(error.message).includes("BUSYGROUP")) throw error;
          return null;
        }
      },
      async xReadGroup(group, consumer) {
        return client.xreadgroup(group, consumer, env.redis.stream, ">", { count: 1 });
      },
      async xAutoClaim(consumer) {
        const result = await client.xautoclaim(env.redis.stream, env.redis.group, consumer, env.redis.claimIdleMs, "0-0", { count: 1 });
        return Array.isArray(result) ? [{ name: env.redis.stream, messages: result[1] || [] }] : [];
      },
      async xAck(id) { return client.xack(env.redis.stream, env.redis.group, id); }
    };
  }

  return {
    kind,
    client,
    async xAdd(stream, fields) { return client.xAdd(stream, "*", fields); },
    async xGroupCreate(stream, group) {
      try { return await client.xGroupCreate(stream, group, "0", { MKSTREAM: true }); }
      catch (error) { if (!String(error.message).includes("BUSYGROUP")) throw error; return null; }
    },
    async xReadGroup(group, consumer) {
      return client.xReadGroup(group, consumer, [{ key: env.redis.stream, id: ">" }], { COUNT: 1, BLOCK: env.redis.blockMs });
    },
    async xAutoClaim(consumer) {
      const result = await client.xAutoClaim(env.redis.stream, env.redis.group, consumer, env.redis.claimIdleMs, "0-0", { COUNT: 1 });
      return [{ name: env.redis.stream, messages: result.messages || [] }];
    },
    async xAck(id) { return client.xAck(env.redis.stream, env.redis.group, id); }
  };
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function closeRedisScanQueue() {
  if (!clientPromise) return;
  const queue = await clientPromise;
  if (queue.kind === "tcp") await queue.client.quit();
  clientPromise = null;
  workerStarted = false;
}

module.exports = { closeRedisScanQueue, enqueueDependencyScan, getRedisClient, isRedisEnabled, startDependencyScanWorker };
