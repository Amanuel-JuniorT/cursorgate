"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const gate = path.join(__dirname, "..", "src", "gate.js");
const configPath = path.join(os.homedir(), ".companion.json");

describe("gate allowlist / fail-safe", () => {
  it("allowlists git status without network", () => {
    if (!fs.existsSync(configPath)) return;
    const prev = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const next = {
      ...prev,
      enabled: true,
      sendNotifications: true,
      allowlist: ["^git status$"],
      daemonToken: prev.daemonToken || "x",
      relayUrl: "http://127.0.0.1:1", // unreachable if allowlist misses
    };
    fs.writeFileSync(configPath, JSON.stringify(next, null, 2));
    try {
      const r = spawnSync(process.execPath, [gate], {
        input: JSON.stringify({
          command: "git status",
          workspace_roots: ["/c:/x/y"],
        }),
        encoding: "utf8",
        timeout: 5000,
      });
      assert.match(r.stdout || "", /"permission":"allow"/);
    } finally {
      fs.writeFileSync(configPath, JSON.stringify(prev, null, 2));
    }
  });

  it("blocks chaining even if allowlist would match prefix", () => {
    if (!fs.existsSync(configPath)) return;
    const prev = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const next = {
      ...prev,
      enabled: true,
      sendNotifications: true,
      allowlist: ["^git status.*$"],
      daemonToken: null, // force ask if it hits network path
      relayUrl: "http://127.0.0.1:8787",
    };
    fs.writeFileSync(configPath, JSON.stringify(next, null, 2));
    try {
      const r = spawnSync(process.execPath, [gate], {
        input: JSON.stringify({
          command: "git status; rm -rf x",
          workspace_roots: ["/c:/x/y"],
        }),
        encoding: "utf8",
        timeout: 5000,
      });
      assert.match(r.stdout || "", /"permission":"ask"/);
    } finally {
      fs.writeFileSync(configPath, JSON.stringify(prev, null, 2));
    }
  });
});
