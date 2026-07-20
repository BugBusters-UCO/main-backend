const { sequelize, loadSequelize } = require("../dbConnection/sequelize");

let ProxyAlert = null;

if (sequelize) {
  const { DataTypes } = loadSequelize();
  ProxyAlert = sequelize.define(
    "ProxyAlert",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
      },
      type: {
        type: DataTypes.STRING,
        allowNull: false
      },
      packageName: {
        type: DataTypes.STRING,
        allowNull: false
      },
      message: {
        type: DataTypes.STRING,
        allowNull: false
      },
      findings: {
        type: DataTypes.JSONB,
        allowNull: true
      }
    },
    {
      tableName: "proxy_alerts",
      timestamps: true,
      indexes: [{ fields: ["packageName"] }, { fields: ["createdAt"] }]
    }
  );
}

module.exports = ProxyAlert;
