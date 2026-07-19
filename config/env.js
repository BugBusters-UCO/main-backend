const path = require("path");

const rootDir = path.resolve(__dirname, "..");

module.exports = {
  nodeEnv: process.env.NODE_ENV || "development",
  banking: {
    strictOffline: String(process.env.BANKING_STRICT_OFFLINE || "true").toLowerCase() === "true",
    internalOnly: String(process.env.BANK_INTERNAL_ONLY || "true").toLowerCase() === "true",
    allowMetadataRedisQueue: String(process.env.BANKING_ALLOW_METADATA_REDIS_QUEUE || "false").toLowerCase() === "true"
  },
  port: Number(process.env.PORT || 5000),
  jwtSecret: process.env.JWT_SECRET || (process.env.NODE_ENV === "production" ? undefined : "change-this-secret"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  agentToken: process.env.AGENT_SHARED_TOKEN || (process.env.NODE_ENV === "production" ? undefined : "dev-agent-token"),
  dependencyScannerUrl: process.env.DEPENDENCY_SCANNER_URL || "http://127.0.0.1:8001",
  configScannerUrl: process.env.CONFIG_SCANNER_URL || "http://127.0.0.1:8002",
  configScannerServiceToken: process.env.CONFIG_SCANNER_SERVICE_TOKEN,
  secretScannerUrl: process.env.SECRET_SCANNER_URL || "http://127.0.0.1:8003",
  cipherScannerUrl: process.env.CIPHER_SCANNER_URL || "http://127.0.0.1:8004",
  cipherScannerApiToken: process.env.CIPHER_SCANNER_API_TOKEN || "",
  cipherNotificationWebhookConfig: process.env.CIPHER_NOTIFICATION_WEBHOOKS || "[]",
  riskEngineUrl: process.env.RISK_ENGINE_URL || "http://127.0.0.1:8005",
  frontendUrl: process.env.FRONTEND_URL || "http://127.0.0.1:3000",
  github: {
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    callbackUrl: process.env.GITHUB_CALLBACK_URL || "http://127.0.0.1:5000/api/github/oauth/callback",
    scope: process.env.GITHUB_OAUTH_SCOPE || "repo read:user"
  },
  workspaceDir: path.resolve(rootDir, process.env.WORKSPACE_DIR || "workspace"),
  configScanQueueDir: path.resolve(rootDir, process.env.CONFIG_SCAN_QUEUE_DIR || "workspace/.config-scan-queue"),
  secretScanQueueDir: path.resolve(rootDir, process.env.SECRET_SCAN_QUEUE_DIR || "workspace/.secret-scan-queue"),
  uploadDir: path.resolve(rootDir, process.env.UPLOAD_DIR || "uploads"),
  dbEnabled: String(process.env.DB_ENABLED || "false").toLowerCase() === "true",
  databaseUrl: process.env.DATABASE_URL,
  dbHost: process.env.DB_HOST,
  dbPort: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
  dbName: process.env.DB_NAME,
  dbUser: process.env.DB_USER,
  dbPassword: process.env.DB_PASSWORD,
  databaseSsl: String(process.env.DB_SSL || "true").toLowerCase() === "true",
  redis: {
    enabled: String(process.env.REDIS_ENABLED || "false").toLowerCase() === "true"
      || Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN),
    provider: process.env.REDIS_PROVIDER || (process.env.UPSTASH_REDIS_REST_URL ? "upstash-rest" : "tcp"),
    url: process.env.REDIS_URL,
    upstashUrl: process.env.UPSTASH_REDIS_REST_URL,
    upstashToken: process.env.UPSTASH_REDIS_REST_TOKEN,
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_PORT || 6379),
    username: process.env.REDIS_USERNAME,
    password: process.env.REDIS_PASSWORD,
    database: Number(process.env.REDIS_DB || 0),
    tls: String(process.env.REDIS_TLS || "false").toLowerCase() === "true",
    stream: process.env.REDIS_SCAN_STREAM || "bugbusters:scan-jobs",
    deadLetterStream: process.env.REDIS_SCAN_DLQ_STREAM || "bugbusters:scan-jobs:dead-letter",
    scheduleStream: process.env.REDIS_SCHEDULE_STREAM || "bugbusters:scheduled-scans",
    group: process.env.REDIS_SCAN_GROUP || "bugbusters-scan-workers",
    consumer: process.env.REDIS_SCAN_CONSUMER || `${process.env.HOSTNAME || "backend"}-${process.pid}`,
    blockMs: Number(process.env.REDIS_SCAN_BLOCK_MS || 5000),
    pollMs: Number(process.env.REDIS_SCAN_POLL_MS || 2000),
    claimIdleMs: Number(process.env.REDIS_SCAN_CLAIM_IDLE_MS || 60000),
    maxAttempts: Math.max(1, Number(process.env.REDIS_SCAN_MAX_ATTEMPTS || 3)),
    concurrency: Math.max(1, Number(process.env.SCAN_WORKER_CONCURRENCY || 2))
  },
  scannerApiToken: process.env.SCANNER_API_TOKEN,
  rotation: {
    requireApproval: String(process.env.SECRET_ROTATION_REQUIRE_APPROVAL || "true").toLowerCase() === "true",
    brokerUrl: process.env.SECRET_ROTATION_BROKER_URL,
    brokerToken: process.env.SECRET_ROTATION_BROKER_TOKEN,
    timeoutMs: Number(process.env.SECRET_ROTATION_TIMEOUT_MS || 15000)
  },
  webhook: {
    secrets: {
      github: process.env.GITHUB_WEBHOOK_SECRET,
      gitlab: process.env.GITLAB_WEBHOOK_SECRET,
      bitbucket: process.env.BITBUCKET_WEBHOOK_SECRET,
      azuredevops: process.env.AZURE_DEVOPS_WEBHOOK_SECRET
    },
    providerTokens: {
      github: process.env.GITHUB_TOKEN || process.env.GITHUB_ENTERPRISE_TOKEN,
      gitlab: process.env.GITLAB_TOKEN,
      bitbucket: process.env.BITBUCKET_TOKEN,
      azuredevops: process.env.AZURE_DEVOPS_TOKEN
    },
    providerHosts: {
      github: String(process.env.GITHUB_ENTERPRISE_HOSTS || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean),
      gitlab: String(process.env.GITLAB_ENTERPRISE_HOSTS || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean),
      bitbucket: String(process.env.BITBUCKET_ENTERPRISE_HOSTS || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean),
      azuredevops: String(process.env.AZURE_DEVOPS_HOSTS || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean)
    }
  },
  advisory: {
    allowCustomFeeds: String(process.env.ADVISORY_ALLOW_CUSTOM_FEEDS || "false").toLowerCase() === "true",
    offlineMode: String(process.env.ADVISORY_OFFLINE_MODE || "true").toLowerCase() === "true",
    internalHosts: String(process.env.INTERNAL_ADVISORY_HOSTS || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean)
    ,sourceMode: process.env.ADVISORY_SOURCE_MODE || "manual",
    allowExternalFeeds: String(process.env.ADVISORY_ALLOW_EXTERNAL_FEEDS || "false").toLowerCase() === "true"
  },
  identity: {
    ssoEnabled: String(process.env.SSO_ENABLED || "false").toLowerCase() === "true",
    oidcIssuer: process.env.OIDC_ISSUER,
    oidcClientId: process.env.OIDC_CLIENT_ID,
    oidcClientSecret: process.env.OIDC_CLIENT_SECRET,
    mfaRequired: String(process.env.MFA_REQUIRED || "false").toLowerCase() === "true",
    mfaEncryptionKey: process.env.MFA_ENCRYPTION_KEY || process.env.JWT_SECRET || "change-this-secret"
  },
  mail: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false").toLowerCase() === "true",
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.MAIL_FROM || "Security Scanner <security@example.com>"
  }
};
