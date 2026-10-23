"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { migrate, validateConfig } = require("../src/config.js");

describe("config migrate", () => {
  it("keeps legacy out/in and maps waitMs", () => {
    const cfg = migrate({
      out: "cc-out-abc",
      in: "cc-in-xyz",
      enabled: false,
      waitMs: 0,
    });
    assert.equal(cfg.out, "cc-out-abc");
    assert.equal(cfg.in, "cc-in-xyz");
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.timeoutSeconds, 0);
    assert.equal(cfg.version, 1);
    assert.equal(cfg.onTimeout, "ask");
    assert.ok(cfg.allowlist.length);
  });

  it("validate requires token", () => {
    const problems = validateConfig(
      migrate({ enabled: true, relayUrl: "http://127.0.0.1:8787" })
    );
    assert.ok(problems.some((p) => p.includes("daemonToken")));
  });
});
