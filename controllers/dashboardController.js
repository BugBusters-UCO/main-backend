const { ScanJob, ScheduledScan, Agent, GithubAccount, AgentScanJob } = require("../models");
const { userIdFromAuthToken } = require("../services/githubAccountService");

async function getDashboardStats(req, res, next) {
  try {
    const authToken = req.query.authToken || req.headers.authorization?.replace("Bearer ", "");
    const userId = userIdFromAuthToken(authToken);

    const whereClause = userId ? { userId } : {};

    // Get all cloud scan jobs
    const scans = await ScanJob.findAll({
      where: whereClause,
      attributes: ["id", "status", "scannerType", "result", "createdAt", "sourceLabel"]
    });

    // Get all agent scan jobs
    const agentScans = await AgentScanJob.findAll({
      where: whereClause,
      attributes: ["id", "status", "modules", "result", "createdAt", "sourceLabel"]
    });

    let totalScans = scans.length + agentScans.length;
    let successfulScans = 0;
    let failedScans = 0;
    let totalFindings = 0;
    let criticalFindings = 0;

    let scanCounts = {
      dependency: 0,
      config: 0,
      secret: 0,
      cipher: 0
    };

    let scannerDetails = {
      dependency: { scans: 0, findings: 0, critical: 0, high: 0, medium: 0, low: 0 },
      config: { scans: 0, findings: 0, critical: 0, high: 0, medium: 0, low: 0 },
      secret: { scans: 0, findings: 0, critical: 0, high: 0, medium: 0, low: 0 },
      cipher: { scans: 0, findings: 0, critical: 0, high: 0, medium: 0, low: 0 }
    };

    const aggregateSeverities = (items, type) => {
      items.forEach(item => {
        totalFindings++;
        if (scannerDetails[type]) scannerDetails[type].findings++;
        const sev = (item.severity || 'low').toLowerCase();
        if (sev === 'critical') {
          criticalFindings++;
          if (scannerDetails[type]) scannerDetails[type].critical++;
        } else if (sev === 'high') {
          if (scannerDetails[type]) scannerDetails[type].high++;
        } else if (sev === 'medium' || sev === 'moderate') {
          if (scannerDetails[type]) scannerDetails[type].medium++;
        } else {
          if (scannerDetails[type]) scannerDetails[type].low++;
        }
      });
    };

    // Process Cloud Scans
    scans.forEach((scan) => {
      if (scan.status === "completed") {
        successfulScans++;
      } else if (scan.status === "failed") {
        failedScans++;
      }

      if (scanCounts[scan.scannerType] !== undefined) {
        scanCounts[scan.scannerType]++;
        scannerDetails[scan.scannerType].scans++;
      }

      if (scan.result) {
        if (scan.scannerType === "dependency" && Array.isArray(scan.result.findings)) {
          aggregateSeverities(scan.result.findings, "dependency");
        } else if (scan.scannerType === "config" && Array.isArray(scan.result.findings)) {
          aggregateSeverities(scan.result.findings, "config");
        } else if (scan.scannerType === "secret" && Array.isArray(scan.result.findings)) {
          aggregateSeverities(scan.result.findings, "secret");
        } else if (scan.scannerType === "cipher" && Array.isArray(scan.result.findings)) {
          aggregateSeverities(scan.result.findings, "cipher");
        }
      }
    });

    // Process Agent Scans
    agentScans.forEach((agentScan) => {
      if (agentScan.status === "completed") {
        successfulScans++;
      } else if (agentScan.status === "failed") {
        failedScans++;
      }

      const modules = agentScan.modules || [];
      modules.forEach(mod => {
        if (scanCounts[mod] !== undefined) {
          scanCounts[mod]++;
          scannerDetails[mod].scans++;
        }
      });

      if (agentScan.result && Array.isArray(agentScan.result.reports)) {
        agentScan.result.reports.forEach(report => {
          const mod = report.module;
          if (report.result) {
            if (mod === "dependency" && Array.isArray(report.result.findings)) {
              aggregateSeverities(report.result.findings, "dependency");
            } else if (mod === "config" && Array.isArray(report.result.findings)) {
              aggregateSeverities(report.result.findings, "config");
            } else if (mod === "secret" && Array.isArray(report.result.findings)) {
              aggregateSeverities(report.result.findings, "secret");
            } else if (mod === "cipher" && Array.isArray(report.result.findings)) {
              aggregateSeverities(report.result.findings, "cipher");
            }
          }
        });
      }
    });

    // Scheduled Scans
    const scheduledScans = await ScheduledScan.findAll({ where: whereClause, attributes: ["enabled", "lastError"] });
    const totalScheduled = scheduledScans.length;
    const failedScheduled = scheduledScans.filter(s => s.lastError).length;

    // VM Agents
    const agents = await Agent.findAll({ where: whereClause, attributes: ["status"] });
    const totalAgents = agents.length;
    const connectedAgents = agents.filter(a => a.status === "online" || a.status === "scanning").length;

    // Github Connection
    let githubConnected = false;
    if (userId) {
      const githubAccount = await GithubAccount.findOne({ where: { userId } });
      githubConnected = !!githubAccount;
    }

    // Recent Scans
    let recentScansRaw = [
      ...scans.map(s => ({
        id: s.id, sourceLabel: s.sourceLabel, scannerType: s.scannerType, status: s.status, createdAt: s.createdAt
      })),
      ...agentScans.map(s => ({
        id: s.id, sourceLabel: s.sourceLabel, scannerType: `agent (${(s.modules || []).join(", ")})`, status: s.status, createdAt: s.createdAt
      }))
    ];
    
    const recentScans = recentScansRaw
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 5);

    // Riskiest Assets
    const assetRisks = {};
    
    // Trend Data (Last 7 days)
    const trendMap = {};
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        trendMap[d.toISOString().split('T')[0]] = 0;
    }

    const processTrendAndRisks = (sourceLabel, createdAt, items) => {
      // Riskiest Assets logic
      if (sourceLabel) {
        if (!assetRisks[sourceLabel]) {
            assetRisks[sourceLabel] = { critical: 0, high: 0 };
        }
        items.forEach(item => {
            const sev = (item.severity || 'low').toLowerCase();
            if (sev === 'critical') assetRisks[sourceLabel].critical++;
            else if (sev === 'high') assetRisks[sourceLabel].high++;
        });
      }

      // Trend logic
      if (createdAt) {
        const dateStr = new Date(createdAt).toISOString().split('T')[0];
        if (trendMap[dateStr] !== undefined) {
            trendMap[dateStr] += items.length;
        }
      }
    };

    scans.forEach(scan => {
      let items = [];
      if (scan.result) {
          if (scan.scannerType === "dependency") items = scan.result.findings || [];
          if (scan.scannerType === "config") items = scan.result.findings || [];
          if (scan.scannerType === "secret") items = scan.result.findings || [];
          if (scan.scannerType === "cipher") items = scan.result.findings || [];
      }
      processTrendAndRisks(scan.sourceLabel, scan.createdAt, items);
    });

    agentScans.forEach(agentScan => {
      let items = [];
      if (agentScan.result && Array.isArray(agentScan.result.reports)) {
        agentScan.result.reports.forEach(report => {
          if (report.result) {
            if (report.module === "dependency" && report.result.findings) items = items.concat(report.result.findings);
            if (report.module === "config" && report.result.findings) items = items.concat(report.result.findings);
            if (report.module === "secret" && report.result.findings) items = items.concat(report.result.findings);
            if (report.module === "cipher" && report.result.findings) items = items.concat(report.result.findings);
          }
        });
      }
      processTrendAndRisks(agentScan.sourceLabel, agentScan.createdAt, items);
    });

    const riskiestAssets = Object.entries(assetRisks)
        .map(([sourceLabel, counts]) => ({ sourceLabel, criticalCount: counts.critical, highCount: counts.high }))
        .sort((a, b) => b.criticalCount - a.criticalCount || b.highCount - a.highCount)
        .slice(0, 3);

    const trendData = Object.entries(trendMap).map(([date, findingsCount]) => ({ date, findingsCount }));

    res.json({
      totalScans,
      successfulScans,
      failedScans,
      totalFindings,
      criticalFindings,
      scanCounts,
      scannerDetails,
      scheduled: {
        total: totalScheduled,
        failed: failedScheduled
      },
      agents: {
        total: totalAgents,
        connected: connectedAgents
      },
      githubConnected,
      recentScans,
      riskiestAssets,
      trendData
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getDashboardStats
};
