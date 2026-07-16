const { sequelize, loadSequelize } = require("../dbConnection/sequelize");

let FindingReview = null;
if (sequelize) {
  const { DataTypes } = loadSequelize();
  FindingReview = sequelize.define("FindingReview", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    findingId: { type: DataTypes.STRING, allowNull: false },
    scanJobId: { type: DataTypes.UUID, allowNull: false },
    departmentId: { type: DataTypes.STRING, allowNull: true },
    status: { type: DataTypes.ENUM("open", "confirmed", "in_progress", "fixed", "accepted_risk", "false_positive", "waived", "reopened"), defaultValue: "open" },
    note: { type: DataTypes.TEXT, allowNull: true },
    dueAt: { type: DataTypes.DATE, allowNull: true },
    reviewerId: { type: DataTypes.UUID, allowNull: true }
  }, { tableName: "finding_reviews", timestamps: true });
}

module.exports = FindingReview;
