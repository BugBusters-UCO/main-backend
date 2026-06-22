const router = require("express").Router();

const healthRoutes = require("./healthRoutes");
const authRoutes = require("./authRoutes");
const scanRoutes = require("./scanRoutes");
const configScanRoutes = require("./configScanRoutes");
const githubRoutes = require("./githubRoutes");

router.use("/health", healthRoutes);
router.use("/auth", authRoutes);
router.use("/scans", scanRoutes);
router.use("/config-scans", configScanRoutes);
router.use("/github", githubRoutes);

module.exports = router;
