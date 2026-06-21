const { checkScannerHealth } = require("../services/dependencyScannerService");

async function health(_req, res) {
  let dependencyScanner = { status: "unreachable" };

  try {
    dependencyScanner = await checkScannerHealth();
  } catch (error) {
    dependencyScanner = {
      status: "unreachable",
      message: error.message
    };
  }

  res.json({
    status: "ok",
    service: "main-backend",
    dependencyScanner
  });
}

module.exports = { health };
