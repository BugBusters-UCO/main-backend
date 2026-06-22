const jobs = new Map();
const { ScanJob } = require("../models");

async function createJob(job) {
  jobs.set(job.id, job);
  if (ScanJob) {
    await ScanJob.create(_dbJob(job));
  }
  return job;
}

async function updateJob(jobId, patch) {
  const existing = jobs.get(jobId);
  if (!existing && !ScanJob) return null;
  const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  jobs.set(jobId, updated);
  if (ScanJob) {
    await ScanJob.update(_dbJob(updated), { where: { id: jobId } });
    const dbJob = await ScanJob.findByPk(jobId);
    return dbJob ? _plainJob(dbJob) : updated;
  }
  return updated;
}

async function getJob(jobId) {
  if (ScanJob) {
    const dbJob = await ScanJob.findByPk(jobId);
    if (dbJob) return _plainJob(dbJob);
  }
  return jobs.get(jobId) || null;
}

async function listJobs(filters = {}) {
  if (ScanJob) {
    const where = {};
    if (filters.userId) where.userId = filters.userId;
    if (filters.scannerType) where.scannerType = filters.scannerType;
    const dbJobs = await ScanJob.findAll({ where, order: [["createdAt", "DESC"]], limit: filters.limit || 100 });
    return dbJobs.map(_plainJob);
  }
  return Array.from(jobs.values())
    .filter((job) => !filters.userId || job.userId === filters.userId)
    .filter((job) => !filters.scannerType || job.scannerType === filters.scannerType)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

module.exports = { createJob, updateJob, getJob, listJobs };

function _dbJob(job) {
  return {
    id: job.id,
    userId: job.userId || null,
    importedRepositoryId: job.importedRepositoryId || null,
    scannerType: job.scannerType || "dependency",
    sourceType: job.sourceType,
    sourceLabel: job.sourceLabel,
    status: job.status,
    result: job.result || null,
    error: job.error || null,
    completedAt: job.completedAt || null
  };
}

function _plainJob(dbJob) {
  const plain = dbJob.toJSON();
  return {
    ...plain,
    createdAt: plain.createdAt instanceof Date ? plain.createdAt.toISOString() : plain.createdAt,
    updatedAt: plain.updatedAt instanceof Date ? plain.updatedAt.toISOString() : plain.updatedAt,
    completedAt: plain.completedAt instanceof Date ? plain.completedAt.toISOString() : plain.completedAt
  };
}
