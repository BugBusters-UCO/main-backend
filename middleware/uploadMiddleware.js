const multer = require("multer");
const path = require("path");
const env = require("../config/env");

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, env.uploadDir),
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, "_");
    cb(null, `${Date.now()}-${safeName}`);
  }
});

const uploadZip = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() !== ".zip") {
      return cb(new Error("Only .zip repository archives are allowed"));
    }
    return cb(null, true);
  }
});

module.exports = { uploadZip };
