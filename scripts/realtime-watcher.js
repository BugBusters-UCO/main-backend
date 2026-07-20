const fs = require('fs');
const path = require('path');
const axios = require('axios');
const os = require('os');

// Configuration
const WATCH_DIR = process.argv[2] || path.join(__dirname, '..', 'workspace'); 
const SCANNER_API = 'http://127.0.0.1:8002/api/v1/scans';
const ALERTS_API = 'http://127.0.0.1:5000/api/proxy/alerts';

// Ensure watch directory exists
if (!fs.existsSync(WATCH_DIR)) {
    fs.mkdirSync(WATCH_DIR, { recursive: true });
}

console.log(`\n🛡️  Zero Trust Endpoint Detection Active!`);
console.log(`👀 Watching for malicious file injections in: ${WATCH_DIR}\n`);

// Simple debounce to prevent multiple triggers for a single save event
let timeout = null;

fs.watch(WATCH_DIR, { recursive: true }, (eventType, filename) => {
    if (!filename) return;

    // Ignore temporary files, git, or node_modules
    if (filename.includes('.git') || filename.includes('node_modules') || filename.endsWith('~')) return;

    clearTimeout(timeout);
    
    timeout = setTimeout(async () => {
        const fullPath = path.join(WATCH_DIR, filename);
        
        // Wait briefly to ensure file write is complete
        await new Promise(resolve => setTimeout(resolve, 100));

        if (!fs.existsSync(fullPath)) {
            return; // File was deleted, ignore
        }

        console.log(`\n[WATCHER] ⚠️ File modification detected: ${filename}`);
        console.log(`[SCAN] Instantly scanning ${filename} for vulnerabilities...`);

        try {
            // We pass the workspace directory to the scanner and let it scan. 
            // In a production EDR, we might pass just the specific file.
            // But since the scanner takes a project_path, we pass the workspace root.
            const scanResult = await axios.post(SCANNER_API, {
                project_path: WATCH_DIR,
                max_depth: 3
            });

            // Filter findings that only relate to the modified file
            const fileFindings = scanResult.data.findings.filter(f => 
                f.file_path.endsWith(filename) || filename.endsWith(f.file_path)
            );

            const totalFindings = fileFindings.length;

            if (totalFindings > 0) {
                console.log(`\n[BLOCK] 🚨 INSIDER THREAT / CODEBASE COMPROMISE DETECTED!`);
                console.log(`[BLOCK] ${filename} contains ${totalFindings} severe misconfigurations.`);
                console.log(`[BLOCK] Triggering Dashboard Alert...\n`);

                const machineInfo = {
                    ip: '127.0.0.1 (Local System)',
                    userAgent: `OS: ${os.type()} ${os.release()}`,
                    actionTaken: "ALERT_TRIGGERED & FORENSICS_LOGGED"
                };

                // Send Alert to Backend
                await axios.post(ALERTS_API, {
                    type: 'CODEBASE_COMPROMISE',
                    package: filename,
                    message: `Insider Threat: Malicious code injected into ${filename} directly on the filesystem.`,
                    findings: {
                        error: `Local Endpoint Scanner found ${totalFindings} issues.`,
                        threatLevel: "CRITICAL",
                        origin: machineInfo,
                        details: fileFindings
                    }
                });

                console.log(`✅ Alert successfully sent to dashboard.`);
            } else {
                console.log(`[PASS] ✅ ${filename} is safe. No vulnerabilities detected.`);
            }

        } catch (error) {
            console.error(`[ERROR] Failed to scan or alert:`, error.message);
        }

    }, 300); // 300ms debounce
});
