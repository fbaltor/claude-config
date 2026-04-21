import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import YAML from "yaml";
import type { ZodError } from "zod";

import {
  phaseContractSchema,
  statusFileSchema,
  criticOutputSchema,
  coverageOutputSchema,
} from "../src/schemas/index.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

const loadFixture = (name: string): unknown =>
  YAML.parse(readFileSync(join(fixturesDir, name), "utf8"));

const zodErrorPaths = (err: unknown): string[] => {
  const zerr = err as ZodError;
  return zerr.issues.map((issue) => issue.path.join("."));
};

describe("phaseContractSchema", () => {
  it("parses the valid fixture", () => {
    const data = loadFixture("phase-contract.valid.yaml");
    const parsed = phaseContractSchema.parse(data);
    assert.equal(parsed.id, "02-mapper");
    assert.equal(parsed.type, "code");
    assert.equal(parsed.tdd, true);
    assert.equal(parsed.behavior_spec.length, 3);
    assert.equal(parsed.critic.subagent_type, "general-purpose");
  });

  it("rejects the invalid fixture with path=type", () => {
    const data = loadFixture("phase-contract.invalid.yaml");
    const result = phaseContractSchema.safeParse(data);
    assert.equal(result.success, false);
    if (!result.success) {
      const paths = zodErrorPaths(result.error);
      assert.ok(paths.includes("type"), `expected path 'type' in ${paths.join(",")}`);
    }
  });

  it("requires tdd_skip_reason when type=code and tdd=false", () => {
    const result = phaseContractSchema.safeParse({
      id: "x",
      type: "code",
      tdd: false,
      objective: "x",
      behavior_spec: [],
      inputs: { code: [], docs_for_testing: [], docs_for_impl: [] },
      exit_criteria: [],
      out_of_scope: [],
      critic: { subagent_type: "general-purpose", checklist: [], frame_break_probe: "" },
      contract_confirmed: false,
    });
    assert.equal(result.success, false);
    if (!result.success) {
      const paths = zodErrorPaths(result.error);
      assert.ok(paths.includes("tdd_skip_reason"));
    }
  });
});

describe("statusFileSchema", () => {
  it("parses the valid fixture", () => {
    const data = loadFixture("status-file.valid.yaml");
    const parsed = statusFileSchema.parse(data);
    assert.equal(parsed.task, "META-001");
    assert.equal(parsed.phases.length, 2);
    assert.equal(parsed.phases[0]!.status, "done");
    assert.equal(parsed.phases[1]!.status, "test-writing");
    assert.equal(parsed.phases[0]!.critic_state.resolved_issues.length, 1);
  });

  it("rejects the invalid fixture with path including phases.0.status", () => {
    const data = loadFixture("status-file.invalid.yaml");
    const result = statusFileSchema.safeParse(data);
    assert.equal(result.success, false);
    if (!result.success) {
      const paths = zodErrorPaths(result.error);
      assert.ok(
        paths.includes("phases.0.status"),
        `expected path 'phases.0.status' in ${paths.join(",")}`,
      );
    }
  });
});

describe("criticOutputSchema", () => {
  it("parses the valid fixture", () => {
    const data = loadFixture("critic-output.valid.yaml");
    const parsed = criticOutputSchema.parse(data);
    assert.equal(parsed.checklist_results.length, 2);
    assert.equal(parsed.issues.length, 1);
    assert.equal(parsed.issues[0]!.severity, "LOW");
    assert.equal(parsed.remaining_actionable_issues, "NONE");
    assert.equal(parsed.frame_concerns, "NONE");
  });

  it("accepts an issue-id array for remaining_actionable_issues", () => {
    const parsed = criticOutputSchema.parse({
      checklist_results: [],
      issues: [
        { id: "foo", severity: "HIGH", summary: "bar", evidence: "x:1" },
      ],
      remaining_actionable_issues: ["foo"],
      frame_concerns: [],
    });
    assert.deepEqual(parsed.remaining_actionable_issues, ["foo"]);
    assert.deepEqual(parsed.frame_concerns, []);
  });

  it("rejects the invalid fixture with path=issues.0.severity", () => {
    const data = loadFixture("critic-output.invalid.yaml");
    const result = criticOutputSchema.safeParse(data);
    assert.equal(result.success, false);
    if (!result.success) {
      const paths = zodErrorPaths(result.error);
      assert.ok(
        paths.includes("issues.0.severity"),
        `expected path 'issues.0.severity' in ${paths.join(",")}`,
      );
    }
  });
});

describe("coverageOutputSchema", () => {
  it("parses the valid fixture", () => {
    const data = loadFixture("coverage-output.valid.yaml");
    const parsed = coverageOutputSchema.parse(data);
    assert.equal(parsed.coverage.length, 3);
    assert.equal(parsed.coverage[0]!.status, "full");
    assert.equal(parsed.coverage[2]!.status, "missing");
    assert.equal(parsed.gaps_found, true);
  });

  it("rejects the invalid fixture with path=coverage.0.status", () => {
    const data = loadFixture("coverage-output.invalid.yaml");
    const result = coverageOutputSchema.safeParse(data);
    assert.equal(result.success, false);
    if (!result.success) {
      const paths = zodErrorPaths(result.error);
      assert.ok(
        paths.includes("coverage.0.status"),
        `expected path 'coverage.0.status' in ${paths.join(",")}`,
      );
    }
  });
});
