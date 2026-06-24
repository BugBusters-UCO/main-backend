const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const apiRoutes = require("./routes");
const { errorHandler } = require("./middleware/errorHandler");
const { requestLogger } = require("./middleware/requestLogger");

const app = express();

app.use(
  helmet({
    contentSecurityPolicy: false
  })
);
app.use(cors({ origin: process.env.CLIENT_ORIGIN || true, credentials: true }));
app.use("/api/github/webhook", express.raw({ type: "application/json", limit: "2mb" }));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 240,
    standardHeaders: true,
    legacyHeaders: false
  })
);
app.use(requestLogger);

app.use("/api", apiRoutes);

app.get("/", (_req, res) => {
  res.json({
    service: "main-backend",
    message: "Use the existing Next frontend for the dashboard.",
    health: "/api/health"
  });
});

app.use(errorHandler);

module.exports = app;
