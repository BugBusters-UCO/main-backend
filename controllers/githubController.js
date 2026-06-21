const env = require("../config/env");
const {
  buildAuthorizeUrl,
  completeOAuth,
  getSessionUser,
  listRepositories,
  resolveSessionToken
} = require("../services/githubAccountService");

function sessionFromRequest(req) {
  return req.headers["x-github-session"] || req.body?.githubSession;
}

function startGithubOAuth(_req, res, next) {
  try {
    res.redirect(buildAuthorizeUrl());
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
    const token = resolveSessionToken(githubSession);
    const repositories = await listRepositories(token);
    console.log(`Imported ${repositories.length} GitHub repositories for active session`);
    res.json({ repositories });
  } catch (error) {
    error.statusCode = error.response?.status || error.statusCode || 500;
    error.message = error.response?.status === 401 ? "GitHub connection failed. Connect GitHub again." : error.message;
    next(error);
  }
}

module.exports = {
  getGithubRepositories,
  getGithubSession,
  githubOAuthCallback,
  startGithubOAuth
};
