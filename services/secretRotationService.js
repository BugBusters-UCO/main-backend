const axios = require("axios");
const { randomUUID } = require("crypto");
const { SecretFinding, SecretRotationAction, ScanJob } = require("../models");
const env = require("../config/env");
const { recordAudit, recordAuditEvent } = require("./auditService");

async function requestRotation(req, scanJobId, findingId, input = {}) {
  const action = input.action === "revoke" ? "revoke" : input.action === "rotate" ? "rotate" : null;
  const secretReference = String(input.secretReference || "").trim();
  if (!action || !secretReference || secretReference.length > 2048) {
    const error = new Error("action and a valid secretReference are required");
    error.statusCode = 400;
    throw error;
  }
  const job = await findJob(scanJobId);
  if (!job || !_canAccess(job, req.user)) return null;
  const finding = await findFinding(scanJobId, findingId);
  if (!finding) return null;

  const record = {
    id: randomUUID(), scanJobId, findingId,
    fingerprint: finding.fingerprint, providerFamily: input.providerFamily || null,
    secretType: finding.secretType || "unknown", action,
    status: env.rotation.requireApproval ? "pending_approval" : "queued",
    secretReference, requestedBy: req.user?.id || null, approvedBy: null,
    resultMetadata: { rawSecretTransmitted: false }, error: null
  };
  const saved = await saveAction(record);
  await recordAudit(req, "secret-rotation.requested", "secret-rotation", saved.id, {
    scanJobId, findingId, action, providerFamily: record.providerFamily, secretType: record.secretType,
    rawSecretTransmitted: false
  });
  if (record.status === "queued") return executeRotation(saved, req.user?.id || null);
  return saved;
}

async function approveRotation(req, actionId) {
  const action = await getAction(actionId);
  if (!action || !_canAccess(await findJob(action.scanJobId), req.user)) return null;
  if (action.status !== "pending_approval") return action;
  const updated = await updateAction(actionId, { status: "queued", approvedBy: req.user?.id || null });
  await recordAudit(req, "secret-rotation.approved", "secret-rotation", actionId, { action: action.action, rawSecretTransmitted: false });
  return executeRotation(updated, req.user?.id || null);
}

async function executeRotation(action, actorId = null) {
  if (!action) return null;
  if (String(process.env.SECRET_ROTATION_EXECUTE || "false").toLowerCase() !== "true") {
    return updateAction(action.id, { status: "dry_run", resultMetadata: { rawSecretTransmitted: false, executionEnabled: false, nextStep: "Enable SECRET_ROTATION_EXECUTE and configure SECRET_ROTATION_BROKER_URL after approval." } });
  }
  if (!env.rotation.brokerUrl || !env.rotation.brokerToken) {
    return updateAction(action.id, { status: "failed", error: "Secret rotation broker is not configured", resultMetadata: { rawSecretTransmitted: false } });
  }
  await updateAction(action.id, { status: "running" });
  try {
    const response = await axios.post(env.rotation.brokerUrl, {
      action: action.action,
      scanJobId: action.scanJobId,
      findingId: action.findingId,
      fingerprint: action.fingerprint,
      providerFamily: action.providerFamily,
      secretType: action.secretType,
      secretReference: action.secretReference,
      requestedBy: action.requestedBy,
      approvedBy: action.approvedBy || actorId,
      rawSecretTransmitted: false
    }, { timeout: env.rotation.timeoutMs, headers: { authorization: `Bearer ${env.rotation.brokerToken}` } });
    const completed = await updateAction(action.id, { status: "completed", resultMetadata: { rawSecretTransmitted: false, brokerStatus: response.status, brokerResult: response.data?.status || "accepted" } });
    await recordAuditEvent({ actorId: actorId || action.approvedBy || action.requestedBy || null }, "secret-rotation.completed", "secret-rotation", action.id, { action: action.action, rawSecretTransmitted: false });
    return completed;
  } catch (error) {
    const failed = await updateAction(action.id, { status: "failed", error: String(error.message || "rotation broker failed").slice(0, 500), resultMetadata: { rawSecretTransmitted: false } });
    await recordAuditEvent({ actorId: actorId || action.approvedBy || action.requestedBy || null }, "secret-rotation.failed", "secret-rotation", action.id, { action: action.action, rawSecretTransmitted: false });
    return failed;
  }
}

async function findJob(scanJobId) {
  return ScanJob ? ScanJob.findByPk(scanJobId) : null;
}

async function findFinding(scanJobId, findingId) {
  if (!SecretFinding) return null;
  return SecretFinding.findOne({ where: { scanJobId, findingId } });
}

async function saveAction(record) {
  if (SecretRotationAction) return (await SecretRotationAction.create(record)).toJSON();
  return record;
}

async function getAction(id) {
  if (SecretRotationAction) {
    const row = await SecretRotationAction.findByPk(id);
    return row?.toJSON() || null;
  }
  return null;
}

async function updateAction(id, patch) {
  if (!SecretRotationAction) return { id, ...patch };
  await SecretRotationAction.update(patch, { where: { id } });
  return getAction(id);
}

function _canAccess(job, user) {
  if (!job || !user) return false;
  if (["admin", "security_admin", "auditor"].includes(user.role)) return true;
  return !job.userId || job.userId === user.id;
}

module.exports = { approveRotation, requestRotation };
