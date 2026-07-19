const { sequelize, loadSequelize } = require("../dbConnection/sequelize");

let AiExplanation = null;

if (sequelize) {
  const { DataTypes } = loadSequelize();
  AiExplanation = sequelize.define(
    "AiExplanation",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
      },
      jobId: {
        type: DataTypes.STRING,
        allowNull: false
      },
      sectionId: {
        type: DataTypes.STRING,
        allowNull: false
      },
      content: {
        type: DataTypes.TEXT,
        allowNull: false
      }
    },
    {
      tableName: "ai_explanations",
      timestamps: true,
      indexes: [
        {
          unique: true,
          fields: ["jobId", "sectionId"]
        }
      ]
    }
  );
}

module.exports = AiExplanation;
