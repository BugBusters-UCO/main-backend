const { sequelize, loadSequelize } = require("../dbConnection/sequelize");

let AuditEvent = null;
if (sequelize) {
  const { DataTypes } = loadSequelize();
  AuditEvent = sequelize.define("AuditEvent", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    actorId: { type: DataTypes.UUID, allowNull: true },
    actorRole: { type: DataTypes.STRING, allowNull: true },
    departmentId: { type: DataTypes.STRING, allowNull: true },
    action: { type: DataTypes.STRING, allowNull: false },
    resourceType: { type: DataTypes.STRING, allowNull: false },
    resourceId: { type: DataTypes.STRING, allowNull: true },
    metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    ipAddress: { type: DataTypes.STRING, allowNull: true },
    userAgent: { type: DataTypes.TEXT, allowNull: true }
  }, { tableName: "audit_events", timestamps: true });
}

module.exports = AuditEvent;
