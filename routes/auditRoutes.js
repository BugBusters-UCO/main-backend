const router = require("express").Router();
const { requireAdmin, requireAuth, requireMfa } = require("../middleware/authMiddleware");
const { listAudit } = require("../controllers/auditController");

router.use(requireAuth, requireMfa, requireAdmin);
router.get("/", listAudit);

module.exports = router;
