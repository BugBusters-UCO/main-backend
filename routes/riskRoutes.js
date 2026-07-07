const router = require("express").Router();
const riskController = require("../controllers/riskController");
const { requireAuth } = require("../middleware/authMiddleware");

router.use(requireAuth);
router.get("/business-inputs", riskController.getBusinessInputs);
router.get("/assessments", riskController.getAssessments);
router.post("/assessments", riskController.createAssessment);
router.post("/assessments/:assessmentId/remedies", riskController.createAssessmentRemedies);
router.get("/assessments/:assessmentId", riskController.getAssessment);
router.get("/assessments/:assessmentId/pdf", riskController.downloadPdf);
router.post("/overview", riskController.getRiskOverview);

module.exports = router;
