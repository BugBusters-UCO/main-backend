const { sequelize, loadSequelize } = require("../dbConnection/sequelize");

let ImportedRepository = null;

if (sequelize) {
  const { DataTypes } = loadSequelize();
  ImportedRepository = sequelize.define(
    "ImportedRepository",
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
      githubAccountId: {
        type: DataTypes.UUID,
        allowNull: true
      },
      githubRepoId: {
        type: DataTypes.BIGINT,
        allowNull: true
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false
      },
      fullName: {
        type: DataTypes.STRING,
        allowNull: false
      },
      private: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
      },
      defaultBranch: {
        type: DataTypes.STRING,
        allowNull: true
      },
      cloneUrl: {
        type: DataTypes.STRING,
        allowNull: false
      },
      htmlUrl: {
        type: DataTypes.STRING,
        allowNull: true
      },
      language: {
        type: DataTypes.STRING,
        allowNull: true
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      lastImportedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
      }
    },
    {
      tableName: "imported_repositories",
      timestamps: true,
      indexes: [{ unique: true, fields: ["userId", "fullName"] }]
    }
  );
}

module.exports = ImportedRepository;
