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

module.exports = { sendScanReport };
