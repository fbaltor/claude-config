import { z } from "zod";

export const phaseTypeSchema = z.enum(["code", "docs", "research", "config", "mixed"]);

export const phaseInputsSchema = z.object({
  code: z.array(z.string()).default([]),
  docs_for_testing: z.array(z.string()).default([]),
  docs_for_impl: z.array(z.string()).default([]),
});

export const phaseCriticSchema = z.object({
  subagent_type: z.string().min(1),
  checklist: z.array(z.string()).default([]),
  frame_break_probe: z.string().default(""),
});

export const phaseContractSchema = z
  .object({
    id: z.string().min(1),
    type: phaseTypeSchema,
    tdd: z.boolean(),
    tdd_skip_reason: z.string().optional(),
    objective: z.string().min(1),
    behavior_spec: z.array(z.string()).default([]),
    inputs: phaseInputsSchema,
    exit_criteria: z.array(z.string()).default([]),
    out_of_scope: z.array(z.string()).default([]),
    critic: phaseCriticSchema,
    contract_confirmed: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.type === "code" && value.tdd === false && !value.tdd_skip_reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tdd_skip_reason"],
        message: "tdd_skip_reason is required when type=code and tdd=false",
      });
    }
  });

export type PhaseContract = z.infer<typeof phaseContractSchema>;
export type PhaseType = z.infer<typeof phaseTypeSchema>;
