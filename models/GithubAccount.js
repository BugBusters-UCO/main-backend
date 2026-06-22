const { sequelize, loadSequelize } = require("../dbConnection/sequelize");

let GithubAccount = null;

if (sequelize) {
  const { DataTypes } = loadSequelize();
  GithubAccount = sequelize.define(
    "GithubAccount",
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
      githubId: {
        type: DataTypes.BIGINT,
        allowNull: true
      },
      login: {
        type: DataTypes.STRING,
        allowNull: false
      },
      name: {
        type: DataTypes.STRING,
        allowNull: true
      },
      avatarUrl: {
        type: DataTypes.STRING,
        allowNull: true
      },
      profileUrl: {
        type: DataTypes.STRING,
        allowNull: true
      },
      accessToken: {
        type: DataTypes.TEXT,
        allowNull: false
      }
    },
    {
      tableName: "github_accounts",
      timestamps: true,
      indexes: [{ unique: true, fields: ["userId", "login"] }]
    }
  );
}

module.exports = GithubAccount;
