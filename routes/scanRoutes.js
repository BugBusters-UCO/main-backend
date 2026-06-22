const router = require("express").Router();
const scanController = require("../controllers/scanController");
const { uploadZip } = require("../middleware/uploadMiddleware");
const { requireAuth } = require("../middleware/authMiddleware");

router.use(requireAuth);
router.get("/", scanController.getScanJobs);
router.get("/:jobId", scanController.getScanJob);
router.get("/:jobId/logs", scanController.streamScanLogs);
router.post("/github", scanController.startGithubScan);
router.post("/zip", uploadZip.single("repoZip"), scanController.startZipScan);

module.exports = router;
