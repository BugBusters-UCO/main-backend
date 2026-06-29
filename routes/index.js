const router = require("express").Router();

const healthRoutes = require("./healthRoutes");
const authRoutes = require("./authRoutes");
const scanRoutes = require("./scanRoutes");
const configScanRoutes = require("./configScanRoutes");
const secretScanRoutes = require("./secretScanRoutes");
const cipherScanRoutes = require("./cipherScanRoutes");
const githubRoutes = require("./githubRoutes");

router.use("/health", healthRoutes);
router.use("/auth", authRoutes);
router.use("/scans", scanRoutes);
router.use("/config-scans", configScanRoutes);
router.use("/secret-scans", secretScanRoutes);
router.use("/cipher-scans", cipherScanRoutes);
router.use("/github", githubRoutes);

module.exports = router;
