const router = require("express").Router();
const { requireAuth, requireMfa } = require("../middleware/authMiddleware");
const { scanContainer } = require("../controllers/containerScanController");

router.use(requireAuth, requireMfa);
router.post("/", scanContainer);

module.exports = router;
