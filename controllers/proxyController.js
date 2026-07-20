const { ProxyAlert } = require("../models");

let clients = [];

// SSE Endpoint for frontend to subscribe to events
function eventsStream(req, res) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // Add this client to the pool
    clients.push(res);

    req.on("close", () => {
        clients = clients.filter(client => client !== res);
    });
}

// Webhook for Security Proxy to push alerts to the dashboard
async function receiveAlert(req, res, next) {
    try {
        const alertData = req.body;

        // Save to DB
        const savedAlert = await ProxyAlert.create({
            type: alertData.type,
            packageName: alertData.package,
            message: alertData.message,
            findings: alertData.findings || null
        });
        
        const payload = JSON.stringify({
            id: savedAlert.id,
            timestamp: savedAlert.createdAt,
            ...alertData
        });

        // Broadcast to all connected frontend clients
        clients.forEach(client => client.write(`data: ${payload}\n\n`));

        return res.status(202).json({ accepted: true, broadcastedTo: clients.length });
    } catch (error) {
        return next(error);
    }
}

async function getAlerts(req, res, next) {
    try {
        const alerts = await ProxyAlert.findAll({
            order: [['createdAt', 'DESC']],
            limit: 100
        });
        return res.json(alerts);
    } catch (error) {
        return next(error);
    }
}

module.exports = {
    eventsStream,
    receiveAlert,
    getAlerts
};
