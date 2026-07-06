const router = require("express").Router();
const agentController = require("../controllers/agentController");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireAgentToken } = require("../middleware/agentAuthMiddleware");

router.post("/register", requireAgentToken, agentController.registerVmAgent);
router.post("/:agentId/heartbeat", requireAgentToken, agentController.heartbeatVmAgent);
router.get("/:agentId/commands", requireAgentToken, agentController.pollAgentCommands);
router.post("/:agentId/scans/:scanId/logs", requireAgentToken, agentController.postAgentLog);
router.post("/:agentId/scans/:scanId/status", requireAgentToken, agentController.postAgentScanStatus);
router.post("/:agentId/scans/:scanId/result", requireAgentToken, agentController.postAgentScanResult);

router.use(requireAuth);

router.get("/", agentController.getAgents);
router.get("/scan-reports", agentController.getAgentScanReports);
router.get("/:agentId/inventory", agentController.getAgentInventory);
router.get("/:agentId/scans", agentController.getAgentScans);
router.post("/:agentId/scans", agentController.createAgentScan);
router.get("/scans/:scanId", agentController.getAgentScanJob);
router.post("/scans/:scanId/stop", agentController.stopAgentScanJob);
router.get("/scans/:scanId/logs", agentController.streamAgentScanLogs);

module.exports = router;
