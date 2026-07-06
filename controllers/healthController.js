const { checkScannerHealth } = require("../services/dependencyScannerService");
const { checkConfigScannerHealth } = require("../services/configScannerService");
const { checkSecretScannerHealth } = require("../services/secretScannerService");
const { checkCipherScannerHealth } = require("../services/cipherScannerService");
const { checkRiskEngineHealth } = require("../services/riskEngineService");

async function health(_req, res) {
  let dependencyScanner = { status: "unreachable" };
  let configScanner = { status: "unreachable" };
  let secretScanner = { status: "unreachable" };
  let cipherScanner = { status: "unreachable" };
  let riskEngine = { status: "unreachable" };

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

  try {
    secretScanner = await checkSecretScannerHealth();
  } catch (error) {
    secretScanner = {
      status: "unreachable",
      message: error.message
    };
  }

  try {
    cipherScanner = await checkCipherScannerHealth();
  } catch (error) {
    cipherScanner = {
      status: "unreachable",
      message: error.message
    };
  }

  try {
    riskEngine = await checkRiskEngineHealth();
  } catch (error) {
    riskEngine = {
      status: "unreachable",
      message: error.message
    };
  }

  res.json({
    status: "ok",
    service: "main-backend",
    dependencyScanner,
    configScanner,
    secretScanner,
    cipherScanner,
    riskEngine
  });
}

module.exports = { health };
