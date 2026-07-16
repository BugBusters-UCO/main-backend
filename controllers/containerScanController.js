const { scanContainerTarget } = require("../services/containerScannerService");

async function scanContainer(req, res, next) {
  try {
    const result = await scanContainerTarget({
      image: req.body?.image,
      dockerfilePath: req.body?.dockerfilePath,
      sbomPath: req.body?.sbomPath,
      projectPath: req.body?.projectPath
    });
    return res.json(result);
  } catch (error) { return next(error); }
}

module.exports = { scanContainer };
