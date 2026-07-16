const { AuditEvent } = require("../models");

const memory = [];

async function recordAudit(req, action, resourceType, resourceId, metadata = {}) {
  return recordAuditEvent({
    actorId: req.user?.id || null,
    actorRole: req.user?.role || null,
    departmentId: req.user?.departmentId || null,
    ipAddress: req.ip || null,
    userAgent: req.get?.("user-agent") || null
  }, action, resourceType, resourceId, metadata);
}

async function recordAuditEvent(actor = {}, action, resourceType, resourceId, metadata = {}) {
  const event = {
    actorId: actor.actorId || null,
    actorRole: actor.actorRole || null,
    departmentId: actor.departmentId || null,
    action,
    resourceType,
    resourceId: resourceId || null,
    metadata,
    ipAddress: actor.ipAddress || null,
    userAgent: actor.userAgent || null
  };
  if (AuditEvent) {
    const saved = await AuditEvent.create(event);
    return saved.toJSON();
  }
  const fallback = { id: `audit-${Date.now()}-${memory.length}`, ...event, createdAt: new Date().toISOString() };
  memory.push(fallback);
  return fallback;
}

async function listAuditEvents(limit = 100) {
  const size = Math.min(Math.max(Number(limit) || 100, 1), 1000);
  if (AuditEvent) {
    const rows = await AuditEvent.findAll({ order: [["createdAt", "DESC"]], limit: size });
    return rows.map((row) => row.toJSON());
  }
  return memory.slice(-size).reverse();
}

module.exports = { listAuditEvents, recordAudit, recordAuditEvent };
