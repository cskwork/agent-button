import { z } from "zod";

/** Shared identity fields for both button kinds. */
const identityFields = {
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "id must be kebab-case"),
  label: z.string().min(1),
  description: z.string().default(""),
  icon: z.string().optional(),
  group: z.string().default("Default"),
  shortcut: z.string().regex(/^[0-9]$/).optional(),
  pinned: z.boolean().default(false),
};

export const AgentSpecSchema = z.object({
  adapter: z.string().min(1),
  profile: z.string().default("default"),
  model: z.string().optional(),
  inherit_native_config: z.boolean().default(true),
});

export const WorkspaceSchema = z.object({
  cwd: z.string().default("~"),
  isolation: z.enum(["host-process"]).default("host-process"),
});

/** Prompt input declaration: a narrow JSON-schema subset, enough for forms. */
export const InputPropertySchema = z.object({
  type: z.enum(["string", "number", "boolean", "enum"]).default("string"),
  values: z.array(z.string()).optional(),
  format: z.string().optional(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  description: z.string().optional(),
  required: z.boolean().default(false),
});

export const InputsSchema = z.object({
  type: z.literal("object").default("object"),
  properties: z.record(InputPropertySchema).default({}),
});

export const CapabilitiesSchema = z.object({
  mode: z.enum(["inherit", "overlay", "isolated"]).default("inherit"),
  skills: z.union([z.object({ mode: z.string() }), z.array(z.string())]).optional(),
  mcp: z.union([z.object({ mode: z.string() }), z.array(z.string())]).optional(),
  tools: z.array(z.string()).default([]),
  environment: z.record(z.string()).default({}),
});

export const PermissionsSchema = z.object({
  filesystem: z
    .object({
      read: z.array(z.string()).default([]),
      write: z.array(z.string()).default([]),
    })
    .default({ read: [], write: [] }),
  network: z.object({ allow: z.array(z.string()).default([]) }).default({ allow: [] }),
  commands: z.object({ policy: z.enum(["agent-native", "deny"]).default("agent-native") }).default({ policy: "agent-native" }),
  external_side_effects: z.enum(["allow", "confirm", "deny"]).default("confirm"),
});

export const ExecutionSchema = z.object({
  timeout_seconds: z.number().int().positive().default(1800),
  concurrency: z.enum(["reject", "queue", "replace", "parallel"]).default("reject"),
  resumable: z.boolean().default(false),
});

export const TriggerSchema = z.object({
  type: z.enum(["manual", "schedule"]).default("manual"),
  cron: z.string().optional(),
  timezone: z.string().optional(),
  missed_run_policy: z.enum(["skip", "run_once", "catch_up"]).default("skip"),
  overlap_policy: z.enum(["reject", "queue", "replace", "parallel"]).default("reject"),
});

export const OutputsSchema = z.object({
  collect: z.array(z.string()).default([]),
});

export const SuccessSchema = z.object({
  require_artifact: z.array(z.string()).default([]),
  require_agent_exit_code: z.number().int().optional(),
});

export const AgentButtonSchema = z.object({
  version: z.literal(1),
  kind: z.literal("agent-button"),
  ...identityFields,
  agent: AgentSpecSchema,
  workspace: WorkspaceSchema.default({ cwd: "~", isolation: "host-process" }),
  prompt: z.object({ template: z.string().min(1) }),
  inputs: InputsSchema.default({ type: "object", properties: {} }),
  capabilities: CapabilitiesSchema.default({}),
  permissions: PermissionsSchema.default({}),
  execution: ExecutionSchema.default({}),
  trigger: TriggerSchema.default({ type: "manual" }),
  outputs: OutputsSchema.default({ collect: [] }),
  success: SuccessSchema.default({ require_artifact: [] }),
});

export type AgentButton = z.infer<typeof AgentButtonSchema>;
export type ButtonTrigger = z.infer<typeof TriggerSchema>;
export type ButtonPermissions = z.infer<typeof PermissionsSchema>;
