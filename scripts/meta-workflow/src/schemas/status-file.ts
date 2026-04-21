import { z } from "zod";

export const phaseStatusEnum = z.enum([
  "not-started",
  "test-writing",
  "coverage-verifying",
  "implementing",
  "critiquing",
  "done",
]);

export const stageStatusEnum = z.enum(["not-started", "in-progress", "done"]);

export const criticIssueRefSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
  summary: z.string().default(""),
});

export const resolvedIssueSchema = z.object({
  id: z.string().min(1),
  fixed_in_commit: z.string().default(""),
});

export const criticStateSchema = z.object({
  iteration: z.number().int().min(0).default(0),
  pending_issues: z.array(criticIssueRefSchema).default([]),
  resolved_issues: z.array(resolvedIssueSchema).default([]),
});

export const phaseStatusEntrySchema = z.object({
  id: z.string().min(1),
  status: phaseStatusEnum,
  contract_confirmed: z.boolean().default(false),
  stages: z.record(stageStatusEnum).default({}),
  critic_state: criticStateSchema.default({
    iteration: 0,
    pending_issues: [],
    resolved_issues: [],
  }),
  artifacts: z.record(z.string()).default({}),
});

export const statusFileSchema = z.object({
  task: z.string().default(""),
  plan_doc: z.string().min(1),
  research_doc: z.string().default(""),
  phases: z.array(phaseStatusEntrySchema).default([]),
});

export type StatusFile = z.infer<typeof statusFileSchema>;
export type PhaseStatusEntry = z.infer<typeof phaseStatusEntrySchema>;
export type PhaseStatus = z.infer<typeof phaseStatusEnum>;
export type StageStatus = z.infer<typeof stageStatusEnum>;
export type CriticState = z.infer<typeof criticStateSchema>;
