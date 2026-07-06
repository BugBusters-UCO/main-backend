const nodemailer = require("nodemailer");
const env = require("../config/env");

function createTransporter() {
  if (!env.mail.host || !env.mail.user) {
    return null;
  }

  return nodemailer.createTransport({
    host: env.mail.host,
    port: env.mail.port,
    secure: env.mail.secure,
    auth: {
      user: env.mail.user,
      pass: env.mail.pass
    }
  });
}

async function sendScanReport(to, subject, report) {
  const transporter = createTransporter();
  if (!transporter) {
    return { skipped: true, reason: "SMTP is not configured" };
  }

  await transporter.sendMail({
    from: env.mail.from,
    to,
    subject,
    text: JSON.stringify(report, null, 2)
  });
  return { skipped: false };
}

async function sendRiskAssessmentReport(to, assessment, pdfBuffer) {
  const transporter = createTransporter();
  if (!transporter) {
    return { skipped: true, reason: "SMTP is not configured" };
  }

  const risk = assessment?.result?.risk || {};
  const subject = `Scheduled security risk report - ${risk.project_name || assessment?.sourceLabel || "project"}`;
  const text = [
    `Scheduled security scan completed for ${risk.project_name || assessment?.sourceLabel || "project"}.`,
    "",
    `Final risk score: ${risk.final_risk_score ?? "-"}`,
    `Technical risk score: ${risk.technical_risk_score ?? "-"}`,
    `Business risk score: ${risk.business_risk_score ?? "-"}`,
    `Risk level: ${risk.risk_level || "-"}`,
    "",
    "The attached PDF contains the executive summary and remediation priorities."
  ].join("\n");

  await transporter.sendMail({
    from: env.mail.from,
    to,
    subject,
    text,
    attachments: [
      {
        filename: `risk-report-${assessment.id}.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf"
      }
    ]
  });
  return { skipped: false };
}

module.exports = { sendRiskAssessmentReport, sendScanReport };
