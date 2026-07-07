const puppeteer = require('puppeteer');
const axios = require('axios');
const env = require('../config/env');
const { renderPdfHtml } = require('./pdfTemplateRenderer');

async function buildRiskReportPdf(assessment) {
  // 1. Fetch AI batched remediations for the report
  let aiReportData = null;
  try {
    const risk = assessment?.result?.risk;
    if (risk) {
      const response = await axios.post(`${env.riskEngineUrl}/api/v1/risk/report-remedies`, {
        risk: risk,
        limit: 10
      }, { timeout: 45000 });
      aiReportData = response.data;
    }
  } catch (err) {
    console.error("Failed to fetch batched AI remediations for PDF report:", err.message);
  }

  // 2. Generate HTML
  const htmlContent = renderPdfHtml(assessment, aiReportData);

  // 3. Render PDF with Puppeteer
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  
  try {
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
    
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true
    });
    
    return pdfBuffer;
  } finally {
    await browser.close();
  }
}

module.exports = { buildRiskReportPdf };
