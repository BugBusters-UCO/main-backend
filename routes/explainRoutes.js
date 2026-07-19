const express = require("express");
const router = express.Router();
const { explainCipherSection } = require("../controllers/explainController");
const { requireAuth } = require("../middleware/authMiddleware");

// The endpoint will be /api/explain/cipher
// We apply authentication middleware just in case
router.post("/cipher", requireAuth, explainCipherSection);

module.exports = router;
