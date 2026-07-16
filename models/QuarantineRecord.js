const { sequelize, loadSequelize } = require("../dbConnection/sequelize");

let QuarantineRecord = null;
if (sequelize) {
  const { DataTypes } = loadSequelize();
  QuarantineRecord = sequelize.define("QuarantineRecord", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    findingId: { type: DataTypes.STRING, allowNull: true },
    artifactDigest: { type: DataTypes.STRING, allowNull: false },
    packageName: { type: DataTypes.STRING, allowNull: true },
    packageVersion: { type: DataTypes.STRING, allowNull: true },
    ecosystem: { type: DataTypes.STRING, allowNull: true },
    departmentId: { type: DataTypes.STRING, allowNull: true },
    severity: { type: DataTypes.ENUM("critical", "high", "medium", "low", "unknown"), defaultValue: "high" },
    status: { type: DataTypes.ENUM("suspected", "under_review", "confirmed_malicious", "blocked", "approved_exception", "released"), defaultValue: "suspected" },
    reason: { type: DataTypes.TEXT, allowNull: false },
    evidence: { type: DataTypes.JSONB, allowNull: true },
    createdBy: { type: DataTypes.UUID, allowNull: true },
    approvedBy: { type: DataTypes.UUID, allowNull: true },
    expiresAt: { type: DataTypes.DATE, allowNull: true }
  }, { tableName: "quarantine_records", timestamps: true, indexes: [{ fields: ["artifactDigest"] }, { fields: ["status"] }, { fields: ["departmentId"] }] });
}

module.exports = QuarantineRecord;
