import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseIssueUrl, parseProjectUrl } from "../lib/linear.ts";

describe("parseIssueUrl", () => {
  it("extracts identifier from a canonical issue URL", () => {
    assert.equal(
      parseIssueUrl(
        "https://linear.app/gojumpstart/issue/JUMP-304/landing-page-sync",
      ),
      "JUMP-304",
    );
  });

  it("accepts URLs without a trailing title slug", () => {
    assert.equal(
      parseIssueUrl("https://linear.app/gojumpstart/issue/JUMP-304"),
      "JUMP-304",
    );
  });

  it("accepts URLs with query strings or fragments", () => {
    assert.equal(
      parseIssueUrl("https://linear.app/gojumpstart/issue/GOJ-42?foo=bar"),
      "GOJ-42",
    );
    assert.equal(
      parseIssueUrl("https://linear.app/gojumpstart/issue/GOJ-42#comment-1"),
      "GOJ-42",
    );
  });

  it("uppercases a lowercase team key", () => {
    assert.equal(
      parseIssueUrl("https://linear.app/gojumpstart/issue/jump-304/slug"),
      "JUMP-304",
    );
  });

  it("returns null for non-URL strings", () => {
    assert.equal(parseIssueUrl("JUMP-304"), null);
    assert.equal(parseIssueUrl(""), null);
    assert.equal(parseIssueUrl("not a url"), null);
  });

  it("returns null for project URLs", () => {
    assert.equal(
      parseIssueUrl(
        "https://linear.app/gojumpstart/project/foo-bar-dde13216e3fa",
      ),
      null,
    );
  });
});

describe("parseProjectUrl", () => {
  it("extracts slugId from a canonical project URL", () => {
    assert.equal(
      parseProjectUrl(
        "https://linear.app/gojumpstart/project/internalize-chatwoot-by-self-hosting-dde13216e3fa",
      ),
      "dde13216e3fa",
    );
  });

  it("accepts URLs with a trailing tab segment", () => {
    assert.equal(
      parseProjectUrl(
        "https://linear.app/gojumpstart/project/sentry-integration-67afdcc4c9fa/overview",
      ),
      "67afdcc4c9fa",
    );
  });

  it("accepts URLs with a query string", () => {
    assert.equal(
      parseProjectUrl(
        "https://linear.app/gojumpstart/project/sentry-integration-67afdcc4c9fa?tab=timeline",
      ),
      "67afdcc4c9fa",
    );
  });

  it("lowercases the slugId", () => {
    assert.equal(
      parseProjectUrl(
        "https://linear.app/gojumpstart/project/foo-DDE13216E3FA",
      ),
      "dde13216e3fa",
    );
  });

  it("picks the trailing 12-char suffix even when the kebab name contains hex-looking tokens", () => {
    // Slug name has a 12-char hex run embedded in it; only the final one is the slugId.
    assert.equal(
      parseProjectUrl(
        "https://linear.app/gojumpstart/project/abcdef012345-project-67afdcc4c9fa",
      ),
      "67afdcc4c9fa",
    );
  });

  it("returns null for non-URL strings", () => {
    assert.equal(parseProjectUrl("some project name"), null);
    assert.equal(parseProjectUrl(""), null);
    assert.equal(parseProjectUrl("dde13216e3fa"), null);
  });

  it("returns null for issue URLs", () => {
    assert.equal(
      parseProjectUrl("https://linear.app/gojumpstart/issue/JUMP-304/slug"),
      null,
    );
  });

  it("returns null when the URL has no 12-char suffix", () => {
    assert.equal(
      parseProjectUrl("https://linear.app/gojumpstart/project/no-suffix"),
      null,
    );
  });
});
