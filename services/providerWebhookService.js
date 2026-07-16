const crypto = require("crypto");

const env = require("../config/env");

const SUPPORTED = new Set(["github", "gitlab", "bitbucket", "azuredevops"]);

function normalizeProvider(value) {
  const provider = String(value || "").toLowerCase().replace(/[._-]/g, "");
  if (provider === "azuredevops" || provider === "azure") return "azuredevops";
  if (SUPPORTED.has(provider)) return provider;
  throw new Error("Unsupported webhook provider");
}

function verifyWebhook(providerInput, headers, rawBody) {
  const provider = normalizeProvider(providerInput);
  const secret = env.webhook.secrets[provider];
  if (!secret) throw new Error(`Webhook secret is not configured for ${provider}`);
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || "");

  if (provider === "gitlab") {
    if (!safeEqual(headers["x-gitlab-token"], secret)) throw new Error("Invalid GitLab webhook token");
    return provider;
  }

  const signature = headers["x-hub-signature-256"] || headers["x-hub-signature"] || headers["x-webhook-signature"];
  if (!signature) throw new Error("Webhook signature is missing");
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
  if (!safeEqual(signature, expected)) throw new Error("Invalid webhook signature");
  return provider;
}

function parseEvent(providerInput, payload, headers) {
  const provider = normalizeProvider(providerInput);
  if (provider === "github") return githubEvent(payload, headers);
  if (provider === "gitlab") return gitlabEvent(payload, headers);
  if (provider === "bitbucket") return bitbucketEvent(payload, headers);
  return azureEvent(payload, headers);
}

function githubEvent(payload, headers) {
  const event = String(headers["x-github-event"] || "").toLowerCase();
  if (event === "ping") return { ignored: true, reason: "ping" };
  if (!new Set(["push", "pull_request"]).has(event)) return { ignored: true, reason: event || "unknown event" };
  const pull = payload.pull_request;
  const changedFiles = event === "push"
    ? (payload.commits || []).flatMap((commit) => [...(commit.added || []), ...(commit.modified || []), ...(commit.removed || [])])
    : [];
  return normalized("github", event, payload.repository?.clone_url, pull?.head?.sha || payload.after, payload.repository?.full_name, payload.ref, changedFiles);
}

function gitlabEvent(payload, headers) {
  const event = String(headers["x-gitlab-event"] || "").toLowerCase();
  if (!event.includes("push") && !event.includes("merge request")) return { ignored: true, reason: event || "unknown event" };
  const merge = payload.object_attributes;
  const changedFiles = (payload.commits || []).flatMap((commit) => [...(commit.added || []), ...(commit.modified || []), ...(commit.removed || [])]);
  return normalized("gitlab", event, payload.project?.git_http_url || payload.project?.http_url_to_repo, merge?.last_commit?.id || payload.after, payload.project?.path_with_namespace, payload.ref, changedFiles);
}

function bitbucketEvent(payload, headers) {
  const event = String(headers["x-event-key"] || "").toLowerCase();
  if (!event.startsWith("repo:push") && !event.startsWith("pullrequest:")) return { ignored: true, reason: event || "unknown event" };
  const change = payload.push?.changes?.[0];
  const pull = payload.pullrequest;
  const clone = payload.repository?.links?.clone?.find((item) => item.name === "https")?.href
    || payload.repository?.links?.clone?.[0]?.href;
  const changedFiles = (change?.commits || []).flatMap((commit) => (commit.files || []).map((file) => file.path || file.new?.path || file.old?.path).filter(Boolean));
  return normalized("bitbucket", event, clone, pull?.source?.commit?.hash || change?.new?.target?.hash, payload.repository?.full_name, change?.new?.name, changedFiles);
}

function azureEvent(payload, headers) {
  const event = String(payload.eventType || headers["x-azure-event"] || "").toLowerCase();
  if (!event.includes("push") && !event.includes("pullrequest")) return { ignored: true, reason: event || "unknown event" };
  const resource = payload.resource || {};
  const repository = resource.repository || {};
  const refUpdate = resource.refUpdates?.[0];
  return normalized("azuredevops", event, repository.remoteUrl || repository.webUrl, resource.lastMergeSourceCommit?.commitId || resource.sourceRefCommit?.commitId || refUpdate?.newObjectId, repository.name, refUpdate?.name, []);
}

function normalized(provider, event, repoUrl, commitSha, sourceLabel, ref, changedFiles = []) {
  if (!repoUrl || !commitSha) throw new Error("Webhook does not contain a repository URL and immutable commit SHA");
  return { provider, event, repoUrl, commitSha, sourceLabel: sourceLabel || repoUrl, ref: ref || null, changedFiles: Array.from(new Set(changedFiles.filter(Boolean))).slice(0, 10000) };
}

function deliveryId(provider, headers, event) {
  return headers[provider === "github" ? "x-github-delivery" : provider === "gitlab" ? "x-gitlab-event-uuid" : provider === "bitbucket" ? "x-request-uuid" : "x-azure-delivery"] || `${provider}:${event.commitSha}`;
}

function safeEqual(actual, expected) {
  if (!actual || !expected) return false;
  const left = Buffer.from(String(actual));
  const right = Buffer.from(String(expected));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

module.exports = { deliveryId, normalizeProvider, parseEvent, verifyWebhook };
