"use strict";
const fs = require("fs");
const path = require("path");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
  ".webmanifest": "application/manifest+json",
};

/**
 * PWA dist roots (first match wins):
 * - COMPANION_PWA_DIST
 * - packages/pwa/dist (monorepo / Docker image)
 * - ~/.companion/pwa-dist (desktop copy)
 */
function pwaDistRoot() {
  if (process.env.COMPANION_PWA_DIST) {
    const p = path.resolve(process.env.COMPANION_PWA_DIST);
    if (fs.existsSync(path.join(p, "index.html"))) return p;
  }
  const mono = path.resolve(__dirname, "..", "..", "pwa", "dist");
  if (fs.existsSync(path.join(mono, "index.html"))) return mono;

  const homeCopy = path.join(
    require("os").homedir(),
    ".companion",
    "pwa-dist"
  );
  if (fs.existsSync(path.join(homeCopy, "index.html"))) return homeCopy;

  return null;
}

function safeJoin(root, reqPath) {
  const decoded = decodeURIComponent(reqPath.split("?")[0]);
  let rel = decoded.replace(/^\/+/, "");
  if (!rel || rel.endsWith("/")) rel = path.join(rel, "index.html");
  const full = path.normalize(path.join(root, rel));
  const rootNorm = path.normalize(root + path.sep);
  if (!full.startsWith(rootNorm) && full !== path.normalize(root)) {
    return null;
  }
  return full;
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} pathname
 * @returns {boolean}
 */
function tryServePwa(req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const root = pwaDistRoot();
  if (!root) return false;

  const apiExact = new Set([
    "/health",
    "/snapshot",
    "/vapidPublicKey",
    "/daemon-token",
    "/agent-finished",
  ]);
  const apiPrefix = [
    "/pair",
    "/approvals",
    "/devices",
    "/chats",
    "/replies",
    "/push",
    "/settings",
    "/gate",
    "/agent",
    "/daemon",
    "/ws",
    "/vapid",
  ];
  if (
    apiExact.has(pathname) ||
    apiPrefix.some((p) => pathname === p || pathname.startsWith(p + "/"))
  ) {
    return false;
  }

  let filePath = safeJoin(root, pathname === "/" ? "/index.html" : pathname);
  if (!filePath) return false;

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(root, "index.html");
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;

  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  const body = fs.readFileSync(filePath);
  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": body.length,
    "Cache-Control":
      ext === ".html" ? "no-cache" : "public, max-age=86400",
  });
  if (req.method === "HEAD") res.end();
  else res.end(body);
  return true;
}

function pwaStatus() {
  const root = pwaDistRoot();
  return { served: !!root, path: root };
}

module.exports = { tryServePwa, pwaDistRoot, pwaStatus };
