const { sequelize, loadSequelize } = require("../dbConnection/sequelize");

let SecretFinding = null;
if (sequelize) {
  const { DataTypes } = loadSequelize();
  SecretFinding = sequelize.define("SecretFinding", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    findingId: { type: DataTypes.STRING, allowNull: false },
    scanJobId: { type: DataTypes.UUID, allowNull: false },
    fingerprint: { type: DataTypes.STRING(128), allowNull: false },
    ruleId: { type: DataTypes.STRING, allowNull: true },
    secretType: { type: DataTypes.STRING, allowNull: false },
    category: { type: DataTypes.STRING, allowNull: true },
    severity: { type: DataTypes.STRING, allowNull: false },
    filePath: { type: DataTypes.TEXT, allowNull: true },
    lineNumber: { type: DataTypes.INTEGER, allowNull: true },
    confidence: { type: DataTypes.FLOAT, allowNull: true },
    validationStatus: { type: DataTypes.STRING, allowNull: true },
    context: { type: DataTypes.STRING, allowNull: true },
    evidence: { type: DataTypes.TEXT, allowNull: true },
    metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} }
  }, {
    tableName: "secret_findings",
    timestamps: true,
    indexes: [{ fields: ["scanJobId"] }, { fields: ["fingerprint"] }, { fields: ["severity"] }, { unique: true, fields: ["findingId", "scanJobId"] }]
  });
}

module.exports = SecretFinding;
