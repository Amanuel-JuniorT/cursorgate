"use strict";
/**
 * Phone → PC reply path.
 * Cursor has no stable public inject API for local IDE chats, so we:
 * 1. Write replies to ~/.companion/reply-inbox/
 * 2. Show a Windows tray balloon so you notice
 * 3. Mark status delivered_to_inbox (paste into Cursor yourself)
 */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { replyInboxPath } = require("./paths.js");

function ensureInbox() {
  fs.mkdirSync(replyInboxPath(), { recursive: true });
}

function notifyWindows(title, body) {
  if (process.platform !== "win32") return;
  const safeTitle = String(title).replace(/'/g, "''").slice(0, 60);
  const safeBody = String(body).replace(/'/g, "''").slice(0, 180);
  const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$n = New-Object System.Windows.Forms.NotifyIcon
$n.Icon = [System.Drawing.SystemIcons]::Information
$n.Visible = $true
$n.BalloonTipTitle = '${safeTitle}'
$n.BalloonTipText = '${safeBody}'
$n.ShowBalloonTip(8000)
Start-Sleep -Seconds 9
$n.Dispose()
`;
  try {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", ps],
      { detached: true, stdio: "ignore", windowsHide: true }
    );
    child.unref();
  } catch {
    /* ignore */
  }
}

/**
 * @param {{ id: string, chatId: string, text: string }} reply
 * @param {{ chatPath?: string|null, project?: string|null, title?: string|null }} meta
 */
function deliverToInbox(reply, meta = {}) {
  ensureInbox();
  const file = path.join(replyInboxPath(), `${reply.chatId}.jsonl`);
  const row = {
    replyId: reply.id,
    chatId: reply.chatId,
    text: reply.text,
    project: meta.project || null,
    title: meta.title || null,
    chatPath: meta.chatPath || null,
    receivedAt: Date.now(),
    status: "queued_on_pc",
    note:
      "Cursor will NOT auto-reply. Open LATEST.txt and paste into the IDE chat.",
  };
  fs.appendFileSync(file, JSON.stringify(row) + "\n", "utf8");

  const latest = path.join(replyInboxPath(), "LATEST.txt");
  const header = [
    `Received: ${new Date().toISOString()}`,
    `Project: ${meta.project || "?"}`,
    `Chat: ${meta.title || reply.chatId}`,
    `Inbox file: ${file}`,
    "",
    ">>> PASTE THIS INTO CURSOR (agent does not receive it automatically) <<<",
    "",
    reply.text,
    "",
  ].join("\n");
  fs.writeFileSync(latest, header, "utf8");

  notifyWindows(
    `Phone reply · ${meta.project || "Cursor"}`,
    reply.text.slice(0, 120)
  );

  return {
    status: "delivered_to_inbox",
    detail:
      "Saved on PC (+ Windows notification). Paste from %USERPROFILE%\\.companion\\reply-inbox\\LATEST.txt into Cursor — the agent does not auto-receive phone replies.",
  };
}

function listInbox(limit = 20) {
  ensureInbox();
  const latest = path.join(replyInboxPath(), "LATEST.txt");
  const files = fs
    .readdirSync(replyInboxPath())
    .filter((f) => f.endsWith(".jsonl"))
    .slice(0, limit);
  return { latestExists: fs.existsSync(latest), files, dir: replyInboxPath() };
}

module.exports = { deliverToInbox, listInbox, ensureInbox, replyInboxPath, notifyWindows };
