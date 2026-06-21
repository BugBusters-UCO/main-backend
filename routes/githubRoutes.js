const router = require("express").Router();
const githubController = require("../controllers/githubController");

router.get("/oauth/start", githubController.startGithubOAuth);
router.get("/oauth/callback", githubController.githubOAuthCallback);
router.post("/session", githubController.getGithubSession);
router.post("/repositories", githubController.getGithubRepositories);

module.exports = router;
