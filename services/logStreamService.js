const { EventEmitter } = require("events");

const emitter = new EventEmitter();
const logsByJob = new Map();

function addLog(jobId, level, message, meta = {}) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    jobId,
    level,
    message,
    meta,
    timestamp: new Date().toISOString()
  };

  const logs = logsByJob.get(jobId) || [];
  logs.push(entry);
  logsByJob.set(jobId, logs.slice(-1000));
  emitter.emit(jobId, entry);
  const metaText = Object.keys(meta || {}).length ? ` ${JSON.stringify(meta)}` : "";
  console.log(`[${jobId}] ${level.toUpperCase()} ${message}${metaText}`);
  return entry;
}

function getLogs(jobId) {
  return logsByJob.get(jobId) || [];
}

function subscribe(jobId, listener) {
  emitter.on(jobId, listener);
  return () => emitter.off(jobId, listener);
}

module.exports = { addLog, getLogs, subscribe };
