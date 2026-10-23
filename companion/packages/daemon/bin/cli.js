#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const { parseArgs } = require("node:util");
const {
  loadConfig,
  saveConfig,
  ensureConfig,
  validateConfig,
  readRelayDaemonToken,
  maskToken,
  DEFAULTS,
} = require("../src/config.js");
const { gatePath, installDir, logPath, daemonLogPath, configPath } = require("../src/paths.js");
const { installProjectHooks, removeProjectHooks } = require("../src/hooksFile.js");
const { RelayClient } = require("../src/relayClient.js");
const { discoverChats } = require("../src/chatWatcher.js");
const { listInbox } = require("../src/replyInbox.js");
const { runDaemon } = require("../src/daemon.js");
const { listLanIpv4, bestLanIp } = require("../src/lan.js");

function print(msg) {
  console.log(msg);
}

function installGateRuntime() {
  fs.mkdirSync(installDir(), { recursive: true });
  const src = path.join(__dirname, "..", "src", "gate.js");
  fs.copyFileSync(src, gatePath());
  return gatePath();
}

async function syncTokenFromRelay(cfg) {
  const token = readRelayDaemonToken();
  if (token) {
    cfg.daemonToken = token;
    saveConfig(cfg);
    return token;
  }
  return cfg.daemonToken;
}

async function cmdInstall() {
  const gate = installGateRuntime();
  let cfg = ensureConfig({});
  await syncTokenFromRelay(cfg);
  cfg = loadConfig();
  print(`Gate runtime: ${gate}`);
  print(`Config: ${configPath()}`);
  print(`Relay: ${cfg.relayUrl}`);
  print(`Token: ${maskToken(cfg.daemonToken)}`);
  if (!cfg.daemonToken) {
    print("");
    print("Start the relay once so a daemon token is created:");
    print("  npm run start:relay");
    print("Then re-run: companion install");
  } else {
    try {
      const client = new RelayClient(cfg);
      const h = await client.health();
      print(`Relay health: ok (devices=${h.devices}, pending=${h.pendingApprovals})`);
    } catch (e) {
      print(`Relay not reachable: ${e.message}`);
    }
  }
  print("");
  print("Next: companion pair   (show code for phone PWA)");
  print("      companion init . (wire this project hooks)");
  print("      companion daemon (start chat sync + reply inbox)");
}

async function cmdInit(projectPath, yes) {
  await cmdInstall();
  const root = path.resolve(projectPath || ".");
  const result = installProjectHooks(root, gatePath());
  print(result.changed ? `Updated ${result.hooksFile}` : `Already set ${result.hooksFile}`);
  print(`Command: ${result.command}`);

  const gi = path.join(root, ".gitignore");
  const line = ".cursor/hooks.json";
  if (fs.existsSync(gi)) {
    const text = fs.readFileSync(gi, "utf8");
    if (!text.includes(line)) {
      let add = yes;
      if (!yes && process.stdin.isTTY) {
        print(`Add ${line} to .gitignore? (y/N) — use --yes to auto-accept`);
      }
      if (add) {
        fs.appendFileSync(gi, `\n${line}\n`);
        print("Added to .gitignore");
      }
    }
  }
}

async function cmdPair() {
  let cfg = loadConfig();
  if (!cfg?.daemonToken) {
    cfg = ensureConfig({ daemonToken: readRelayDaemonToken() });
    await syncTokenFromRelay(cfg);
    cfg = loadConfig();
  }
  const problems = validateConfig(cfg);
  if (problems.length) {
    print("Config issues: " + problems.join("; "));
    process.exitCode = 1;
    return;
  }
  const client = new RelayClient(cfg);
  const { code, expiresAt } = await client.startPairing();
  const lan = bestLanIp();
  const lans = listLanIpv4();
  const pwaUrl = lan ? `http://${lan}:5173/` : "http://<PC-LAN-IP>:5173/";
  const relayUrl = lan ? `http://${lan}:8787` : "http://<PC-LAN-IP>:8787";

  print("");
  print("═══ Pair your phone ═══");
  print(`Code: ${code}`);
  print(`Expires: ${new Date(expiresAt).toLocaleString()}`);
  print("");
  print("1) On Android Chrome open the PWA (NOT port 8787):");
  print(`   ${pwaUrl}`);
  print("2) On the Pair screen, set Relay URL to:");
  print(`   ${relayUrl}`);
  print("3) Enter the code above, then Pair device.");
  print("");
  print(`PC-local relay (gate/daemon): ${cfg.relayUrl}`);
  if (lans.length) {
    print("Detected IPs:");
    for (const x of lans) {
      print(`  ${x.ip}  (${x.name}${x.vm ? ", likely VM — skip for phone" : ""})`);
    }
  }
  print("Phone and PC must be on the same Wi-Fi. Codes expire in ~10 minutes.");
}

async function cmdDevices() {
  const cfg = loadConfig();
  const client = new RelayClient(cfg);
  const { devices } = await client.listDevices();
  if (!devices.length) print("No paired devices");
  for (const d of devices) {
    print(`${d.id}  ${d.name}  lastSeen=${new Date(d.lastSeenAt).toISOString()}`);
  }
}

async function cmdRevoke(id) {
  const cfg = loadConfig();
  const client = new RelayClient(cfg);
  await client.revokeDevice(id);
  print(`Revoked ${id}`);
}

function cmdOnOff(enabled) {
  const cfg = ensureConfig({});
  cfg.enabled = enabled;
  saveConfig(cfg);
  print(`enabled: ${enabled}`);
}

function cmdStatus() {
  const cfg = loadConfig();
  if (!cfg) {
    print("No config — run companion install");
    return;
  }
  if (cfg.timeoutSeconds === 0) {
    print("WARNING: timeoutSeconds=0 — agent will hang if phone unreachable");
  }
  print(`enabled: ${cfg.enabled}`);
  print(`relay: ${cfg.relayUrl}`);
  print(`phoneApprovals: ${cfg.phoneApprovals === true}`);
  print(`timeoutSeconds: ${cfg.timeoutSeconds}`);
  print(`allowlist: ${cfg.allowlist?.length || 0}`);
  print(`gate installed: ${fs.existsSync(gatePath())}`);
  print(`token: ${maskToken(cfg.daemonToken)}`);
  print(`chatWatch: ${cfg.chatWatchEnabled !== false}`);
  print(`replyMode: ${cfg.replyMode || (process.platform === "win32" ? "paste" : "inbox")}`);
  print(`replySubmit: ${cfg.replySubmit || "enter"}`);
  const problems = validateConfig(cfg);
  print(`config valid: ${problems.length === 0}`);
  if (problems.length) problems.forEach((p) => print("  - " + p));
}

async function cmdSet(key, value) {
  const cfg = ensureConfig({});
  if (key === "timeout") {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) throw new Error("timeout must be integer >= 0");
    cfg.timeoutSeconds = n;
    if (n === 0) print("WARNING: agent will hang if phone unreachable");
  } else if (key === "server" || key === "relay") {
    cfg.relayUrl = value;
  } else if (key === "token") {
    cfg.daemonToken = value === "none" ? null : value;
  } else if (key === "replyMode" || key === "reply") {
    const v = String(value || "").toLowerCase();
    if (!["paste", "clipboard", "inbox"].includes(v)) {
      throw new Error("replyMode must be paste|clipboard|inbox");
    }
    cfg.replyMode = v;
  } else if (key === "replySubmit" || key === "submit") {
    const v = String(value || "").toLowerCase().replace("_", "+");
    if (!["enter", "ctrl+enter", "ctrl-enter"].includes(v)) {
      throw new Error("replySubmit must be enter|ctrl+enter");
    }
    cfg.replySubmit = v === "ctrl-enter" ? "ctrl+enter" : v;
  } else if (
    key === "phoneApprovals" ||
    key === "phone" ||
    key === "approvals"
  ) {
    const v = String(value || "").toLowerCase();
    if (!["true", "false", "on", "off", "1", "0"].includes(v)) {
      throw new Error("phoneApprovals must be true|false");
    }
    cfg.phoneApprovals = v === "true" || v === "on" || v === "1";
  } else {
    throw new Error(
      "unknown key — use timeout|relay|token|replyMode|replySubmit|phoneApprovals"
    );
  }
  saveConfig(cfg);
  // Mirror to relay so gate preflight + phone Settings stay in sync
  if (
    (key === "phoneApprovals" || key === "phone" || key === "approvals") &&
    cfg.daemonToken &&
    cfg.relayUrl
  ) {
    try {
      await fetch(`${String(cfg.relayUrl).replace(/\/$/, "")}/settings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.daemonToken}`,
        },
        body: JSON.stringify({ phoneApprovals: cfg.phoneApprovals === true }),
      });
    } catch {
      print("(relay sync skipped — start relay to pick up setting)");
    }
  }
  print("ok");
  cmdStatus();
}

function cmdAllow(sub, arg) {
  const cfg = ensureConfig({});
  if (!Array.isArray(cfg.allowlist)) cfg.allowlist = DEFAULTS.allowlist.slice();
  if (sub === "list") {
    cfg.allowlist.forEach((r, i) => print(`${i}: ${r}`));
    return;
  }
  if (sub === "add") {
    const re = arg;
    try {
      new RegExp(re);
    } catch (e) {
      throw new Error("invalid regex: " + e.message);
    }
    if (!re.startsWith("^") || !re.endsWith("$")) {
      print("WARNING: regex should start with ^ and end with $");
    }
    cfg.allowlist.push(re);
    saveConfig(cfg);
    print("added");
    return;
  }
  if (sub === "remove") {
    const i = Number(arg);
    if (!Number.isInteger(i) || i < 0 || i >= cfg.allowlist.length) {
      throw new Error("bad index");
    }
    cfg.allowlist.splice(i, 1);
    saveConfig(cfg);
    print("removed");
    return;
  }
  throw new Error("allow add|remove|list");
}

async function cmdDoctor() {
  const checks = [];
  const ok = (name, pass, hint) => checks.push({ name, pass, hint });

  ok("node>=18", Number(process.versions.node.split(".")[0]) >= 18, "Install Node 18+");

  let cfg = null;
  try {
    cfg = loadConfig();
    const problems = validateConfig(cfg);
    ok("config", problems.length === 0, problems.join("; ") || "run companion install");
  } catch (e) {
    ok("config", false, e.message);
  }

  ok("gate runtime", fs.existsSync(gatePath()), "run companion install");

  if (cfg?.daemonToken) {
    try {
      const h = await new RelayClient(cfg).health();
      ok("relay reachable", true, `devices=${h.devices}`);
    } catch (e) {
      ok("relay reachable", false, e.message + " — start npm run start:relay");
    }
  } else {
    ok("relay reachable", false, "no daemonToken");
  }

  // stdin smoke
  try {
    const { spawnSync } = require("child_process");
    const payload = JSON.stringify({
      command: "echo hi",
      workspace_roots: ["/c:/x/y"],
    });
    // enabled false temporarily? use echo pipe — gate may hang waiting approval.
    // Instead just check gate parses — run with enabled false
    const prev = cfg;
    if (prev) {
      const copy = { ...prev, enabled: false };
      saveConfig(copy);
      const r = spawnSync(process.execPath, [gatePath()], {
        input: payload,
        encoding: "utf8",
        timeout: 5000,
      });
      saveConfig(prev);
      const out = (r.stdout || "").trim();
      ok("gate smoke", out.includes('"permission":"ask"'), out || r.stderr || "no output");
    } else {
      ok("gate smoke", false, "no config");
    }
  } catch (e) {
    ok("gate smoke", false, e.message);
  }

  const chats = discoverChats();
  ok("chat discovery", true, `found ${chats.length} transcript(s)`);

  const inbox = listInbox();
  ok("reply inbox", true, inbox.dir);

  print("");
  for (const c of checks) {
    print(`${c.pass ? "PASS" : "FAIL"}  ${c.name}${c.hint ? " — " + c.hint : ""}`);
  }
  if (checks.some((c) => !c.pass)) process.exitCode = 1;
}

async function cmdLogs(n) {
  const file = logPath();
  if (!fs.existsSync(file)) {
    print("no gate log");
    return;
  }
  const lines = fs.readFileSync(file, "utf8").trim().split(/\r?\n/);
  print(lines.slice(-n).join("\n"));
  if (fs.existsSync(daemonLogPath())) {
    print("\n--- daemon ---");
    print(
      fs.readFileSync(daemonLogPath(), "utf8").trim().split(/\r?\n/).slice(-n).join("\n")
    );
  }
}

/** Purge terminals/junk and push a fresh chat catalog to the relay (and phone). */
async function cmdSync() {
  const cfg = loadConfig();
  if (!cfg?.daemonToken) {
    print("No config/token — run companion install with relay up");
    process.exitCode = 1;
    return;
  }
  const client = new RelayClient(cfg);
  try {
    const purged = await client.purgeJunkChats();
    print(`Purged junk chats: ${purged.removed || 0}`);
  } catch (e) {
    print(`Note: purge API unavailable (${e.message}) — restart relay, then re-run sync`);
  }
  const chats = discoverChats().slice(0, 80);
  const byProject = {};
  for (const c of chats) {
    byProject[c.project] = (byProject[c.project] || 0) + 1;
  }
  try {
    const { count } = await client.replaceChats(chats);
    print(`Synced ${count} chats to relay:`);
  } catch (e) {
    print(`replace API unavailable (${e.message}) — upserting one-by-one`);
    for (const chat of chats) {
      await client.upsertChat(chat);
    }
    print(`Upserted ${chats.length} chats (restart relay for full catalog replace)`);
  }
  for (const [p, n] of Object.entries(byProject).sort((a, b) => b[1] - a[1])) {
    print(`  ${p}: ${n}`);
  }
  print("");
  print("On the phone: open Chats → Settings → Refresh snapshot (or reopen the app).");
  print("You should see projects like Swiss-knife / Simon — not 1.txt terminals.");
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] || "help";

  try {
    if (cmd === "install") return await cmdInstall();
    if (cmd === "init") {
      const yes = args.includes("--yes");
      const p = args.find((a) => a !== "init" && a !== "--yes") || ".";
      return await cmdInit(p, yes);
    }
    if (cmd === "pair") return await cmdPair();
    if (cmd === "devices") return await cmdDevices();
    if (cmd === "revoke") return await cmdRevoke(args[1]);
    if (cmd === "on") return cmdOnOff(true);
    if (cmd === "off") return cmdOnOff(false);
    if (cmd === "status") return cmdStatus();
    if (cmd === "set") return await cmdSet(args[1], args[2]);
    if (cmd === "allow") return cmdAllow(args[1], args[2]);
    if (cmd === "doctor") return await cmdDoctor();
    if (cmd === "logs") return await cmdLogs(Number(args[1]) || 50);
    if (cmd === "daemon") return await runDaemon();
    if (cmd === "sync") return await cmdSync();
    if (cmd === "test-paste") {
      const { pasteIntoCursor } = require("../src/replyInject.js");
      const cfg = loadConfig() || {};
      const text =
        args.slice(1).join(" ").trim() ||
        "companion test-paste: if you see this in Cursor chat, paste+run works";
      print("Click inside the Cursor Agent chat input now (3s)…");
      print("(Do not toggle Agent off — we only paste + Enter)");
      await new Promise((r) => setTimeout(r, 3000));
      const result = pasteIntoCursor(text, {
        submit: cfg.replySubmit || "enter",
        project: args.includes("--project")
          ? args[args.indexOf("--project") + 1]
          : null,
      });
      print(result.ok ? "OK: " + result.detail : "FAIL: " + result.detail);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (cmd === "remove") {
      const r = removeProjectHooks(path.resolve(args[1] || "."));
      print(r.changed ? "removed hook entry" : "nothing to remove");
      return;
    }
    if (cmd === "inbox") {
      print(JSON.stringify(listInbox(), null, 2));
      return;
    }

    print(`companion — Cursor phone companion (Full B)

Commands:
  install          Copy gate runtime, migrate config, sync relay token
  init [path]      Wire project .cursor/hooks.json (--yes for gitignore)
  remove [path]    Remove our hooks entry
  pair             Print pairing code for PWA
  devices          List paired phones
  revoke <id>      Revoke a device
  on | off         Enable/disable shell gate
  status           Show config (tokens masked)
  set <key> <val>  timeout | relay | token | phoneApprovals | replyMode | replySubmit
  allow add|remove|list
  daemon           Run chat sync + reply inbox worker
  sync             Purge junk + resync real chats to phone
  test-paste [msg] Focus Cursor, paste message, press Enter (dry-run inject)
  doctor           Health checks
  logs [-n 50]     Tail gate/daemon logs
  inbox            Show reply inbox path

Reply inject:
  set replyMode paste|clipboard|inbox
  set replySubmit enter|ctrl+enter
`);
  } catch (e) {
    console.error(e.message || e);
    process.exitCode = 1;
  }
}

main();
