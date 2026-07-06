const { sequelize, loadSequelize } = require("../dbConnection/sequelize");

let RiskAssessment = null;

if (sequelize) {
  const { DataTypes } = loadSequelize();
  RiskAssessment = sequelize.define(
    "RiskAssessment",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false
      },
      sourceType: {
        type: DataTypes.STRING,
        allowNull: false
      },
      sourceLabel: {
        type: DataTypes.STRING,
        allowNull: false
      },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "waiting"
      },
      scanJobIds: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: []
      },
      agentScanJobIds: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: []
      },
      businessContext: {
        type: DataTypes.JSONB,
        allowNull: true
      },
      weights: {
        type: DataTypes.JSONB,
        allowNull: true
      },
      includeAiRecommendation: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      result: {
        type: DataTypes.JSONB,
        allowNull: true
      },
      error: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      startedAt: {
        type: DataTypes.DATE,
        allowNull: true
      },
      completedAt: {
        type: DataTypes.DATE,
        allowNull: true
      }
    },
    {
      tableName: "risk_assessments",
      timestamps: true,
      indexes: [
        { fields: ["userId", "status"] },
        { fields: ["userId", "sourceLabel"] }
      ]
    }
  );
}

module.exports = RiskAssessment;
