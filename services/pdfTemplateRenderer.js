function renderPdfHtml(assessment, aiReportData) {
  const risk = assessment?.result?.risk || {};
  const findings = risk.top_findings || [];
  const items = aiReportData?.items || [];
  
  const getSeverityColor = (severity) => {
    switch (severity?.toLowerCase()) {
      case "critical": return "#ef4444";
      case "high": return "#f97316";
      case "elevated": return "#eab308";
      case "moderate": return "#3b82f6";
      case "low": return "#22c55e";
      default: return "#9ca3af";
    }
  };

  // Find remediation mapping
  const remediationMap = {};
  items.forEach(item => {
    remediationMap[item.finding_id] = item;
  });

  const findingsHtml = findings.map(finding => {
    const ai = remediationMap[finding.id] || {};
    const steps = ai.remediation_steps || [];
    const stepsHtml = steps.length 
      ? `<ul class="remediation-list">${steps.map(step => `<li>${step}</li>`).join('')}</ul>` 
      : `<p>${finding.remediation || "Review and remediate according to best practices."}</p>`;

    return `
      <div class="finding-card">
        <div class="finding-header">
          <div class="finding-title">
            <span class="severity-badge" style="background-color: ${getSeverityColor(finding.severity)}">${finding.severity.toUpperCase()}</span>
            <h3>${finding.title}</h3>
          </div>
          <div class="finding-score-box">
            <div class="finding-score-label">Risk Score</div>
            <div class="finding-score">${finding.business_adjusted_score}</div>
          </div>
        </div>
        <div class="finding-body">
          <div class="metadata-row">
            <div class="metadata-item">
              <span>Category</span>
              <span>${finding.category}</span>
            </div>
            <div class="metadata-item">
              <span>Scanner</span>
              <span>${finding.scanner.toUpperCase()}</span>
            </div>
            <div class="metadata-item">
              <span>Location</span>
              <span>${finding.file_path || "N/A"}${finding.line_number ? `:${finding.line_number}` : ''}</span>
            </div>
          </div>
          
          <div class="section-title">Business Impact</div>
          <p>${ai.business_impact_explanation || finding.plain_language_summary}</p>
          
          <div class="section-title">Remediation Steps</div>
          ${stepsHtml}
          
          <div class="section-title">Prevention Recommendation</div>
          <p>${ai.prevention_recommendation || "Implement CI/CD checks to prevent regression."}</p>
        </div>
      </div>
    `;
  }).join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
    
    * {
      box-sizing: border-box;
    }
    
    :root {
      --primary: #2563eb;
      --secondary: #475569;
      --accent: #38bdf8;
      --text-main: #1e293b;
      --text-muted: #64748b;
      --bg-light: #f8fafc;
      --border: #e2e8f0;
    }
    
    @page {
      size: A4;
      margin: 20mm;
    }
    
    @page:first {
      margin: 0;
    }

    body {
      font-family: 'Inter', sans-serif;
      color: var(--text-main);
      line-height: 1.6;
      margin: 0;
      padding: 0;
      background-color: #ffffff;
      -webkit-print-color-adjust: exact;
    }
    
    .cover {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      height: 100vh;
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      color: white;
      padding: 80px 60px;
      page-break-after: always;
    }
    
    .cover-header .brand {
      font-size: 24px;
      font-weight: 800;
      letter-spacing: 2px;
      color: var(--accent);
      text-transform: uppercase;
    }
    
    .cover-body {
      margin-top: auto;
      margin-bottom: auto;
    }
    
    .cover h1 {
      font-size: 56px;
      margin: 0 0 16px 0;
      font-weight: 800;
      line-height: 1.1;
      letter-spacing: -1px;
    }
    
    .cover h2 {
      font-size: 28px;
      font-weight: 300;
      color: #94a3b8;
      margin: 0;
    }
    
    .cover-metrics {
      display: flex;
      gap: 30px;
      margin-top: 60px;
    }
    
    .cover-metric-box {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      padding: 24px;
      border-radius: 12px;
      min-width: 200px;
      backdrop-filter: blur(10px);
    }
    
    .cover-metric-label {
      font-size: 13px;
      color: #94a3b8;
      text-transform: uppercase;
      font-weight: 600;
      letter-spacing: 1px;
      margin-bottom: 8px;
    }
    
    .cover-metric-value {
      font-size: 48px;
      font-weight: 800;
      line-height: 1;
    }
    
    .cover-footer {
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      padding-top: 30px;
      display: flex;
      justify-content: space-between;
      color: #cbd5e1;
      font-size: 14px;
    }

    .page {
      padding: 40px 60px;
      page-break-after: always;
      position: relative;
    }
    
    .page:last-child {
      page-break-after: auto;
    }
    
    .header {
      font-size: 28px;
      font-weight: 800;
      color: var(--text-main);
      border-bottom: 3px solid var(--primary);
      padding-bottom: 12px;
      margin-bottom: 32px;
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      page-break-after: avoid;
    }
    
    .card {
      background: #ffffff;
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 24px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
      page-break-inside: avoid;
      break-inside: avoid;
    }
    
    .executive-text {
      font-size: 16px;
      font-weight: 400;
      color: var(--secondary);
      line-height: 1.8;
      margin: 0;
    }
    
    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
      margin-bottom: 24px;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    
    .metric-box {
      background: var(--bg-light);
      padding: 20px;
      border-radius: 12px;
      border: 1px solid var(--border);
      text-align: center;
    }
    
    .metric-box .label {
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--text-muted);
      font-weight: 700;
    }
    
    .metric-box .value {
      font-size: 36px;
      font-weight: 800;
      color: var(--text-main);
      margin-top: 8px;
    }
    
    .finding-card {
      border: 1px solid var(--border);
      border-radius: 12px;
      margin-bottom: 32px;
      page-break-inside: avoid !important;
      break-inside: avoid !important;
      background: #ffffff;
      box-shadow: 0 2px 8px rgba(0,0,0,0.04);
    }
    
    .finding-header {
      background: var(--bg-light);
      padding: 16px 24px;
      border-bottom: 1px solid var(--border);
      border-radius: 12px 12px 0 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
      page-break-after: avoid;
    }
    
    .finding-title {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    
    .finding-title h3 {
      margin: 0;
      font-size: 18px;
      font-weight: 700;
      color: var(--text-main);
    }
    
    .severity-badge {
      color: white;
      padding: 6px 12px;
      border-radius: 6px;
      font-weight: 700;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .finding-score-box {
      text-align: right;
    }
    
    .finding-score-label {
      font-size: 10px;
      text-transform: uppercase;
      color: var(--text-muted);
      font-weight: 700;
      letter-spacing: 1px;
    }
    
    .finding-score {
      font-size: 24px;
      font-weight: 800;
      color: var(--text-main);
      line-height: 1;
    }
    
    .finding-body {
      padding: 24px;
      font-size: 14px;
    }
    
    .metadata-row {
      display: flex;
      flex-wrap: wrap;
      gap: 20px;
      margin-bottom: 20px;
      background: #f1f5f9;
      padding: 12px 16px;
      border-radius: 8px;
    }
    
    .metadata-item {
      display: flex;
      flex-direction: column;
    }
    
    .metadata-item span:first-child {
      font-size: 11px;
      text-transform: uppercase;
      color: var(--text-muted);
      font-weight: 600;
      margin-bottom: 2px;
    }
    
    .metadata-item span:last-child {
      font-weight: 500;
      color: var(--text-main);
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    
    .section-title {
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--primary);
      font-weight: 700;
      margin-top: 24px;
      margin-bottom: 12px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 6px;
      display: flex;
      align-items: center;
      gap: 8px;
      page-break-after: avoid;
    }
    
    .section-title::before {
      content: '';
      display: block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background-color: var(--primary);
    }
    
    .finding-body p {
      margin-top: 0;
      margin-bottom: 16px;
      color: var(--secondary);
      line-height: 1.7;
    }
    
    ul.remediation-list {
      margin: 0 0 20px 0;
      padding-left: 0;
      list-style: none;
    }
    
    ul.remediation-list li {
      margin-bottom: 12px;
      padding-left: 28px;
      position: relative;
      color: var(--secondary);
      line-height: 1.6;
    }
    
    ul.remediation-list li::before {
      content: '→';
      position: absolute;
      left: 0;
      color: var(--primary);
      font-weight: bold;
    }
    
    .priorities-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    
    .priorities-list li {
      padding: 16px;
      border-bottom: 1px solid var(--border);
      display: flex;
      gap: 16px;
      page-break-inside: avoid;
    }
    
    .priorities-list li:last-child {
      border-bottom: none;
    }
    
    .priority-scanner {
      font-weight: 700;
      color: var(--primary);
      background: #eff6ff;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 12px;
      text-transform: uppercase;
      height: fit-content;
      white-space: nowrap;
    }
    
    .priority-text {
      color: var(--secondary);
      line-height: 1.6;
    }
    
    .assessment-context p {
      margin: 8px 0;
    }
  </style>
</head>
<body>

  <!-- Cover Page -->
  <div class="cover">
    <div class="cover-header">
      <div class="brand">BugBusters Enterprise</div>
    </div>
    
    <div class="cover-body">
      <h1>Enterprise Security<br>Risk Report</h1>
      <h2>${risk.project_name || assessment.sourceLabel || "Target Assessment"}</h2>
      
      <div class="cover-metrics">
        <div class="cover-metric-box">
          <div class="cover-metric-label">Final Risk Score</div>
          <div class="cover-metric-value">${risk.final_risk_score ?? "-"}</div>
        </div>
        <div class="cover-metric-box">
          <div class="cover-metric-label">Risk Level</div>
          <div class="cover-metric-value" style="color: ${getSeverityColor(risk.risk_level)}">${(risk.risk_level || "-").toUpperCase()}</div>
        </div>
      </div>
    </div>
    
    <div class="cover-footer">
      <div>
        <strong>Generated:</strong> ${new Date().toLocaleString()}<br>
        <strong>Status:</strong> ${assessment.status.toUpperCase()}
      </div>
      <div style="text-align: right;">
        <strong>Assessment ID:</strong><br>
        <span style="font-family: monospace;">${assessment.id}</span>
      </div>
    </div>
  </div>

  <!-- Executive Summary -->
  <div class="page">
    <div class="header">
      <span>Executive Summary</span>
    </div>
    
    <div class="card">
      <p class="executive-text">${aiReportData?.executive_summary || risk.executive_summary || "No executive summary available."}</p>
    </div>
    
    <div class="grid-2">
      <div class="metric-box">
        <div class="label">Technical Risk</div>
        <div class="value" style="color: ${getSeverityColor(risk.risk_level)}">${risk.technical_risk_score ?? "-"}</div>
      </div>
      <div class="metric-box">
        <div class="label">Business Risk</div>
        <div class="value">${risk.business_risk_score ?? "-"}</div>
      </div>
    </div>
    
    <div class="card assessment-context">
      <div class="section-title">Assessment Context</div>
      <p><strong>Environment:</strong> ${risk.environment}</p>
      <p><strong>Total Findings Evaluated:</strong> ${findings.length}</p>
      <p><strong>Decision:</strong> ${risk.executive_brief?.decision || "Review required"}</p>
    </div>
    
    <div class="header" style="margin-top: 48px;">
      <span>Top Priority Actions</span>
    </div>
    <div class="card" style="padding: 0;">
      <ul class="priorities-list">
        ${(risk.overall_priorities || []).slice(0, 5).map(p => `
          <li>
            <div class="priority-scanner">${p.scanner}</div>
            <div class="priority-text">${p.fix_first}</div>
          </li>
        `).join('')}
      </ul>
    </div>
  </div>

  <!-- Detailed Findings -->
  <div class="page">
    <div class="header">
      <span>Detailed Findings & AI Remediation</span>
    </div>
    ${findingsHtml || "<p>No critical findings reported in this assessment.</p>"}
  </div>
  
</body>
</html>
  `;
}

module.exports = { renderPdfHtml };
