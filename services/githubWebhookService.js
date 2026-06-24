const crypto = require("crypto");

const env = require("../config/env");
const { loadSequelize } = require("../dbConnection/sequelize");
const { GithubAccount, ImportedRepository } = require("../models");
const { startImportedRepositoryConfigScan } = require("../controllers/configScanController");
const { startImportedRepositoryDependencyScan } = require("../controllers/scanController");

const recentDeliveries = new Map();
const DELIVERY_TTL_MS = 10 * 60 * 1000;

function parseWebhookBody(req) {
  if (Buffer.isBuffer(req.body)) {
    return JSON.parse(req.body.toString("utf8"));
  }
  return req.body || {};
}

function verifyGithubSignature(req) {
  if (!env.github.webhookSecret) {
    return { verified: false, reason: "GITHUB_WEBHOOK_SECRET is not configured" };
  }
  const signature = req.headers["x-hub-signature-256"];
  if (!signature || !Buffer.isBuffer(req.body)) {
    const error = new Error("Missing GitHub webhook signature");
    error.statusCode = 401;
    throw error;
  }

  const expected = `sha256=${crypto
    .createHmac("sha256", env.github.webhookSecret)
    .update(req.body)
    .digest("hex")}`;

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    const error = new Error("Invalid GitHub webhook signature");
    error.statusCode = 401;
    throw error;
  }
  return { verified: true, reason: "signature matched" };
}

function shouldProcessDelivery(deliveryId) {
  if (!deliveryId) return true;
  const now = Date.now();
  for (const [id, timestamp] of recentDeliveries.entries()) {
    if (now - timestamp > DELIVERY_TTL_MS) recentDeliveries.delete(id);
  }
  if (recentDeliveries.has(deliveryId)) return false;
  recentDeliveries.set(deliveryId, now);
  return true;
}

async function findImportedRepositoriesForPush(payload) {
  if (!ImportedRepository) return [];
  const sequelizePackage = loadSequelize();
  const Op = sequelizePackage?.Op;
  const repoId = payload.repository?.id;
  const fullName = payload.repository?.full_name;
  const where = [];
  if (repoId) where.push({ githubRepoId: repoId });
  if (fullName) where.push({ fullName });
  if (!where.length) return [];

  return ImportedRepository.findAll({
    where: Op ? { [Op.or]: where } : where[0],
    include: GithubAccount ? [{ model: GithubAccount, as: "githubAccount" }] : []
  });
}

async function startScansForPush({ repositories, payload, verified }) {
  const jobs = [];
  const trigger = `github-push:${payload.after || payload.head_commit?.id || "unknown"}`;
  const scanTypes = new Set(env.github.autoScanTypes);

  for (const repositoryModel of repositories) {
    const repository = repositoryModel.toJSON ? repositoryModel.toJSON() : repositoryModel;
    const githubToken = repository.githubAccount?.accessToken;
    if (!githubToken) {
      jobs.push({
        repository: repository.fullName,
        skipped: true,
        reason: "No stored GitHub token for imported repository"
      });
      continue;
    }

    if (scanTypes.has("dependency")) {
      const job = await startImportedRepositoryDependencyScan({ repository, githubToken, trigger });
      jobs.push({ scannerType: "dependency", jobId: job.id, repository: repository.fullName });
    }
    if (scanTypes.has("config")) {
      const job = await startImportedRepositoryConfigScan({ repository, githubToken, trigger });
      jobs.push({ scannerType: "config", jobId: job.id, repository: repository.fullName });
    }
  }

  return {
    verified,
    jobs,
    repositoryCount: repositories.length,
    scanTypes: [...scanTypes]
  };
}

module.exports = {
  findImportedRepositoriesForPush,
  parseWebhookBody,
  shouldProcessDelivery,
  startScansForPush,
  verifyGithubSignature
};
