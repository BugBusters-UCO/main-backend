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
      sourceType: {
        type: DataTypes.ENUM("github", "zip", "local"),
        allowNull: false
      },
      sourceLabel: {
        type: DataTypes.STRING,
        allowNull: false
      },
      status: {
        type: DataTypes.ENUM("queued", "running", "completed", "failed"),
        defaultValue: "queued"
      },
      result: {
        type: DataTypes.JSONB,
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
