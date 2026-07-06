const {
  createScheduledScan,
  deleteScheduledScan,
  getScheduledScan,
  listScheduledScans,
  runScheduleNow,
  updateScheduledScan
} = require("../services/scheduledScanService");

async function createSchedule(req, res, next) {
  try {
    res.status(201).json(await createScheduledScan(req.user.id, req.body || {}));
  } catch (error) {
    next(error);
  }
}

async function listSchedules(req, res, next) {
  try {
    res.json(await listScheduledScans(req.user.id));
  } catch (error) {
    next(error);
  }
}

async function getSchedule(req, res, next) {
  try {
    const schedule = await getScheduledScan(req.user.id, req.params.scheduleId);
    if (!schedule) return res.status(404).json({ message: "Scheduled scan not found" });
    res.json(schedule);
  } catch (error) {
    next(error);
  }
}

async function updateSchedule(req, res, next) {
  try {
    const schedule = await updateScheduledScan(req.user.id, req.params.scheduleId, req.body || {});
    if (!schedule) return res.status(404).json({ message: "Scheduled scan not found" });
    res.json(schedule);
  } catch (error) {
    next(error);
  }
}

async function deleteSchedule(req, res, next) {
  try {
    const deleted = await deleteScheduledScan(req.user.id, req.params.scheduleId);
    if (!deleted) return res.status(404).json({ message: "Scheduled scan not found" });
    res.json({ deleted: true });
  } catch (error) {
    next(error);
  }
}

async function runSchedule(req, res, next) {
  try {
    const schedule = await runScheduleNow(req.user.id, req.params.scheduleId);
    if (!schedule) return res.status(404).json({ message: "Scheduled scan not found" });
    res.status(202).json(schedule);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createSchedule,
  deleteSchedule,
  getSchedule,
  listSchedules,
  runSchedule,
  updateSchedule
};
