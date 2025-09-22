// Approval string to be shared across frontend and backend
export const APPROVAL = {
  YES: "Yes, confirmed.",
  NO: "No, denied."
} as const;

export type AgentSource = "active" | "handoff";

export interface RespondingAgentMetadata {
  id: string;
  name: string;
  source: AgentSource;
  orchestratorId: string;
  orchestratorName: string;
  reason: string | null;
}

export interface ChatMessageMetadata {
  createdAt?: string;
  respondingAgent?: RespondingAgentMetadata;
}
