"use strict";
/**
 * Deliver a phone reply into Cursor on Windows: paste + run.
 *
 * Flow:
 *   1. Clipboard
 *   2. Bring Cursor to foreground
 *   3. Ctrl+V (no Ctrl+L — that toggles Agent off)
 *   4. Enter or Ctrl+Enter (config.replySubmit)
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { replyInboxPath, companionDir } = require("./paths.js");
const { notifyWindows } = require("./replyInbox.js");

function ensureInbox() {
  fs.mkdirSync(replyInboxPath(), { recursive: true });
}

function writeInboxFile(reply, meta) {
  ensureInbox();
  const file = path.join(replyInboxPath(), `${reply.chatId}.jsonl`);
  fs.appendFileSync(
    file,
    JSON.stringify({
      replyId: reply.id,
      chatId: reply.chatId,
      text: reply.text,
      project: meta.project || null,
      title: meta.title || null,
      receivedAt: Date.now(),
    }) + "\n",
    "utf8"
  );
  const latest = path.join(replyInboxPath(), "LATEST.txt");
  fs.writeFileSync(
    latest,
    [
      `Received: ${new Date().toISOString()}`,
      `Project: ${meta.project || "?"}`,
      `Chat: ${meta.title || reply.chatId}`,
      "",
      reply.text,
      "",
    ].join("\n"),
    "utf8"
  );
  return { file, latest };
}

function setClipboard(text) {
  const r = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", "Set-Clipboard -Value $input"],
    {
      input: String(text),
      encoding: "utf8",
      windowsHide: true,
      timeout: 8000,
    }
  );
  if (r.status !== 0) {
    throw new Error(
      "clipboard failed: " +
        ((r.stderr || r.stdout || "").toString().slice(0, 200) || String(r.status))
    );
  }
}

/**
 * @param {string} text
 * @param {{ submit?: 'enter'|'ctrl+enter', project?: string|null }} opts
 */
function pasteIntoCursor(text, opts = {}) {
  setClipboard(text);

  const submit = (opts.submit || "enter").toLowerCase();
  const submitKeys =
    submit === "ctrl+enter" || submit === "ctrl-enter"
      ? "^{ENTER}"
      : "{ENTER}";
  // Safe for single-quoted PowerShell string
  const projectHint = String(opts.project || "")
    .replace(/'/g, "''")
    .slice(0, 80);

  const scriptPath = path.join(companionDir(), "paste-run.ps1");
  fs.mkdirSync(companionDir(), { recursive: true });

  // EnumWindows: Cursor multi-window often shares one process; Get-Process only
  // exposes a single MainWindowTitle, so Swiss-knife vanishes when Simon is focused.
  const ps = [
    "# companion paste-and-run — EnumWindows so every Cursor window is visible",
    "$ErrorActionPreference = 'Continue'",
    "Add-Type -AssemblyName System.Windows.Forms | Out-Null",
    "try {",
    "  Add-Type -TypeDefinition @'",
    "using System;",
    "using System.Text;",
    "using System.Collections.Generic;",
    "using System.Runtime.InteropServices;",
    "public class CompanionWin3 {",
    "  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);",
    "  [DllImport(\"user32.dll\")] public static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);",
    "  [DllImport(\"user32.dll\")] public static extern bool IsWindowVisible(IntPtr hWnd);",
    "  [DllImport(\"user32.dll\", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);",
    "  [DllImport(\"user32.dll\", CharSet=CharSet.Unicode)] public static extern int GetWindowTextLength(IntPtr hWnd);",
    "  [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr hWnd);",
    "  [DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);",
    "  [DllImport(\"user32.dll\")] public static extern bool IsIconic(IntPtr hWnd);",
    "  [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow();",
    "  [DllImport(\"user32.dll\")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);",
    "  [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);",
    "  [DllImport(\"kernel32.dll\")] public static extern uint GetCurrentThreadId();",
    "  public const int SW_RESTORE = 9;",
    "  public static List<string> ListCursorWindows() {",
    "    var list = new List<string>();",
    "    EnumWindows((h, l) => {",
    "      if (!IsWindowVisible(h)) return true;",
    "      int len = GetWindowTextLength(h);",
    "      if (len <= 0) return true;",
    "      var sb = new StringBuilder(len + 1);",
    "      GetWindowText(h, sb, sb.Capacity);",
    "      string t = sb.ToString();",
    "      if (t.IndexOf(\"Cursor\", StringComparison.OrdinalIgnoreCase) < 0) return true;",
    "      uint pid = 0;",
    "      GetWindowThreadProcessId(h, out pid);",
    "      list.Add(h.ToInt64().ToString() + \"\\t\" + pid.ToString() + \"\\t\" + t);",
    "      return true;",
    "    }, IntPtr.Zero);",
    "    return list;",
    "  }",
    "}",
    "'@",
    "} catch {}",
    "",
    `$projectHint = '${projectHint}'`,
    "$rows = [CompanionWin3]::ListCursorWindows()",
    "if (-not $rows -or $rows.Count -eq 0) {",
    "  Write-Output 'NO_CURSOR_WINDOW'",
    "  exit 2",
    "}",
    "",
    "$wins = @()",
    "foreach ($row in $rows) {",
    "  $parts = $row -split \"`t\", 3",
    "  if ($parts.Count -lt 3) { continue }",
    "  $wins += [pscustomobject]@{ Hwnd = [IntPtr][int64]$parts[0]; Pid = [uint32]$parts[1]; Title = $parts[2] }",
    "}",
    "Write-Output ('WINS count=' + $wins.Count)",
    "",
    "$foreHwnd = [CompanionWin3]::GetForegroundWindow()",
    "$hwnd = [IntPtr]::Zero",
    "$title = ''",
    "$winPid = 0",
    "$pick = 'fallback'",
    "",
    "# Prefer window whose title contains the phone chat project name",
    "if ($projectHint) {",
    "  Write-Output ('HINT project=' + $projectHint)",
    "  $hintLower = $projectHint.ToLower()",
    "  foreach ($w in $wins) {",
    "    if ($w.Title.ToLower().Contains($hintLower)) {",
    "      $hwnd = $w.Hwnd; $title = $w.Title; $winPid = $w.Pid; $pick = 'project-title'; break",
    "    }",
    "  }",
    "  if ($hwnd -eq [IntPtr]::Zero) {",
    "    Write-Output ('HINT no-title-match among ' + $wins.Count + ' windows')",
    "    foreach ($w in $wins) { Write-Output ('WIN ' + $w.Pid + ' | ' + $w.Title) }",
    "  }",
    "}",
    "",
    "if ($hwnd -eq [IntPtr]::Zero) {",
    "  foreach ($w in $wins) {",
    "    if ($w.Hwnd -eq $foreHwnd) { $hwnd = $w.Hwnd; $title = $w.Title; $winPid = $w.Pid; $pick = 'foreground'; break }",
    "  }",
    "}",
    "",
    "if ($hwnd -eq [IntPtr]::Zero) {",
    "  foreach ($w in $wins) {",
    "    if (-not [CompanionWin3]::IsIconic($w.Hwnd)) {",
    "      $hwnd = $w.Hwnd; $title = $w.Title; $winPid = $w.Pid; $pick = 'visible'; break",
    "    }",
    "  }",
    "}",
    "",
    "if ($hwnd -eq [IntPtr]::Zero) {",
    "  $w = $wins[0]",
    "  $hwnd = $w.Hwnd; $title = $w.Title; $winPid = $w.Pid; $pick = 'first'",
    "}",
    "",
    "if ([CompanionWin3]::IsIconic($hwnd)) {",
    "  [CompanionWin3]::ShowWindow($hwnd, 9) | Out-Null",
    "}",
    "",
    "$fore = [CompanionWin3]::GetForegroundWindow()",
    "$foreTid = 0; $curTid = [CompanionWin3]::GetCurrentThreadId()",
    "if ($fore -ne [IntPtr]::Zero) { [void][CompanionWin3]::GetWindowThreadProcessId($fore, [ref]$foreTid) }",
    "$targetTid = 0",
    "[void][CompanionWin3]::GetWindowThreadProcessId($hwnd, [ref]$targetTid)",
    "if ($foreTid -ne 0 -and $foreTid -ne $curTid) {",
    "  [void][CompanionWin3]::AttachThreadInput($curTid, $foreTid, $true)",
    "}",
    "if ($targetTid -ne 0 -and $targetTid -ne $curTid) {",
    "  [void][CompanionWin3]::AttachThreadInput($curTid, $targetTid, $true)",
    "}",
    "[void][CompanionWin3]::SetForegroundWindow($hwnd)",
    "Start-Sleep -Milliseconds 450",
    "",
    "[System.Windows.Forms.SendKeys]::SendWait('^v')",
    "Start-Sleep -Milliseconds 300",
    `[System.Windows.Forms.SendKeys]::SendWait('${submitKeys}')`,
    "Start-Sleep -Milliseconds 150",
    "",
    "if ($foreTid -ne 0 -and $foreTid -ne $curTid) {",
    "  [void][CompanionWin3]::AttachThreadInput($curTid, $foreTid, $false)",
    "}",
    "if ($targetTid -ne 0 -and $targetTid -ne $curTid) {",
    "  [void][CompanionWin3]::AttachThreadInput($curTid, $targetTid, $false)",
    "}",
    "",
    `Write-Output ("OK pick=$pick title=$title pid=$winPid submit=${submit}")`,
    "exit 0",
    "",
  ].join("\r\n");

  fs.writeFileSync(scriptPath, ps, "utf8");

  const r = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
    { encoding: "utf8", windowsHide: true, timeout: 20000 }
  );
  const out = ((r.stdout || "") + (r.stderr || "")).trim();

  if (r.status === 2 || /NO_CURSOR_WINDOW/i.test(out)) {
    return {
      ok: false,
      detail:
        "Cursor window not found — text is on clipboard. Open Cursor, click the chat input, Ctrl+V then Enter.",
    };
  }
  if (r.status !== 0 || /(?:^|\n)\s*(?:error|exception)/i.test(out)) {
    return {
      ok: false,
      detail:
        "Paste/run failed — text is on clipboard. " + out.slice(0, 220),
    };
  }
  return {
    ok: true,
    detail: out || `Pasted + submitted (${submit}).`,
  };
}

/**
 * @param {{ id: string, chatId: string, text: string }} reply
 * @param {{ chatPath?: string|null, project?: string|null, title?: string|null, replyMode?: string, replySubmit?: string }} meta
 */
function deliverReply(reply, meta = {}) {
  const mode =
    meta.replyMode ||
    (process.platform === "win32" ? "paste" : "inbox");
  const submit = meta.replySubmit || "enter";

  const files = writeInboxFile(reply, meta);

  if (mode === "inbox") {
    notifyWindows(
      `Phone reply · ${meta.project || "Cursor"}`,
      reply.text.slice(0, 120)
    );
    return {
      status: "delivered_to_inbox",
      detail: `Saved to ${files.latest}. Paste into Cursor.`,
      mode,
    };
  }

  if (process.platform !== "win32") {
    return {
      status: "delivered_to_inbox",
      detail: "Direct paste is Windows-only for now. Saved to inbox.",
      mode: "inbox",
    };
  }

  try {
    if (mode === "clipboard") {
      setClipboard(reply.text);
      notifyWindows(
        `Phone reply · ${meta.project || "Cursor"}`,
        "On clipboard — Ctrl+V then Enter in Cursor"
      );
      return {
        status: "delivered_to_clipboard",
        detail: "Copied to clipboard. Focus Cursor chat → Ctrl+V → Enter.",
        mode,
      };
    }

    const result = pasteIntoCursor(reply.text, {
      submit,
      project: meta.project || null,
    });
    notifyWindows(
      result.ok
        ? `Sent to Cursor · ${meta.project || ""}`
        : `Phone reply · ${meta.project || "Cursor"}`,
      result.ok ? reply.text.slice(0, 100) : result.detail.slice(0, 120)
    );
    return {
      status: result.ok ? "delivered_to_cursor" : "delivered_to_clipboard",
      detail: result.detail,
      mode: "paste",
    };
  } catch (e) {
    notifyWindows(
      `Phone reply · ${meta.project || "Cursor"}`,
      reply.text.slice(0, 120)
    );
    return {
      status: "delivered_to_inbox",
      detail: "Inject failed (" + e.message + "). Saved to " + files.latest,
      mode: "inbox",
    };
  }
}

module.exports = {
  deliverReply,
  pasteIntoCursor,
  setClipboard,
  writeInboxFile,
};
