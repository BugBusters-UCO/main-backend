const env = require("../config/env");
const {
  buildAuthorizeUrl,
  completeOAuth,
  deleteImportedRepository,
  disconnectGithubAccount,
  getSessionUser,
  getStoredGithubAccount,
  importRepositoriesForUser,
  listImportedRepositories,
  resolveSessionToken,
  userIdFromAuthToken
} = require("../services/githubAccountService");

function sessionFromRequest(req) {
  return req.headers["x-github-session"] || req.body?.githubSession;
}

function startGithubOAuth(_req, res, next) {
  try {
    const authToken = _req.query.authToken || _req.headers.authorization?.replace("Bearer ", "");
    const userId = userIdFromAuthToken(authToken);
    if (!userId) {
      return res.status(401).json({ message: "Login before connecting GitHub" });
    }
    res.redirect(buildAuthorizeUrl({ userId }));
  } catch (error) {
    next(error);
  }
}

async function githubOAuthCallback(req, res, next) {
  try {
    const { sessionId, user } = await completeOAuth({
      code: req.query.code,
      state: req.query.state
    });
    console.log(`GitHub OAuth connected for ${user.login}`);

    const redirectUrl = new URL(env.frontendUrl);
    redirectUrl.searchParams.set("githubSession", sessionId);
    redirectUrl.searchParams.set("githubConnected", "true");
    res.redirect(redirectUrl.toString());
  } catch (error) {
    const redirectUrl = new URL(env.frontendUrl);
    redirectUrl.searchParams.set("githubError", error.message);
    res.redirect(redirectUrl.toString());
  }
}

function getGithubSession(req, res) {
  const githubSession = sessionFromRequest(req);
  const user = getSessionUser(githubSession);
  if (!user) {
    return res.status(401).json({
      connected: false,
      message: "GitHub session is missing or expired. Connect GitHub again."
    });
  }

  res.json({
    connected: true,
    user
  });
}

async function getGithubRepositories(req, res, next) {
  try {
    const githubSession = sessionFromRequest(req);
    let token;
    try {
      token = resolveSessionToken(githubSession);
    } catch (_error) {
      const storedAccount = await getStoredGithubAccount(req.user?.id);
      token = storedAccount?.accessToken;
    }
    if (!token) {
      return res.status(401).json({ message: "GitHub connection failed. Connect GitHub again." });
    }
    await importRepositoriesForUser(req.user?.id, token);
    const repositories = await listImportedRepositories(req.user.id);
    console.log(`Imported ${repositories.length} GitHub repositories for active user`);
    res.json({ repositories });
  } catch (error) {
    error.statusCode = error.response?.status || error.statusCode || 500;
    error.message = error.response?.status === 401 ? "GitHub connection failed. Connect GitHub again." : error.message;
    next(error);
  }
}

async function getImportedRepositories(req, res, next) {
  try {
    const repositories = await listImportedRepositories(req.user.id);
    res.json({ repositories });
  } catch (error) {
    next(error);
  }
}

async function deleteRepository(req, res, next) {
  try {
    const deleted = await deleteImportedRepository(req.user.id, req.params.repositoryId);
    if (!deleted) {
      return res.status(404).json({ message: "Imported repository not found" });
    }
    res.json({ deleted: true });
  } catch (error) {
    next(error);
  }
}

async function disconnectGithub(req, res, next) {
  try {
    await disconnectGithubAccount(req.user.id);
    res.json({ disconnected: true });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  deleteRepository,
  disconnectGithub,
  getGithubRepositories,
  getImportedRepositories,
  getGithubSession,
  githubOAuthCallback,
  startGithubOAuth
};
