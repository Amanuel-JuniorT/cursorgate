"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { redactSecrets, envelope, MSG } = require("../src/index.js");

describe("redactSecrets", () => {
  it("redacts emails", () => {
    assert.match(redactSecrets("hi me@example.com"), /\[EMAIL\]/);
  });
  it("redacts user_email fields", () => {
    assert.match(redactSecrets("user_email: a@b.com"), /REDACTED/);
  });
  it("redacts gh tokens", () => {
    assert.match(redactSecrets("ghp_abcdefghijklmnopqrstuvwxyz12"), /\[SECRET\]/);
  });
});

describe("envelope", () => {
  it("sets protocol version and type", () => {
    const e = envelope(MSG.PING, { id: 1 });
    assert.equal(e.v, 1);
    assert.equal(e.type, "ping");
    assert.equal(e.id, 1);
  });
});
