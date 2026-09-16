const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const UAParser = require("ua-parser-js");

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const BASE_URL = process.env.BASE_URL || "";

app.set("trust proxy", true);
app.use(express.json({ limit: "50kb" }));
app.use(express.static(path.join(__dirname, "public")));

const DATA_FILE = path.join(__dirname, "data", "store.json");

function ensureStore() {
  if (!fs.existsSync(path.dirname(DATA_FILE))) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ links: [] }, null, 2));
  }
}

function readStore() {
  ensureStore();
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function writeStore(store) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

function randomId(bytes = 5) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function normalizeIp(ip = "") {
  let value = ip.split(",")[0].trim();
  if (value.startsWith("::ffff:")) value = value.slice(7);
  return value;
}

function getClientIp(req) {
  return normalizeIp(
    req.headers["cf-connecting-ip"] ||
    req.headers["x-forwarded-for"] ||
    req.socket.remoteAddress ||
    req.ip ||
    ""
  );
}

function isPrivateIp(ip = "") {
  if (!ip) return false;

  // IPv4 private / local ranges
  if (/^10\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^127\./.test(ip)) return true;
  if (/^169\.254\./.test(ip)) return true;

  const match172 = ip.match(/^172\.(\d+)\./);
  if (match172) {
    const second = Number(match172[1]);
    if (second >= 16 && second <= 31) return true;
  }

  // IPv6 loopback, unique-local and link-local
  const lower = ip.toLowerCase();
  if (lower === "::1") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("fe80:")) return true;

  return false;
}

function getLanIpVisibleToServer(req) {
  /*
   * A website hosted on the public internet normally cannot see the
   * visitor's 192.168.x.x / 10.x.x.x address because NAT does not send
   * that address across the internet.
   *
   * We therefore expose a LAN/private IP only when this Node server is
   * being contacted directly, without a forwarding proxy/CDN header.
   */
  const hasProxyHeader =
    Boolean(req.headers["cf-connecting-ip"]) ||
    Boolean(req.headers["x-forwarded-for"]);

  const peerIp = normalizeIp(req.socket.remoteAddress || "");

  if (!hasProxyHeader && isPrivateIp(peerIp)) {
    return peerIp;
  }

  return null;
}

function safeUrl(value) {
  try {
    const u = new URL(value);
    if (!["http:", "https:"].includes(u.protocol)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function sanitizeText(value, max = 500) {
  if (typeof value !== "string") return "";
  return value.slice(0, max);
}

app.post("/api/links", (req, res) => {
  const destination = safeUrl(req.body.destination);

  if (!destination) {
    return res.status(400).json({
      error: "Destination must be a valid http:// or https:// URL."
    });
  }

  const store = readStore();
  const code = randomId(5);
  const adminToken = randomId(24);

  store.links.push({
    code,
    adminToken,
    destination,
    createdAt: new Date().toISOString(),
    visits: []
  });

  writeStore(store);

  const requestBase =
    BASE_URL ||
    `${req.protocol}://${req.get("host")}`;

  res.json({
    code,
    trackingUrl: `${requestBase}/r/${code}`,
    dashboardUrl: `${requestBase}/dashboard.html?token=${adminToken}`,
    adminToken
  });
});

/*
 * IMPORTANT:
 * This endpoint deliberately does NOT store the visitor IP.
 * It only renders the consent page.
 */
app.get("/r/:code", (req, res) => {
  const store = readStore();
  const link = store.links.find(item => item.code === req.params.code);

  if (!link) {
    return res.status(404).send("Tracking link not found.");
  }

  res.sendFile(path.join(__dirname, "public", "consent.html"));
});

app.get("/api/link/:code/public", (req, res) => {
  const store = readStore();
  const link = store.links.find(item => item.code === req.params.code);

  if (!link) return res.status(404).json({ error: "Not found" });

  res.json({
    code: link.code,
    destination: link.destination
  });
});

/*
 * Data is recorded only after the visitor presses "Agree & Continue".
 * GPS coordinates are accepted only after the browser's own permission dialog.
 */
app.post("/api/link/:code/consent", (req, res) => {
  const store = readStore();
  const link = store.links.find(item => item.code === req.params.code);

  if (!link) return res.status(404).json({ error: "Not found" });

  const ua = sanitizeText(req.headers["user-agent"] || "", 1000);
  const parsed = UAParser(ua);

  const latitude =
    Number.isFinite(req.body.latitude) ? req.body.latitude : null;
  const longitude =
    Number.isFinite(req.body.longitude) ? req.body.longitude : null;
  const accuracy =
    Number.isFinite(req.body.accuracy) ? req.body.accuracy : null;

  const visit = {
    id: randomId(8),
    timestamp: new Date().toISOString(),
    ip: getClientIp(req),
    privateIp: getLanIpVisibleToServer(req),

    device: {
      type: parsed.device.type || "desktop",
      vendor: parsed.device.vendor || "Unknown",
      model: parsed.device.model || "Unknown"
    },

    os: {
      name: parsed.os.name || "Unknown",
      version: parsed.os.version || "Unknown"
    },

    browser: {
      name: parsed.browser.name || "Unknown",
      version: parsed.browser.version || "Unknown"
    },

    userAgent: ua,

    client: {
      language: sanitizeText(req.body.language || "", 50),
      platform: sanitizeText(req.body.platform || "", 100),
      screen: sanitizeText(req.body.screen || "", 30),
      timezone: sanitizeText(req.body.timezone || "", 100),
      referrer: sanitizeText(req.body.referrer || "", 500)
    },

    gps: {
      latitude,
      longitude,
      accuracy
    }
  };

  link.visits.push(visit);
  writeStore(store);

  res.json({
    ok: true,
    redirectTo: link.destination
  });
});

app.get("/api/dashboard/:token", (req, res) => {
  const store = readStore();
  const link = store.links.find(item => item.adminToken === req.params.token);

  if (!link) return res.status(404).json({ error: "Dashboard not found" });

  const requestBase =
    BASE_URL ||
    `${req.protocol}://${req.get("host")}`;

  res.json({
    code: link.code,
    destination: link.destination,
    createdAt: link.createdAt,
    trackingUrl: `${requestBase}/r/${link.code}`,
    totalVisits: link.visits.length,
    visits: [...link.visits].reverse()
  });
});

ensureStore();

app.listen(PORT, HOST, () => {
  const shownBase = BASE_URL || `http://localhost:${PORT}`;
  console.log(`Consent Link Analytics running on ${shownBase}`);
  console.log(`Listening on ${HOST}:${PORT}`);
});
