const router = require("express").Router();
const { getDashboardStats } = require("../controllers/dashboardController");

router.get("/stats", getDashboardStats);

module.exports = router;
