const router = require("express").Router();
const { requireAuth, requireMfa } = require("../middleware/authMiddleware");
const controller = require("../controllers/findingController");

router.use(requireAuth, requireMfa);
router.get("/:findingId/reviews", controller.listFindingReviews);
router.post("/:findingId/reviews", controller.reviewFinding);

module.exports = router;
