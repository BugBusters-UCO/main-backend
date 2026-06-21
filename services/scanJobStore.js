const jobs = new Map();

function createJob(job) {
  jobs.set(job.id, job);
  return job;
}

function updateJob(jobId, patch) {
  const existing = jobs.get(jobId);
  if (!existing) return null;
  const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  jobs.set(jobId, updated);
  return updated;
}

function getJob(jobId) {
  return jobs.get(jobId) || null;
}

function listJobs() {
  return Array.from(jobs.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

module.exports = { createJob, updateJob, getJob, listJobs };
