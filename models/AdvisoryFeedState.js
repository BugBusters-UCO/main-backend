const { sequelize, loadSequelize } = require("../dbConnection/sequelize");

let AdvisoryFeedState = null;
if (sequelize) {
  const { DataTypes } = loadSequelize();
  AdvisoryFeedState = sequelize.define("AdvisoryFeedState", {
    feed: { type: DataTypes.STRING, primaryKey: true },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "never_run" },
    lastStartedAt: { type: DataTypes.DATE, allowNull: true },
    lastSuccessAt: { type: DataTypes.DATE, allowNull: true },
    lastCursor: { type: DataTypes.STRING, allowNull: true },
    recordsIngested: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    error: { type: DataTypes.TEXT, allowNull: true }
  }, { tableName: "advisory_feed_states", timestamps: true });
}

module.exports = AdvisoryFeedState;
