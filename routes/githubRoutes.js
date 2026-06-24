const router = require("express").Router();
const githubController = require("../controllers/githubController");
const { requireAuth } = require("../middleware/authMiddleware");

router.get("/oauth/start", githubController.startGithubOAuth);
router.get("/oauth/callback", githubController.githubOAuthCallback);
router.post("/webhook", githubController.handleGithubWebhook);
router.post("/session", requireAuth, githubController.getGithubSession);
router.post("/repositories", requireAuth, githubController.getGithubRepositories);
router.get("/repositories", requireAuth, githubController.getImportedRepositories);
router.delete("/repositories/:repositoryId", requireAuth, githubController.deleteRepository);
router.delete("/connection", requireAuth, githubController.disconnectGithub);

module.exports = router;
