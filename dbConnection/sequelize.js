const env = require("../config/env");

function loadSequelize() {
  try {
    return require("sequelize");
  } catch (_error) {
    return null;
  }
}

function createSequelizeInstance() {
  if (!env.databaseUrl) {
    return null;
  }

  const sequelizePackage = loadSequelize();
  if (!sequelizePackage) {
    return null;
  }

  const { Sequelize } = sequelizePackage;
  return new Sequelize(env.databaseUrl, {
    dialect: "postgres",
    dialectOptions: env.databaseSsl
      ? {
          ssl: {
            require: true,
            rejectUnauthorized: false
          }
        }
      : {},
    logging: env.nodeEnv === "development" ? console.log : false
  });
}

const sequelize = createSequelizeInstance();

async function connectDatabase() {
  if (!env.dbEnabled) {
    console.log("Database disabled. Set DB_ENABLED=true when PostgreSQL is ready.");
    return null;
  }
  if (!sequelize) {
    throw new Error("Install sequelize, pg, and pg-hstore and set DATABASE_URL before enabling DB_ENABLED=true");
  }
  await sequelize.authenticate();
  require("../models");
  await sequelize.sync();
  console.log("PostgreSQL connected through Sequelize.");
  return sequelize;
}

module.exports = { sequelize, connectDatabase, loadSequelize };
