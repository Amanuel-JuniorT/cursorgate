"use strict";
const fs = require("fs");
const { loadConfig, validateConfig, readRelayDaemonToken, ensureConfig, saveConfig } = require("./config.js");
const { daemonLogPath, companionDir } = require("./paths.js");
const { RelayClient } = require("./relayClient.js");
const { ChatWatcher, discoverChats } = require("./chatWatcher.js");
const { notifyWindows } = require("./replyInbox.js");
const { deliverReply } = require("./replyInject.js");

function log(m) {
  const line = `${new Date().toISOString()} ${m}\n`;
  try {
    fs.mkdirSync(companionDir(), { recursive: true });
    fs.appendFileSync(daemonLogPath(), line);
  } catch {
    /* ignore */
  }
  console.log(m);
}

async function runDaemon() {
  let cfg = loadConfig();
  const token = (cfg && cfg.daemonToken) || readRelayDaemonToken();
  if (!cfg || !cfg.daemonToken) {
    cfg = ensureConfig({
      daemonToken: token,
      relayUrl: cfg?.relayUrl,
    });
    if (token && cfg.daemonToken !== token) {
      cfg.daemonToken = token;
      saveConfig(cfg);
      cfg = loadConfig();
    }
  }

  const problems = validateConfig(cfg);
  if (problems.length) {
    log("config problems: " + problems.join("; "));
    log("Fix with: companion install (relay must be running once to create token)");
  }

  const client = new RelayClient({
    relayUrl: cfg.relayUrl,
    daemonToken: cfg.daemonToken,
  });

  // Persist default + push phoneApprovals to relay (source of truth for gate)
  if (typeof cfg.phoneApprovals !== "boolean") {
    cfg.phoneApprovals = false;
    saveConfig(cfg);
    cfg = loadConfig();
  }
  try {
    await client.setSettings({ phoneApprovals: cfg.phoneApprovals === true });
  } catch (e) {
    log("settings sync: " + e.message);
  }

  /** @type {Map<string, { path?: string, project?: string, title?: string }>} */
  const chatMeta = new Map();

  const refreshMeta = () => {
    try {
      for (const c of discoverChats().slice(0, 80)) {
        chatMeta.set(c.id, {
          path: c.path,
          project: c.project,
          title: c.title,
        });
      }
    } catch (e) {
      log("meta refresh: " + e.message);
    }
  };

  const backfill = async () => {
    if (cfg.chatWatchEnabled === false) return;
    try {
      await client.purgeJunkChats().catch(() => {});
      const chats = discoverChats().slice(0, 80);
      for (const chat of chats) {
        chatMeta.set(chat.id, {
          path: chat.path,
          project: chat.project,
          title: chat.title,
        });
      }
      // Full replace so phone no longer shows old terminals/*.txt junk
      await client.replaceChats(chats);
      log(`backfill replaced catalog with ${chats.length} chats`);
    } catch (e) {
      log("backfill error: " + e.message);
    }
  };

  await backfill();

  const watcher = new ChatWatcher({
    log,
    onUpsert: async (chat) => {
      try {
        chatMeta.set(chat.id, {
          path: chat.path,
          project: chat.project,
          title: chat.title,
        });
        await client.upsertChat(chat);
      } catch (e) {
        log("upsert chat: " + e.message);
      }
    },
    onFinished: async (chat) => {
      const label = `${chat.project} / ${(chat.title || "").slice(0, 40)}`;
      notifyWindows("Agent finished", label);
      try {
        await client.agentFinished(chat);
        log(`agent finished: ${label}`);
      } catch (e) {
        log("finished notify: " + e.message);
      }
    },
  });

  if (cfg.chatWatchEnabled !== false) {
    watcher.start(4000);
    log("chat watcher started");
  }

  let replyBusy = false;
  let lastReplyErrLog = 0;
  setInterval(async () => {
    if (replyBusy) return;
    replyBusy = true;
    try {
      const cfgNow = loadConfig();
      if (!cfgNow?.daemonToken) return;
      client.token = cfgNow.daemonToken;
      client.base = (cfgNow.relayUrl || "").replace(/\/$/, "");
      const { replies } = await client.pendingReplies();
      if (replies.length) log(`processing ${replies.length} phone reply(ies)`);
      for (const reply of replies) {
        const meta = chatMeta.get(reply.chatId) || {};
        // Resolve project: phone payload → local meta → rediscover by chat id
        let project = reply.project || meta.project || null;
        let title = reply.title || meta.title || null;
        if (!project) {
          try {
            const hit = discoverChats().find((c) => c.id === reply.chatId);
            if (hit) {
              project = hit.project;
              title = title || hit.title;
              chatMeta.set(hit.id, {
                path: hit.path,
                project: hit.project,
                title: hit.title,
              });
            }
          } catch {
            /* ignore */
          }
        }
        const cfgReply = loadConfig();
        log(
          `reply ${reply.id} → project=${project || "?"} title=${(title || "").slice(0, 40)}`
        );
        const result = deliverReply(reply, {
          chatPath: meta.path || null,
          project,
          title,
          replyMode: cfgReply?.replyMode || undefined,
          replySubmit: cfgReply?.replySubmit || "enter",
        });
        try {
          await client.appendChatMessage(reply.chatId, {
            role: "user",
            content: `📱 ${reply.text}`,
            ts: Date.now(),
          });
        } catch (e) {
          log("append chat msg: " + e.message);
        }
        await client.setReplyStatus(reply.id, result.status, result.detail);
        log(
          `reply ${reply.id} → ${result.status} (${result.mode}) ${result.detail || ""}`.slice(
            0,
            240
          )
        );
      }
    } catch (e) {
      const now = Date.now();
      // Log at least every 15s so silent fetch failures are visible
      if (now - lastReplyErrLog > 15_000) {
        log("reply poll error: " + (e && e.message));
        lastReplyErrLog = now;
      }
    } finally {
      replyBusy = false;
    }
  }, 1500);

  setInterval(refreshMeta, 20_000);

  // Clear stale phone approval cards when gate already handed off to Cursor
  setInterval(async () => {
    try {
      const cfgNow = loadConfig();
      if (!cfgNow?.daemonToken) return;
      client.token = cfgNow.daemonToken;
      client.base = (cfgNow.relayUrl || "").replace(/\/$/, "");
      const r = await client.expireApprovals();
      if (r.expired) log(`expired ${r.expired} stale approval(s)`);
    } catch (e) {
      /* relay blip */
    }
  }, 20000);

  // Keep ~/.companion.json in sync if phone toggles approvals on the relay
  setInterval(async () => {
    try {
      const { settings } = await client.getSettings();
      const on = settings && settings.phoneApprovals === true;
      const cfgNow = loadConfig();
      if (cfgNow && cfgNow.phoneApprovals !== on) {
        cfgNow.phoneApprovals = on;
        saveConfig(cfgNow);
        log(`phoneApprovals → ${on} (from relay)`);
      }
    } catch {
      /* ignore */
    }
  }, 15000);

  let lastTick = Date.now();
  setInterval(async () => {
    const now = Date.now();
    if (now - lastTick > 60_000) {
      log("wake/backfill detected (gap > 60s)");
      await backfill();
    }
    lastTick = now;
  }, 5000);

  const replyMode = cfg.replyMode || (process.platform === "win32" ? "paste" : "inbox");
  log(`daemon running → relay ${cfg.relayUrl}`);
  log(
    `phoneApprovals=${cfg.phoneApprovals === true} (off → Cursor UI; on + live PWA → phone)`
  );
  log("PC must stay awake for live sync, approvals, and replies.");
  log(
    `Phone replies mode=${replyMode} (paste=inject into Cursor, clipboard=copy only, inbox=file only)`
  );

  await new Promise(() => {});
}

module.exports = { runDaemon, log };
