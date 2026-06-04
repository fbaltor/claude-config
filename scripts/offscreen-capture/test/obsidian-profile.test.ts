import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { obsidianProfile } from "../src/profiles/obsidian";

interface Fixture {
  root: string;
  cfg: string;
  vault: string;
}

async function setupFixture(): Promise<Fixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "osc-fix-"));

  const cfg = path.join(root, "config");
  await fs.mkdir(cfg, { recursive: true });
  await fs.writeFile(
    path.join(cfg, "obsidian.json"),
    JSON.stringify({ vaults: { old: { path: "/elsewhere", ts: 1, open: true } } }),
  );
  await fs.writeFile(path.join(cfg, "SingletonLock"), "lock"); // must be excluded from the copy
  await fs.writeFile(path.join(cfg, "appearance.json"), "{}"); // must be copied

  const vault = path.join(root, "vault");
  await fs.mkdir(path.join(vault, ".obsidian"), { recursive: true });
  await fs.writeFile(path.join(vault, "note.md"), "# Note");
  await fs.writeFile(
    path.join(vault, ".obsidian", "workspace.json"),
    JSON.stringify({ main: { sentinel: true }, left: { collapsed: false }, right: { collapsed: false } }),
  );

  return { root, cfg, vault };
}

function userDirOf(args: string[]): string {
  const a = args.find((x) => x.startsWith("--user-data-dir="));
  assert.ok(a, "launch args missing --user-data-dir");
  return a!.split("=")[1];
}

test("obsidian profile: isolates + repoints + opens graph, leaving sources untouched", async () => {
  const { root, cfg, vault } = await setupFixture();
  const profile = obsidianProfile({ vault, view: "graph", configSrc: cfg });
  const prepared = await profile.prepare({ backend: "sway", size: { width: 100, height: 100 } });

  try {
    // native-Wayland launch flags
    assert.ok(prepared.launch.args?.includes("--ozone-platform=wayland"));
    assert.ok(prepared.launch.args?.includes("--no-sandbox"));
    assert.equal(prepared.launch.env?.NIXOS_OZONE_WL, "1");

    const userDir = userDirOf(prepared.launch.args ?? []);

    // Singleton* excluded; ordinary files copied
    await assert.rejects(fs.access(path.join(userDir, "SingletonLock")), "SingletonLock should not be copied");
    await fs.access(path.join(userDir, "appearance.json"));

    // config repointed to the vault COPY (not the original), open=true; previous vault closed
    const newCfg = JSON.parse(await fs.readFile(path.join(userDir, "obsidian.json"), "utf8"));
    const opened = Object.values<{ path: string; open: boolean }>(newCfg.vaults).filter((v) => v.open);
    assert.equal(opened.length, 1);
    const vaultCopy = opened[0].path;
    assert.notEqual(vaultCopy, vault, "should open a copy, not the source vault");
    assert.equal(newCfg.vaults.old.open, false);

    // graph view pre-arranged on the copy
    const ws = JSON.parse(await fs.readFile(path.join(vaultCopy, ".obsidian", "workspace.json"), "utf8"));
    assert.equal(ws.main.children[0].children[0].state.type, "graph");
    const graph = JSON.parse(await fs.readFile(path.join(vaultCopy, ".obsidian", "graph.json"), "utf8"));
    assert.equal(graph.showArrow, true);

    // SOURCES untouched
    const srcWs = JSON.parse(await fs.readFile(path.join(vault, ".obsidian", "workspace.json"), "utf8"));
    assert.deepEqual(srcWs.main, { sentinel: true }, "source vault workspace must not be mutated");
    const srcCfg = JSON.parse(await fs.readFile(path.join(cfg, "obsidian.json"), "utf8"));
    assert.equal(srcCfg.vaults.old.open, true, "source config must not be mutated");
  } finally {
    await prepared.cleanup();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("obsidian profile: view=default does not rewrite the workspace", async () => {
  const { root, cfg, vault } = await setupFixture();
  const profile = obsidianProfile({ vault, view: "default", configSrc: cfg });
  const prepared = await profile.prepare({ backend: "sway", size: { width: 100, height: 100 } });
  try {
    const userDir = userDirOf(prepared.launch.args ?? []);
    const newCfg = JSON.parse(await fs.readFile(path.join(userDir, "obsidian.json"), "utf8"));
    const vaultCopy = Object.values<{ path: string; open: boolean }>(newCfg.vaults).find((v) => v.open)!.path;
    const ws = JSON.parse(await fs.readFile(path.join(vaultCopy, ".obsidian", "workspace.json"), "utf8"));
    assert.deepEqual(ws.main, { sentinel: true }, "view=default should leave the workspace as copied");
  } finally {
    await prepared.cleanup();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("obsidian profile: cleanup removes the work dir", async () => {
  const { root, cfg, vault } = await setupFixture();
  const profile = obsidianProfile({ vault, configSrc: cfg });
  const prepared = await profile.prepare({ backend: "sway", size: { width: 100, height: 100 } });
  const userDir = userDirOf(prepared.launch.args ?? []);
  await fs.access(userDir); // exists now
  await prepared.cleanup();
  await assert.rejects(fs.access(userDir), "work dir should be gone after cleanup");
  await fs.rm(root, { recursive: true, force: true });
});
