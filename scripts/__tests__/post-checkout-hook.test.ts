import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseNewBranch } from "../../hooks/post-checkout-update-linear-status.ts";

describe("parseNewBranch — git checkout -b / -B", () => {
  it("extracts branch from a plain `git checkout -b <branch>`", () => {
    assert.equal(parseNewBranch("git checkout -b baltor/jump-326-foo"), "baltor/jump-326-foo");
  });

  it("extracts branch from `git checkout -B <branch>` (force create)", () => {
    assert.equal(parseNewBranch("git checkout -B baltor/jump-326-foo"), "baltor/jump-326-foo");
  });

  it("takes only the branch, ignoring the trailing start-point", () => {
    assert.equal(parseNewBranch("git checkout -b feat/x main"), "feat/x");
  });

  it("returns null for `git checkout <existing-branch>` (no -b)", () => {
    assert.equal(parseNewBranch("git checkout main"), null);
  });
});

describe("parseNewBranch — git switch -c / -C / --create", () => {
  it("handles -c", () => {
    assert.equal(parseNewBranch("git switch -c feat/x"), "feat/x");
  });

  it("handles -C (force create)", () => {
    assert.equal(parseNewBranch("git switch -C feat/x"), "feat/x");
  });

  it("handles --create", () => {
    assert.equal(parseNewBranch("git switch --create feat/x"), "feat/x");
  });

  it("returns null for `git switch <existing-branch>` (no -c/--create)", () => {
    assert.equal(parseNewBranch("git switch main"), null);
  });
});

describe("parseNewBranch — git worktree add", () => {
  it("extracts branch from `git worktree add -b <branch> <path>`", () => {
    assert.equal(
      parseNewBranch("git worktree add -b baltor/jump-326 /home/me/worktrees/jump-326"),
      "baltor/jump-326",
    );
  });

  it("extracts branch when a start-point follows the path", () => {
    assert.equal(
      parseNewBranch("git worktree add -b feat/x /tmp/wt main"),
      "feat/x",
    );
  });

  it("handles -B (force create)", () => {
    assert.equal(parseNewBranch("git worktree add -B feat/x /tmp/wt"), "feat/x");
  });

  it("returns null for `git worktree add` without -b/-B (existing branch)", () => {
    assert.equal(parseNewBranch("git worktree add /tmp/wt existing-branch"), null);
  });

  it("returns null for other worktree subcommands", () => {
    assert.equal(parseNewBranch("git worktree list"), null);
    assert.equal(parseNewBranch("git worktree remove /tmp/wt"), null);
  });
});

describe("parseNewBranch — git global flags before subcommand", () => {
  it("skips `git -C <path>` and still parses the new branch", () => {
    assert.equal(parseNewBranch("git -C /repo checkout -b foo"), "foo");
  });

  it("skips `git -c <key=value>`", () => {
    assert.equal(parseNewBranch("git -c user.name=x checkout -b foo"), "foo");
  });

  it("skips --git-dir and --work-tree", () => {
    assert.equal(
      parseNewBranch("git --git-dir /tmp/.git --work-tree /tmp checkout -b foo"),
      "foo",
    );
  });

  it("works with `git -C <path> worktree add -b`", () => {
    assert.equal(
      parseNewBranch("git -C /repo worktree add -b foo /tmp/wt main"),
      "foo",
    );
  });
});

describe("parseNewBranch — command prefixes and chaining", () => {
  it("finds the git command after a `cd … &&` prefix", () => {
    assert.equal(parseNewBranch("cd /tmp && git checkout -b foo"), "foo");
  });

  it("finds the git command after env-var assignment", () => {
    assert.equal(parseNewBranch("GIT_AUTHOR_NAME=x git checkout -b foo"), "foo");
  });
});

describe("parseNewBranch — non-matching commands", () => {
  it("returns null for non-branch-creating git commands", () => {
    assert.equal(parseNewBranch("git status"), null);
    assert.equal(parseNewBranch("git log --oneline"), null);
    assert.equal(parseNewBranch("git push origin main"), null);
    assert.equal(parseNewBranch("git branch -d foo"), null);
  });

  it("returns null for non-git commands", () => {
    assert.equal(parseNewBranch("ls -la"), null);
    assert.equal(parseNewBranch("npm test"), null);
  });

  it("returns null for empty or whitespace-only commands", () => {
    assert.equal(parseNewBranch(""), null);
    assert.equal(parseNewBranch("   "), null);
  });
});

describe("parseNewBranch — formatting tolerance", () => {
  it("strips surrounding double quotes", () => {
    assert.equal(parseNewBranch(`git checkout -b "baltor/jump-326"`), "baltor/jump-326");
  });

  it("strips surrounding single quotes", () => {
    assert.equal(parseNewBranch(`git checkout -b 'baltor/jump-326'`), "baltor/jump-326");
  });

  it("tolerates extra whitespace", () => {
    assert.equal(parseNewBranch("  git   checkout   -b   foo  "), "foo");
  });
});
