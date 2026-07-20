const router = require("express").Router();
const { eventsStream, receiveAlert, getAlerts } = require("../controllers/proxyController");

// SSE Stream for the React frontend
router.get("/events", eventsStream);

// REST API for historical alerts
router.get("/alerts", getAlerts);

// Webhook receiver for the Node.js Security Proxy
router.post("/alerts", receiveAlert);

module.exports = router;
