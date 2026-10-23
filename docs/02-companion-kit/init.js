#!/usr/bin/env node
"use strict";

/**
 * Scaffold the ntfy phone-approval gate into the current project.
 *
 * Usage (from the project root you want to wire up):
 *   node ~/.cursor/companion/init.js
 *   node %USERPROFILE%\.cursor\companion\init.js
 *
 * Creates:
 *   ~/.companion.json          (once per machine; keeps existing)
 *   ./.cursor/hooks.json
 *   ./.cursor/hooks/gate.js
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const HERE = __dirname;
const cwd = process.cwd();
const companionPath = path.join(os.homedir(), ".companion.json");
const templateGate = path.join(HERE, "gate.js");
const templateHooks = path.join(HERE, "hooks.json");

if (!fs.existsSync(templateGate) || !fs.existsSync(templateHooks)) {
  console.error("Missing templates next to init.js:", HERE);
  process.exit(1);
}

const hex = () => crypto.randomBytes(12).toString("hex");

let cfg;
if (fs.existsSync(companionPath)) {
  cfg = JSON.parse(fs.readFileSync(companionPath, "utf8"));
  if (!cfg.out || !cfg.in) {
    console.error("Invalid", companionPath, "- need out and in topics");
    process.exit(1);
  }
  if (typeof cfg.enabled !== "boolean") cfg.enabled = true;
  if (cfg.waitMs === undefined) cfg.waitMs = 0;
  console.log("Keeping existing", companionPath);
} else {
  cfg = {
    out: `cc-out-${hex()}`,
    in: `cc-in-${hex()}`,
    enabled: true,
    waitMs: 0,
  };
  fs.writeFileSync(companionPath, JSON.stringify(cfg, null, 2) + "\n", "utf8");
  console.log("Created", companionPath);
}

const hooksDir = path.join(cwd, ".cursor", "hooks");
fs.mkdirSync(hooksDir, { recursive: true });

const destGate = path.join(hooksDir, "gate.js");
const destHooks = path.join(cwd, ".cursor", "hooks.json");
fs.copyFileSync(templateGate, destGate);
fs.copyFileSync(templateHooks, destHooks);

console.log("Wrote", destHooks);
console.log("Wrote", destGate);
console.log("");
console.log("Phone: subscribe in ntfy to this out topic:");
console.log(" ", cfg.out);
console.log("");
console.log("Toggle later in", companionPath);
console.log('  "enabled": false  → normal Cursor prompts only');
console.log('  "waitMs": 25000   → optional auto Pass to Cursor after 25s');
console.log("");
console.log("Done. If Cursor had this folder open, reload hooks (save hooks.json or restart).");
