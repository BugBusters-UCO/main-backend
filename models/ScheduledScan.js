const { sequelize, loadSequelize } = require("../dbConnection/sequelize");

let ScheduledScan = null;

if (sequelize) {
  const { DataTypes } = loadSequelize();
  ScheduledScan = sequelize.define(
    "ScheduledScan",
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
      importedRepositoryId: {
        type: DataTypes.UUID,
        allowNull: true
      },
      agentId: {
        type: DataTypes.UUID,
        allowNull: true
      },
      selectedPaths: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: []
      },
      scope: {
        type: DataTypes.STRING,
        allowNull: true
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false
      },
      sourceType: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "github"
      },
      sourceLabel: {
        type: DataTypes.STRING,
        allowNull: false
      },
      scanners: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: ["dependency", "config", "secret", "cipher"]
      },
      frequency: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "daily"
      },
      timeOfDay: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "09:00"
      },
      timesPerDay: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1
      },
      weekdays: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: []
      },
      monthDays: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: []
      },
      timezone: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "Asia/Calcutta"
      },
      businessContext: {
        type: DataTypes.JSONB,
        allowNull: true
      },
      reportEmail: {
        type: DataTypes.STRING,
        allowNull: true
      },
      enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
      },
      running: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      lastRunAt: {
        type: DataTypes.DATE,
        allowNull: true
      },
      nextRunAt: {
        type: DataTypes.DATE,
        allowNull: true
      },
      lastStatus: {
        type: DataTypes.STRING,
        allowNull: true
      },
      lastRiskAssessmentId: {
        type: DataTypes.UUID,
        allowNull: true
      },
      lastScanJobIds: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: []
      },
      lastError: {
        type: DataTypes.TEXT,
        allowNull: true
      }
    },
    {
      tableName: "scheduled_scans",
      timestamps: true
    }
  );
}

module.exports = ScheduledScan;
