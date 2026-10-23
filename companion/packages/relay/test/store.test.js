"use strict";
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Store } = require("../src/store.js");

describe("Store", () => {
  let dir;
  let store;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "companion-relay-"));
    store = new Store(dir);
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("creates daemon token", () => {
    const t = store.ensureDaemonToken();
    assert.equal(typeof t, "string");
    assert.equal(t.length > 16, true);
    assert.equal(store.ensureDaemonToken(), t);
  });

  it("pairs with code then rejects reuse", () => {
    const { code } = store.rotatePairingCode();
    const d = store.pairDevice(code, "phone");
    assert.ok(d.token);
    assert.equal(store.pairDevice(code, "x"), null);
  });

  it("settles approvals", () => {
    store.upsertApproval({
      id: "abc",
      command: "echo hi",
      project: "t",
      status: "pending",
      createdAt: Date.now(),
    });
    assert.equal(store.pendingApprovals().length, 1);
    store.upsertApproval({
      id: "abc",
      status: "approved",
      permission: "allow",
    });
    assert.equal(store.pendingApprovals().length, 0);
  });

  it("revokes device", () => {
    const { code } = store.rotatePairingCode();
    const d = store.pairDevice(code, "x");
    assert.ok(store.deviceByToken(d.token));
    store.revokeDevice(d.id);
    assert.equal(store.deviceByToken(d.token), null);
  });
});
