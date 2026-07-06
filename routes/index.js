const router = require("express").Router();

const healthRoutes = require("./healthRoutes");
const authRoutes = require("./authRoutes");
const scanRoutes = require("./scanRoutes");
const configScanRoutes = require("./configScanRoutes");
const secretScanRoutes = require("./secretScanRoutes");
const cipherScanRoutes = require("./cipherScanRoutes");
const riskRoutes = require("./riskRoutes");
const githubRoutes = require("./githubRoutes");
const agentRoutes = require("./agentRoutes");
const scheduledScanRoutes = require("./scheduledScanRoutes");

router.use("/health", healthRoutes);
router.use("/auth", authRoutes);
router.use("/scans", scanRoutes);
router.use("/config-scans", configScanRoutes);
router.use("/secret-scans", secretScanRoutes);
router.use("/cipher-scans", cipherScanRoutes);
router.use("/risk", riskRoutes);
router.use("/github", githubRoutes);
router.use("/agents", agentRoutes);
router.use("/scheduled-scans", scheduledScanRoutes);

module.exports = router;
