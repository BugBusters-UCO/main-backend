const { checkScannerHealth } = require("../services/dependencyScannerService");
const { checkConfigScannerHealth } = require("../services/configScannerService");

async function health(_req, res) {
  let dependencyScanner = { status: "unreachable" };
  let configScanner = { status: "unreachable" };

  try {
    dependencyScanner = await checkScannerHealth();
  } catch (error) {
    dependencyScanner = {
      status: "unreachable",
      message: error.message
    };
  }

  try {
    configScanner = await checkConfigScannerHealth();
  } catch (error) {
    configScanner = {
      status: "unreachable",
      message: error.message
    };
  }

  res.json({
    status: "ok",
    service: "main-backend",
    dependencyScanner,
    configScanner
  });
}

module.exports = { health };
