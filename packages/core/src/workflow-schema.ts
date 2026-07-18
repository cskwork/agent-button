import { z } from "zod";
import {
  ExecutionSchema,
  InputsSchema,
  TriggerSchema,
  OutputsSchema,
  SuccessSchema,
} from "./button-schema.ts";

/** Workflow inputs allow enum shorthand: `type: enum` + `values`. */
const WorkflowInputSchema = z.object({
  type: z.enum(["string", "number", "boolean", "enum"]).default("string"),
  values: z.array(z.string()).optional(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  description: z.string().optional(),
  required: z.boolean().default(false),
});

const stepBase = {
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  when: z.string().optional(),
};

export const CommandStepSchema = z.object({
  ...stepBase,
  type: z.literal("command"),
  executable: z.string().min(1),
  args: z.array(z.string()).default([]),
  cwd: z.string().optional(),
  env: z.record(z.string()).default({}),
  save_stdout_as: z.string().optional(),
  idempotency_key: z.string().optional(),
  timeout_seconds: z.number().int().positive().default(600),
  assertions: z
    .object({
      stdout_empty: z.boolean().optional(),
      exit_code: z.number().int().optional(),
      stdout_matches: z.string().optional(),
    })
    .optional(),
});

export const AgentStepSchema = z.object({
  ...stepBase,
  type: z.literal("agent"),
  adapter: z.string().min(1),
  profile: z.string().default("default"),
  model: z.string().optional(),
  capability_profile: z.string().optional(),
  cwd: z.string().optional(),
  prompt: z.string().min(1),
  result_schema: z.record(z.unknown()).optional(),
  save_result_as: z.string().optional(),
  timeout_seconds: z.number().int().positive().default(1800),
});

export const ApprovalStepSchema = z.object({
  ...stepBase,
  type: z.literal("approval"),
  display: z.object({
    title: z.string().min(1),
    fields: z.array(z.string()).default([]),
  }),
  timeout_seconds: z.number().int().positive().default(86400),
});

export const AssertionStepSchema = z.object({
  ...stepBase,
  type: z.literal("assertion"),
  require: z.array(z.string()).min(1),
});

export const HttpStepSchema = z.object({
  ...stepBase,
  type: z.literal("http"),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
  url: z.string().min(1),
  headers: z.record(z.string()).default({}),
  body: z.unknown().optional(),
  expect_status: z.array(z.number().int()).default([200, 201, 204]),
  save_response_as: z.string().optional(),
  timeout_seconds: z.number().int().positive().default(120),
});

/** Deterministic Jenkins adapter: trigger a parameterized build via REST. */
export const JenkinsStepSchema = z.object({
  ...stepBase,
  type: z.literal("jenkins"),
  base_url: z.string().min(1),
  job: z.string().min(1),
  parameters: z.record(z.string()).default({}),
  credential: z.string().optional(),
});

export const JenkinsWaitStepSchema = z.object({
  ...stepBase,
  type: z.literal("jenkins-wait"),
  base_url: z.string().min(1),
  build: z.string().min(1),
  credential: z.string().optional(),
  timeout_seconds: z.number().int().positive().default(1800),
  poll_seconds: z.number().int().positive().default(15),
});

export const WorkflowStepSchema = z.discriminatedUnion("type", [
  CommandStepSchema,
  AgentStepSchema,
  ApprovalStepSchema,
  AssertionStepSchema,
  HttpStepSchema,
  JenkinsStepSchema,
  JenkinsWaitStepSchema,
]);

export const WorkflowSchema = z.object({
  version: z.literal(1),
  kind: z.literal("workflow"),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  label: z.string().min(1),
  description: z.string().default(""),
  icon: z.string().optional(),
  group: z.string().default("Default"),
  shortcut: z.string().regex(/^[0-9]$/).optional(),
  pinned: z.boolean().default(false),
  risk: z.enum(["read-only", "local-write", "external-write", "high"]).default("local-write"),
  inputs: z.record(WorkflowInputSchema).default({}),
  steps: z.array(WorkflowStepSchema).min(1),
  execution: ExecutionSchema.default({}),
  trigger: TriggerSchema.default({ type: "manual" }),
  outputs: OutputsSchema.default({ collect: [] }),
  success: SuccessSchema.default({ require_artifact: [] }),
});

export type Workflow = z.infer<typeof WorkflowSchema>;
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;
export type CommandStep = z.infer<typeof CommandStepSchema>;
export type AgentStep = z.infer<typeof AgentStepSchema>;
export type ApprovalStep = z.infer<typeof ApprovalStepSchema>;
export type AssertionStep = z.infer<typeof AssertionStepSchema>;
export type HttpStep = z.infer<typeof HttpStepSchema>;
export type JenkinsStep = z.infer<typeof JenkinsStepSchema>;
export type JenkinsWaitStep = z.infer<typeof JenkinsWaitStepSchema>;

// Late import to avoid a cycle: InputsSchema lives in button-schema.
export { InputsSchema };

import { AgentButtonSchema } from "./button-schema.ts";

export const ButtonDefinitionSchema = z.discriminatedUnion("kind", [
  AgentButtonSchema,
  WorkflowSchema,
]);

export type ButtonDefinition = z.infer<typeof ButtonDefinitionSchema>;
