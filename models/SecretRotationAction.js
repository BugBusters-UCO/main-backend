const { sequelize, loadSequelize } = require("../dbConnection/sequelize");

let SecretRotationAction = null;
if (sequelize) {
  const { DataTypes } = loadSequelize();
  SecretRotationAction = sequelize.define("SecretRotationAction", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    scanJobId: { type: DataTypes.UUID, allowNull: false },
    findingId: { type: DataTypes.STRING, allowNull: false },
    fingerprint: { type: DataTypes.STRING(128), allowNull: false },
    providerFamily: { type: DataTypes.STRING, allowNull: true },
    secretType: { type: DataTypes.STRING, allowNull: false },
    action: { type: DataTypes.ENUM("rotate", "revoke"), allowNull: false },
    status: { type: DataTypes.ENUM("pending_approval", "queued", "running", "completed", "failed", "dry_run"), allowNull: false, defaultValue: "pending_approval" },
    secretReference: { type: DataTypes.TEXT, allowNull: false },
    requestedBy: { type: DataTypes.UUID, allowNull: true },
    approvedBy: { type: DataTypes.UUID, allowNull: true },
    resultMetadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    error: { type: DataTypes.TEXT, allowNull: true }
  }, { tableName: "secret_rotation_actions", timestamps: true });
}

module.exports = SecretRotationAction;
