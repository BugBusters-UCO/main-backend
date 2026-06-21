const { sequelize, loadSequelize } = require("../dbConnection/sequelize");

let User = null;

if (sequelize) {
  const { DataTypes } = loadSequelize();
  User = sequelize.define(
    "User",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false
      },
      email: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
      },
      passwordHash: {
        type: DataTypes.STRING,
        allowNull: false
      },
      role: {
        type: DataTypes.ENUM("admin", "developer", "viewer"),
        defaultValue: "developer"
      }
    },
    {
      tableName: "users",
      timestamps: true
    }
  );
}

module.exports = User;
