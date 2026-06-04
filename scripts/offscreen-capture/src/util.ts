// Pure helpers, split out so they are unit-testable without spawning anything.

import type { Size } from "./types";

// "ctrl+shift+g" -> ["-M","ctrl","-M","shift","-k","g","-m","shift","-m","ctrl"]
// Modifiers are pressed left-to-right and released in reverse. Modifier names are lower-cased;
// the key (an xkb keysym for wtype's -k) is left as-is.
export function chordToWtype(chord: string): string[] {
  const parts = chord.split("+").map((s) => s.trim());
  const key = parts.pop();
  if (!key) throw new Error(`invalid key chord: "${chord}"`); // empty or trailing "+"
  if (parts.some((m) => m === "")) throw new Error(`invalid key chord: "${chord}"`); // empty modifier
  const mods = parts.map((m) => m.toLowerCase());
  const args: string[] = [];
  for (const m of mods) args.push("-M", m);
  args.push("-k", key);
  for (const m of [...mods].reverse()) args.push("-m", m);
  return args;
}

export type Args = Record<string, string | boolean>;

// Minimal `--flag value` / `--bool` parser. A flag whose next token is another `--flag`
// (or absent) is treated as a boolean true.
export function parseArgs(argv: string[]): Args {
  const a: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (!t.startsWith("--")) continue;
    const key = t.slice(2);
    const next = argv[i + 1];
    if (next != null && !next.startsWith("--")) {
      a[key] = next;
      i++;
    } else {
      a[key] = true;
    }
  }
  return a;
}

export function parseSize(s: string): Size {
  const m = s.match(/^(\d+)x(\d+)$/);
  if (!m) throw new Error(`invalid size "${s}" (expected e.g. 1680x1050)`);
  return { width: Number(m[1]), height: Number(m[2]) };
}
