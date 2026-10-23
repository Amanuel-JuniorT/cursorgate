"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  humanizeProjectSlug,
  projectFromTranscriptPath,
  titleFromMessages,
} = require("../src/projectName.js");

describe("projectName", () => {
  it("humanizes Cursor project slugs", () => {
    assert.equal(
      humanizeProjectSlug("c-Users-Home-Documents-TAC-Project-Swiss-knife"),
      "Swiss-knife"
    );
  });

  it("extracts project from transcript path", () => {
    const p =
      "C:/Users/Home/.cursor/projects/c-Users-Home-Documents-TAC-Project-Swiss-knife/agent-transcripts/abc/file.jsonl";
    assert.equal(projectFromTranscriptPath(p), "Swiss-knife");
  });

  it("cleans titles", () => {
    assert.equal(
      titleFromMessages([{ role: "user", content: "<user_query> Hello there </user_query>" }]),
      "Hello there"
    );
  });

  it("does not wipe text after timestamp tags", () => {
    const title = titleFromMessages([
      {
        role: "user",
        content:
          "<timestamp>Friday, Oct 16, 2026, 9:12 PM (UTC+3)</timestamp>\n<user_query>\n@docs\n\nWhat do you understand\n</user_query>",
      },
    ]);
    assert.match(title, /What do you understand/);
    assert.notEqual(title, "Chat");
  });
});
