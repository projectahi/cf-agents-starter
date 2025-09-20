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

export interface AgentConfig {
  systemPrompt: string;
  modelId: AgentModelId;
  temperature: number;
  maxSteps: number;
  updatedAt: string;
}

const DEFAULT_PROMPT = `You are a helpful assistant that can do various tasks...`;

const DEFAULT_CONFIG: AgentConfig = {
  systemPrompt: DEFAULT_PROMPT,
  modelId: ALLOWED_MODEL_IDS[0],
  temperature: 0.7,
  maxSteps: 10,
  updatedAt: new Date().toISOString()
};

const agentConfigSchema = z.object({
  systemPrompt: z.string().min(1, "System prompt is required"),
  modelId: z.string().min(1, "Model is required"),
  temperature: z.number().min(0).max(2),
  maxSteps: z.number().int().min(1).max(50)
});

const agentConfigUpdateSchema = agentConfigSchema.partial();

export type AgentConfigUpdateInput = Partial<z.infer<typeof agentConfigSchema>>;

let currentConfig: AgentConfig = DEFAULT_CONFIG;

export function getAgentConfig(): AgentConfig {
  return currentConfig;
}

export function updateAgentConfig(update: AgentConfigUpdateInput): AgentConfig {
  const parsed = agentConfigUpdateSchema.parse(update);
  currentConfig = {
    ...currentConfig,
    ...parsed,
    updatedAt: new Date().toISOString()
  };
  return currentConfig;
}

export function resetAgentConfig(): AgentConfig {
  currentConfig = {
    ...DEFAULT_CONFIG,
    updatedAt: new Date().toISOString()
  };
  return currentConfig;
}

export const agentConfigValidators = {
  full: agentConfigSchema,
  update: agentConfigUpdateSchema
};

export const defaultAgentConfig = DEFAULT_CONFIG;
