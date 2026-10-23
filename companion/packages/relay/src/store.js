"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const { seal, open } = require("./atRest.js");

function defaultDataDir() {
  return path.join(os.homedir(), ".companion", "relay");
}

class Store {
  /**
   * @param {string} [dir]
   */
  constructor(dir = defaultDataDir()) {
    this.dir = dir;
    this.file = path.join(dir, "state.json");
    this.state = {
      version: 1,
      pairingCode: null,
      pairingExpiresAt: 0,
      daemonToken: null,
      devices: {},
      approvals: {},
      chats: {},
      messages: {},
      replyQueue: [],
      pushSubscriptions: {},
      revokedDeviceIds: [],
      vapid: null,
      // Phone shell approvals off until opted in (synced from daemon / PWA)
      settings: { phoneApprovals: false },
    };
    this.load();
  }

  getSettings() {
    const s = this.state.settings || {};
    return {
      phoneApprovals: s.phoneApprovals === true,
    };
  }

  setSettings(patch) {
    const cur = this.getSettings();
    if (typeof patch.phoneApprovals === "boolean") {
      cur.phoneApprovals = patch.phoneApprovals;
    }
    this.state.settings = cur;
    this.save();
    return cur;
  }

  /** App-level liveness (not just TCP): updated by PWA heartbeat. */
  touchDeviceLive(deviceId) {
    const d = this.state.devices[deviceId];
    if (!d) return false;
    d.lastLiveAt = Date.now();
    d.lastSeenAt = d.lastLiveAt;
    this.save();
    return true;
  }

  /**
   * @param {number} [maxAgeMs]
   */
  liveDeviceCount(maxAgeMs = 30000) {
    const now = Date.now();
    let n = 0;
    for (const d of Object.values(this.state.devices)) {
      if (d.lastLiveAt && now - d.lastLiveAt <= maxAgeMs) n++;
    }
    return n;
  }

  ackApproval(id, deviceId) {
    const a = this.state.approvals[id];
    if (!a) return null;
    if (!a.ackedAt) {
      a.ackedAt = Date.now();
      a.ackedBy = deviceId || null;
      this.save();
    }
    return a;
  }

  load() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      if (fs.existsSync(this.file)) {
        const raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
        this.state = { ...this.state, ...raw };
      }
    } catch (e) {
      console.error("store load error:", e.message);
    }
  }

  save() {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2) + "\n", "utf8");
    fs.renameSync(tmp, this.file);
    try {
      fs.chmodSync(this.file, 0o600);
    } catch {
      /* windows */
    }
  }

  ensureDaemonToken() {
    if (!this.state.daemonToken) {
      this.state.daemonToken = crypto.randomBytes(24).toString("hex");
      this.save();
    }
    return this.state.daemonToken;
  }

  rotatePairingCode(ttlMs = 10 * 60 * 1000) {
    const code = String(crypto.randomInt(100000, 999999));
    this.state.pairingCode = code;
    this.state.pairingExpiresAt = Date.now() + ttlMs;
    this.save();
    return { code, expiresAt: this.state.pairingExpiresAt };
  }

  /**
   * @param {string} code
   * @param {string} deviceName
   */
  pairDevice(code, deviceName = "phone") {
    if (
      !this.state.pairingCode ||
      code !== this.state.pairingCode ||
      Date.now() > this.state.pairingExpiresAt
    ) {
      return null;
    }
    const id = crypto.randomBytes(12).toString("hex");
    const token = crypto.randomBytes(24).toString("hex");
    this.state.devices[id] = {
      id,
      tokenSealed: seal(token),
      name: String(deviceName).slice(0, 64),
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    };
    this.state.pairingCode = null;
    this.state.pairingExpiresAt = 0;
    this.save();
    // Return plaintext token once to the phone; only sealed form is stored.
    return {
      id,
      token,
      name: this.state.devices[id].name,
      createdAt: this.state.devices[id].createdAt,
      lastSeenAt: this.state.devices[id].lastSeenAt,
    };
  }

  _deviceToken(d) {
    if (!d) return null;
    if (d.token) return d.token; // legacy plaintext migration
    if (d.tokenSealed) {
      try {
        return open(d.tokenSealed);
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * @param {string} token
   */
  deviceByToken(token) {
    if (!token) return null;
    for (const d of Object.values(this.state.devices)) {
      const plain = this._deviceToken(d);
      if (plain && plain === token) {
        if (this.state.revokedDeviceIds.includes(d.id)) return null;
        d.lastSeenAt = Date.now();
        // migrate legacy plaintext → sealed
        if (d.token && !d.tokenSealed) {
          d.tokenSealed = seal(d.token);
          delete d.token;
          this.save();
        }
        return { ...d, token: plain };
      }
    }
    return null;
  }

  /**
   * @param {string} deviceId
   */
  revokeDevice(deviceId) {
    if (this.state.devices[deviceId]) {
      delete this.state.devices[deviceId];
      delete this.state.pushSubscriptions[deviceId];
      if (!this.state.revokedDeviceIds.includes(deviceId)) {
        this.state.revokedDeviceIds.push(deviceId);
      }
      this.save();
      return true;
    }
    return false;
  }

  listDevices() {
    return Object.values(this.state.devices).map((d) => ({
      id: d.id,
      name: d.name,
      createdAt: d.createdAt,
      lastSeenAt: d.lastSeenAt,
      lastLiveAt: d.lastLiveAt || null,
    }));
  }

  /**
   * @param {object} approval
   */
  upsertApproval(approval) {
    this.state.approvals[approval.id] = {
      ...this.state.approvals[approval.id],
      ...approval,
    };
    this.save();
    return this.state.approvals[approval.id];
  }

  getApproval(id) {
    return this.state.approvals[id] || null;
  }

  pendingApprovals() {
    return Object.values(this.state.approvals).filter((a) => a.status === "pending");
  }

  /**
   * @param {object} chat
   */
  upsertChat(chat) {
    this.state.chats[chat.id] = { ...this.state.chats[chat.id], ...chat };
    this.save();
    return this.state.chats[chat.id];
  }

  /**
   * @param {string} chatId
   * @param {object[]} messages
   */
  setMessages(chatId, messages) {
    this.state.messages[chatId] = messages;
    this.save();
  }

  getMessages(chatId) {
    return this.state.messages[chatId] || [];
  }

  allChats() {
    return Object.values(this.state.chats).sort(
      (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)
    );
  }

  /**
   * Replace the whole chat catalog (used after daemon purge/resync).
   * @param {object[]} chats
   * @param {Record<string, object[]>} messagesById
   */
  replaceCatalog(chats, messagesById = {}) {
    const nextChats = {};
    const nextMessages = {};
    for (const chat of chats) {
      if (!chat || !chat.id) continue;
      nextChats[chat.id] = chat;
      if (Array.isArray(messagesById[chat.id])) {
        nextMessages[chat.id] = messagesById[chat.id];
      } else if (Array.isArray(chat.messages)) {
        nextMessages[chat.id] = chat.messages;
      } else if (this.state.messages[chat.id]) {
        nextMessages[chat.id] = this.state.messages[chat.id];
      }
    }
    this.state.chats = nextChats;
    this.state.messages = nextMessages;
    this.save();
    return this.allChats();
  }

  /**
   * Remove chats matching predicate.
   * @param {(chat: object) => boolean} pred
   */
  removeChatsWhere(pred) {
    let n = 0;
    for (const [id, chat] of Object.entries(this.state.chats)) {
      if (pred(chat)) {
        delete this.state.chats[id];
        delete this.state.messages[id];
        n++;
      }
    }
    if (n) this.save();
    return n;
  }

  enqueueReply(item) {
    const row = {
      id: crypto.randomBytes(8).toString("hex"),
      status: "queued",
      createdAt: Date.now(),
      ...item,
    };
    this.state.replyQueue.push(row);
    this.save();
    return row;
  }

  pendingReplies() {
    return this.state.replyQueue.filter((r) => r.status === "queued");
  }

  updateReply(id, patch) {
    const row = this.state.replyQueue.find((r) => r.id === id);
    if (!row) return null;
    Object.assign(row, patch);
    this.save();
    return row;
  }

  setPushSubscription(deviceId, sub) {
    this.state.pushSubscriptions[deviceId] = sub;
    this.save();
  }

  allPushSubscriptions() {
    return Object.entries(this.state.pushSubscriptions).map(([deviceId, sub]) => ({
      deviceId,
      sub,
    }));
  }

  snapshotForDevice() {
    return {
      approvals: this.pendingApprovals(),
      chats: this.allChats(),
      devices: this.listDevices().map((d) => ({ id: d.id, name: d.name })),
      replyQueue: this.state.replyQueue.slice(-50),
      settings: this.getSettings(),
    };
  }
}

module.exports = { Store, defaultDataDir };
