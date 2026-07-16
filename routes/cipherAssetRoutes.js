const router = require("express").Router();
const controller = require("../controllers/cipherAssetController");
const { requireAuth } = require("../middleware/authMiddleware");

router.use(requireAuth);
router.get("/", controller.getAssets);
router.post("/", controller.saveAssets);
router.post("/scan", controller.startAssetScan);
router.post("/import", controller.importProviderAssets);
router.delete("/:assetId", controller.deleteAsset);

module.exports = router;
