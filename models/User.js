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
        type: DataTypes.ENUM("admin", "security_admin", "department_admin", "auditor", "developer", "viewer"),
        defaultValue: "developer"
      },
      departmentId: {
        type: DataTypes.STRING,
        allowNull: true
      },
      mfaEnabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      mfaSecretEncrypted: { type: DataTypes.TEXT, allowNull: true },
      ssoSubject: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true
      }
    },
    {
      tableName: "users",
      timestamps: true
    }
  );
}

module.exports = User;
