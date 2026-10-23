"use strict";
const fs = require("fs");
const path = require("path");
const { installDir, gatePath } = require("../src/paths.js");

fs.mkdirSync(installDir(), { recursive: true });
const src = path.join(__dirname, "..", "src", "gate.js");
fs.copyFileSync(src, gatePath());
console.log("installed gate →", gatePath());

// Also clear any leftover pending approvals that confuse the phone UI
try {
  const cfgPath = path.join(require("os").homedir(), ".companion.json");
  if (fs.existsSync(cfgPath)) {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    if (cfg.daemonToken && cfg.relayUrl) {
      fetch(`${String(cfg.relayUrl).replace(/\/$/, "")}/approvals/expire`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.daemonToken}` },
      }).catch(() => {});
    }
  }
} catch {
  /* ignore */
}
