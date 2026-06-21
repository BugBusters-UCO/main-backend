const axios = require("axios");
const env = require("../config/env");
const {
  createOAuthState,
  consumeOAuthState,
  createGithubSession,
  getGithubSession
} = require("./githubOAuthStore");

const GITHUB_API = "https://api.github.com";
const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";

function requireOAuthConfig() {
  if (!env.github.clientId || !env.github.clientSecret) {
    const error = new Error("GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.");
    error.statusCode = 500;
    throw error;
  }
}

function buildAuthorizeUrl() {
  requireOAuthConfig();
  const state = createOAuthState();
  const params = new URLSearchParams({
    client_id: env.github.clientId,
    redirect_uri: env.github.callbackUrl,
    scope: env.github.scope,
    state,
    prompt: "select_account"
  });

  return `${GITHUB_AUTHORIZE_URL}?${params.toString()}`;
}

async function completeOAuth({ code, state }) {
  requireOAuthConfig();
  if (!code || !state || !consumeOAuthState(state)) {
    const error = new Error("Invalid GitHub OAuth callback state");
    error.statusCode = 400;
    throw error;
  }

  const tokenResponse = await axios.post(
    GITHUB_TOKEN_URL,
    {
      client_id: env.github.clientId,
      client_secret: env.github.clientSecret,
      code,
      redirect_uri: env.github.callbackUrl
    },
    {
      headers: { Accept: "application/json" },
      timeout: 15000
    }
  );

  if (tokenResponse.data.error) {
    const error = new Error(tokenResponse.data.error_description || "GitHub OAuth token exchange failed");
    error.statusCode = 400;
    throw error;
  }

  const token = tokenResponse.data.access_token;
  const user = await getViewer(token);
  const sessionId = createGithubSession({ token, user });
  return { sessionId, user };
}

function resolveSessionToken(sessionId) {
  const session = getGithubSession(sessionId);
  if (!session) {
    const error = new Error("GitHub session is missing or expired. Connect GitHub again.");
    error.statusCode = 401;
    throw error;
  }
  return session.token;
}

function getSessionUser(sessionId) {
  const session = getGithubSession(sessionId);
  if (!session) return null;
  return session.user;
}

function githubHeaders(token) {
  if (!token) {
    const error = new Error("GitHub connection token is required");
    error.statusCode = 400;
    throw error;
  }

  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
}

async function getViewer(token) {
  const response = await axios.get(`${GITHUB_API}/user`, {
    headers: githubHeaders(token),
    timeout: 15000
  });

  return {
    login: response.data.login,
    name: response.data.name,
    avatarUrl: response.data.avatar_url,
    profileUrl: response.data.html_url
  };
}

async function listRepositories(token) {
  const response = await axios.get(`${GITHUB_API}/user/repos`, {
    headers: githubHeaders(token),
    params: {
      visibility: "all",
      affiliation: "owner,collaborator,organization_member",
      sort: "updated",
      per_page: 100
    },
    timeout: 20000
  });

  return response.data.map((repo) => ({
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    private: repo.private,
    defaultBranch: repo.default_branch,
    updatedAt: repo.updated_at,
    cloneUrl: repo.clone_url,
    htmlUrl: repo.html_url,
    language: repo.language,
    description: repo.description
  }));
}

module.exports = {
  buildAuthorizeUrl,
  completeOAuth,
  getSessionUser,
  getViewer,
  listRepositories,
  resolveSessionToken
};
