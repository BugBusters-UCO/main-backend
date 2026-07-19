const router = require("express").Router();
const authController = require("../controllers/authController");
const { requireAuth } = require("../middleware/authMiddleware");

router.post("/register", authController.register);
router.post("/login", authController.login);
router.get("/me", requireAuth, authController.me);
router.post("/mfa/enroll", requireAuth, authController.beginMfa);
router.post("/mfa/verify", requireAuth, authController.verifyMfa);
router.get("/mfa/secret", requireAuth, authController.getMfaSecret);

module.exports = router;
