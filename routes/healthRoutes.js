const router = require("express").Router();
const { health } = require("../controllers/healthController");

router.get("/", health);

module.exports = router;
