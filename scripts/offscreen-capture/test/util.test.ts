import test from "node:test";
import assert from "node:assert/strict";

import { chordToWtype, parseArgs, parseSize } from "../src/util";

test("chordToWtype: single modifier", () => {
  assert.deepEqual(chordToWtype("ctrl+g"), ["-M", "ctrl", "-k", "g", "-m", "ctrl"]);
});

test("chordToWtype: multiple modifiers pressed in order, released in reverse", () => {
  assert.deepEqual(chordToWtype("ctrl+shift+p"), [
    "-M", "ctrl", "-M", "shift", "-k", "p", "-m", "shift", "-m", "ctrl",
  ]);
});

test("chordToWtype: bare key, no modifiers", () => {
  assert.deepEqual(chordToWtype("Escape"), ["-k", "Escape"]);
});

test("chordToWtype: lower-cases modifiers but preserves the key keysym", () => {
  assert.deepEqual(chordToWtype("Ctrl+G"), ["-M", "ctrl", "-k", "G", "-m", "ctrl"]);
});

test("chordToWtype: rejects empty / malformed chords", () => {
  assert.throws(() => chordToWtype(""));
  assert.throws(() => chordToWtype("ctrl+")); // empty key
  assert.throws(() => chordToWtype("+g")); // empty modifier
});

test("parseArgs: value flags, boolean flags, and a trailing boolean", () => {
  const a = parseArgs(["--backend", "sway", "--view", "graph", "--headless", "--out", "/tmp/x.png"]);
  assert.equal(a.backend, "sway");
  assert.equal(a.view, "graph");
  assert.equal(a.headless, true); // followed by another --flag => boolean
  assert.equal(a.out, "/tmp/x.png");
});

test("parseArgs: lone trailing flag is boolean", () => {
  assert.deepEqual(parseArgs(["--flag"]), { flag: true });
});

test("parseArgs: ignores non-flag leading tokens", () => {
  assert.deepEqual(parseArgs(["positional", "--k", "v"]), { k: "v" });
});

test("parseSize: valid WxH", () => {
  assert.deepEqual(parseSize("1680x1050"), { width: 1680, height: 1050 });
});

test("parseSize: rejects junk", () => {
  assert.throws(() => parseSize("big"));
  assert.throws(() => parseSize("1680X1050")); // capital X not accepted
  assert.throws(() => parseSize("1680x"));
});
