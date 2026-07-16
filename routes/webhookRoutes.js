const router = require("express").Router();
const { receiveDependencyWebhook, receiveSecretWebhook } = require("../controllers/webhookController");
const { receiveAssetWebhook } = require("../controllers/cipherAssetController");

router.post("/:provider/dependency", receiveDependencyWebhook);
router.post("/:provider/secret", receiveSecretWebhook);
router.post("/cipher-assets", receiveAssetWebhook);

module.exports = router;
