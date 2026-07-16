const counters = Object.create(null);

function increment(name, amount = 1) { counters[name] = (counters[name] || 0) + amount; }
function snapshot() { return { ...counters, capturedAt: new Date().toISOString() }; }
function reset() { for (const key of Object.keys(counters)) delete counters[key]; }

module.exports = { increment, reset, snapshot };
