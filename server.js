require("dotenv").config();

const app = require("./app");
const { ensureRuntimeDirs } = require("./config/storage");

const PORT = Number(process.env.PORT || 5000);

ensureRuntimeDirs();

app.listen(PORT, () => {
  console.log(`Main backend running on http://127.0.0.1:${PORT}`);
  console.log("Use the existing frontend for the dashboard.");
});
