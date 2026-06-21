const { randomUUID } = require("crypto");

const states = new Map();
const sessions = new Map();

function createOAuthState() {
  const state = randomUUID();
  states.set(state, { createdAt: Date.now() });
  return state;
}

function consumeOAuthState(state) {
  const storedState = states.get(state);
  states.delete(state);
  return Boolean(storedState);
}

function createGithubSession({ token, user }) {
  const sessionId = randomUUID();
  sessions.set(sessionId, {
    token,
    user,
    createdAt: Date.now()
  });
  return sessionId;
}

function getGithubSession(sessionId) {
  if (!sessionId) return null;
  return sessions.get(sessionId) || null;
}

module.exports = {
  createOAuthState,
  consumeOAuthState,
  createGithubSession,
  getGithubSession
};
