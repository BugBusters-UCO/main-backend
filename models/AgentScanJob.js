const { sequelize, loadSequelize } = require("../dbConnection/sequelize");

let AgentScanJob = null;

if (sequelize) {
  const { DataTypes } = loadSequelize();
  AgentScanJob = sequelize.define(
    "AgentScanJob",
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
      agentId: {
        type: DataTypes.UUID,
        allowNull: false
      },
      sourceLabel: {
        type: DataTypes.STRING,
        allowNull: false
      },
      scope: {
        type: DataTypes.ENUM("full-os", "root", "selected", "application"),
        defaultValue: "selected"
      },
      selectedPaths: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: []
      },
      modules: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: []
      },
      status: {
        type: DataTypes.ENUM("queued", "running", "stopping", "stopped", "completed", "failed"),
        defaultValue: "queued"
      },
      command: {
        type: DataTypes.JSONB,
        allowNull: true
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
      tableName: "agent_scan_jobs",
      timestamps: true,
      indexes: [{ fields: ["userId", "agentId"] }]
    }
  );
}

module.exports = AgentScanJob;
