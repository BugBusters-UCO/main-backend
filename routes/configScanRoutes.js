const router = require("express").Router();
const configScanController = require("../controllers/configScanController");
const { uploadZip } = require("../middleware/uploadMiddleware");
const { requireAuth } = require("../middleware/authMiddleware");

router.use(requireAuth);
router.get("/", configScanController.getConfigScanJobs);
router.get("/:jobId", configScanController.getConfigScanJob);
router.get("/:jobId/logs", configScanController.streamConfigScanLogs);
router.post("/github", configScanController.startGithubConfigScan);
router.post("/zip", uploadZip.single("repoZip"), configScanController.startZipConfigScan);

module.exports = router;
