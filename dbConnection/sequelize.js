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
            rejectUnauthorized: true
          }
        }
      : {},
    logging: false,
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
  await ensureScanJobScannerTypeEnum();
  await ensureScanJobCancellationSchema();
  await ensureScanJobSourceTypeEnum();
  await ensureUserRoleEnum();
  await ensureScheduledScansImportedRepositoryNullable();
  require("../models");
  await sequelize.sync({ alter: env.nodeEnv !== "production" });
  console.log("PostgreSQL connected through Sequelize.");
  return sequelize;
}

async function ensureScanJobSourceTypeEnum() {
  if (!sequelize) return;
  for (const value of ["gitlab", "bitbucket", "azuredevops"]) {
    try {
      await sequelize.query(`ALTER TYPE "enum_scan_jobs_sourceType" ADD VALUE IF NOT EXISTS '${value}'`);
    } catch (error) {
      console.error(`Failed to add scan source type ${value}:`, error.message);
    }
  }
}

async function ensureUserRoleEnum() {
  if (!sequelize) return;
  for (const value of ["security_admin", "department_admin", "auditor"]) {
    try {
      await sequelize.query(`ALTER TYPE "enum_users_role" ADD VALUE IF NOT EXISTS '${value}'`);
    } catch (error) {
      console.error(`Failed to add user role ${value}:`, error.message);
    }
  }
}

async function ensureScheduledScansImportedRepositoryNullable() {
  if (!sequelize) return;
  try {
    await sequelize.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'scheduled_scans' AND column_name = 'importedRepositoryId') THEN
          ALTER TABLE "scheduled_scans" ALTER COLUMN "importedRepositoryId" DROP NOT NULL;
        END IF;
      END $$;
    `);
  } catch (error) {
    console.error("Failed to alter importedRepositoryId to drop NOT NULL:", error);
  }
}

async function ensureScanJobScannerTypeEnum() {
  if (!sequelize) return;
  await sequelize.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_scan_jobs_scannerType') THEN
        ALTER TYPE "enum_scan_jobs_scannerType" ADD VALUE IF NOT EXISTS 'secret';
        ALTER TYPE "enum_scan_jobs_scannerType" ADD VALUE IF NOT EXISTS 'cipher';
      END IF;
    END $$;
  `);
}

async function ensureScanJobCancellationSchema() {
  if (!sequelize) return;
  await sequelize.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_scan_jobs_status') THEN
        ALTER TYPE "enum_scan_jobs_status" ADD VALUE IF NOT EXISTS 'cancelled';
      END IF;
    END $$;
  `);
  await sequelize.query('ALTER TABLE "scan_jobs" ADD COLUMN IF NOT EXISTS "cancelRequested" BOOLEAN NOT NULL DEFAULT false');
  await sequelize.query('ALTER TABLE "scan_jobs" ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP WITH TIME ZONE');
}

module.exports = { sequelize, connectDatabase, loadSequelize };
