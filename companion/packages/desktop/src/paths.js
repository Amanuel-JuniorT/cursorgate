"use strict";
const path = require("path");
const fs = require("fs");

/** Monorepo package roots when running via `electron .` in packages/desktop */
function monorepoRoot() {
  return path.resolve(__dirname, "..", "..", "..");
}

function relayEntry() {
  const p = path.join(monorepoRoot(), "packages", "relay", "bin", "relay.js");
  if (fs.existsSync(p)) return p;
  // Packaged extraResources
  return path.join(process.resourcesPath || "", "relay", "bin", "relay.js");
}

function daemonCli() {
  const p = path.join(monorepoRoot(), "packages", "daemon", "bin", "cli.js");
  if (fs.existsSync(p)) return p;
  return path.join(process.resourcesPath || "", "daemon", "bin", "cli.js");
}

function rendererDir() {
  return path.join(__dirname, "..", "renderer");
}

function assetsDir() {
  return path.join(__dirname, "..", "assets");
}

module.exports = {
  monorepoRoot,
  relayEntry,
  daemonCli,
  rendererDir,
  assetsDir,
};
