const router = require("express").Router();

const healthRoutes = require("./healthRoutes");
const scanRoutes = require("./scanRoutes");
const githubRoutes = require("./githubRoutes");

router.use("/health", healthRoutes);
router.use("/scans", scanRoutes);
router.use("/github", githubRoutes);

module.exports = router;
