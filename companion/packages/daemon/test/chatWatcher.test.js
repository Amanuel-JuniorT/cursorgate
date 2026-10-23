"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { parseJsonlMessages } = require("../src/chatWatcher.js");
const { redactSecrets } = require("@companion/shared");

describe("parseJsonlMessages", () => {
  it("parses roles and redacts email in content path", () => {
    const text = [
      JSON.stringify({ role: "user", content: "hello me@x.com" }),
      JSON.stringify({ role: "assistant", content: "hi" }),
    ].join("\n");
    const msgs = parseJsonlMessages(text);
    assert.equal(msgs.length, 2);
    assert.match(msgs[0].content, /EMAIL|hello/);
    assert.equal(msgs[1].role, "assistant");
  });
});

describe("redact in shared", () => {
  it("never leaves bare user_email assignment", () => {
    assert.match(redactSecrets("user_email: a@b.co"), /REDACTED/);
  });
});
