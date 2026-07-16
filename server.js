const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, ".env") });

const app = require("./app");
const { ensureRuntimeDirs } = require("./config/storage");
const { connectDatabase } = require("./dbConnection/sequelize");
const { resumePendingAssessments } = require("./services/riskAssessmentService");
const { startScheduledScanWorker } = require("./services/scheduledScanService");
const { startDependencyScanWorker } = require("./services/redisScanQueue");
const { runQueuedDependencyScan } = require("./controllers/scanController");
const { startConfigScanWorker } = require("./services/configScanQueue");
const { runConfigJob } = require("./controllers/configScanController");
const { startSecretScanWorker } = require("./services/secretScanQueue");
const { runQueuedSecretScan } = require("./controllers/secretScanController");
const { startCipherScanWorker } = require("./services/cipherScanQueue");
const { runQueuedCipherScan } = require("./controllers/cipherScanController");
const { validateProductionConfig } = require("./config/productionValidation");

const PORT = Number(process.env.PORT || 5000);

ensureRuntimeDirs();

async function start() {
  validateProductionConfig();
  await connectDatabase();
  const resumedAssessments = await resumePendingAssessments();
  if (resumedAssessments) {
    console.log(`Resumed ${resumedAssessments} pending risk assessment(s).`);
  }
  startScheduledScanWorker();
  await startDependencyScanWorker(runQueuedDependencyScan);
  await startConfigScanWorker(runConfigJob);
  await startSecretScanWorker(runQueuedSecretScan);
  await startCipherScanWorker(runQueuedCipherScan);

  app.listen(PORT, () => {
    console.log(`Main backend running on http://127.0.0.1:${PORT}`);
    console.log("Use the existing frontend for the dashboard.");
  });
}

start().catch((error) => {
  console.error("Failed to start main backend:", error.message);
  process.exit(1);
});
