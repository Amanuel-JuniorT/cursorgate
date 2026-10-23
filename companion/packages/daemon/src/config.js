"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DEFAULT_ALLOWLIST } = require("@companion/shared");
const { configPath, companionDir } = require("./paths.js");

const DEFAULTS = {
  version: 1,
  enabled: true,
  relayUrl: "http://127.0.0.1:8787",
  daemonToken: null,
  timeoutSeconds: 120,
  onTimeout: "ask",
  allowlist: DEFAULT_ALLOWLIST.slice(),
  sendNotifications: true,
  // Off by default: shell approvals go to Cursor UI unless phone is opted in + live
  phoneApprovals: false,
  chatWatchEnabled: true,
  keepAwakeHint: true,
  // paste | clipboard | inbox — Windows default is paste (SendKeys into Cursor)
  replyMode: process.platform === "win32" ? "paste" : "inbox",
  // enter | ctrl+enter — how to submit after paste
  replySubmit: "enter",
};

/**
 * @param {string} file
 * @param {object} obj
 */
function atomicWrite(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp." + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* windows */
  }
}

/**
 * Migrate legacy ntfy companion.json in place; never regenerate topics unless asked.
 * @param {object} raw
 */
function migrate(raw) {
  const incoming = raw && typeof raw === "object" ? raw : {};
  const cfg = { ...DEFAULTS, ...incoming };
  cfg.version = 1;
  if (cfg.onTimeout !== "ask") cfg.onTimeout = "ask";
  if (!Array.isArray(cfg.allowlist) || !cfg.allowlist.length) {
    cfg.allowlist = DEFAULT_ALLOWLIST.slice();
  }
  // Prefer explicit timeoutSeconds; else map legacy waitMs; else default.
  if (typeof incoming.timeoutSeconds === "number") {
    cfg.timeoutSeconds = incoming.timeoutSeconds;
  } else if (typeof incoming.waitMs === "number") {
    cfg.timeoutSeconds = incoming.waitMs > 0 ? Math.round(incoming.waitMs / 1000) : 0;
  } else {
    cfg.timeoutSeconds = DEFAULTS.timeoutSeconds;
  }
  if (typeof cfg.enabled !== "boolean") cfg.enabled = true;
  if (typeof cfg.sendNotifications !== "boolean") cfg.sendNotifications = true;
  // Missing key → default off (do not inherit sendNotifications)
  if (typeof incoming.phoneApprovals === "boolean") {
    cfg.phoneApprovals = incoming.phoneApprovals;
  } else if (typeof cfg.phoneApprovals !== "boolean") {
    cfg.phoneApprovals = DEFAULTS.phoneApprovals;
  }
  if (!cfg.relayUrl) cfg.relayUrl = DEFAULTS.relayUrl;
  // Keep legacy out/in if present (for reference / fallback docs) but unused by gate.
  return cfg;
}

function loadConfig() {
  const file = configPath();
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return migrate(raw);
  } catch (e) {
    const err = new Error("invalid config: " + e.message);
    err.code = "INVALID_CONFIG";
    throw err;
  }
}

function saveConfig(cfg) {
  atomicWrite(configPath(), migrate(cfg));
  return loadConfig();
}

/**
 * Ensure config exists. Optionally seed daemonToken from relay state file.
 */
function ensureConfig(opts = {}) {
  fs.mkdirSync(companionDir(), { recursive: true });
  let cfg = loadConfig();
  if (!cfg) {
    cfg = migrate({
      enabled: true,
      daemonToken: opts.daemonToken || null,
      relayUrl: opts.relayUrl || DEFAULTS.relayUrl,
    });
    // Preserve nothing from missing file — topics not required anymore.
    saveConfig(cfg);
    cfg = loadConfig();
  } else {
    let dirty = false;
    if (opts.daemonToken && cfg.daemonToken !== opts.daemonToken) {
      cfg.daemonToken = opts.daemonToken;
      dirty = true;
    }
    if (opts.relayUrl && cfg.relayUrl !== opts.relayUrl) {
      cfg.relayUrl = opts.relayUrl;
      dirty = true;
    }
    if (dirty) saveConfig(cfg);
  }
  return cfg;
}

/**
 * Read daemon token from relay state if present.
 */
function readRelayDaemonToken() {
  const stateFile = path.join(companionDir(), "relay", "state.json");
  try {
    if (!fs.existsSync(stateFile)) return null;
    const st = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    return st.daemonToken || null;
  } catch {
    return null;
  }
}

function validateConfig(cfg) {
  const problems = [];
  if (!cfg) {
    problems.push("config missing");
    return problems;
  }
  if (cfg.version !== 1) problems.push("version must be 1");
  if (typeof cfg.enabled !== "boolean") problems.push("enabled must be boolean");
  if (!cfg.relayUrl || typeof cfg.relayUrl !== "string") problems.push("relayUrl required");
  if (cfg.onTimeout !== "ask") problems.push('onTimeout must be "ask"');
  if (typeof cfg.timeoutSeconds !== "number" || cfg.timeoutSeconds < 0) {
    problems.push("timeoutSeconds must be >= 0");
  }
  if (!Array.isArray(cfg.allowlist)) problems.push("allowlist must be array");
  else {
    for (const r of cfg.allowlist) {
      try {
        new RegExp(r);
      } catch {
        problems.push("bad allowlist regex: " + r);
      }
    }
  }
  if (!cfg.daemonToken) problems.push("daemonToken missing — run companion install after starting relay");
  return problems;
}

function maskToken(t) {
  if (!t || t.length < 8) return "****";
  return "****" + t.slice(-4);
}

module.exports = {
  DEFAULTS,
  loadConfig,
  saveConfig,
  ensureConfig,
  migrate,
  validateConfig,
  readRelayDaemonToken,
  maskToken,
  atomicWrite,
  configPath,
};
