const { createJob, findByDeliveryId } = require("../services/scanJobStore");
const { enqueueDependencyScan, isRedisEnabled } = require("../services/redisScanQueue");
const { deliveryId, normalizeProvider, parseEvent, verifyWebhook } = require("../services/providerWebhookService");
const { runQueuedDependencyScan } = require("./scanController");
const { enqueueSecretScan } = require("../services/secretScanQueue");
const { runQueuedSecretScan } = require("./secretScanController");
const { recordAuditEvent } = require("../services/auditService");

async function receiveDependencyWebhook(req, res, next) {
  try {
    const provider = normalizeProvider(req.params.provider);
    verifyWebhook(provider, req.headers, req.rawBody);
    const event = parseEvent(provider, req.body, req.headers);
    if (event.ignored) return res.status(202).json({ accepted: true, ignored: true, reason: event.reason });
    const id = deliveryId(provider, req.headers, event);
    const existing = await findByDeliveryId(id);
    if (existing) return res.status(202).json({ accepted: true, duplicate: true, jobId: existing.id, commitSha: existing.commitSha || event.commitSha });

    const job = await createJob({
      id: require("crypto").randomUUID(),
      userId: null,
      importedRepositoryId: null,
      scannerType: "dependency",
      sourceType: provider,
      sourceLabel: event.sourceLabel,
      status: "queued",
      result: null,
      error: null,
      deliveryId: id,
      commitSha: event.commitSha,
      repoUrl: event.repoUrl,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const input = {
      sourceType: provider,
      provider,
      sourceLabel: event.sourceLabel,
      repoUrl: event.repoUrl,
      commitSha: event.commitSha,
      ref: event.ref,
      departmentId: null,
      includeDev: true,
      useOsv: true,
      failOn: "high"
    };

    if (isRedisEnabled()) {
      await enqueueDependencyScan(job.id, input);
    } else {
      setImmediate(() => runQueuedDependencyScan(job.id, input).catch(() => {}));
    }

    return res.status(202).json({ accepted: true, jobId: job.id, provider, commitSha: event.commitSha });
  } catch (error) {
    error.statusCode = error.statusCode || 401;
    return next(error);
  }
}

async function receiveSecretWebhook(req, res, next) {
  try {
    const provider = normalizeProvider(req.params.provider);
    verifyWebhook(provider, req.headers, req.rawBody);
    const event = parseEvent(provider, req.body, req.headers);
    if (event.ignored) return res.status(202).json({ accepted: true, ignored: true, reason: event.reason });
    const id = `secret:${deliveryId(provider, req.headers, event)}`;
    const existing = await findByDeliveryId(id);
    if (existing) return res.status(202).json({ accepted: true, duplicate: true, jobId: existing.id, commitSha: existing.commitSha || event.commitSha });

    const job = await createJob({
      id: require("crypto").randomUUID(), userId: null, importedRepositoryId: null,
      scannerType: "secret", sourceType: provider, sourceLabel: event.sourceLabel,
      status: "queued", result: null, error: null, deliveryId: id,
      commitSha: event.commitSha, repoUrl: event.repoUrl,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    });
    await recordAuditEvent({}, "secret-scan.created", "secret-scan", job.id, { sourceType: provider, sourceLabel: event.sourceLabel, commitSha: event.commitSha, deliveryId: id });
    await enqueueSecretScan(job.id, {
      sourceType: provider, provider, sourceLabel: event.sourceLabel,
      repoUrl: event.repoUrl, commitSha: event.commitSha, ref: event.ref,
      changedFiles: event.changedFiles,
      failOn: "high", includeLow: true, includeGitHistory: true,
      completeGitHistory: false,
      userId: null
    });
    return res.status(202).json({ accepted: true, jobId: job.id, provider, commitSha: event.commitSha });
  } catch (error) {
    error.statusCode = error.statusCode || 401;
    return next(error);
  }
}

module.exports = { receiveDependencyWebhook, receiveSecretWebhook };
