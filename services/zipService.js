const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");
const env = require("../config/env");

function extractZip(zipPath, jobId) {
  const targetDir = path.join(env.workspaceDir, jobId, "repo");
  fs.mkdirSync(targetDir, { recursive: true });

  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  const maxEntries = Number(process.env.CONFIG_SCAN_MAX_ARCHIVE_ENTRIES || 10000);
  const maxExpandedBytes = Number(process.env.CONFIG_SCAN_MAX_ARCHIVE_BYTES || 500 * 1024 * 1024);
  if (entries.length > maxEntries) throw new Error(`ZIP archive exceeds maximum entry count (${maxEntries})`);
  let expandedBytes = 0;
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const entrySize = Number(entry.header?.size || 0);
    expandedBytes += entrySize;
    if (entrySize > Number(process.env.CONFIG_SCAN_MAX_ARCHIVE_FILE_BYTES || 50 * 1024 * 1024)) {
      throw new Error("ZIP archive contains an oversized file");
    }
    if (expandedBytes > maxExpandedBytes) throw new Error(`ZIP archive exceeds maximum expanded size (${maxExpandedBytes})`);
    if (entry.entryName.includes("\\") || entry.entryName.split("/").some((part) => part === "..")) {
      throw new Error("Unsafe zip archive path detected");
    }
    const destination = path.resolve(targetDir, entry.entryName);
    const relative = path.relative(targetDir, destination);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Unsafe zip archive path detected");
    }
  }
  zip.extractAllTo(targetDir, true);
  return targetDir;
}

module.exports = { extractZip };
