const express = require('express');
const { spawn } = require('child_process');
const path = require('path');

const router = express.Router();

let activeWatcherProcess = null;

router.post('/start-watch', (req, res) => {
    const { folderPath } = req.body;

    if (!folderPath) {
        return res.status(400).json({ error: "folderPath is required" });
    }

    // Terminate existing watcher if running
    if (activeWatcherProcess) {
        activeWatcherProcess.kill();
        activeWatcherProcess = null;
    }

    const scriptPath = path.join(__dirname, '..', 'scripts', 'realtime-watcher.js');
    
    // Spawn the node script as a child process
    activeWatcherProcess = spawn('node', [scriptPath, folderPath]);

    activeWatcherProcess.stdout.on('data', (data) => {
        console.log(`[EDR Watcher] ${data}`);
    });

    activeWatcherProcess.stderr.on('data', (data) => {
        console.error(`[EDR Watcher Error] ${data}`);
    });

    res.json({ message: `Started real-time monitoring on ${folderPath}` });
});

router.post('/stop-watch', (req, res) => {
    if (activeWatcherProcess) {
        activeWatcherProcess.kill();
        activeWatcherProcess = null;
        res.json({ message: "Stopped real-time monitoring" });
    } else {
        res.json({ message: "No active watcher to stop" });
    }
});

module.exports = router;
