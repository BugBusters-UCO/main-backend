const {
  buildRiskOverview,
  getRiskBusinessInputs
} = require("../services/riskEngineService");
const {
  createRiskAssessment,
  generateAssessmentRemedies,
  getRiskAssessment,
  listRiskAssessments
} = require("../services/riskAssessmentService");

async function getBusinessInputs(_req, res, next) {
  try {
    res.json(await getRiskBusinessInputs());
  } catch (error) {
    next(error);
  }
}

async function getRiskOverview(req, res, next) {
  try {
    res.json(await buildRiskOverview(req.user.id, req.body || {}));
  } catch (error) {
    next(error);
  }
}

async function createAssessment(req, res, next) {
  try {
    res.status(202).json(await createRiskAssessment(req.user.id, req.body || {}));
  } catch (error) {
    next(error);
  }
}

async function getAssessments(req, res, next) {
  try {
    res.json(await listRiskAssessments(req.user.id, { limit: Number(req.query.limit || 100) }));
  } catch (error) {
    next(error);
  }
}

async function getAssessment(req, res, next) {
  try {
    const assessment = await getRiskAssessment(req.user.id, req.params.assessmentId);
    if (!assessment) return res.status(404).json({ message: "Risk assessment not found" });
    res.json(assessment);
  } catch (error) {
    next(error);
  }
}

async function createAssessmentRemedies(req, res, next) {
  try {
    const assessment = await generateAssessmentRemedies(req.user.id, req.params.assessmentId, req.body || {});
    if (!assessment) return res.status(404).json({ message: "Risk assessment not found" });
    res.json(assessment);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getBusinessInputs,
  getRiskOverview,
  createAssessment,
  createAssessmentRemedies,
  getAssessments,
  getAssessment
};
