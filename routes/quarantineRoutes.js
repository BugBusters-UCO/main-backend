const router = require("express").Router();
const { requireAuth, requireMfa, requireRoles } = require("../middleware/authMiddleware");
const controller = require("../controllers/quarantineController");

router.use(requireAuth, requireMfa);
router.get("/", controller.list);
router.post("/check", controller.check);
router.post("/", requireRoles("admin", "security_admin", "department_admin"), controller.create);
router.post("/:id/approve", requireRoles("admin", "security_admin"), controller.approve);

module.exports = router;
