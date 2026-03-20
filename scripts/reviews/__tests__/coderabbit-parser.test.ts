import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { CodeRabbitParser } from "../src/yaml-builder/parsers/coderabbit.js";

// ---------------------------------------------------------------------------
// K4 — explodeSummary should propagate severity/category from section headers
// ---------------------------------------------------------------------------

describe("CodeRabbitParser.explodeSummary", () => {
  const parser = new CodeRabbitParser();

  it("propagates section header severity to bullet items that lack their own", () => {
    // Section header has [Major] badge, but the bullet item does not
    const body = [
      "## [Major] Issues",
      "- **Missing null check** in handler",
      "",
    ].join("\n");

    const results = parser.explodeSummary("s1", body, null);

    assert.ok(results.length > 0, "should produce at least one exploded item");
    assert.equal(results[0].severity, "major");
  });

  it("propagates section header category to bullet items that lack their own", () => {
    // Section header has a category emoji, bullet item does not
    const body = [
      "## \u{1F41B} Bug section",
      "- **Off-by-one error** in loop",
      "",
    ].join("\n");

    const results = parser.explodeSummary("s1", body, null);

    assert.ok(results.length > 0, "should produce at least one exploded item");
    assert.equal(results[0].category, "bug");
  });

  it("prefers the bullet's own severity over the section header", () => {
    const body = [
      "## [Major] Issues",
      "- [Critical] **Security flaw** in auth",
      "",
    ].join("\n");

    const results = parser.explodeSummary("s1", body, null);

    assert.ok(results.length > 0);
    assert.equal(results[0].severity, "critical");
  });

  it("returns null severity/category when neither header nor bullet has badges", () => {
    const body = [
      "## `src/index.ts`",
      "- **Rename variable** for clarity",
      "",
    ].join("\n");

    const results = parser.explodeSummary("s1", body, null);

    assert.ok(results.length > 0);
    assert.equal(results[0].severity, null);
    assert.equal(results[0].category, null);
  });

  it("splits bullets prefixed with bracketed severity like [Critical]", () => {
    const body = [
      "## [Major] Issues",
      "- **Missing null check** in handler",
      "- [Critical] **SQL injection** in query builder",
      "",
    ].join("\n");

    const results = parser.explodeSummary("s1", body, null);

    assert.equal(results.length, 2, "should split into two separate items");
    assert.equal(results[0].severity, "major");
    assert.equal(results[0].title, "Missing null check");
    assert.equal(results[1].severity, "critical");
    assert.equal(results[1].title, "SQL injection");
  });

  it("extracts file from backtick-quoted header", () => {
    const body = [
      "## `src/utils.ts`",
      "- **Fix typo** in function name",
      "",
    ].join("\n");

    const results = parser.explodeSummary("s1", body, null);

    assert.ok(results.length > 0);
    assert.equal(results[0].file, "src/utils.ts");
  });
});
