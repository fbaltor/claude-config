import { z } from "zod";

export const severityEnum = z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);

export const checklistResultEnum = z.enum(["PASS", "FAIL", "UNCLEAR"]);

export const checklistResultSchema = z.object({
  item: z.string().min(1),
  result: checklistResultEnum,
  evidence: z.string().default(""),
});

export const criticIssueSchema = z.object({
  id: z.string().min(1),
  severity: severityEnum,
  summary: z.string().min(1),
  evidence: z.string().default(""),
  suggested_fix: z.string().optional(),
});

const noneLiteral = z.literal("NONE");

export const remainingIssuesSchema = z.union([z.array(z.string()), noneLiteral]);
export const frameConcernsSchema = z.union([z.array(z.string()), noneLiteral]);

export const criticOutputSchema = z.object({
  checklist_results: z.array(checklistResultSchema).default([]),
  issues: z.array(criticIssueSchema).default([]),
  remaining_actionable_issues: remainingIssuesSchema,
  frame_concerns: frameConcernsSchema,
});

export type CriticOutput = z.infer<typeof criticOutputSchema>;
export type CriticIssue = z.infer<typeof criticIssueSchema>;
export type Severity = z.infer<typeof severityEnum>;
export type ChecklistResult = z.infer<typeof checklistResultSchema>;
