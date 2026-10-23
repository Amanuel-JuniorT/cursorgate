"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const NTFY = "https://ntfy.sh";
const POLL_MS = 1500;
const MAX_CMD_LEN = 3500;    // longer than this can't be shown fully on the phone -> ask

// Auto-allow ONLY exact read-only commands, and never anything with shell chaining.
const SAFE = [/^git (status|branch( --show-current)?|diff|log( -\d+)?)$/];
const CHAINING = /[;&|`$<>\n]/;

const LOG = path.join(os.homedir(), "gate-debug.log");
const log = (m) => {
  try { fs.appendFileSync(LOG, `${new Date().toISOString()} ${m}\n`); } catch {}
};

let answered = false;
const answer = (permission, why) => {
  if (answered) return;
  answered = true;
  log(`-> ${permission} (${why})`);
  process.stdout.write(JSON.stringify({ permission }));
};

// Any crash -> "ask", never allow.
process.on("uncaughtException", (e) => { log("CRASH " + (e && e.stack)); answer("ask", "crash"); process.exit(0); });
process.on("unhandledRejection", (e) => { log("REJECT " + e); answer("ask", "rejection"); process.exit(0); });

log("started");

// Cursor on Windows may feed UTF-16 LE (with or without BOM). Never coerce
// chunks to a string until we know the encoding, or JSON.parse fails silently.
const decodeStdin = (buf) => {
  if (!buf.length) return { text: "", enc: "empty" };
  let enc = "utf8";
  let text;
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    text = buf.slice(2).toString("utf16le");
    enc = "utf16le-bom";
  } else if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    text = buf.slice(2).swap16().toString("utf16le");
    enc = "utf16be-bom";
  } else if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    // Cursor on Windows sends UTF-8 with BOM; JSON.parse rejects the BOM.
    text = buf.slice(3).toString("utf8");
    enc = "utf8-bom";
  } else if (buf.length >= 4 && buf[0] === 0x7b && buf[1] === 0x00) {
    // ASCII '{' (0x7b) followed by 0x00 => UTF-16 LE without BOM
    text = buf.toString("utf16le");
    enc = "utf16le";
  } else {
    text = buf.toString("utf8");
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return { text, enc };
};

const chunks = [];
process.stdin.on("data", (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
process.stdin.on("end", async () => {
  const buf = Buffer.concat(chunks);
  const { text: raw, enc } = decodeStdin(buf);
  log(`stdin bytes=${buf.length} enc=${enc}`);

  let ev;
  try {
    ev = JSON.parse(raw);
  } catch {
    log(`bad stdin json head=${buf.slice(0, 8).toString("hex")}`);
    answer("ask", "bad stdin json");
    return process.exit(0);
  }

  const cmd = String(ev.command || "").trim();
  const project = path.basename(String((ev.workspace_roots || [""])[0]).replace(/\/$/, "")) || "unknown";
  // Do NOT log user_email or the full payload.
  log(`event=${ev.hook_event_name} project=${project} cmd=${cmd.slice(0, 200)}`);

  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".companion.json"), "utf8"));
  } catch (e) {
    log("config error: " + e.message);
    answer("ask", "no config");
    return process.exit(0);
  }

  // Master switch: false → normal Cursor desktop prompt, no ntfy.
  if (cfg.enabled === false) {
    answer("ask", "disabled");
    return process.exit(0);
  }

  if (!cfg.out || !cfg.in) {
    log("config error: missing out/in");
    answer("ask", "no config");
    return process.exit(0);
  }

  if (SAFE.some((r) => r.test(cmd)) && !CHAINING.test(cmd)) {
    answer("allow", "allowlist");
    return process.exit(0);
  }
  if (!cmd || cmd.length > MAX_CMD_LEN) {
    answer("ask", "empty or too long");
    return process.exit(0);
  }

  // waitMs: 0 / omitted = wait until a button (no auto-timeout).
  // Positive = optional auto handoff to Cursor after that many ms.
  const waitMs = Number(cfg.waitMs);
  const useTimeout = Number.isFinite(waitMs) && waitMs > 0;

  const id = crypto.randomBytes(4).toString("hex");
  const since = Math.floor(Date.now() / 1000);
  const button = (label, verb) => ({
    action: "http",
    label,
    url: `${NTFY}/${cfg.in}`,
    method: "POST",
    body: `${verb}:${id}`,
    clear: true,
  });

  // After decide: replace the actionable notice with a read-only history entry
  // (same sequence_id) so the command text remains visible. Then dismiss the
  // heads-up via /clear without deleting history.
  const finalizeNotify = async (outcome) => {
    try {
      const upd = await fetch(NTFY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: cfg.out,
          sequence_id: id,
          title: `${outcome} (${project})`,
          message: cmd,
          priority: 2,
        }),
      });
      const clr = await fetch(`${NTFY}/${cfg.out}/${id}/clear`);
      log(`finalize status=${upd.status} clear=${clr.status} seq=${id} outcome=${outcome}`);
    } catch (e) {
      log("finalize error: " + e.message);
    }
  };

  const settle = async (permission, why, outcome) => {
    await finalizeNotify(outcome);
    answer(permission, why);
    process.exit(0);
  };

  try {
    const pub = await fetch(NTFY, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: cfg.out,
        title: `Cursor wants to run (${project})`,
        message: cmd,
        priority: 4,
        sequence_id: id,
        actions: [
          button("Approve", "approve"),
          button("Deny", "deny"),
          button("Pass to Cursor", "pass"),
        ],
      }),
    });
    log(`notify status=${pub.status} id=${id} waitMs=${useTimeout ? waitMs : "none"}`);

    const deadline = useTimeout ? Date.now() + waitMs : null;
    for (;;) {
      if (deadline !== null && Date.now() >= deadline) {
        return settle("ask", "timeout", "No response → Cursor");
      }
      const r = await fetch(`${NTFY}/${cfg.in}/json?poll=1&since=${since}`);
      const lines = (await r.text()).split("\n").filter(Boolean);
      for (const line of lines) {
        let m;
        try { m = JSON.parse(line); } catch { continue; }
        if (m.event !== "message") continue;
        if (m.message === `approve:${id}`) return settle("allow", "ntfy approve", "Approved");
        if (m.message === `deny:${id}`) return settle("deny", "ntfy deny", "Denied");
        if (m.message === `pass:${id}`) return settle("ask", "ntfy pass", "Passed → Cursor");
      }
      await new Promise((res) => setTimeout(res, POLL_MS));
    }
  } catch (e) {
    log("network error: " + e.message);
    await finalizeNotify("Error");
    answer("ask", "network");
  }
  process.exit(0);
});
