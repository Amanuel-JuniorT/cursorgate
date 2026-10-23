"use strict";
/**
 * Adapter over Cursor local agent transcript stores.
 * Format is treated as unstable — isolated here.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { redactSecrets } = require("@companion/shared");
const { agentTranscriptsRoots, cursorWorkspaceStorage } = require("./paths.js");
const {
  projectFromTranscriptPath,
  titleFromMessages,
} = require("./projectName.js");

function safeRead(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function parseJsonlMessages(text) {
  const messages = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      const role =
        row.role ||
        row.type ||
        (row.message && row.message.role) ||
        "assistant";
      let content =
        row.content ||
        row.text ||
        (row.message && (row.message.content || row.message.text)) ||
        "";
      if (Array.isArray(content)) {
        content = content
          .map((p) => {
            if (typeof p === "string") return p;
            if (p && p.type && p.type !== "text") return "";
            return (p && (p.text || p.content)) || "";
          })
          .filter(Boolean)
          .join("\n");
      }
      if (typeof content !== "string") content = JSON.stringify(content);
      content = redactSecrets(content).slice(0, 4000);
      if (!content.trim()) continue;
      messages.push({
        id:
          row.id ||
          crypto
            .createHash("sha1")
            .update(content + role)
            .digest("hex")
            .slice(0, 12),
        role: String(role).slice(0, 32),
        content,
        ts: row.timestamp || row.ts || null,
      });
    } catch {
      /* skip */
    }
  }
  return messages;
}

/**
 * Only scan agent-transcripts under each Cursor project folder.
 * Skip terminals/ and other noise (.txt shell dumps).
 */
function scanCursorProjects(projectsRoot) {
  const chats = [];
  if (!fs.existsSync(projectsRoot)) return chats;

  let projectDirs;
  try {
    projectDirs = fs.readdirSync(projectsRoot, { withFileTypes: true });
  } catch {
    return chats;
  }

  for (const proj of projectDirs) {
    if (!proj.isDirectory()) continue;
    const transcriptRoot = path.join(projectsRoot, proj.name, "agent-transcripts");
    if (!fs.existsSync(transcriptRoot)) continue;

    const walk = (d, depth = 0) => {
      if (depth > 5) return;
      let entries;
      try {
        entries = fs.readdirSync(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const ent of entries) {
        const full = path.join(d, ent.name);
        if (ent.isDirectory()) {
          walk(full, depth + 1);
          continue;
        }
        if (!ent.isFile() || !ent.name.endsWith(".jsonl")) continue;
        // Skip subagent child transcripts — keep parent chats only
        if (full.replace(/\\/g, "/").includes("/subagents/")) continue;
        const text = safeRead(full);
        if (!text) continue;
        const messages = parseJsonlMessages(text);
        if (!messages.length) continue;
        const st = fs.statSync(full);
        const id = crypto.createHash("sha1").update(full).digest("hex").slice(0, 16);
        chats.push({
          id,
          project: projectFromTranscriptPath(full),
          title: titleFromMessages(messages, ent.name),
          status: "idle",
          updatedAt: st.mtimeMs,
          path: full,
          messages: messages.slice(-80),
        });
      }
    };

    walk(transcriptRoot);
  }

  return chats;
}

/** True if a stored chat is junk (terminals / agent-tools / old bad sync). */
function isJunkChat(chat) {
  const p = String((chat && chat.path) || "").replace(/\\/g, "/").toLowerCase();
  if (!p) return false;
  if (p.includes("/terminals/")) return true;
  if (p.includes("/agent-tools/")) return true;
  if (p.endsWith(".txt")) return true;
  const title = String((chat && chat.title) || "");
  if (/^\d+\.txt$/i.test(title)) return true;
  return false;
}

function scanWorkspaceStorage() {
  const root = cursorWorkspaceStorage();
  const chats = [];
  if (!fs.existsSync(root)) return chats;
  let workspaces;
  try {
    workspaces = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return chats;
  }
  for (const ws of workspaces) {
    if (!ws.isDirectory()) continue;
    const wsPath = path.join(root, ws.name);
    for (const name of ["chat.json", "composer.json"]) {
      const file = path.join(wsPath, name);
      if (!fs.existsSync(file)) continue;
      const text = safeRead(file);
      if (!text) continue;
      try {
        const data = JSON.parse(text);
        const msgs = Array.isArray(data.messages) ? data.messages : [];
        const mapped = msgs
          .slice(-80)
          .map((m, i) => ({
            id: String(m.id || i),
            role: String(m.role || "assistant"),
            content: redactSecrets(String(m.content || m.text || "")).slice(0, 4000),
            ts: m.ts || null,
          }))
          .filter((m) => m.content);
        if (!mapped.length) continue;
        const id = crypto.createHash("sha1").update(file).digest("hex").slice(0, 16);
        const st = fs.statSync(file);
        chats.push({
          id,
          project: "workspace",
          title: titleFromMessages(mapped, "workspace chat"),
          status: "idle",
          updatedAt: st.mtimeMs,
          path: file,
          messages: mapped,
        });
      } catch {
        /* ignore */
      }
    }
  }
  return chats;
}

function discoverChats() {
  const all = [];
  const seen = new Set();
  for (const root of agentTranscriptsRoots()) {
    for (const c of scanCursorProjects(root)) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      all.push(c);
    }
  }
  for (const c of scanWorkspaceStorage()) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    all.push(c);
  }
  all.sort((a, b) => b.updatedAt - a.updatedAt);
  return all;
}

/** @deprecated kept for tests */
function scanTranscriptDir(dir) {
  return scanCursorProjects(dir);
}

class ChatWatcher {
  constructor(hooks) {
    this.hooks = hooks;
    this.prev = new Map();
    this.timer = null;
  }

  async tick() {
    const chats = discoverChats();
    for (const chat of chats.slice(0, 60)) {
      const prev = this.prev.get(chat.id);
      const quietMs = Date.now() - chat.updatedAt;
      let status = "idle";
      if (quietMs < 15_000) status = "running";
      else if (prev && prev.status === "running" && quietMs >= 15_000) {
        status = "finished";
      }
      chat.status = status === "finished" ? "finished" : status;

      const changed =
        !prev ||
        prev.updatedAt !== chat.updatedAt ||
        prev.status !== chat.status ||
        prev.msgCount !== chat.messages.length;

      if (changed) await this.hooks.onUpsert(chat);
      if (status === "finished" && prev && prev.status === "running") {
        await this.hooks.onFinished(chat);
      }
      this.prev.set(chat.id, {
        updatedAt: chat.updatedAt,
        status: chat.status === "finished" ? "idle" : chat.status,
        msgCount: chat.messages.length,
      });
    }
  }

  start(intervalMs = 4000) {
    if (this.timer) return;
    const loop = async () => {
      try {
        await this.tick();
      } catch (e) {
        this.hooks.log?.("chatWatcher error: " + e.message);
      }
    };
    loop();
    this.timer = setInterval(loop, intervalMs);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = {
  discoverChats,
  parseJsonlMessages,
  ChatWatcher,
  scanTranscriptDir,
  scanCursorProjects,
  isJunkChat,
};
