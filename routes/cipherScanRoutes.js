const router = require("express").Router();
const cipherScanController = require("../controllers/cipherScanController");
const { uploadZip } = require("../middleware/uploadMiddleware");
const { requireAuth } = require("../middleware/authMiddleware");

router.use(requireAuth);
router.get("/", cipherScanController.getCipherScanJobs);
router.get("/:jobId", cipherScanController.getCipherScanJob);
router.get("/:jobId/logs", cipherScanController.streamCipherScanLogs);
router.post("/github", cipherScanController.startGithubCipherScan);
router.post("/zip", uploadZip.single("repoZip"), cipherScanController.startZipCipherScan);

module.exports = router;
