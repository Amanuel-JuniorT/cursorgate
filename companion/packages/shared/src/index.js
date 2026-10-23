"use strict";

/** @typedef {'allow'|'deny'|'ask'} Permission */
/** @typedef {'approve'|'deny'|'pass'} ApprovalDecision */
/** @typedef {'pending'|'approved'|'denied'|'passed'|'expired'|'error'} ApprovalStatus */
/** @typedef {'running'|'idle'|'finished'} ChatStatus */

const PROTOCOL_VERSION = 1;

const MSG = {
  HELLO: "hello",
  PAIR_OK: "pair_ok",
  PAIR_FAIL: "pair_fail",
  APPROVAL_REQUEST: "approval_request",
  APPROVAL_ACK: "approval_ack",
  APPROVAL_DECISION: "approval_decision",
  APPROVAL_SETTLED: "approval_settled",
  SETTINGS: "settings",
  CHAT_UPSERT: "chat_upsert",
  CHAT_MESSAGES: "chat_messages",
  AGENT_FINISHED: "agent_finished",
  REPLY_QUEUE: "reply_queue",
  REPLY_STATUS: "reply_status",
  PING: "ping",
  PONG: "pong",
  ERROR: "error",
  STATE_SNAPSHOT: "state_snapshot",
  REVOKE_DEVICE: "revoke_device",
  DOCTOR: "doctor",
};

/**
 * @param {string} type
 * @param {object} [payload]
 */
function envelope(type, payload = {}) {
  return {
    v: PROTOCOL_VERSION,
    type,
    ts: Date.now(),
    ...payload,
  };
}

/** Best-effort secret redaction for synced chat text. */
function redactSecrets(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/\buser_email\b\s*[:=]\s*\S+/gi, "user_email=[REDACTED]")
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[EMAIL]")
    .replace(/\b(sk|pk|api|token|secret|bearer)[-_]?[A-Za-z0-9]{16,}\b/gi, "[SECRET]")
    .replace(/\bghp_[A-Za-z0-9]{20,}\b/g, "[SECRET]")
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "[SECRET]");
}

const DEFAULT_ALLOWLIST = [
  "^git (status|branch( --show-current)?|diff|log( -\\d+)?( --oneline)?)$",
];

const CHAINING_RE = /[|&`$<>\n]/;

module.exports = {
  PROTOCOL_VERSION,
  MSG,
  envelope,
  redactSecrets,
  DEFAULT_ALLOWLIST,
  CHAINING_RE,
};
