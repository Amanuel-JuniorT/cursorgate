"use strict";
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { relayEntry, daemonCli } = require("./paths.js");

const MAX_LINES = 800;

/** @type {import('child_process').ChildProcess|null} */
let relayProc = null;
/** @type {import('child_process').ChildProcess|null} */
let daemonProc = null;

/** @type {string[]} */
const relayLog = [];
/** @type {string[]} */
const daemonLog = [];

const listeners = new Set();

function emit() {
  const status = snapshot();
  for (const fn of listeners) {
    try {
      fn(status);
    } catch {
      /* ignore */
    }
  }
}

function onStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function alive(proc) {
  return !!(proc && proc.exitCode === null && !proc.killed);
}

function snapshot() {
  return {
    relay: alive(relayProc),
    daemon: alive(daemonProc),
    relayPid: alive(relayProc) ? relayProc.pid : null,
    daemonPid: alive(daemonProc) ? daemonProc.pid : null,
  };
}

function pushLines(buf, text, stream) {
  const ts = new Date().toISOString().slice(11, 19);
  const prefix = stream === "err" ? "ERR " : "";
  for (const line of String(text).split(/\r?\n/)) {
    const t = line.trimEnd();
    if (!t) continue;
    buf.push(`[${ts}] ${prefix}${t}`);
  }
  while (buf.length > MAX_LINES) buf.shift();
}

function attachLogs(child, buf, tag) {
  child.stdout.on("data", (d) => {
    const s = String(d);
    pushLines(buf, s, "out");
    const line = s.trim();
    if (line) console.log(`[${tag}]`, line);
  });
  child.stderr.on("data", (d) => {
    const s = String(d);
    pushLines(buf, s, "err");
    const line = s.trim();
    if (line) console.error(`[${tag}]`, line);
  });
}

function spawnWithNode(script, args, buf, tag) {
  const child = spawn("node", [script, ...args], {
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    shell: false,
  });
  attachLogs(child, buf, tag);
  child.on("exit", (code, signal) => {
    pushLines(
      buf,
      `process exited code=${code} signal=${signal || ""}`,
      "out"
    );
    emit();
  });
  child.on("error", (e) => {
    pushLines(buf, `spawn error: ${e.message}`, "err");
    console.error(`[${tag}] spawn error`, e.message);
  });
  return child;
}

function startRelay() {
  if (alive(relayProc)) return snapshot();
  const entry = relayEntry();
  pushLines(relayLog, `starting ${entry}`, "out");
  console.log("[desktop] starting relay", entry);
  relayProc = spawnWithNode(entry, [], relayLog, "relay");
  emit();
  return snapshot();
}

function startDaemon() {
  if (alive(daemonProc)) return snapshot();
  const entry = daemonCli();
  pushLines(daemonLog, `starting ${entry} daemon`, "out");
  console.log("[desktop] starting daemon", entry);
  daemonProc = spawnWithNode(entry, ["daemon"], daemonLog, "daemon");
  emit();
  return snapshot();
}

function stopProc(proc) {
  if (!alive(proc)) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(proc.pid), "/f", "/t"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } else {
      proc.kill("SIGTERM");
    }
  } catch (e) {
    console.error("stop error", e.message);
  }
}

function stopRelay() {
  if (alive(relayProc)) pushLines(relayLog, "stopping…", "out");
  stopProc(relayProc);
  relayProc = null;
  emit();
  return snapshot();
}

function stopDaemon() {
  if (alive(daemonProc)) pushLines(daemonLog, "stopping…", "out");
  stopProc(daemonProc);
  daemonProc = null;
  emit();
  return snapshot();
}

function startAll() {
  startRelay();
  setTimeout(() => startDaemon(), 900);
  return snapshot();
}

function stopAll() {
  stopDaemon();
  stopRelay();
  return snapshot();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function restartRelay() {
  stopRelay();
  await sleep(400);
  startRelay();
  return snapshot();
}

async function restartDaemon() {
  stopDaemon();
  await sleep(400);
  startDaemon();
  return snapshot();
}

async function restartAll() {
  stopAll();
  await sleep(500);
  startAll();
  return snapshot();
}

/** Tail of daemon file log (extra history written by daemon itself). */
function readDaemonFileTail(maxLines = 200) {
  const file = path.join(os.homedir(), ".companion", "daemon.log");
  try {
    if (!fs.existsSync(file)) return [];
    const text = fs.readFileSync(file, "utf8");
    const lines = text.split(/\r?\n/).filter(Boolean);
    return lines.slice(-maxLines).map((l) => `[file] ${l}`);
  } catch {
    return [];
  }
}

function getLogs() {
  const fileTail = readDaemonFileTail(120);
  // Prefer live process buffer; append recent file lines not already obvious
  const daemonCombined = [...fileTail, ...daemonLog].slice(-MAX_LINES);
  return {
    relay: relayLog.slice(),
    daemon: daemonCombined,
  };
}

module.exports = {
  onStatus,
  snapshot,
  startRelay,
  startDaemon,
  stopRelay,
  stopDaemon,
  startAll,
  stopAll,
  restartRelay,
  restartDaemon,
  restartAll,
  getLogs,
};
