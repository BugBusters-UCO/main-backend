const router = require("express").Router();
const controller = require("../controllers/healthController");

router.get("/", controller.health);
router.get("/metrics", controller.metricsEndpoint);

module.exports = router;
