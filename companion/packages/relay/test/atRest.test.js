"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { seal, open } = require("../src/atRest.js");

describe("atRest", () => {
  it("roundtrips", () => {
    const s = seal("secret-token-value");
    assert.notEqual(s, "secret-token-value");
    assert.equal(open(s), "secret-token-value");
  });
});
