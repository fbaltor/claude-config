/**
 * Display layer for check-reviews. Decoupled from the data-fetching logic
 * so the main script stays view-agnostic.
 *
 * Two implementations:
 *   - TerminalRenderer  (TTY): ANSI colors, spinners, in-place line updates
 *   - PlainRenderer (non-TTY): simple text output, no escape codes
 */

import type { AiCheckRun, CheckStatusResult } from "./check-reviews.js";

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface StatusRenderer {
  /** Full status display: header, check lines, and summary. */
  render(result: CheckStatusResult): void;

  /** Overwrite check lines and footer in-place (for polling). */
  update(result: CheckStatusResult): void;

  /** Reset tracked line count (call before external console output). */
  reset(): void;
}

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const SPINNER = ["◐", "◓", "◑", "◒"] as const;

function ansi(code: string, text: string, enabled: boolean): string {
  return enabled ? `\x1b[${code}m${text}\x1b[0m` : text;
}

/** Conclusions treated as non-failure (used by both checkIcon/checkLabel and summaryText). */
const PASS_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);

// ---------------------------------------------------------------------------
// Pure formatting functions (exported for testing)
// ---------------------------------------------------------------------------

export function checkIcon(
  check: AiCheckRun,
  frame: number,
  color: boolean,
): string {
  if (check.status !== "completed") {
    const ch = SPINNER[frame % SPINNER.length]!;
    return ansi("33", ch, color);
  }
  switch (check.conclusion) {
    case "success":
      return ansi("32", "✓", color);
    case "skipped":
      return ansi("2", "⊘", color);
    case "neutral":
      return ansi("2", "◦", color);
    default:
      return ansi("31", "✗", color);
  }
}

export function checkLabel(
  check: AiCheckRun,
  color: boolean,
): string {
  if (check.status !== "completed") return ansi("33", "in progress", color);
  switch (check.conclusion) {
    case "success":
      return ansi("32", "completed", color);
    case "skipped":
      return ansi("2", "skipped", color);
    case "neutral":
      return ansi("2", "neutral", color);
    default:
      return ansi("31", `failed — ${check.conclusion ?? "unknown"}`, color);
  }
}

export function formatCheckLine(
  check: AiCheckRun,
  frame: number,
  color: boolean,
): string {
  return `  ${checkIcon(check, frame, color)} ${check.name.padEnd(22)} ${checkLabel(check, color)}`;
}

export function summaryText(
  result: CheckStatusResult,
  color: boolean,
): string {
  if (result.checks.length === 0) {
    return ansi("2", "No AI review checks found.", color);
  }
  if (result.allCompleted && !result.anyFailed) {
    return ansi("32", "✓ All AI reviews complete!", color);
  }
  if (result.anyFailed) {
    const n = result.checks.filter(
      (c) => c.status === "completed" && !PASS_CONCLUSIONS.has(c.conclusion ?? ""),
    ).length;
    return ansi("31", `✗ ${n} of ${result.checks.length} checks failed`, color);
  }
  const pending = result.checks.filter((c) => c.status !== "completed").length;
  return ansi("33", `${pending} of ${result.checks.length} still running`, color);
}

// ---------------------------------------------------------------------------
// Terminal renderer (TTY: in-place updates via ANSI escape codes)
// ---------------------------------------------------------------------------

class TerminalRenderer implements StatusRenderer {
  private lines = 0;
  private frame = 0;
  private startTime = Date.now();

  render(result: CheckStatusResult): void {
    const sha = result.headSha.slice(0, 7);
    const header = `${ansi("1", `PR #${result.prNumber}`, true)} — AI Review Status ${ansi("2", `(${sha})`, true)}`;
    process.stdout.write(`\n${header}\n\n`);
    this.writeBlock(result, false);
  }

  update(result: CheckStatusResult): void {
    this.frame++;
    this.eraseBlock();
    this.writeBlock(result, true);
  }

  reset(): void {
    this.lines = 0;
  }

  private eraseBlock(): void {
    if (this.lines > 0) {
      process.stdout.write(`\x1b[${this.lines}A\x1b[0J`);
    }
  }

  private writeBlock(result: CheckStatusResult, isPolling: boolean): void {
    const buf: string[] = [];

    for (const check of result.checks) {
      buf.push(formatCheckLine(check, this.frame, true));
    }
    buf.push("");

    if (result.allCompleted || result.checks.length === 0 || !isPolling) {
      buf.push(summaryText(result, true));
    } else {
      const elapsed = Math.round((Date.now() - this.startTime) / 1000);
      const sp = ansi("33", SPINNER[this.frame % SPINNER.length]!, true);
      buf.push(`${sp} ${ansi("2", `Waiting for reviews — ${elapsed}s elapsed`, true)}`);
    }

    for (const line of buf) {
      process.stdout.write(`\x1b[2K${line}\n`);
    }
    this.lines = buf.length;
  }
}

// ---------------------------------------------------------------------------
// Plain renderer (non-TTY: simple line output, no ANSI codes)
// ---------------------------------------------------------------------------

class PlainRenderer implements StatusRenderer {
  render(result: CheckStatusResult): void {
    const sha = result.headSha.slice(0, 7);
    console.log(`PR #${result.prNumber} — AI Review Status (commit ${sha})\n`);
    for (const check of result.checks) {
      console.log(formatCheckLine(check, 0, false));
    }
    console.log("");
    console.log(summaryText(result, false));
  }

  update(result: CheckStatusResult): void {
    for (const check of result.checks) {
      console.log(formatCheckLine(check, 0, false));
    }
    console.log("");
    if (result.allCompleted) {
      console.log(summaryText(result, false));
    }
  }

  reset(): void {}
}

// ---------------------------------------------------------------------------
// Noop renderer (for tests)
// ---------------------------------------------------------------------------

class NoopRenderer implements StatusRenderer {
  render(): void {}
  update(): void {}
  reset(): void {}
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

export function createRenderer(): StatusRenderer {
  return process.stdout.isTTY ? new TerminalRenderer() : new PlainRenderer();
}

export function createNoopRenderer(): StatusRenderer {
  return new NoopRenderer();
}
