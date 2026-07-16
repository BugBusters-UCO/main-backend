const axios = require("axios");
const jwt = require("jsonwebtoken");
const env = require("../config/env");
const { GithubAccount, ImportedRepository } = require("../models");
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
  if (env.banking.internalOnly || (env.banking.strictOffline && env.nodeEnv === "production")) {
    const error = new Error("Public GitHub OAuth is disabled in bank-internal-only mode. Use an approved enterprise provider integration.");
    error.statusCode = 403;
    throw error;
  }
  if (!env.github.clientId || !env.github.clientSecret) {
    const error = new Error("GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.");
    error.statusCode = 500;
    throw error;
  }
}

function buildAuthorizeUrl({ userId } = {}) {
  requireOAuthConfig();
  const state = createOAuthState(userId || null);
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
  const storedState = state ? consumeOAuthState(state) : null;
  if (!code || !storedState) {
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
  let githubAccount = null;
  if (storedState.userId && GithubAccount) {
    githubAccount = await upsertGithubAccount(storedState.userId, token, user);
  }
  const sessionId = createGithubSession({ token, user });
  return { sessionId, user, githubAccount };
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

function userIdFromAuthToken(authToken) {
  if (!authToken) return null;
  try {
    const decoded = jwt.verify(authToken, env.jwtSecret);
    return decoded.id;
  } catch (_error) {
    return null;
  }
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
  if (env.banking.internalOnly || (env.banking.strictOffline && env.nodeEnv === "production")) throw new Error("Public GitHub API access is disabled in bank-internal-only mode");
  const response = await axios.get(`${GITHUB_API}/user`, {
    headers: githubHeaders(token),
    timeout: 15000
  });

  return {
    id: response.data.id,
    login: response.data.login,
    name: response.data.name,
    avatarUrl: response.data.avatar_url,
    profileUrl: response.data.html_url
  };
}

async function upsertGithubAccount(userId, token, githubUser) {
  if (!GithubAccount) return null;
  const [account] = await GithubAccount.upsert(
    {
      userId,
      githubId: githubUser.id,
      login: githubUser.login,
      name: githubUser.name,
      avatarUrl: githubUser.avatarUrl,
      profileUrl: githubUser.profileUrl,
      accessToken: token
    },
    { returning: true }
  );
  return account;
}

async function getStoredGithubAccount(userId) {
  if (!GithubAccount || !userId) return null;
  return GithubAccount.findOne({ where: { userId }, order: [["updatedAt", "DESC"]] });
}

async function disconnectGithubAccount(userId) {
  if (!GithubAccount || !userId) return 0;
  const accounts = await GithubAccount.findAll({ where: { userId } });
  const accountIds = accounts.map((account) => account.id);
  if (ImportedRepository && accountIds.length) {
    await ImportedRepository.update({ githubAccountId: null }, { where: { userId, githubAccountId: accountIds } });
  }
  return GithubAccount.destroy({ where: { userId } });
}

async function listRepositories(token) {
  if (env.banking.internalOnly || (env.banking.strictOffline && env.nodeEnv === "production")) throw new Error("Public GitHub API access is disabled in bank-internal-only mode");
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

async function importRepositoriesForUser(userId, token) {
  const repositories = await listRepositories(token);
  if (!ImportedRepository || !userId) {
    return repositories;
  }

  const account = await getStoredGithubAccount(userId);
  for (const repo of repositories) {
    await ImportedRepository.upsert({
      userId,
      githubAccountId: account?.id || null,
      githubRepoId: repo.id,
      name: repo.name,
      fullName: repo.fullName,
      private: repo.private,
      defaultBranch: repo.defaultBranch,
      cloneUrl: repo.cloneUrl,
      htmlUrl: repo.htmlUrl,
      language: repo.language,
      description: repo.description,
      lastImportedAt: new Date()
    });
  }
  return repositories;
}

async function listImportedRepositories(userId) {
  if (!ImportedRepository || !userId) return [];
  const repos = await ImportedRepository.findAll({ where: { userId }, order: [["lastImportedAt", "DESC"]] });
  return repos.map((repo) => repo.toJSON());
}

async function deleteImportedRepository(userId, repositoryId) {
  if (!ImportedRepository || !userId) return 0;
  return ImportedRepository.destroy({ where: { id: repositoryId, userId } });
}

module.exports = {
  buildAuthorizeUrl,
  completeOAuth,
  deleteImportedRepository,
  disconnectGithubAccount,
  getSessionUser,
  getStoredGithubAccount,
  getViewer,
  importRepositoriesForUser,
  listImportedRepositories,
  listRepositories,
  resolveSessionToken,
  userIdFromAuthToken
};
