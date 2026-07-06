const router = require("express").Router();
const scheduledScanController = require("../controllers/scheduledScanController");
const { requireAuth } = require("../middleware/authMiddleware");

router.use(requireAuth);

router.get("/", scheduledScanController.listSchedules);
router.post("/", scheduledScanController.createSchedule);
router.get("/:scheduleId", scheduledScanController.getSchedule);
router.put("/:scheduleId", scheduledScanController.updateSchedule);
router.delete("/:scheduleId", scheduledScanController.deleteSchedule);
router.post("/:scheduleId/run-now", scheduledScanController.runSchedule);

module.exports = router;
