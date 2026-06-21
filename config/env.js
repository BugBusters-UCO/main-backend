const path = require("path");

const rootDir = path.resolve(__dirname, "..");

module.exports = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 5000),
  jwtSecret: process.env.JWT_SECRET || "change-this-secret",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  dependencyScannerUrl: process.env.DEPENDENCY_SCANNER_URL || "http://127.0.0.1:8001",
  frontendUrl: process.env.FRONTEND_URL || "http://127.0.0.1:3000",
  github: {
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    callbackUrl: process.env.GITHUB_CALLBACK_URL || "http://127.0.0.1:5000/api/github/oauth/callback",
    scope: process.env.GITHUB_OAUTH_SCOPE || "repo read:user"
  },
  workspaceDir: path.resolve(rootDir, process.env.WORKSPACE_DIR || "workspace"),
  uploadDir: path.resolve(rootDir, process.env.UPLOAD_DIR || "uploads"),
  dbEnabled: String(process.env.DB_ENABLED || "false").toLowerCase() === "true",
  databaseUrl: process.env.DATABASE_URL,
  mail: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false").toLowerCase() === "true",
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.MAIL_FROM || "Security Scanner <security@example.com>"
  }
};
