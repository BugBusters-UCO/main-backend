const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");
const env = require("../config/env");

function extractZip(zipPath, jobId) {
  const targetDir = path.join(env.workspaceDir, jobId, "repo");
  fs.mkdirSync(targetDir, { recursive: true });

  const zip = new AdmZip(zipPath);
  for (const entry of zip.getEntries()) {
    const destination = path.resolve(targetDir, entry.entryName);
    if (!destination.startsWith(targetDir)) {
      throw new Error("Unsafe zip archive path detected");
    }
  }
  zip.extractAllTo(targetDir, true);
  return targetDir;
}

module.exports = { extractZip };
