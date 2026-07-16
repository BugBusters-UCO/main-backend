const axios = require("axios");

const { Advisory } = require("../models");
const { AdvisoryFeedState } = require("../models");
const env = require("../config/env");

const memory = new Map();
const feedMemory = new Map();
const CISA_KEV_URL = process.env.CISA_KEV_URL || "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";
const OSV_URL = process.env.OSV_ADVISORY_URL || "https://api.osv.dev/v1/vulns";
const MAX_BATCH = 5000;

async function ingestOsvIds(ids = []) {
  assertAllowedFeedUrl(OSV_URL);
  const unique = Array.from(new Set(ids.map(String).filter(Boolean))).slice(0, MAX_BATCH);
  const records = [];
  for (const id of unique) {
    const response = await axios.get(`${OSV_URL}/${encodeURIComponent(id)}`, { timeout: 20000 });
    records.push(await upsert(normalizeOsv(response.data)));
  }
  return records;
}

async function ingestCisaKev(url = CISA_KEV_URL) {
  assertAllowedFeedUrl(url);
  if (url !== CISA_KEV_URL && !env.advisory.allowCustomFeeds) throw new Error("Custom advisory feeds are disabled");
  const response = await axios.get(url, { timeout: 30000, maxContentLength: 50 * 1024 * 1024 });
  const vulnerabilities = Array.isArray(response.data?.vulnerabilities) ? response.data.vulnerabilities : [];
  const records = [];
  for (const item of vulnerabilities.slice(0, MAX_BATCH)) {
    records.push(await upsert(normalizeKev(item)));
  }
  return records;
}

async function ingestNvdFeed(url = process.env.NVD_FEED_URL) {
  if (!url) throw new Error("NVD_FEED_URL is required for NVD feed ingestion");
  assertAllowedFeedUrl(url);
  if (url !== process.env.NVD_FEED_URL && !env.advisory.allowCustomFeeds) throw new Error("Custom advisory feeds are disabled");
  const response = await axios.get(url, { timeout: 60000, maxContentLength: 100 * 1024 * 1024 });
  const vulnerabilities = response.data?.vulnerabilities || response.data?.CVE_Items || [];
  const records = [];
  for (const item of vulnerabilities.slice(0, MAX_BATCH)) {
    const cve = item.cve || item;
    if (cve.id || cve.CVE_data_meta?.ID) records.push(await upsert(normalizeNvd(cve)));
  }
  return records;
}

async function getAdvisory(id) {
  if (Advisory) {
    const record = await Advisory.findByPk(id);
    return record ? record.toJSON() : null;
  }
  return memory.get(id) || null;
}

async function listAdvisories(limit = 100) {
  if (Advisory) {
    const records = await Advisory.findAll({ order: [["modified", "DESC"]], limit: Math.min(Number(limit) || 100, 1000) });
    return records.map((record) => record.toJSON());
  }
  return Array.from(memory.values()).slice(0, Math.min(Number(limit) || 100, 1000));
}

async function recordFeedState(feed, patch) {
  const value = { feed, ...patch };
  if (AdvisoryFeedState) {
    await AdvisoryFeedState.upsert(value);
    const row = await AdvisoryFeedState.findByPk(feed);
    return row ? row.toJSON() : value;
  }
  feedMemory.set(feed, { ...(feedMemory.get(feed) || {}), ...value });
  return feedMemory.get(feed);
}

async function listFeedStates() {
  if (AdvisoryFeedState) return (await AdvisoryFeedState.findAll({ order: [["feed", "ASC"]] })).map((row) => row.toJSON());
  return Array.from(feedMemory.values());
}

async function upsert(record) {
  const value = { ...record, ingestedAt: new Date() };
  if (Advisory) {
    await Advisory.upsert(value);
    const saved = await Advisory.findByPk(value.id);
    return saved ? saved.toJSON() : value;
  }
  memory.set(value.id, value);
  return value;
}

function normalizeOsv(item) {
  const fixedVersions = [];
  for (const affected of item.affected || []) for (const range of affected.ranges || []) for (const event of range.events || []) if (event.fixed) fixedVersions.push(event.fixed);
  return {
    id: item.id,
    source: "OSV",
    aliases: item.aliases || [],
    summary: item.summary || null,
    details: item.details || null,
    severity: severityFromOsv(item),
    cvssScore: null,
    epssScore: null,
    cisaKev: false,
    published: date(item.published),
    modified: date(item.modified),
    affected: item.affected || [],
    fixedVersions: Array.from(new Set(fixedVersions)),
    references: item.references || [],
    raw: item
  };
}

function normalizeKev(item) {
  return {
    id: item.cveID,
    source: "CISA-KEV",
    aliases: [item.cveID].filter(Boolean),
    summary: item.vulnerabilityName || null,
    details: item.shortDescription || null,
    severity: "critical",
    cvssScore: null,
    epssScore: null,
    cisaKev: true,
    published: date(item.dateAdded),
    modified: date(item.dueDate),
    affected: [{ vendor: item.vendorProject, product: item.product, versions: [item.knownRansomwareCampaignUse || "unknown"] }],
    fixedVersions: [],
    references: item.notes ? [{ type: "advisory", url: item.notes }] : [],
    raw: item
  };
}

function normalizeNvd(item) {
  const description = item.descriptions?.find((entry) => entry.lang === "en")?.value || item.description?.description_data?.[0]?.value || null;
  const metrics = item.metrics?.cvssMetricV31?.[0] || item.metrics?.cvssMetricV30?.[0] || item.impact?.baseMetricV3;
  const cvss = metrics?.cvssData?.baseScore || metrics?.cvssV3?.baseScore || null;
  const id = item.id || item.CVE_data_meta?.ID;
  return {
    id,
    source: "NVD",
    aliases: [id].filter(Boolean),
    summary: description,
    details: description,
    severity: metrics?.cvssData?.baseSeverity?.toLowerCase() || severityFromScore(cvss),
    cvssScore: cvss,
    epssScore: null,
    cisaKev: false,
    published: date(item.published || item.publishedDate),
    modified: date(item.lastModified || item.lastModifiedDate),
    affected: item.configurations?.nodes || item.configurations || [],
    fixedVersions: [],
    references: (item.references || item.references?.reference_data || []).map((ref) => ({ url: ref.url })),
    raw: item
  };
}

function severityFromOsv(item) {
  const raw = String(item.database_specific?.severity || "").toLowerCase();
  return ["critical", "high", "medium", "low"].includes(raw) ? raw : "unknown";
}
function severityFromScore(score) { return score >= 9 ? "critical" : score >= 7 ? "high" : score >= 4 ? "medium" : score ? "low" : "unknown"; }
function date(value) { return value ? new Date(value) : null; }

function assertAllowedFeedUrl(rawUrl) {
  let parsed;
  try { parsed = new URL(rawUrl); } catch (_error) { throw new Error("Advisory feed URL is invalid"); }
  const externalAllowed = env.advisory.sourceMode === "auto" && env.advisory.allowExternalFeeds && !env.advisory.offlineMode;
  if (!externalAllowed && !env.advisory.internalHosts.includes(parsed.hostname.toLowerCase())) {
    throw new Error("Public advisory feeds are disabled; configure an approved internal advisory mirror");
  }
  if (!externalAllowed && parsed.protocol !== "https:") throw new Error("Internal advisory feeds must use HTTPS");
}

module.exports = { getAdvisory, ingestCisaKev, ingestNvdFeed, ingestOsvIds, listAdvisories, listFeedStates, recordFeedState };
