const router = require("express").Router();
const secretScanController = require("../controllers/secretScanController");
const { uploadZip } = require("../middleware/uploadMiddleware");
const { requireAuth } = require("../middleware/authMiddleware");

router.use(requireAuth);
router.get("/", secretScanController.getSecretScanJobs);
router.get("/:jobId", secretScanController.getSecretScanJob);
router.get("/:jobId/logs", secretScanController.streamSecretScanLogs);
router.get("/:jobId/artifacts/:format", secretScanController.getSecretScanArtifact);
router.post("/:jobId/findings/:findingId/rotation", secretScanController.requestSecretRotation);
router.post("/:jobId/rotation/:actionId/approve", secretScanController.approveSecretRotation);
router.post("/github", secretScanController.startGithubSecretScan);
router.post("/zip", uploadZip.single("repoZip"), secretScanController.startZipSecretScan);

module.exports = router;
