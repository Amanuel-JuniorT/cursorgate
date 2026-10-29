"use strict";
const http = require("http");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");
const { MSG, envelope, PROTOCOL_VERSION } = require("@companion/shared");
const { Store } = require("./store.js");
const { ensureVapid, notifyAll } = require("./push.js");
const { tryServePwa, pwaStatus } = require("./staticPwa.js");

// Fly sets PORT; local default remains 8787
const PORT = Number(
  process.env.PORT || process.env.COMPANION_RELAY_PORT || 8787
);
const HOST = process.env.COMPANION_RELAY_HOST || "0.0.0.0";

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Daemon-Token, X-Device-Token",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(body);
}

function bearer(req, headerName) {
  const h = req.headers[headerName.toLowerCase()] || req.headers.authorization || "";
  if (typeof h === "string" && h.toLowerCase().startsWith("bearer ")) {
    return h.slice(7).trim();
  }
  return typeof h === "string" ? h.trim() : "";
}

function main() {
  const store = new Store();
  const daemonToken = store.ensureDaemonToken();
  const vapid = ensureVapid(store);

  /** @type {Set<import('ws').WebSocket>} */
  const sockets = new Set();

  function broadcast(msg, filter) {
    const data = JSON.stringify(msg);
    for (const ws of sockets) {
      if (ws.readyState !== 1) continue;
      if (filter && !filter(ws)) continue;
      try {
        ws.send(data);
      } catch {
        /* ignore */
      }
    }
  }

  function authDaemon(req) {
    const t = bearer(req, "X-Daemon-Token") || bearer(req, "Authorization");
    return t && t === daemonToken;
  }

  function authDevice(req) {
    const t =
      bearer(req, "X-Device-Token") ||
      (req.url && new URL(req.url, "http://x").searchParams.get("token")) ||
      "";
    return store.deviceByToken(t);
  }

  const server = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      return sendJson(res, 204, {});
    }

    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    try {
      // Prefer built PWA on same origin (Fly HTTPS or local dist)
      if (tryServePwa(req, res, url.pathname)) return;

      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "")) {
        const host = req.headers.host || `localhost:${PORT}`;
        const pwa = pwaStatus();
        return sendJson(res, 200, {
          ok: true,
          service: "companion-relay",
          hint: pwa.served
            ? "PWA is served from this origin"
            : "Build the PWA (npm run build -w @companion/pwa) or set COMPANION_PWA_DIST",
          pwaServed: pwa.served,
          relay: `http://${host}`,
          health: "/health",
        });
      }

      if (req.method === "GET" && url.pathname === "/health") {
        const pwa = pwaStatus();
        return sendJson(res, 200, {
          ok: true,
          v: PROTOCOL_VERSION,
          devices: store.listDevices().length,
          liveDevices: store.liveDeviceCount(),
          pendingApprovals: store.pendingApprovals().length,
          phoneApprovals: store.getSettings().phoneApprovals,
          pwaServed: pwa.served,
        });
      }

      // Gate / daemon: should we wait on the phone for this shell command?
      if (req.method === "GET" && url.pathname === "/gate/preflight") {
        if (!authDaemon(req)) return sendJson(res, 401, { error: "daemon auth required" });
        const settings = store.getSettings();
        const live = store.liveDeviceCount(30000);
        const usePhone = settings.phoneApprovals === true && live > 0;
        return sendJson(res, 200, {
          usePhone,
          phoneApprovals: settings.phoneApprovals,
          liveDevices: live,
          reason: !settings.phoneApprovals
            ? "phoneApprovals_off"
            : live === 0
              ? "no_live_phone"
              : "ok",
        });
      }

      if (req.method === "GET" && url.pathname === "/settings") {
        const device = authDevice(req);
        if (!authDaemon(req) && !device) {
          return sendJson(res, 401, { error: "auth required" });
        }
        return sendJson(res, 200, { settings: store.getSettings() });
      }

      if (req.method === "POST" && url.pathname === "/settings") {
        const device = authDevice(req);
        if (!authDaemon(req) && !device) {
          return sendJson(res, 401, { error: "auth required" });
        }
        const body = await readJson(req);
        const settings = store.setSettings({
          phoneApprovals:
            typeof body.phoneApprovals === "boolean"
              ? body.phoneApprovals
              : undefined,
        });
        broadcast(envelope(MSG.SETTINGS, { settings }));
        return sendJson(res, 200, { settings });
      }

      if (req.method === "GET" && url.pathname === "/vapidPublicKey") {
        return sendJson(res, 200, { publicKey: vapid.publicKey });
      }

      // --- pairing ---
      if (req.method === "POST" && url.pathname === "/pair/start") {
        if (!authDaemon(req)) return sendJson(res, 401, { error: "daemon auth required" });
        const { code, expiresAt } = store.rotatePairingCode();
        return sendJson(res, 200, { code, expiresAt });
      }

      if (req.method === "POST" && url.pathname === "/pair") {
        const body = await readJson(req);
        const device = store.pairDevice(String(body.code || ""), body.name || "phone");
        if (!device) return sendJson(res, 400, { error: "invalid or expired pairing code" });
        return sendJson(res, 200, {
          deviceId: device.id,
          token: device.token,
          name: device.name,
        });
      }

      if (req.method === "GET" && url.pathname === "/devices") {
        if (!authDaemon(req)) return sendJson(res, 401, { error: "daemon auth required" });
        return sendJson(res, 200, { devices: store.listDevices() });
      }

      if (req.method === "POST" && url.pathname.startsWith("/devices/") && url.pathname.endsWith("/revoke")) {
        if (!authDaemon(req)) return sendJson(res, 401, { error: "daemon auth required" });
        const id = url.pathname.split("/")[2];
        const ok = store.revokeDevice(id);
        broadcast(envelope(MSG.REVOKE_DEVICE, { deviceId: id }));
        return sendJson(res, ok ? 200 : 404, { ok });
      }

      // --- daemon: approvals ---
      if (req.method === "POST" && url.pathname === "/approvals") {
        if (!authDaemon(req)) return sendJson(res, 401, { error: "daemon auth required" });
        const body = await readJson(req);
        if (!body.id || !body.command) {
          return sendJson(res, 400, { error: "id and command required" });
        }
        const approval = store.upsertApproval({
          id: body.id,
          command: String(body.command).slice(0, 4000),
          project: String(body.project || "unknown").slice(0, 128),
          status: "pending",
          createdAt: Date.now(),
          timeoutSeconds: Number(body.timeoutSeconds) || 0,
          ackedAt: null,
        });
        const msg = envelope(MSG.APPROVAL_REQUEST, { approval });
        broadcast(msg, (ws) => ws.role === "device");
        const pushResults = await notifyAll(store, {
          title: `Cursor wants to run (${approval.project})`,
          body: approval.command.slice(0, 120),
          tag: `approval-${approval.id}`,
          data: { type: "approval", id: approval.id },
        });
        if (!pushResults.length) {
          console.log(
            `approval ${approval.id}: no push subscribers (enable push in PWA Settings)`
          );
        } else {
          const ok = pushResults.filter((r) => r.ok).length;
          console.log(
            `approval ${approval.id}: push ${ok}/${pushResults.length}`
          );
        }
        return sendJson(res, 200, { approval });
      }

      if (
        req.method === "POST" &&
        url.pathname.startsWith("/approvals/") &&
        url.pathname.endsWith("/ack")
      ) {
        const device = authDevice(req);
        if (!device) return sendJson(res, 401, { error: "device auth required" });
        const id = url.pathname.split("/")[2];
        const a = store.ackApproval(id, device.id);
        if (!a) return sendJson(res, 404, { error: "not found" });
        return sendJson(res, 200, { approval: a });
      }

      if (req.method === "GET" && url.pathname.startsWith("/approvals/")) {
        const parts = url.pathname.split("/").filter(Boolean);
        // /approvals/:id only — ignore /approvals/:id/decide|settle
        if (parts.length !== 2) {
          /* fall through */
        } else {
          const id = parts[1];
          const wait = url.searchParams.get("wait") === "1";
          const isDaemon = authDaemon(req);
          const device = authDevice(req);
          if (!isDaemon && !device) return sendJson(res, 401, { error: "auth required" });

          const deadline =
            Date.now() +
            Math.min(Number(url.searchParams.get("timeoutMs") || 60000), 300000);
          const poll = async () => {
            for (;;) {
              const a = store.getApproval(id);
              if (!a) return sendJson(res, 404, { error: "not found" });
              if (a.status !== "pending" || !wait)
                return sendJson(res, 200, { approval: a });
              if (Date.now() >= deadline)
                return sendJson(res, 200, { approval: a, timedOut: true });
              await new Promise((r) => setTimeout(r, 400));
            }
          };
          return poll();
        }
      }

      if (
        req.method === "POST" &&
        url.pathname.startsWith("/approvals/") &&
        url.pathname.endsWith("/settle")
      ) {
        if (!authDaemon(req)) return sendJson(res, 401, { error: "daemon auth required" });
        const id = url.pathname.split("/")[2];
        const body = await readJson(req);
        const a = store.getApproval(id);
        if (!a) return sendJson(res, 404, { error: "not found" });
        if (a.status !== "pending") {
          return sendJson(res, 200, { approval: a, alreadySettled: true });
        }
        const updated = store.upsertApproval({
          ...a,
          status: body.status || "expired",
          permission: body.permission || "ask",
          why: body.why || null,
          decidedAt: Date.now(),
          decidedBy: "gate",
        });
        broadcast(envelope(MSG.APPROVAL_SETTLED, { approval: updated }));
        return sendJson(res, 200, { approval: updated });
      }

      if (
        req.method === "POST" &&
        url.pathname.startsWith("/approvals/") &&
        url.pathname.endsWith("/decide")
      ) {
        const device = authDevice(req);
        if (!device) return sendJson(res, 401, { error: "device auth required" });
        const id = url.pathname.split("/")[2];
        const body = await readJson(req);
        const decision = body.decision; // approve | deny | pass
        const a = store.getApproval(id);
        if (!a) return sendJson(res, 404, { error: "not found" });
        if (a.status !== "pending") {
          // Idempotent: phone can clear a card that gate already settled
          broadcast(envelope(MSG.APPROVAL_SETTLED, { approval: a }));
          return sendJson(res, 200, { approval: a, alreadySettled: true });
        }
        if (!["approve", "deny", "pass"].includes(decision)) {
          return sendJson(res, 400, { error: "decision must be approve|deny|pass" });
        }
        const status =
          decision === "approve"
            ? "approved"
            : decision === "deny"
              ? "denied"
              : "passed";
        const permission =
          decision === "approve" ? "allow" : decision === "deny" ? "deny" : "ask";
        const updated = store.upsertApproval({
          ...a,
          status,
          decision,
          permission,
          decidedAt: Date.now(),
          decidedBy: device.id,
        });
        broadcast(envelope(MSG.APPROVAL_SETTLED, { approval: updated }));
        return sendJson(res, 200, { approval: updated });
      }

      if (req.method === "POST" && url.pathname === "/approvals/expire") {
        if (!authDaemon(req)) return sendJson(res, 401, { error: "daemon auth required" });
        const now = Date.now();
        let n = 0;
        for (const a of store.pendingApprovals()) {
          const ttlSec = Number(a.timeoutSeconds) > 0 ? Number(a.timeoutSeconds) : 300;
          const age = now - (a.createdAt || 0);
          if (age > (ttlSec + 30) * 1000) {
            const updated = store.upsertApproval({
              ...a,
              status: "expired",
              permission: "ask",
              decidedAt: now,
              decidedBy: "expire",
            });
            broadcast(envelope(MSG.APPROVAL_SETTLED, { approval: updated }));
            n++;
          }
        }
        return sendJson(res, 200, { expired: n });
      }

      // --- chats (daemon writes, devices read) ---
      if (req.method === "POST" && url.pathname === "/chats") {
        if (!authDaemon(req)) return sendJson(res, 401, { error: "daemon auth required" });
        const body = await readJson(req);
        const chat = store.upsertChat({
          id: body.id,
          project: body.project,
          title: body.title,
          status: body.status || "idle",
          updatedAt: body.updatedAt || Date.now(),
          path: body.path || null,
        });
        if (Array.isArray(body.messages)) {
          store.setMessages(chat.id, body.messages);
        }
        broadcast(
          envelope(MSG.CHAT_UPSERT, {
            chat,
            messages: store.getMessages(chat.id),
          }),
          (ws) => ws.role === "device"
        );
        return sendJson(res, 200, { chat });
      }

      // Full catalog replace — clears terminals/junk left from older syncs
      if (req.method === "POST" && url.pathname === "/chats/replace") {
        if (!authDaemon(req)) return sendJson(res, 401, { error: "daemon auth required" });
        const body = await readJson(req);
        const list = Array.isArray(body.chats) ? body.chats : [];
        const chats = store.replaceCatalog(list);
        const snap = {
          chats: chats.map((c) => ({
            ...c,
            messages: store.getMessages(c.id).slice(-100),
          })),
        };
        broadcast(envelope(MSG.STATE_SNAPSHOT, {
          approvals: store.pendingApprovals(),
          chats: snap.chats,
          devices: store.listDevices().map((d) => ({ id: d.id, name: d.name })),
          replyQueue: store.state.replyQueue.slice(-50),
        }), (ws) => ws.role === "device");
        return sendJson(res, 200, { count: chats.length });
      }

      if (req.method === "POST" && url.pathname === "/chats/purge-junk") {
        if (!authDaemon(req)) return sendJson(res, 401, { error: "daemon auth required" });
        const removed = store.removeChatsWhere((chat) => {
          const p = String(chat.path || "").replace(/\\/g, "/").toLowerCase();
          return (
            p.includes("/terminals/") ||
            p.includes("/agent-tools/") ||
            p.endsWith(".txt") ||
            /^\d+\.txt$/i.test(String(chat.title || ""))
          );
        });
        broadcast(envelope(MSG.STATE_SNAPSHOT, {
          approvals: store.pendingApprovals(),
          chats: store.allChats().map((c) => ({
            ...c,
            messages: store.getMessages(c.id).slice(-100),
          })),
          devices: store.listDevices().map((d) => ({ id: d.id, name: d.name })),
          replyQueue: store.state.replyQueue.slice(-50),
        }), (ws) => ws.role === "device");
        return sendJson(res, 200, { removed });
      }

      if (req.method === "POST" && url.pathname === "/agent-finished") {
        if (!authDaemon(req)) return sendJson(res, 401, { error: "daemon auth required" });
        const body = await readJson(req);
        const chat = body.chatId ? store.state.chats[body.chatId] : null;
        if (chat) {
          store.upsertChat({ ...chat, status: "finished", updatedAt: Date.now() });
        }
        const msg = envelope(MSG.AGENT_FINISHED, {
          chatId: body.chatId,
          project: body.project,
          title: body.title,
        });
        broadcast(msg, (ws) => ws.role === "device");
        await notifyAll(store, {
          title: "Agent finished",
          body: `${body.project || "project"}: ${body.title || "chat"}`,
          tag: `done-${body.chatId || crypto.randomBytes(4).toString("hex")}`,
          data: { type: "agent_finished", chatId: body.chatId },
        });
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === "GET" && url.pathname === "/chats") {
        const device = authDevice(req);
        if (!authDaemon(req) && !device) return sendJson(res, 401, { error: "auth required" });
        return sendJson(res, 200, { chats: store.allChats() });
      }

      if (req.method === "GET" && url.pathname.startsWith("/chats/") && url.pathname.endsWith("/messages")) {
        const device = authDevice(req);
        if (!authDaemon(req) && !device) return sendJson(res, 401, { error: "auth required" });
        const id = url.pathname.split("/")[2];
        return sendJson(res, 200, {
          chat: store.state.chats[id] || null,
          messages: store.getMessages(id),
        });
      }

      if (req.method === "POST" && url.pathname.startsWith("/chats/") && url.pathname.endsWith("/append")) {
        if (!authDaemon(req)) return sendJson(res, 401, { error: "daemon auth required" });
        const id = url.pathname.split("/")[2];
        const body = await readJson(req);
        const msg = body.message || {};
        const messages = store.getMessages(id).slice();
        messages.push({
          id: msg.id || crypto.randomBytes(6).toString("hex"),
          role: msg.role || "user",
          content: String(msg.content || "").slice(0, 8000),
          ts: msg.ts || Date.now(),
          fromPhone: true,
        });
        store.setMessages(id, messages.slice(-120));
        const chat = store.state.chats[id];
        if (chat) {
          store.upsertChat({ ...chat, updatedAt: Date.now() });
        }
        broadcast(
          envelope(MSG.CHAT_UPSERT, {
            chat: store.state.chats[id] || { id },
            messages: store.getMessages(id),
          }),
          (ws) => ws.role === "device"
        );
        return sendJson(res, 200, { ok: true, messages: store.getMessages(id) });
      }

      // --- replies from phone ---
      if (req.method === "POST" && url.pathname === "/replies") {
        const device = authDevice(req);
        if (!device) return sendJson(res, 401, { error: "device auth required" });
        const body = await readJson(req);
        if (!body.chatId || !body.text) {
          return sendJson(res, 400, { error: "chatId and text required" });
        }
        // Prefer project from phone payload; else look up mirrored chat
        const mirrored = store.state.chats[body.chatId];
        const row = store.enqueueReply({
          chatId: body.chatId,
          text: String(body.text).slice(0, 8000),
          deviceId: device.id,
          project:
            (body.project && String(body.project).slice(0, 128)) ||
            (mirrored && mirrored.project) ||
            null,
          title:
            (body.title && String(body.title).slice(0, 200)) ||
            (mirrored && mirrored.title) ||
            null,
        });
        broadcast(envelope(MSG.REPLY_QUEUE, { reply: row }));
        return sendJson(res, 200, { reply: row });
      }

      if (req.method === "GET" && url.pathname === "/replies/pending") {
        if (!authDaemon(req)) return sendJson(res, 401, { error: "daemon auth required" });
        return sendJson(res, 200, { replies: store.pendingReplies() });
      }

      if (req.method === "POST" && url.pathname.startsWith("/replies/") && url.pathname.endsWith("/status")) {
        if (!authDaemon(req)) return sendJson(res, 401, { error: "daemon auth required" });
        const id = url.pathname.split("/")[2];
        const body = await readJson(req);
        const row = store.updateReply(id, {
          status: body.status,
          detail: body.detail || null,
          updatedAt: Date.now(),
        });
        if (!row) return sendJson(res, 404, { error: "not found" });
        broadcast(envelope(MSG.REPLY_STATUS, { reply: row }));
        return sendJson(res, 200, { reply: row });
      }

      // --- push subscribe ---
      if (req.method === "POST" && url.pathname === "/push/subscribe") {
        const device = authDevice(req);
        if (!device) return sendJson(res, 401, { error: "device auth required" });
        const body = await readJson(req);
        if (!body.endpoint || !body.keys) {
          return sendJson(res, 400, { error: "invalid subscription" });
        }
        store.setPushSubscription(device.id, body);
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === "GET" && url.pathname === "/snapshot") {
        const device = authDevice(req);
        if (!device) return sendJson(res, 401, { error: "device auth required" });
        const snap = store.snapshotForDevice();
        // attach messages for each chat (capped)
        const withMsgs = snap.chats.map((c) => ({
          ...c,
          messages: store.getMessages(c.id).slice(-100),
        }));
        return sendJson(res, 200, { ...snap, chats: withMsgs });
      }

      if (req.method === "GET" && url.pathname === "/daemon-token") {
        // Only printable on local console via CLI — block remote fetch without extra secret.
        // Daemon reads token from disk share instead. Expose bootstrap only via env.
        if (process.env.COMPANION_ALLOW_TOKEN_HTTP !== "1") {
          return sendJson(res, 403, { error: "disabled" });
        }
        return sendJson(res, 200, { daemonToken });
      }

      if (tryServePwa(req, res, url.pathname)) return;

      sendJson(res, 404, { error: "not found" });
    } catch (e) {
      console.error(e);
      sendJson(res, 500, { error: "server error" });
    }
  });

  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const role = url.searchParams.get("role") || "device";
    const token = url.searchParams.get("token") || "";

    if (role === "daemon") {
      if (token !== daemonToken) {
        ws.close(1008, "unauthorized");
        return;
      }
      ws.role = "daemon";
    } else {
      const device = store.deviceByToken(token);
      if (!device) {
        ws.close(1008, "unauthorized");
        return;
      }
      ws.role = "device";
      ws.deviceId = device.id;
    }

    sockets.add(ws);
    ws.send(JSON.stringify(envelope(MSG.HELLO, { role: ws.role })));

    if (ws.role === "device") {
      const snap = store.snapshotForDevice();
      ws.send(
        JSON.stringify(
          envelope(MSG.STATE_SNAPSHOT, {
            ...snap,
            chats: snap.chats.map((c) => ({
              ...c,
              messages: store.getMessages(c.id).slice(-100),
            })),
          })
        )
      );
    }

    ws.on("message", async (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.type === MSG.PING) {
        // App heartbeat: only count as "live" when phone sends live:true
        // (MainApp mounted — not a zombie socket after a white-screen crash).
        if (ws.role === "device" && msg.live === true && ws.deviceId) {
          store.touchDeviceLive(ws.deviceId);
        }
        ws.send(JSON.stringify(envelope(MSG.PONG)));
        return;
      }
      if (msg.type === MSG.APPROVAL_ACK && ws.role === "device" && msg.id) {
        store.ackApproval(String(msg.id), ws.deviceId);
        if (ws.deviceId) store.touchDeviceLive(ws.deviceId);
      }
    });

    ws.on("close", () => sockets.delete(ws));
  });

  server.listen(PORT, HOST, () => {
    const pwa = pwaStatus();
    console.log(`companion-relay listening on http://${HOST}:${PORT}`);
    console.log(`data dir: ${store.dir}`);
    console.log(`pwa: ${pwa.served ? pwa.path : "not found"}`);
    console.log(`VAPID public key ready (${vapid.publicKey.slice(0, 12)}…)`);
  });

  return { server, store, daemonToken };
}

if (require.main === module) {
  main();
}

module.exports = { main };
