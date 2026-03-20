import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { stripCollapseWrappers, cleanBody } from "../src/yaml-builder/body-cleaner.js";

// ---------------------------------------------------------------------------
// K3 — HTML tags with attributes must be stripped
// ---------------------------------------------------------------------------

describe("stripCollapseWrappers", () => {
  it("strips bare <details> tags", () => {
    assert.equal(
      stripCollapseWrappers("<details>content</details>"),
      "content",
    );
  });

  it("strips <details> with attributes like open", () => {
    assert.equal(
      stripCollapseWrappers('<details open>content</details>'),
      "content",
    );
  });

  it("strips <summary> with style attribute", () => {
    assert.equal(
      stripCollapseWrappers('<summary style="font-weight:bold">Title</summary>'),
      "Title",
    );
  });

  it("strips <blockquote> with class attribute", () => {
    assert.equal(
      stripCollapseWrappers('<blockquote class="note">Quote</blockquote>'),
      "Quote",
    );
  });

  it("strips mixed tags with and without attributes", () => {
    const input = '<details open>\n<summary style="color:red">Info</summary>\nBody\n</details>';
    const result = stripCollapseWrappers(input);
    assert.ok(!result.includes("<details"));
    assert.ok(!result.includes("<summary"));
    assert.ok(result.includes("Info"));
    assert.ok(result.includes("Body"));
  });
});

describe("cleanBody", () => {
  it("strips tags with attributes through the full pipeline", () => {
    const input = '<details open>\n<summary style="bold">Tip</summary>\nSome advice\n</details>';
    const result = cleanBody(input, "generic-bot");
    assert.ok(!result.includes("<details"));
    assert.ok(!result.includes("<summary"));
    assert.ok(result.includes("Tip"));
    assert.ok(result.includes("Some advice"));
  });

  it("strips single-line HTML comments", () => {
    const result = cleanBody("before <!-- fingerprint --> after", "coderabbitai");
    assert.ok(!result.includes("<!--"));
    assert.ok(result.includes("before"));
    assert.ok(result.includes("after"));
  });

  it("strips multiline HTML comments", () => {
    const result = cleanBody("before\n<!-- this is\na multiline\ncomment -->\nafter", "coderabbitai");
    assert.ok(!result.includes("<!--"));
    assert.ok(!result.includes("multiline"));
    assert.ok(result.includes("before"));
    assert.ok(result.includes("after"));
  });

  it("strips compact HTML comments without spaces", () => {
    const result = cleanBody("before<!--comment-->after", "kody-ai");
    assert.ok(!result.includes("<!--"));
    assert.ok(result.includes("before"));
    assert.ok(result.includes("after"));
  });
});
