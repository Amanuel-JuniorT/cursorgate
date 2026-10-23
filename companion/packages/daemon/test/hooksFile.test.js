"use strict";
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { installProjectHooks, removeProjectHooks } = require("../src/hooksFile.js");

describe("hooksFile", () => {
  let root;
  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "companion-hooks-"));
  });
  after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("merges idempotently and preserves other hooks", () => {
    const cursor = path.join(root, ".cursor");
    fs.mkdirSync(cursor);
    fs.writeFileSync(
      path.join(cursor, "hooks.json"),
      JSON.stringify({
        version: 1,
        hooks: {
          beforeShellExecution: [{ command: "node other.js" }],
        },
      })
    );
    const gate = "C:/Users/x/.companion/runtime/gate.js";
    const r1 = installProjectHooks(root, gate);
    assert.equal(r1.changed, true);
    const r2 = installProjectHooks(root, gate);
    assert.equal(r2.changed, false);
    const data = JSON.parse(
      fs.readFileSync(path.join(cursor, "hooks.json"), "utf8")
    );
    assert.equal(data.hooks.beforeShellExecution.length, 2);
    assert.ok(
      data.hooks.beforeShellExecution.some((h) => h.command.includes("other.js"))
    );
    assert.ok(fs.existsSync(path.join(cursor, "hooks.json.bak")));
    const rem = removeProjectHooks(root);
    assert.equal(rem.changed, true);
    const after = JSON.parse(
      fs.readFileSync(path.join(cursor, "hooks.json"), "utf8")
    );
    assert.equal(after.hooks.beforeShellExecution.length, 1);
  });
});
