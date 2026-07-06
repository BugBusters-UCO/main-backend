function buildRiskReportPdf(assessment) {
  const risk = assessment?.result?.risk || {};
  const lines = [
    "BugBusters Scheduled Security Risk Report",
    "",
    `Project: ${risk.project_name || assessment?.sourceLabel || "Unknown"}`,
    `Assessment: ${assessment?.id || "unknown"}`,
    `Status: ${assessment?.status || "unknown"}`,
    `Completed: ${assessment?.completedAt || new Date().toISOString()}`,
    "",
    `Final Risk Score: ${risk.final_risk_score ?? "-"}`,
    `Technical Risk Score: ${risk.technical_risk_score ?? "-"}`,
    `Business Risk Score: ${risk.business_risk_score ?? "-"}`,
    `Risk Level: ${risk.risk_level || "-"}`,
    "",
    "Executive Summary",
    ...(wrap(risk.executive_summary || risk.executive_brief?.headline || "No executive summary available.")),
    "",
    "Top Remediation Priorities",
    ...priorityLines(risk.overall_priorities || risk.remediation_priorities || []),
    "",
    "Scanner Scores",
    ...scannerLines(risk.scanner_scores || {}),
    "",
    "Business Inputs",
    ...businessLines(risk.business_inputs || []),
    "",
    "This report was generated automatically after the scheduled scan completed."
  ];

  return createSimplePdf(lines);
}

function priorityLines(priorities) {
  if (!priorities.length) return ["No priorities were returned by the risk engine."];
  return priorities.slice(0, 10).flatMap((item, index) => {
    if (typeof item === "string") return wrap(`${index + 1}. ${item}`);
    return wrap(`${item.rank || index + 1}. [${item.scanner || "scanner"}] ${item.title || "Risk"} - ${item.fix_first || item.next_step || "Review and remediate."}`);
  });
}

function scannerLines(scores) {
  const entries = Object.entries(scores);
  if (!entries.length) return ["No scanner scores available."];
  return entries.map(([scanner, score]) => `${scanner}: technical ${score.technical_score ?? "-"}, business adjusted ${score.business_adjusted_score ?? "-"}, level ${score.risk_level || "-"}`);
}

function businessLines(inputs) {
  if (!inputs.length) return ["Default business impact inputs were used."];
  return inputs.map((input) => `${input.label || input.key}: ${input.value ?? input.default ?? "-"}`);
}

function wrap(text, width = 92) {
  const words = String(text || "").replace(/\s+/g, " ").trim().split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > width) {
      if (line) lines.push(line);
      line = word;
    } else {
      line = `${line} ${word}`.trim();
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function createSimplePdf(lines) {
  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 54;
  const lineHeight = 14;
  const pages = [];
  let current = [];
  let y = pageHeight - margin;

  for (const line of lines.flatMap((value) => wrap(value, 96))) {
    if (y < margin) {
      pages.push(current);
      current = [];
      y = pageHeight - margin;
    }
    current.push({ text: line, y });
    y -= lineHeight;
  }
  pages.push(current);

  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };

  const catalogId = add("<< /Type /Catalog /Pages 2 0 R >>");
  const pagesId = add("");
  const fontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageIds = [];

  for (const pageLines of pages) {
    const stream = [
      "BT",
      "/F1 10 Tf",
      "1 0 0 1 54 738 Tm",
      ...pageLines.map((line, index) => `${index === 0 ? "" : "0 -14 Td "}${pdfText(line.text)} Tj`),
      "ET"
    ].join("\n");
    const contentId = add(`<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`);
    const pageId = add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }

  objects[pagesId - 1] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`;
  void catalogId;

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}

function pdfText(text) {
  return `(${String(text || "").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")})`;
}

module.exports = { buildRiskReportPdf };
