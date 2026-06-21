const fs = require("fs");
const env = require("./env");

function ensureRuntimeDirs() {
  for (const dir of [env.workspaceDir, env.uploadDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

module.exports = { ensureRuntimeDirs };
