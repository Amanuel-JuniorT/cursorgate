"use strict";
const path = require("path");

/**
 * Turn Cursor project folder slug into a short display name.
 * e.g. c-Users-Home-Documents-TAC-Project-Swiss-knife → Swiss-knife
 */
function humanizeProjectSlug(slug) {
  if (!slug) return "unknown";
  let s = String(slug);
  s = s.replace(/^c-Users-[^-]+-/i, "");
  s = s.replace(/^Users-[^-]+-/i, "");
  s = s.replace(/^Documents-/i, "");
  // Prefer segment after "Project-"
  const projectIdx = s.search(/(?:^|-)Project-/i);
  if (projectIdx >= 0) {
    const after = s.slice(projectIdx).replace(/^-?Project-/i, "");
    if (after) return after.slice(0, 128);
  }
  const parts = s.split("-").filter(Boolean);
  if (parts.length <= 2) return parts.join("-") || slug;
  return parts.slice(-2).join("-").slice(0, 128);
}

/**
 * Resolve project label from a transcript file path.
 */
function projectFromTranscriptPath(filePath) {
  const norm = String(filePath || "").replace(/\\/g, "/");
  const m = norm.match(/\.cursor\/projects\/([^/]+)/i);
  if (m) return humanizeProjectSlug(m[1]);

  // Fallback: walk parents for a non-generic folder name
  const parts = norm.split("/").filter(Boolean);
  const skip = new Set([
    "agent-transcripts",
    "terminals",
    "transcripts",
    "hooks",
    ".cursor",
    "projects",
  ]);
  for (let i = parts.length - 2; i >= 0; i--) {
    const p = parts[i];
    if (skip.has(p)) continue;
    if (/^[0-9a-f-]{20,}$/i.test(p)) continue; // uuid
    if (p.endsWith(".jsonl") || p.endsWith(".txt")) continue;
    return humanizeProjectSlug(p);
  }
  return "unknown";
}

/**
 * Title from first user message, cleaned of XML-ish wrappers.
 */
function titleFromMessages(messages, fallback) {
  const user = (messages || []).find(
    (m) => m.role === "user" || m.role === "human"
  );
  let t = (user && user.content) || fallback || "Chat";
  t = String(t)
    .replace(/<timestamp>[\s\S]*?<\/timestamp>/gi, "")
    .replace(/<\/?user_query>/gi, "")
    .replace(/<\/?[a-z_]+>/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return t.slice(0, 100) || "Chat";
}

module.exports = {
  humanizeProjectSlug,
  projectFromTranscriptPath,
  titleFromMessages,
};
