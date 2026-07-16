const router = require("express").Router();
const { requireAuth, requireMfa } = require("../middleware/authMiddleware");
const { scanIac } = require("../controllers/iacScanController");

router.use(requireAuth, requireMfa);
router.post("/", scanIac);

module.exports = router;
