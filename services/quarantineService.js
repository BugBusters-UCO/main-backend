const crypto = require("crypto");
const { QuarantineRecord } = require("../models");

const memory = new Map();
const STATUSES = new Set(["suspected", "under_review", "confirmed_malicious", "blocked", "approved_exception", "released"]);
const BLOCKING = new Set(["suspected", "under_review", "confirmed_malicious", "blocked"]);

function digest(value) {
  const raw = String(value || "").trim();
  if (!/^(sha256:)?[a-f0-9]{64}$/i.test(raw)) throw new Error("artifactDigest must be a SHA-256 digest");
  return raw.toLowerCase().startsWith("sha256:") ? raw.toLowerCase() : `sha256:${raw.toLowerCase()}`;
}

async function createQuarantine(input, actorId) {
  if (!input.reason || !STATUSES.has(input.status || "suspected")) throw new Error("A reason and valid quarantine status are required");
  const record = { ...input, artifactDigest: digest(input.artifactDigest), status: input.status || "suspected", createdBy: actorId || null, id: crypto.randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  if (QuarantineRecord) {
    const saved = await QuarantineRecord.create(record);
    return saved.toJSON();
  }
  memory.set(record.id, record); return record;
}

async function listQuarantines(filters = {}) {
  if (QuarantineRecord) {
    const where = {};
    if (filters.status) where.status = filters.status;
    if (filters.departmentId) where.departmentId = filters.departmentId;
    const rows = await QuarantineRecord.findAll({ where, order: [["createdAt", "DESC"]], limit: Math.min(Number(filters.limit) || 100, 500) });
    return rows.map((row) => row.toJSON());
  }
  return [...memory.values()].filter((row) => (!filters.status || row.status === filters.status) && (!filters.departmentId || row.departmentId === filters.departmentId)).slice(0, 500);
}

async function getQuarantine(id) {
  if (QuarantineRecord) return QuarantineRecord.findByPk(id);
  return memory.get(id) || null;
}

async function approveQuarantine(id, actorId, expiresAt) {
  const row = await getQuarantine(id);
  if (!row) return null;
  const values = { status: "approved_exception", approvedBy: actorId, expiresAt: expiresAt || null, updatedAt: new Date() };
  if (QuarantineRecord) { await row.update(values); return row.toJSON(); }
  Object.assign(row, values, { updatedAt: new Date().toISOString() }); memory.set(id, row); return row;
}

async function admissionDecision(input) {
  const target = digest(input.artifactDigest);
  const rows = await listQuarantines({ departmentId: input.departmentId });
  const now = Date.now();
  const matches = rows.filter((row) => row.artifactDigest === target && (!row.expiresAt || new Date(row.expiresAt).getTime() > now));
  const blocking = matches.find((row) => BLOCKING.has(row.status));
  if (blocking) return { decision: "blocked", reason: blocking.reason, quarantineId: blocking.id, status: blocking.status, artifactDigest: target };
  return { decision: "allowed", artifactDigest: target, reason: matches.some((row) => row.status === "approved_exception") ? "approved_exception" : "no_active_quarantine" };
}

module.exports = { createQuarantine, listQuarantines, getQuarantine, approveQuarantine, admissionDecision, STATUSES };
