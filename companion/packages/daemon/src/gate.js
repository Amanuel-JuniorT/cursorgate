"use strict";
/**
 * Cursor beforeShellExecution hook runtime.
 * Zero runtime deps. Talks to companion relay (not public ntfy).
 * Every failure → ask. Never accidental auto-allow.
 * Always settles the relay approval so the phone clears the card.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const POLL_MS = 400;
const MAX_CMD_LEN = 3500;
const SAFE = [
  /^git (status|branch( --show-current)?|diff|log( -\d+)?( --oneline)?)$/,
];
// Dangerous shell metacharacters (`;` alone is OK if every segment is allowlisted)
const DANGEROUS = /[|&`$<>\n]/;

const LOG = path.join(os.homedir(), "gate-debug.log");
const CONFIG = path.join(os.homedir(), ".companion.json");

const log = (m) => {
  try {
    const line = `${new Date().toISOString()} ${m}\n`;
    fs.appendFileSync(LOG, line);
    const st = fs.statSync(LOG);
    if (st.size > 1_000_000) fs.writeFileSync(LOG, line, "utf8");
  } catch {
    /* ignore */
  }
};

let answered = false;
const answer = (permission, why) => {
  if (answered) return;
  answered = true;
  log(`-> ${permission} (${why})`);
  process.stdout.write(JSON.stringify({ permission }));
};

process.on("uncaughtException", (e) => {
  log("CRASH " + (e && e.stack));
  answer("ask", "crash");
  process.exit(0);
});
process.on("unhandledRejection", (e) => {
  log("REJECT " + e);
  answer("ask", "rejection");
  process.exit(0);
});

let stop = false;
const stopPolling = (why) => {
  stop = true;
  log("stop requested: " + why);
};
// Only real process signals — NOT stdin close/end.
// Cursor always closes stdin after the JSON payload; treating that as abort
// made every approval expire instantly (ask/signal) before the phone could tap.
process.on("SIGTERM", () => stopPolling("SIGTERM"));
process.on("SIGINT", () => stopPolling("SIGINT"));

log("started");

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
    text = buf.slice(3).toString("utf8");
    enc = "utf8-bom";
  } else if (buf.length >= 4 && buf[0] === 0x7b && buf[1] === 0x00) {
    text = buf.toString("utf16le");
    enc = "utf16le";
  } else {
    text = buf.toString("utf8");
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return { text, enc };
};

async function settleApproval(relayUrl, token, id, patch) {
  if (!id || !token) return;
  const base = relayUrl.replace(/\/$/, "");
  try {
    const r = await fetch(`${base}/approvals/${id}/settle`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(patch),
    });
    log(`settle status=${r.status} id=${id} → ${patch.status || patch.permission}`);
  } catch (e) {
    log("settle error: " + e.message);
  }
}

async function preflight(relayUrl, token) {
  const base = relayUrl.replace(/\/$/, "");
  try {
    const r = await fetch(`${base}/gate/preflight`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) {
      log(`preflight status=${r.status}`);
      return { usePhone: false, reason: "preflight_http_" + r.status };
    }
    return await r.json();
  } catch (e) {
    log("preflight error: " + e.message);
    return { usePhone: false, reason: "preflight_network" };
  }
}

/** Wait until phone ACKs the approval card (UI actually received it). */
async function waitAck(relayUrl, token, id, ackSeconds) {
  const base = relayUrl.replace(/\/$/, "");
  const deadline = Date.now() + Math.max(1, ackSeconds) * 1000;
  while (Date.now() < deadline) {
    if (stop) return false;
    try {
      const r = await fetch(`${base}/approvals/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) {
        const data = await r.json();
        const a = data.approval;
        if (a && a.ackedAt) return true;
        if (a && a.status && a.status !== "pending") return true;
      }
    } catch (e) {
      log("ack poll error: " + e.message);
    }
    await new Promise((res) => setTimeout(res, 200));
  }
  return false;
}

async function waitDecision(relayUrl, token, id, timeoutSeconds) {
  const base = relayUrl.replace(/\/$/, "");
  const deadline =
    timeoutSeconds > 0 ? Date.now() + timeoutSeconds * 1000 : null;

  for (;;) {
    if (stop) return { permission: "ask", why: "signal" };
    if (deadline !== null && Date.now() >= deadline) {
      return { permission: "ask", why: "timeout" };
    }
    const remaining =
      deadline === null
        ? 15000
        : Math.min(15000, Math.max(500, deadline - Date.now()));
    try {
      const r = await fetch(
        `${base}/approvals/${id}?wait=1&timeoutMs=${remaining}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!r.ok) {
        log(`wait status=${r.status}`);
        await new Promise((res) => setTimeout(res, POLL_MS));
        continue;
      }
      const data = await r.json();
      const a = data.approval;
      if (!a) continue;
      if (a.status === "approved")
        return { permission: "allow", why: "phone approve" };
      if (a.status === "denied")
        return { permission: "deny", why: "phone deny" };
      if (a.status === "passed")
        return { permission: "ask", why: "phone pass" };
      if (a.status === "expired" || a.status === "cancelled")
        return { permission: "ask", why: a.status };
      if (data.timedOut && deadline !== null && Date.now() >= deadline) {
        return { permission: "ask", why: "timeout" };
      }
    } catch (e) {
      log("wait error: " + e.message);
      await new Promise((res) => setTimeout(res, POLL_MS));
    }
  }
}

const chunks = [];
process.stdin.on("data", (d) =>
  chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d))
);
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
  const project =
    path.basename(String((ev.workspace_roots || [""])[0]).replace(/\/$/, "")) ||
    "unknown";
  log(`event=${ev.hook_event_name} project=${project} cmd=${cmd.slice(0, 200)}`);

  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
  } catch (e) {
    log("config error: " + e.message);
    answer("ask", "no config");
    return process.exit(0);
  }

  if (cfg.enabled === false || cfg.sendNotifications === false) {
    answer("ask", "disabled");
    return process.exit(0);
  }

  const allowlist =
    Array.isArray(cfg.allowlist) && cfg.allowlist.length
      ? cfg.allowlist
          .map((s) => {
            try {
              return new RegExp(s);
            } catch {
              return null;
            }
          })
          .filter(Boolean)
      : SAFE;

  const matchesAllow = (c) => allowlist.some((r) => r.test(c));
  // Auto-allow plain allowlisted cmds, or `;`-chains where every segment is allowlisted
  const allowlisted =
    !DANGEROUS.test(cmd) &&
    (matchesAllow(cmd) ||
      cmd
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean)
        .every((part) => matchesAllow(part)));

  if (allowlisted) {
    answer("allow", "allowlist");
    return process.exit(0);
  }
  if (!cmd || cmd.length > MAX_CMD_LEN) {
    answer("ask", "empty or too long");
    return process.exit(0);
  }

  const relayUrl = cfg.relayUrl || "http://127.0.0.1:8787";
  const token = cfg.daemonToken;
  if (!token) {
    log("no daemonToken");
    answer("ask", "no token");
    return process.exit(0);
  }

  let timeoutSeconds = Number(cfg.timeoutSeconds);
  if (!Number.isFinite(timeoutSeconds)) {
    const waitMs = Number(cfg.waitMs);
    timeoutSeconds =
      Number.isFinite(waitMs) && waitMs > 0 ? Math.round(waitMs / 1000) : 0;
  }

  // Phone opted in — only wait if a live PWA heartbeat is present
  const pf = await preflight(relayUrl, token);
  log(
    `preflight usePhone=${pf.usePhone} reason=${pf.reason || "?"} live=${pf.liveDevices ?? "?"}`
  );
  if (!pf.usePhone) {
    answer("ask", pf.reason || "no_live_phone");
    return process.exit(0);
  }

  const id = crypto.randomBytes(8).toString("hex");
  let published = false;
  const ACK_SECONDS = 5;

  const finish = async (permission, why, settleStatus) => {
    if (published) {
      await settleApproval(relayUrl, token, id, {
        status:
          settleStatus ||
          (permission === "allow"
            ? "approved"
            : permission === "deny"
              ? "denied"
              : why === "phone pass"
                ? "passed"
                : "expired"),
        permission,
        why,
      });
    }
    answer(permission, why);
    process.exit(0);
  };

  try {
    const pub = await fetch(`${relayUrl.replace(/\/$/, "")}/approvals`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        id,
        command: cmd,
        project,
        timeoutSeconds,
      }),
    });
    log(
      `notify status=${pub.status} id=${id} timeout=${timeoutSeconds || "none"}`
    );
    if (!pub.ok) {
      answer("ask", "relay reject");
      return process.exit(0);
    }
    published = true;

    const acked = await waitAck(relayUrl, token, id, ACK_SECONDS);
    if (!acked) {
      log("no approval ACK — falling back to Cursor ask");
      return finish("ask", "no_ack");
    }

    const { permission, why } = await waitDecision(
      relayUrl,
      token,
      id,
      timeoutSeconds
    );
    return finish(permission, why);
  } catch (e) {
    log("network error: " + e.message);
    if (published) {
      await settleApproval(relayUrl, token, id, {
        status: "expired",
        permission: "ask",
        why: "network",
      });
    }
    answer("ask", "network");
  }
  process.exit(0);
});
