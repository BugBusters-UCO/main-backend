const { scanIacTarget } = require("../services/iacScannerService");

async function scanIac(req, res, next) {
  try { return res.json(await scanIacTarget({ projectPath: req.body?.projectPath })); }
  catch (error) { return next(error); }
}

module.exports = { scanIac };
