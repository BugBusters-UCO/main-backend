const router = require("express").Router();
const { requireAdmin, requireAuth, requireMfa } = require("../middleware/authMiddleware");
const controller = require("../controllers/advisoryController");

router.use(requireAuth, requireMfa);
router.get("/status", controller.advisoryStatus);
router.get("/impact", controller.advisoryImpact);
router.get("/", controller.listAdvisoryRecords);
router.get("/:id", controller.getAdvisoryById);
router.post("/refresh", requireAdmin, controller.refreshAdvisories);

module.exports = router;
