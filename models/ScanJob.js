const { sequelize, loadSequelize } = require("../dbConnection/sequelize");

let ScanJob = null;

if (sequelize) {
  const { DataTypes } = loadSequelize();
  ScanJob = sequelize.define(
    "ScanJob",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: true
      },
      importedRepositoryId: {
        type: DataTypes.UUID,
        allowNull: true
      },
      scannerType: {
        type: DataTypes.ENUM("dependency", "config", "secret", "cipher"),
        defaultValue: "dependency"
      },
      sourceType: {
        type: DataTypes.ENUM("github", "gitlab", "bitbucket", "azuredevops", "zip", "local"),
        allowNull: false
      },
      sourceLabel: {
        type: DataTypes.STRING,
        allowNull: false
      },
      repoUrl: { type: DataTypes.STRING, allowNull: true },
      commitSha: { type: DataTypes.STRING, allowNull: true },
      deliveryId: { type: DataTypes.STRING, allowNull: true, unique: true },
      departmentId: { type: DataTypes.STRING, allowNull: true },
      status: {
        type: DataTypes.ENUM("queued", "running", "completed", "failed", "cancelled"),
        defaultValue: "queued"
      },
      cancelRequested: { type: DataTypes.BOOLEAN, defaultValue: false },
      cancelledAt: { type: DataTypes.DATE, allowNull: true },
      result: {
        type: DataTypes.JSONB,
        allowNull: true
      },
      error: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      completedAt: {
        type: DataTypes.DATE,
        allowNull: true
      }
    },
    {
      tableName: "scan_jobs",
      timestamps: true
    }
  );
}

module.exports = ScanJob;
