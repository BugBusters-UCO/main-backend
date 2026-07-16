const { sequelize, loadSequelize } = require("../dbConnection/sequelize");

let Advisory = null;
if (sequelize) {
  const { DataTypes } = loadSequelize();
  Advisory = sequelize.define("Advisory", {
    id: { type: DataTypes.STRING, primaryKey: true },
    source: { type: DataTypes.STRING, allowNull: false },
    aliases: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    summary: { type: DataTypes.TEXT, allowNull: true },
    details: { type: DataTypes.TEXT, allowNull: true },
    severity: { type: DataTypes.STRING, allowNull: true },
    cvssScore: { type: DataTypes.FLOAT, allowNull: true },
    epssScore: { type: DataTypes.FLOAT, allowNull: true },
    cisaKev: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    published: { type: DataTypes.DATE, allowNull: true },
    modified: { type: DataTypes.DATE, allowNull: true },
    affected: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    fixedVersions: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    references: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    raw: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    ingestedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
  }, { tableName: "security_advisories", timestamps: true });
}

module.exports = Advisory;
