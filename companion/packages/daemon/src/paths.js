"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

function home() {
  return os.homedir();
}

function companionDir() {
  return path.join(home(), ".companion");
}

function configPath() {
  return path.join(home(), ".companion.json");
}

function installDir() {
  return path.join(companionDir(), "runtime");
}

function gatePath() {
  return path.join(installDir(), "gate.js");
}

function logPath() {
  return path.join(home(), "gate-debug.log");
}

function daemonLogPath() {
  return path.join(companionDir(), "daemon.log");
}

function replyInboxPath() {
  return path.join(companionDir(), "reply-inbox");
}

function cursorUserDir() {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(home(), "AppData", "Roaming"), "Cursor");
  }
  if (process.platform === "darwin") {
    return path.join(home(), "Library", "Application Support", "Cursor");
  }
  return path.join(home(), ".config", "Cursor");
}

function cursorWorkspaceStorage() {
  return path.join(cursorUserDir(), "User", "workspaceStorage");
}

function agentTranscriptsRoots() {
  const roots = [];
  // Cursor project agent-transcripts (Cursor agent stores)
  const cursorProjects = path.join(home(), ".cursor", "projects");
  if (fs.existsSync(cursorProjects)) roots.push(cursorProjects);
  return roots;
}

module.exports = {
  home,
  companionDir,
  configPath,
  installDir,
  gatePath,
  logPath,
  daemonLogPath,
  replyInboxPath,
  cursorUserDir,
  cursorWorkspaceStorage,
  agentTranscriptsRoots,
};
