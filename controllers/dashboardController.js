const { ScanJob, ScheduledScan, Agent, GithubAccount } = require("../models");
const { userIdFromAuthToken } = require("../services/githubAccountService");

async function getDashboardStats(req, res, next) {
  try {
    const authToken = req.query.authToken || req.headers.authorization?.replace("Bearer ", "");
    const userId = userIdFromAuthToken(authToken);

    const whereClause = userId ? { userId } : {};

    // Get all scan jobs
    const scans = await ScanJob.findAll({
      where: whereClause,
      attributes: ["status", "scannerType", "result", "createdAt", "sourceLabel"]
    });

    let totalScans = scans.length;
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

      const aggregateSeverities = (items, type) => {
        items.forEach(item => {
          totalFindings++;
          scannerDetails[type].findings++;
          const sev = (item.severity || 'low').toLowerCase();
          if (sev === 'critical') {
            criticalFindings++;
            scannerDetails[type].critical++;
          } else if (sev === 'high') {
            scannerDetails[type].high++;
          } else if (sev === 'medium' || sev === 'moderate') {
            scannerDetails[type].medium++;
          } else {
            scannerDetails[type].low++;
          }
        });
      };

      if (scan.result) {
        if (scan.scannerType === "dependency" && Array.isArray(scan.result.vulnerabilities)) {
          aggregateSeverities(scan.result.vulnerabilities, "dependency");
        } else if (scan.scannerType === "config" && Array.isArray(scan.result.misconfigurations)) {
          aggregateSeverities(scan.result.misconfigurations, "config");
        } else if (scan.scannerType === "secret" && Array.isArray(scan.result.secrets)) {
          aggregateSeverities(scan.result.secrets, "secret");
        } else if (scan.scannerType === "cipher" && Array.isArray(scan.result.weaknesses)) {
          aggregateSeverities(scan.result.weaknesses, "cipher");
        }
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
    const recentScans = await ScanJob.findAll({
      where: whereClause,
      attributes: ["id", "sourceLabel", "scannerType", "status", "createdAt"],
      order: [["createdAt", "DESC"]],
      limit: 5
    });

    // Riskiest Assets
    const assetRisks = {};
    
    // Trend Data (Last 7 days)
    const trendMap = {};
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        trendMap[d.toISOString().split('T')[0]] = 0;
    }

    scans.forEach(scan => {
      // Riskiest Assets logic
      if (scan.sourceLabel) {
        if (!assetRisks[scan.sourceLabel]) {
            assetRisks[scan.sourceLabel] = { critical: 0, high: 0 };
        }
        if (scan.result) {
            let items = [];
            if (scan.scannerType === "dependency") items = scan.result.vulnerabilities || [];
            if (scan.scannerType === "config") items = scan.result.misconfigurations || [];
            if (scan.scannerType === "secret") items = scan.result.secrets || [];
            if (scan.scannerType === "cipher") items = scan.result.weaknesses || [];
            
            items.forEach(item => {
                const sev = (item.severity || 'low').toLowerCase();
                if (sev === 'critical') assetRisks[scan.sourceLabel].critical++;
                else if (sev === 'high') assetRisks[scan.sourceLabel].high++;
            });
        }
      }

      // Trend logic
      if (scan.createdAt) {
        const dateStr = new Date(scan.createdAt).toISOString().split('T')[0];
        if (trendMap[dateStr] !== undefined) {
            let scanFindings = 0;
            if (scan.result) {
                if (scan.scannerType === "dependency") scanFindings = (scan.result.vulnerabilities || []).length;
                if (scan.scannerType === "config") scanFindings = (scan.result.misconfigurations || []).length;
                if (scan.scannerType === "secret") scanFindings = (scan.result.secrets || []).length;
                if (scan.scannerType === "cipher") scanFindings = (scan.result.weaknesses || []).length;
            }
            trendMap[dateStr] += scanFindings;
        }
      }
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
