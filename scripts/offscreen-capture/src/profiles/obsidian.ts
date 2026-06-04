// Obsidian app profile.
//
// Isolation (so the user's running Obsidian and real vault are never touched):
//   - copy ~/.config/obsidian to a throwaway user-data-dir (a *separate* instance, fresh
//     single-instance lock so it can't be mistaken for a second launch of the real one)
//   - copy the target vault to a throwaway dir and point the config at the copy
//   - optionally pre-arrange the copy's workspace to open straight to the global graph view
//
// Launch flags are native-Wayland (no swiftshader needed — the sway backend gives hardware GL).

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { AppProfile, PreparedApp } from "../types";

export interface ObsidianOptions {
  vault: string; // path to the vault to open (copied, never mutated)
  view?: "graph" | "default"; // pre-open the global graph view (default: graph)
  configSrc?: string; // source Obsidian config dir (default: ~/.config/obsidian)
}

const VAULT_ID = "osc0000000000001";

// Recursive copy that skips Obsidian's Singleton* lock sockets (copying a unix socket throws,
// and a stale lock would make the copy think another instance is running).
async function copyTree(src: string, dest: string): Promise<void> {
  await fs.cp(src, dest, {
    recursive: true,
    filter: (s) => !path.basename(s).startsWith("Singleton"),
  });
}

async function setGraphWorkspace(vault: string): Promise<void> {
  const dir = path.join(vault, ".obsidian");
  await fs.mkdir(dir, { recursive: true });

  const wsPath = path.join(dir, "workspace.json");
  let ws: Record<string, unknown> = {};
  try {
    ws = JSON.parse(await fs.readFile(wsPath, "utf8"));
  } catch {
    ws = {};
  }
  const leafId = "osc_graph_leaf";
  ws.main = {
    id: "osc_main",
    type: "split",
    direction: "vertical",
    children: [
      {
        id: "osc_tabs",
        type: "tabs",
        children: [{ id: leafId, type: "leaf", state: { type: "graph", state: {}, title: "Graph" } }],
      },
    ],
  };
  ws.active = leafId;
  if (ws.left && typeof ws.left === "object") (ws.left as Record<string, unknown>).collapsed = true;
  if (ws.right && typeof ws.right === "object") (ws.right as Record<string, unknown>).collapsed = true;
  await fs.writeFile(wsPath, JSON.stringify(ws, null, 2));

  // Clearer edges in the captured graph.
  const gPath = path.join(dir, "graph.json");
  let g: Record<string, unknown> = {};
  try {
    g = JSON.parse(await fs.readFile(gPath, "utf8"));
  } catch {
    g = {};
  }
  g.showArrow = true;
  g["collapse-filter"] = true;
  g.close = false;
  await fs.writeFile(gPath, JSON.stringify(g, null, 2));
}

export function obsidianProfile(o: ObsidianOptions): AppProfile {
  const configSrc = o.configSrc ?? path.join(os.homedir(), ".config", "obsidian");
  const view = o.view ?? "graph";

  return {
    name: "obsidian",
    nixPkgs: [], // obsidian is provided by the system, not Nix-shell-provisioned here
    bins: ["obsidian"],

    async prepare(): Promise<PreparedApp> {
      const work = await fs.mkdtemp(path.join(os.tmpdir(), "osc-obsidian-"));
      const userDir = path.join(work, "userdata");
      const vaultCopy = path.join(work, "vault");

      await copyTree(configSrc, userDir);
      await copyTree(o.vault, vaultCopy);

      // Repoint the (trusted) config at the vault copy and open it directly.
      const cfgFile = path.join(userDir, "obsidian.json");
      let cfg: { vaults?: Record<string, { path: string; ts: number; open: boolean }> } = {};
      try {
        cfg = JSON.parse(await fs.readFile(cfgFile, "utf8"));
      } catch {
        cfg = {};
      }
      cfg.vaults = cfg.vaults ?? {};
      for (const v of Object.values(cfg.vaults)) v.open = false;
      cfg.vaults[VAULT_ID] = { path: vaultCopy, ts: Date.now(), open: true };
      await fs.writeFile(cfgFile, JSON.stringify(cfg));

      if (view === "graph") await setGraphWorkspace(vaultCopy);

      return {
        launch: {
          app: "obsidian",
          args: [`--user-data-dir=${userDir}`, "--ozone-platform=wayland", "--no-sandbox"],
          env: { NIXOS_OZONE_WL: "1" },
        },
        nav: [], // workspace is pre-opened to the graph; the orchestrator's waitStable settles it
        async cleanup() {
          await fs.rm(work, { recursive: true, force: true }).catch(() => {});
        },
      };
    },
  };
}
