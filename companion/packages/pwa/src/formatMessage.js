/**
 * Turn Cursor transcript chrome into display-friendly pieces.
 * e.g. <timestamp>…</timestamp> + <user_query>…</user_query>
 */

const WRAPPERS = [
  "user_query",
  "assistant_response",
  "system_reminder",
  "user_info",
];

/**
 * @param {string} raw
 * @returns {{ timestamp: string|null, body: string }}
 */
export function formatMessage(raw) {
  let text = String(raw || "");
  let timestamp = null;

  const tsMatch = text.match(/<timestamp>([\s\S]*?)<\/timestamp>/i);
  if (tsMatch) {
    timestamp = tsMatch[1].replace(/\s+/g, " ").trim() || null;
    text = text.replace(/<timestamp>[\s\S]*?<\/timestamp>/gi, "");
  }

  for (const tag of WRAPPERS) {
    const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "gi");
    text = text.replace(re, "$1");
    text = text.replace(new RegExp(`</?${tag}>`, "gi"), "");
  }

  // Drop leftover Cursor-ish XML tags without eating normal < comparisons
  text = text.replace(/<\/?[a-z_][\w:-]*(?:\s[^>]*)?>/gi, "");

  text = text.replace(/^\s+|\s+$/g, "");
  // Collapse excessive blank lines from removed wrappers
  text = text.replace(/\n{3,}/g, "\n\n");

  return { timestamp, body: text || String(raw || "").trim() };
}
