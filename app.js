const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const apiRoutes = require("./routes");
const { errorHandler } = require("./middleware/errorHandler");
const { requestLogger } = require("./middleware/requestLogger");

const app = express();

// The backend is reached through the local reverse proxy in production. Trust
// only that hop so Express can safely use X-Forwarded-For for client IPs.
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 1);
if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0) {
  throw new Error("TRUST_PROXY_HOPS must be a non-negative integer");
}
app.set("trust proxy", trustProxyHops);

app.use(
  helmet({
    contentSecurityPolicy: false
  })
);
const clientOrigin = process.env.CLIENT_ORIGIN;
const origin = clientOrigin 
  ? (clientOrigin.includes(',') ? clientOrigin.split(',').map(s => s.trim()) : clientOrigin) 
  : true;
app.use(cors({ origin, credentials: true }));
app.use(express.json({
  limit: "50mb",
  verify: (req, _res, buffer) => {
    if (req.originalUrl.startsWith("/api/webhooks/")) req.rawBody = Buffer.from(buffer);
  }
}));
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
