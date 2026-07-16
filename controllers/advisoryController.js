const { getAdvisory, ingestCisaKev, ingestNvdFeed, ingestOsvIds, listAdvisories, listFeedStates, recordFeedState } = require("../services/advisoryIngestionService");
const { recordAudit } = require("../services/auditService");
const { analyzeAdvisoryImpact, enqueueEmergencyRescans } = require("../services/advisoryImpactService");

async function refreshAdvisories(req, res, next) {
  try {
    const result = { osv: 0, nvd: 0, cisaKev: 0 };
    if (Array.isArray(req.body?.osvIds) && req.body.osvIds.length) { await recordFeedState("OSV", { status: "running", lastStartedAt: new Date() }); result.osv = (await ingestOsvIds(req.body.osvIds)).length; await recordFeedState("OSV", { status: "success", lastSuccessAt: new Date(), recordsIngested: result.osv }); }
    if (req.body?.nvdUrl || process.env.NVD_FEED_URL) { await recordFeedState("NVD", { status: "running", lastStartedAt: new Date() }); result.nvd = (await ingestNvdFeed(req.body.nvdUrl)).length; await recordFeedState("NVD", { status: "success", lastSuccessAt: new Date(), recordsIngested: result.nvd }); }
    if (req.body?.includeCisaKev !== false) { await recordFeedState("CISA-KEV", { status: "running", lastStartedAt: new Date() }); result.cisaKev = (await ingestCisaKev(req.body?.cisaKevUrl)).length; await recordFeedState("CISA-KEV", { status: "success", lastSuccessAt: new Date(), recordsIngested: result.cisaKev }); }
    const impact = await analyzeAdvisoryImpact(await listAdvisories(1000));
    const rescans = await enqueueEmergencyRescans(impact);
    await recordAudit(req, "advisories.refreshed", "advisory-feed", "internal", { ...result, impactedScans: impact.length, emergencyRescans: rescans });
    return res.json({ refreshed: true, ...result, impactedScans: impact.length, emergencyRescans: rescans, refreshedAt: new Date().toISOString() });
  } catch (error) { return next(error); }
}

async function advisoryStatus(_req, res, next) {
  try { return res.json({ count: (await listAdvisories(1000)).length, source: "internal-advisory-store", feeds: await listFeedStates() }); }
  catch (error) { return next(error); }
}

async function advisoryImpact(req, res, next) {
  try { return res.json(await analyzeAdvisoryImpact(await listAdvisories(req.query.limit || 1000))); }
  catch (error) { return next(error); }
}

async function getAdvisoryById(req, res, next) {
  try {
    const advisory = await getAdvisory(req.params.id);
    return advisory ? res.json(advisory) : res.status(404).json({ message: "Advisory not found" });
  } catch (error) { return next(error); }
}

async function listAdvisoryRecords(req, res, next) {
  try { return res.json(await listAdvisories(req.query.limit)); }
  catch (error) { return next(error); }
}

module.exports = { advisoryImpact, advisoryStatus, getAdvisoryById, listAdvisoryRecords, refreshAdvisories };
