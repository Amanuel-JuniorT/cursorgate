"use strict";

class RelayClient {
  /**
   * @param {{ relayUrl: string, daemonToken: string }} opts
   */
  constructor(opts) {
    this.base = (opts.relayUrl || "").replace(/\/$/, "");
    this.token = opts.daemonToken;
  }

  headers() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.token}`,
    };
  }

  async health() {
    const r = await fetch(`${this.base}/health`);
    if (!r.ok) throw new Error("health " + r.status);
    return r.json();
  }

  async startPairing() {
    const r = await fetch(`${this.base}/pair/start`, {
      method: "POST",
      headers: this.headers(),
    });
    if (!r.ok) throw new Error("pair/start " + r.status + " " + (await r.text()));
    return r.json();
  }

  async listDevices() {
    const r = await fetch(`${this.base}/devices`, { headers: this.headers() });
    if (!r.ok) throw new Error("devices " + r.status);
    return r.json();
  }

  async revokeDevice(id) {
    const r = await fetch(`${this.base}/devices/${id}/revoke`, {
      method: "POST",
      headers: this.headers(),
    });
    if (!r.ok) throw new Error("revoke " + r.status);
    return r.json();
  }

  async upsertChat(chat) {
    const r = await fetch(`${this.base}/chats`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        id: chat.id,
        project: chat.project,
        title: chat.title,
        status: chat.status,
        updatedAt: chat.updatedAt,
        path: chat.path,
        messages: chat.messages,
      }),
    });
    if (!r.ok) throw new Error("chats " + r.status);
    return r.json();
  }

  async replaceChats(chats) {
    const r = await fetch(`${this.base}/chats/replace`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ chats }),
    });
    if (!r.ok) throw new Error("chats/replace " + r.status);
    return r.json();
  }

  async purgeJunkChats() {
    const r = await fetch(`${this.base}/chats/purge-junk`, {
      method: "POST",
      headers: this.headers(),
    });
    if (!r.ok) throw new Error("purge-junk " + r.status);
    return r.json();
  }

  async expireApprovals() {
    const r = await fetch(`${this.base}/approvals/expire`, {
      method: "POST",
      headers: this.headers(),
    });
    if (!r.ok) throw new Error("expire " + r.status);
    return r.json();
  }

  async getSettings() {
    const r = await fetch(`${this.base}/settings`, { headers: this.headers() });
    if (!r.ok) throw new Error("settings " + r.status);
    return r.json();
  }

  async setSettings(patch) {
    const r = await fetch(`${this.base}/settings`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(patch),
    });
    if (!r.ok) throw new Error("settings " + r.status);
    return r.json();
  }

  async agentFinished(chat) {
    const r = await fetch(`${this.base}/agent-finished`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        chatId: chat.id,
        project: chat.project,
        title: chat.title,
      }),
    });
    if (!r.ok) throw new Error("agent-finished " + r.status);
    return r.json();
  }

  async pendingReplies() {
    const r = await fetch(`${this.base}/replies/pending`, {
      headers: this.headers(),
    });
    if (!r.ok) throw new Error("replies " + r.status);
    return r.json();
  }

  async setReplyStatus(id, status, detail) {
    const r = await fetch(`${this.base}/replies/${id}/status`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ status, detail }),
    });
    if (!r.ok) throw new Error("reply status " + r.status);
    return r.json();
  }

  /**
   * Append a message into a mirrored chat (so the phone sees the outbound reply).
   */
  async appendChatMessage(chatId, message) {
    const r = await fetch(`${this.base}/chats/${encodeURIComponent(chatId)}/append`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ message }),
    });
    if (!r.ok) throw new Error("append " + r.status);
    return r.json();
  }
}

module.exports = { RelayClient };
