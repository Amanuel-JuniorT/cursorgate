"use strict";
const fs = require("fs");
const path = require("path");

/**
 * Merge companion gate into project .cursor/hooks.json
 * @param {string} projectRoot
 * @param {string} absoluteGatePath
 */
function installProjectHooks(projectRoot, absoluteGatePath) {
  const cursorDir = path.join(projectRoot, ".cursor");
  const hooksFile = path.join(cursorDir, "hooks.json");
  fs.mkdirSync(cursorDir, { recursive: true });

  let data = { version: 1, hooks: { beforeShellExecution: [] } };
  let existed = false;
  if (fs.existsSync(hooksFile)) {
    existed = true;
    try {
      data = JSON.parse(fs.readFileSync(hooksFile, "utf8"));
    } catch {
      throw new Error("malformed hooks.json — fix or remove it first");
    }
    if (!fs.existsSync(hooksFile + ".bak")) {
      fs.copyFileSync(hooksFile, hooksFile + ".bak");
    }
  }

  if (!data.hooks) data.hooks = {};
  if (!Array.isArray(data.hooks.beforeShellExecution)) {
    data.hooks.beforeShellExecution = [];
  }

  // Windows-friendly: forward slashes inside quotes
  const gateCmd = `node "${absoluteGatePath.replace(/\\/g, "/")}"`;
  const list = data.hooks.beforeShellExecution;
  const idx = list.findIndex(
    (h) => typeof h.command === "string" && h.command.includes(".companion")
  );
  const entry = { command: gateCmd, timeout: 86400 };
  if (idx >= 0) list[idx] = entry;
  else list.push(entry);

  const next = JSON.stringify(data, null, 2) + "\n";
  const prev = existed ? fs.readFileSync(hooksFile, "utf8") : "";
  if (prev === next) {
    return { changed: false, hooksFile, command: gateCmd };
  }
  fs.writeFileSync(hooksFile, next, "utf8");
  return { changed: true, hooksFile, command: gateCmd, backedUp: existed };
}

/**
 * @param {string} projectRoot
 */
function removeProjectHooks(projectRoot) {
  const hooksFile = path.join(projectRoot, ".cursor", "hooks.json");
  if (!fs.existsSync(hooksFile)) return { changed: false };
  let data;
  try {
    data = JSON.parse(fs.readFileSync(hooksFile, "utf8"));
  } catch {
    throw new Error("malformed hooks.json");
  }
  if (!data.hooks || !Array.isArray(data.hooks.beforeShellExecution)) {
    return { changed: false };
  }
  const before = data.hooks.beforeShellExecution.length;
  data.hooks.beforeShellExecution = data.hooks.beforeShellExecution.filter(
    (h) => !(typeof h.command === "string" && h.command.includes(".companion"))
  );
  if (data.hooks.beforeShellExecution.length === before) {
    return { changed: false };
  }
  const empty =
    Object.keys(data.hooks).every(
      (k) => !Array.isArray(data.hooks[k]) || data.hooks[k].length === 0
    ) && data.hooks.beforeShellExecution.length === 0;
  if (empty && !fs.existsSync(hooksFile + ".bak")) {
    // only delete if we likely created it alone — keep file if other keys exist
    const onlyOurs = Object.keys(data.hooks).length <= 1;
    if (onlyOurs) {
      fs.unlinkSync(hooksFile);
      return { changed: true, deleted: true };
    }
  }
  fs.writeFileSync(hooksFile, JSON.stringify(data, null, 2) + "\n", "utf8");
  return { changed: true, hooksFile };
}

module.exports = { installProjectHooks, removeProjectHooks };
