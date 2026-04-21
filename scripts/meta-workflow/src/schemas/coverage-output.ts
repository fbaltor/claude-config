import { z } from "zod";

export const coverageStatusEnum = z.enum(["full", "partial", "missing"]);

export const coverageEntrySchema = z.object({
  behavior: z.string().min(1),
  status: coverageStatusEnum,
  evidence: z.string().default(""),
  gap: z.string().optional(),
});

export const coverageOutputSchema = z.object({
  coverage: z.array(coverageEntrySchema).default([]),
  gaps_found: z.boolean(),
});

export type CoverageOutput = z.infer<typeof coverageOutputSchema>;
export type CoverageEntry = z.infer<typeof coverageEntrySchema>;
export type CoverageStatus = z.infer<typeof coverageStatusEnum>;
