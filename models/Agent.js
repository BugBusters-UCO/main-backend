const { sequelize, loadSequelize } = require("../dbConnection/sequelize");

let Agent = null;

if (sequelize) {
  const { DataTypes } = loadSequelize();
  Agent = sequelize.define(
    "Agent",
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
      name: {
        type: DataTypes.STRING,
        allowNull: false
      },
      hostname: {
        type: DataTypes.STRING,
        allowNull: false
      },
      os: {
        type: DataTypes.STRING,
        allowNull: true
      },
      version: {
        type: DataTypes.STRING,
        allowNull: true
      },
      status: {
        type: DataTypes.ENUM("online", "offline", "scanning", "error"),
        defaultValue: "offline"
      },
      lastSeenAt: {
        type: DataTypes.DATE,
        allowNull: true
      },
      inventory: {
        type: DataTypes.JSONB,
        allowNull: true
      }
    },
    {
      tableName: "agents",
      timestamps: true,
      indexes: [{ fields: ["userId", "hostname"] }]
    }
  );
}

module.exports = Agent;
