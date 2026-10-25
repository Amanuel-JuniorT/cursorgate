"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const { daemonRequire } = require("./daemonRequire.js");

const { installProjectHooks, removeProjectHooks } = daemonRequire(
  "src/hooksFile.js"
);
const { gatePath, cursorWorkspaceStorage, installDir } = daemonRequire(
  "src/paths.js"
);
const { ensureConfig } = daemonRequire("src/config.js");

function hasCompanionHook(projectRoot) {
  const hooksFile = path.join(projectRoot, ".cursor", "hooks.json");
  if (!fs.existsSync(hooksFile)) return false;
  try {
    const raw = fs.readFileSync(hooksFile, "utf8");
    return raw.includes(".companion") || raw.includes("gate.js");
  } catch {
    return false;
  }
}

function readWorkspaceFolder(storageDir) {
  const wf = path.join(storageDir, "workspace.json");
  if (!fs.existsSync(wf)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(wf, "utf8"));
    const folder = data.folder;
    if (!folder || typeof folder !== "string") return null;
    let p = folder;
    if (p.startsWith("file:///")) {
      p = decodeURIComponent(p.replace(/^file:\/\/\//, ""));
      if (process.platform === "win32") p = p.replace(/^\//, "");
    } else if (p.startsWith("file://")) {
      p = decodeURIComponent(p.replace(/^file:\/\//, ""));
    }
    p = path.normalize(p);
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return p;
  } catch {
    /* ignore */
  }
  return null;
}

function discoverProjectRoots() {
  const roots = new Set();

  try {
    const storage = cursorWorkspaceStorage();
    if (fs.existsSync(storage)) {
      for (const ent of fs.readdirSync(storage, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        const folder = readWorkspaceFolder(path.join(storage, ent.name));
        if (folder) roots.add(folder);
      }
    }
  } catch {
    /* ignore */
  }

  const docs = path.join(os.homedir(), "Documents");
  try {
    if (fs.existsSync(docs)) {
      const ents = fs.readdirSync(docs, { withFileTypes: true }).slice(0, 50);
      for (const ent of ents) {
        if (!ent.isDirectory()) continue;
        const p = path.join(docs, ent.name);
        if (
          fs.existsSync(path.join(p, ".cursor")) ||
          fs.existsSync(path.join(p, ".git"))
        ) {
          roots.add(p);
        }
      }
    }
  } catch {
    /* ignore */
  }

  return [...roots].sort((a, b) => a.localeCompare(b));
}

function listProjects() {
  return discoverProjectRoots().map((root) => ({
    path: root,
    name: path.basename(root),
    companion: hasCompanionHook(root),
  }));
}

function enableProject(projectRoot) {
  const root = path.resolve(projectRoot);
  fs.mkdirSync(installDir(), { recursive: true });
  const src = path.join(
    path.resolve(__dirname, "..", "..", "daemon", "src", "gate.js")
  );
  if (fs.existsSync(src)) fs.copyFileSync(src, gatePath());
  ensureConfig({});
  return installProjectHooks(root, gatePath());
}

function disableProject(projectRoot) {
  return removeProjectHooks(path.resolve(projectRoot));
}

module.exports = {
  listProjects,
  enableProject,
  disableProject,
  hasCompanionHook,
};
