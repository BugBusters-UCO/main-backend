const { randomUUID } = require("crypto");

const { ScheduledScan, ImportedRepository, GithubAccount } = require("../models");
const { normalizeScanners, startGithubScanBatch } = require("./scanBatchService");
const { getRiskAssessment } = require("./riskAssessmentService");
const { sendRiskAssessmentReport } = require("./mailService");
const { buildRiskReportPdf } = require("./riskReportPdfService");

const memorySchedules = new Map();
const activeScheduleRuns = new Set();
const FREQUENCIES = new Set(["daily", "weekly", "monthly"]);
const TICK_MS = 60 * 1000;
const WAIT_MS = 4 * 1000;
const MAX_WAIT_MS = 45 * 60 * 1000;

let schedulerTimer = null;

async function createScheduledScan(userId, input = {}) {
  const repository = await resolveRepository(userId, input.importedRepositoryId || input.imported_repository_id);
  const payload = sanitizeScheduleInput(input, repository);
  payload.userId = userId;
  payload.importedRepositoryId = repository.id;
  payload.sourceLabel = repository.fullName;
  payload.nextRunAt = calculateNextRunAt(payload).toISOString();
  payload.lastScanJobIds = [];

  if (ScheduledScan) {
    const row = await ScheduledScan.create(payload);
    return plain(row);
  }

  const schedule = {
    id: randomUUID(),
    ...payload,
    running: false,
    lastRunAt: null,
    lastStatus: null,
    lastRiskAssessmentId: null,
    lastError: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  memorySchedules.set(schedule.id, schedule);
  return schedule;
}

async function listScheduledScans(userId) {
  if (ScheduledScan) {
    const rows = await ScheduledScan.findAll({
      where: { userId },
      order: [["createdAt", "DESC"]],
      limit: 200
    });
    return rows.map(plain);
  }
  return Array.from(memorySchedules.values())
    .filter((schedule) => schedule.userId === userId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

async function getScheduledScan(userId, scheduleId) {
  if (ScheduledScan) {
    const row = await ScheduledScan.findOne({ where: { id: scheduleId, userId } });
    return row ? plain(row) : null;
  }
  const schedule = memorySchedules.get(scheduleId);
  return schedule?.userId === userId ? schedule : null;
}

async function updateScheduledScan(userId, scheduleId, input = {}) {
  const existing = await getScheduledScan(userId, scheduleId);
  if (!existing) return null;

  const repository = input.importedRepositoryId || input.imported_repository_id
    ? await resolveRepository(userId, input.importedRepositoryId || input.imported_repository_id)
    : await resolveRepository(userId, existing.importedRepositoryId);
  const patch = sanitizeScheduleInput({ ...existing, ...input }, repository);
  patch.importedRepositoryId = repository.id;
  patch.sourceLabel = repository.fullName;
  patch.nextRunAt = calculateNextRunAt(patch).toISOString();

  if (ScheduledScan) {
    await ScheduledScan.update(patch, { where: { id: scheduleId, userId } });
    return getScheduledScan(userId, scheduleId);
  }

  const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  memorySchedules.set(scheduleId, updated);
  return updated;
}

async function deleteScheduledScan(userId, scheduleId) {
  if (ScheduledScan) {
    return ScheduledScan.destroy({ where: { id: scheduleId, userId } });
  }
  const existing = await getScheduledScan(userId, scheduleId);
  if (!existing) return 0;
  memorySchedules.delete(scheduleId);
  return 1;
}

async function runScheduleNow(userId, scheduleId) {
  const schedule = await getScheduledScan(userId, scheduleId);
  if (!schedule) return null;
  runSchedule(schedule.id).catch((error) => console.error(`Scheduled scan ${schedule.id} failed:`, error.message));
  return updateSchedule(schedule.id, { lastStatus: "queued", lastError: null });
}

function startScheduledScanWorker() {
  if (schedulerTimer) return;
  schedulerTimer = setInterval(() => {
    runDueSchedules().catch((error) => console.error("Scheduled scan worker failed:", error.message));
  }, TICK_MS);
  schedulerTimer.unref?.();
  runDueSchedules().catch((error) => console.error("Scheduled scan worker failed:", error.message));
  console.log("Scheduled scan worker started.");
}

async function runDueSchedules() {
  const now = new Date();
  const schedules = await loadRunnableSchedules();
  for (const schedule of schedules) {
    if (!schedule.enabled || schedule.running || activeScheduleRuns.has(schedule.id)) continue;
    if (!schedule.nextRunAt || new Date(schedule.nextRunAt).getTime() > now.getTime()) continue;
    runSchedule(schedule.id).catch((error) => console.error(`Scheduled scan ${schedule.id} failed:`, error.message));
  }
}

async function runSchedule(scheduleId) {
  if (activeScheduleRuns.has(scheduleId)) return;
  activeScheduleRuns.add(scheduleId);

  const schedule = await getScheduleById(scheduleId);
  if (!schedule || !schedule.enabled || schedule.running) {
    activeScheduleRuns.delete(scheduleId);
    return;
  }

  await updateSchedule(schedule.id, {
    running: true,
    lastRunAt: new Date().toISOString(),
    lastStatus: "running",
    lastError: null
  });

  try {
    const repository = await resolveRepository(schedule.userId, schedule.importedRepositoryId);
    const account = repository.githubAccountId && GithubAccount
      ? await GithubAccount.findOne({ where: { id: repository.githubAccountId, userId: schedule.userId } })
      : null;
    const batch = await startGithubScanBatch(schedule.userId, {
      repository,
      githubToken: account?.accessToken,
      scanners: schedule.scanners,
      businessContext: schedule.businessContext,
      policy: {
        failOn: "high",
        includeLow: true,
        includeDev: true,
        useOsv: true,
        bankingProfile: "strict",
        enableLiveProbe: true
      }
    });

    await updateSchedule(schedule.id, {
      lastStatus: "scanning",
      lastScanJobIds: batch.jobs.map((job) => job.id),
      lastRiskAssessmentId: batch.assessment.id
    });

    await batch.completion;
    const assessment = await waitForAssessment(schedule.userId, batch.assessment.id);
    let mailError = null;

    if (assessment?.status === "completed" && schedule.reportEmail) {
      try {
        const pdf = buildRiskReportPdf(assessment);
        const mailResult = await sendRiskAssessmentReport(schedule.reportEmail, assessment, pdf);
        if (mailResult.skipped) mailError = mailResult.reason;
      } catch (error) {
        mailError = error.message || "Risk report email failed";
      }
    }

    await updateSchedule(schedule.id, {
      running: false,
      lastStatus: assessment?.status === "completed" ? "completed" : (assessment?.status || "completed"),
      lastRiskAssessmentId: batch.assessment.id,
      nextRunAt: calculateNextRunAt(schedule, new Date(Date.now() + 1000)).toISOString(),
      lastError: assessment?.error || mailError
    });
  } catch (error) {
    await updateSchedule(schedule.id, {
      running: false,
      lastStatus: "failed",
      nextRunAt: calculateNextRunAt(schedule, new Date(Date.now() + 1000)).toISOString(),
      lastError: error.message || "Scheduled scan failed"
    });
  } finally {
    activeScheduleRuns.delete(scheduleId);
  }
}

async function waitForAssessment(userId, assessmentId) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < MAX_WAIT_MS) {
    const assessment = await getRiskAssessment(userId, assessmentId);
    if (assessment && ["completed", "failed", "cancelled"].includes(assessment.status)) return assessment;
    await delay(WAIT_MS);
  }
  return getRiskAssessment(userId, assessmentId);
}

async function resolveRepository(userId, importedRepositoryId) {
  if (!ImportedRepository) {
    const error = new Error("Database is required for scheduled GitHub repository scans");
    error.statusCode = 400;
    throw error;
  }
  const repository = await ImportedRepository.findOne({
    where: { id: importedRepositoryId, userId },
    include: GithubAccount ? [{ model: GithubAccount, as: "githubAccount", required: false }] : []
  });
  if (!repository) {
    const error = new Error("Imported repository not found");
    error.statusCode = 404;
    throw error;
  }
  return plain(repository);
}

async function loadRunnableSchedules() {
  if (ScheduledScan) {
    const rows = await ScheduledScan.findAll({
      where: { enabled: true },
      order: [["nextRunAt", "ASC"]],
      limit: 100
    });
    return rows.map(plain);
  }
  return Array.from(memorySchedules.values()).filter((schedule) => schedule.enabled);
}

async function getScheduleById(scheduleId) {
  if (ScheduledScan) {
    const row = await ScheduledScan.findByPk(scheduleId);
    return row ? plain(row) : null;
  }
  return memorySchedules.get(scheduleId) || null;
}

async function updateSchedule(scheduleId, patch) {
  const payload = { ...patch, updatedAt: new Date().toISOString() };
  if (ScheduledScan) {
    await ScheduledScan.update(payload, { where: { id: scheduleId } });
    return getScheduleById(scheduleId);
  }
  const existing = memorySchedules.get(scheduleId);
  if (!existing) return null;
  const updated = { ...existing, ...payload };
  memorySchedules.set(scheduleId, updated);
  return updated;
}

function sanitizeScheduleInput(input, repository) {
  const frequency = FREQUENCIES.has(String(input.frequency)) ? String(input.frequency) : "daily";
  const timeOfDay = validTime(input.timeOfDay || input.time_of_day) ? String(input.timeOfDay || input.time_of_day) : "09:00";
  return {
    name: String(input.name || `${repository.fullName} scheduled scan`).slice(0, 120),
    sourceType: "github",
    sourceLabel: repository.fullName,
    scanners: normalizeScanners(input.scanners),
    frequency,
    timeOfDay,
    timesPerDay: clamp(Number(input.timesPerDay || input.times_per_day || 1), 1, 8),
    weekdays: intArray(input.weekdays, 0, 6),
    monthDays: intArray(input.monthDays || input.month_days, 1, 31),
    timezone: String(input.timezone || "Asia/Calcutta").slice(0, 64),
    businessContext: normalizeBusinessContext(input.businessContext || input.business_context),
    reportEmail: input.reportEmail || input.report_email || null,
    enabled: input.enabled !== false && String(input.enabled) !== "false"
  };
}

function calculateNextRunAt(schedule, from = new Date()) {
  const candidates = [];
  for (let dayOffset = 0; dayOffset < 400; dayOffset += 1) {
    const day = new Date(from);
    day.setDate(day.getDate() + dayOffset);
    if (!dayMatches(schedule, day)) continue;
    for (const [hour, minute] of dailyTimes(schedule.timeOfDay, schedule.timesPerDay)) {
      const candidate = new Date(day);
      candidate.setHours(hour, minute, 0, 0);
      if (candidate.getTime() > from.getTime()) candidates.push(candidate);
    }
    if (candidates.length) return candidates.sort((a, b) => a.getTime() - b.getTime())[0];
  }
  const fallback = new Date(from);
  fallback.setDate(fallback.getDate() + 1);
  fallback.setHours(9, 0, 0, 0);
  return fallback;
}

function dayMatches(schedule, day) {
  if (schedule.frequency === "daily") return true;
  if (schedule.frequency === "weekly") {
    const days = intArray(schedule.weekdays, 0, 6);
    return !days.length ? true : days.includes(day.getDay());
  }
  const monthDays = intArray(schedule.monthDays, 1, 31);
  return !monthDays.length ? day.getDate() === 1 : monthDays.includes(day.getDate());
}

function dailyTimes(timeOfDay, timesPerDay) {
  const [baseHour, baseMinute] = String(timeOfDay || "09:00").split(":").map(Number);
  const count = clamp(Number(timesPerDay || 1), 1, 8);
  const interval = Math.max(1, Math.floor(24 / count));
  return Array.from({ length: count }, (_value, index) => {
    const hour = (baseHour + index * interval) % 24;
    return [hour, baseMinute || 0];
  });
}

function normalizeBusinessContext(context = {}) {
  const value = (key) => clamp(Number(context[key] ?? 5), 0, 10);
  return {
    assetCriticality: value("assetCriticality"),
    dataSensitivity: value("dataSensitivity"),
    businessImpact: value("businessImpact"),
    internetExposure: value("internetExposure"),
    complianceRequirement: value("complianceRequirement"),
    exploitWindow: value("exploitWindow")
  };
}

function validTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));
}

function intArray(value, min, max) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(Number).filter((item) => Number.isInteger(item) && item >= min && item <= max))).sort((a, b) => a - b);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function plain(row) {
  const value = typeof row.toJSON === "function" ? row.toJSON() : row;
  for (const key of ["createdAt", "updatedAt", "lastRunAt", "nextRunAt"]) {
    if (value[key] instanceof Date) value[key] = value[key].toISOString();
  }
  return value;
}

module.exports = {
  createScheduledScan,
  deleteScheduledScan,
  getScheduledScan,
  listScheduledScans,
  runDueSchedules,
  runScheduleNow,
  startScheduledScanWorker,
  updateScheduledScan
};
