"use strict";
/**
 * At-rest encryption helpers for sensitive relay fields.
 * Key lives in ~/.companion/relay/master.key (0600).
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");

function keyPath() {
  return path.join(os.homedir(), ".companion", "relay", "master.key");
}

function loadOrCreateKey() {
  const file = keyPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    return Buffer.from(fs.readFileSync(file, "utf8").trim(), "hex");
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(file, key.toString("hex") + "\n", "utf8");
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* windows */
  }
  return key;
}

/**
 * @param {string} plaintext
 */
function seal(plaintext) {
  const key = loadOrCreateKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

/**
 * @param {string} blob
 */
function open(blob) {
  const key = loadOrCreateKey();
  const buf = Buffer.from(blob, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

module.exports = { seal, open, loadOrCreateKey, keyPath };
