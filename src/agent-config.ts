import { z } from "zod";

export const ALLOWED_MODEL_IDS = [
  "gpt-5-mini",
  "gpt-5",
  "gpt-5-nano",
  "gpt-5-chat-latest",
  "gpt-4o-2024-11-20",
  "gpt-4.1-mini",
  "gpt-4.1",
  "gpt-4o-mini-2024-11-20",
  "gpt-3.5-turbo"
] as const;

export type AgentModelId = (typeof ALLOWED_MODEL_IDS)[number] | string;

const DEFAULT_PROMPT = `You are a helpful assistant that can do various tasks...`;

const agentConfigCoreSchema = z.object({
  systemPrompt: z.string().min(1, "System prompt is required"),
  modelId: z.string().min(1, "Model is required"),
  temperature: z.number().min(0).max(2),
  maxSteps: z.number().int().min(1).max(50)
});

export const agentConfigSchema = agentConfigCoreSchema.extend({
  updatedAt: z
    .string()
    .datetime({ message: "updatedAt must be an ISO timestamp" })
});

export const agentConfigUpdateSchema = agentConfigCoreSchema.partial();

export type AgentConfig = z.infer<typeof agentConfigSchema>;
export type AgentConfigUpdateInput = z.infer<typeof agentConfigUpdateSchema>;

export const agentProfileSchema = z.object({
  id: z.string().min(1, "Agent id is required"),
  name: z.string().min(1, "Agent name is required"),
  behavior: z.string().min(1, "Agent behavior is required"),
  config: agentConfigSchema,
  toolNames: z.array(z.string().min(1)).nullable().default(null),
  createdAt: z
    .string()
    .datetime({ message: "createdAt must be an ISO timestamp" }),
  updatedAt: z
    .string()
    .datetime({ message: "updatedAt must be an ISO timestamp" })
});

export type AgentProfile = z.infer<typeof agentProfileSchema>;

const agentProfileInputSchema = z.object({
  name: z.string().min(1, "Agent name is required"),
  behavior: z.string().min(1, "Agent behavior is required"),
  config: agentConfigUpdateSchema.optional(),
  toolNames: z.array(z.string().min(1)).nullable().optional()
});

const agentProfileUpdateSchema = z.object({
  name: z.string().min(1, "Agent name is required").optional(),
  behavior: z.string().min(1, "Agent behavior is required").optional(),
  config: agentConfigUpdateSchema.optional(),
  toolNames: z.array(z.string().min(1)).nullable().optional()
});

export type AgentProfileInput = z.infer<typeof agentProfileInputSchema>;
export type AgentProfileUpdateInput = z.infer<typeof agentProfileUpdateSchema>;

export const agentConfigValidators = {
  full: agentConfigSchema,
  update: agentConfigUpdateSchema
};

export const agentProfileValidators = {
  full: agentProfileSchema,
  create: agentProfileInputSchema,
  update: agentProfileUpdateSchema
};

export function createAgentConfig(
  overrides: Partial<Omit<AgentConfig, "updatedAt">> & {
    updatedAt?: string;
  } = {}
): AgentConfig {
  const now = overrides.updatedAt ?? new Date().toISOString();
  const base = {
    systemPrompt: DEFAULT_PROMPT,
    modelId: ALLOWED_MODEL_IDS[0],
    temperature: 0.7,
    maxSteps: 10
  } satisfies Omit<AgentConfig, "updatedAt">;
  const merged = {
    ...base,
    ...overrides
  } satisfies Omit<AgentConfig, "updatedAt">;
  return agentConfigSchema.parse({
    ...merged,
    updatedAt: now
  });
}

export function createAgentProfile(
  input: AgentProfileInput & { id: string }
): AgentProfile {
  const now = new Date().toISOString();
  const configInput = agentConfigUpdateSchema.parse(input.config ?? {});
  const config = createAgentConfig(configInput);
  return agentProfileSchema.parse({
    id: input.id,
    name: input.name,
    behavior: input.behavior,
    config,
    toolNames: input.toolNames ?? null,
    createdAt: now,
    updatedAt: now
  });
}

export function mergeAgentProfile(
  profile: AgentProfile,
  update: AgentProfileUpdateInput
): AgentProfile {
  const configUpdate = update.config
    ? agentConfigUpdateSchema.parse(update.config)
    : undefined;
  const mergedConfig = configUpdate
    ? agentConfigSchema.parse({
        ...profile.config,
        ...configUpdate,
        updatedAt: new Date().toISOString()
      })
    : profile.config;

  return agentProfileSchema.parse({
    ...profile,
    ...update,
    config: mergedConfig,
    toolNames:
      update.toolNames !== undefined
        ? (update.toolNames ?? null)
        : profile.toolNames,
    updatedAt: new Date().toISOString()
  });
}

export function createDefaultAgentProfile(): AgentProfile {
  return createAgentProfile({
    id: "default",
    name: "General Assistant",
    behavior: "Helpful general-purpose assistant",
    config: {},
    toolNames: null
  });
}

export const defaultAgentConfig = createAgentConfig();
