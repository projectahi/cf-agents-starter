import { useCallback, useEffect, useState } from "react";

import type {
  AgentConfig,
  AgentProfile,
  AgentProfileInput,
  AgentProfileUpdateInput
} from "@/agent-config";

interface AgentsIndexResponse {
  agents: AgentProfile[];
  activeAgentId: string | null;
  activeAgent: AgentProfile | null;
  activeAgentEffectiveToolNames?: string[];
  activeAgentToolPrompt?: string;
  allowedModels: string[];
  defaults: AgentProfile;
}

interface AgentConfigResponse {
  agent: AgentProfile;
  config: AgentConfig;
  effectiveToolNames?: string[];
  toolPrompt?: string;
}

interface AgentCreateResponse {
  agent: AgentProfile;
  activeAgentId: string | null;
  activeAgent: AgentProfile | null;
  activeAgentEffectiveToolNames?: string[];
  activeAgentToolPrompt?: string;
}

interface AgentUpdateResponse {
  agent: AgentProfile;
  activeAgentId: string | null;
  activeAgent: AgentProfile | null;
  activeAgentEffectiveToolNames?: string[];
  activeAgentToolPrompt?: string;
}

interface AgentDeleteResponse {
  removed: string;
  activeAgentId: string | null;
  activeAgent: AgentProfile | null;
  activeAgentEffectiveToolNames?: string[];
  activeAgentToolPrompt?: string;
}

interface AgentSelectResponse {
  agent: AgentProfile;
  activeAgentId: string | null;
  activeAgentEffectiveToolNames?: string[];
  activeAgentToolPrompt?: string;
}

export type AgentConfigUpdate = Partial<
  Pick<AgentConfig, "systemPrompt" | "modelId" | "temperature" | "maxSteps">
>;

export type CreateAgentInput = AgentProfileInput & { setActive?: boolean };
export type UpdateAgentInput = AgentProfileUpdateInput;

interface UseAgentConfigState {
  agents: AgentProfile[];
  activeAgent: AgentProfile | null;
  defaultsProfile: AgentProfile | null;
  allowedModels: string[];
  isLoading: boolean;
  error: string | null;
  isSavingConfig: boolean;
  configError: string | null;
  agentActionPending: boolean;
  agentActionError: string | null;
  lastSavedAt: string | null;
  effectiveToolNames: string[];
  toolPrompt: string;
}

function sortAgents(list: AgentProfile[]): AgentProfile[] {
  return [...list].sort((a, b) => {
    const aTime = Date.parse(a.createdAt);
    const bTime = Date.parse(b.createdAt);
    return aTime - bTime;
  });
}

function upsertAgent(
  list: AgentProfile[],
  agent: AgentProfile
): AgentProfile[] {
  const index = list.findIndex((item) => item.id === agent.id);
  if (index === -1) {
    return sortAgents([...list, agent]);
  }
  const next = [...list];
  next[index] = agent;
  return sortAgents(next);
}

function removeAgent(list: AgentProfile[], agentId: string): AgentProfile[] {
  return list.filter((agent) => agent.id !== agentId);
}

export function useAgentConfig() {
  const [state, setState] = useState<UseAgentConfigState>({
    agents: [],
    activeAgent: null,
    defaultsProfile: null,
    allowedModels: [],
    isLoading: false,
    error: null,
    isSavingConfig: false,
    configError: null,
    agentActionPending: false,
    agentActionError: null,
    lastSavedAt: null,
    effectiveToolNames: [],
    toolPrompt: ""
  });

  const fetchAgents = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const response = await fetch("/api/agents");
      if (!response.ok) {
        throw new Error(`Failed to load agents (status ${response.status})`);
      }
      const data = (await response.json()) as AgentsIndexResponse;
      const activeAgent = data.activeAgent ?? null;
      setState((prev) => ({
        ...prev,
        agents: sortAgents(data.agents),
        activeAgent,
        defaultsProfile: data.defaults,
        allowedModels: data.allowedModels,
        isLoading: false,
        error: null,
        lastSavedAt: activeAgent?.config.updatedAt ?? null,
        effectiveToolNames: data.activeAgentEffectiveToolNames ?? [],
        toolPrompt: data.activeAgentToolPrompt ?? ""
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    }
  }, []);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  const updateConfig = useCallback(async (update: AgentConfigUpdate) => {
    setState((prev) => ({ ...prev, isSavingConfig: true, configError: null }));
    try {
      const response = await fetch("/api/agent-config", {
        method: "PATCH",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(update)
      });
      if (!response.ok) {
        const errorBody = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          errorBody.error ?? `Failed to save config (status ${response.status})`
        );
      }
      const data = (await response.json()) as AgentConfigResponse;
      setState((prev) => ({
        ...prev,
        agents: upsertAgent(prev.agents, data.agent),
        activeAgent: data.agent,
        isSavingConfig: false,
        configError: null,
        lastSavedAt: data.config.updatedAt,
        effectiveToolNames: data.effectiveToolNames ?? prev.effectiveToolNames,
        toolPrompt: data.toolPrompt ?? prev.toolPrompt
      }));
      return data.config;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setState((prev) => ({
        ...prev,
        isSavingConfig: false,
        configError: message
      }));
      throw error;
    }
  }, []);

  const resetConfig = useCallback(async () => {
    setState((prev) => ({ ...prev, isSavingConfig: true, configError: null }));
    try {
      const response = await fetch("/api/agent-config", {
        method: "DELETE",
        headers: {
          "cf-agent-config-reset": "confirm"
        }
      });
      if (!response.ok) {
        const errorBody = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          errorBody.error ??
            `Failed to reset config (status ${response.status})`
        );
      }
      const data = (await response.json()) as AgentConfigResponse;
      setState((prev) => ({
        ...prev,
        agents: upsertAgent(prev.agents, data.agent),
        activeAgent: data.agent,
        isSavingConfig: false,
        configError: null,
        lastSavedAt: data.config.updatedAt,
        effectiveToolNames: data.effectiveToolNames ?? prev.effectiveToolNames,
        toolPrompt: data.toolPrompt ?? prev.toolPrompt
      }));
      return data.config;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setState((prev) => ({
        ...prev,
        isSavingConfig: false,
        configError: message
      }));
      throw error;
    }
  }, []);

  const handleAgentSuccess = useCallback(
    (
      response:
        | AgentCreateResponse
        | AgentUpdateResponse
        | AgentDeleteResponse
        | AgentSelectResponse,
      options?: { removedId?: string }
    ) => {
      setState((prev) => {
        let nextAgents = prev.agents;
        if ("agent" in response && response.agent) {
          nextAgents = upsertAgent(nextAgents, response.agent);
        }
        if ("activeAgent" in response && response.activeAgent) {
          nextAgents = upsertAgent(nextAgents, response.activeAgent);
        }
        if (options?.removedId) {
          nextAgents = removeAgent(nextAgents, options.removedId);
        }

        const nextActive =
          ("activeAgent" in response ? response.activeAgent : undefined) ??
          ("agent" in response ? response.agent : undefined) ??
          prev.activeAgent;

        return {
          ...prev,
          agents: sortAgents(nextAgents),
          activeAgent: nextActive,
          agentActionPending: false,
          agentActionError: null,
          lastSavedAt: nextActive?.config.updatedAt ?? prev.lastSavedAt,
          effectiveToolNames:
            response.activeAgentEffectiveToolNames ?? prev.effectiveToolNames,
          toolPrompt: response.activeAgentToolPrompt ?? prev.toolPrompt
        };
      });
    },
    []
  );

  const createAgent = useCallback(
    async (input: CreateAgentInput) => {
      setState((prev) => ({
        ...prev,
        agentActionPending: true,
        agentActionError: null
      }));
      try {
        const response = await fetch("/api/agents", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify(input)
        });
        if (!response.ok) {
          const errorBody = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(
            errorBody.error ??
              `Failed to create agent (status ${response.status})`
          );
        }
        const data = (await response.json()) as AgentCreateResponse;
        handleAgentSuccess(data);
        return data.agent;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setState((prev) => ({
          ...prev,
          agentActionPending: false,
          agentActionError: message
        }));
        throw error;
      }
    },
    [handleAgentSuccess]
  );

  const updateAgent = useCallback(
    async (agentId: string, update: UpdateAgentInput) => {
      setState((prev) => ({
        ...prev,
        agentActionPending: true,
        agentActionError: null
      }));
      try {
        const response = await fetch(
          `/api/agents/${encodeURIComponent(agentId)}`,
          {
            method: "PATCH",
            headers: {
              "content-type": "application/json"
            },
            body: JSON.stringify(update)
          }
        );
        if (!response.ok) {
          const errorBody = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(
            errorBody.error ??
              `Failed to update agent (status ${response.status})`
          );
        }
        const data = (await response.json()) as AgentUpdateResponse;
        handleAgentSuccess(data);
        return data.agent;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setState((prev) => ({
          ...prev,
          agentActionPending: false,
          agentActionError: message
        }));
        throw error;
      }
    },
    [handleAgentSuccess]
  );

  const deleteAgent = useCallback(
    async (agentId: string) => {
      setState((prev) => ({
        ...prev,
        agentActionPending: true,
        agentActionError: null
      }));
      try {
        const response = await fetch(
          `/api/agents/${encodeURIComponent(agentId)}`,
          {
            method: "DELETE"
          }
        );
        if (!response.ok) {
          const errorBody = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(
            errorBody.error ??
              `Failed to delete agent (status ${response.status})`
          );
        }
        const data = (await response.json()) as AgentDeleteResponse;
        handleAgentSuccess(data, { removedId: agentId });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setState((prev) => ({
          ...prev,
          agentActionPending: false,
          agentActionError: message
        }));
        throw error;
      }
    },
    [handleAgentSuccess]
  );

  const selectAgent = useCallback(
    async (agentId: string) => {
      setState((prev) => ({
        ...prev,
        agentActionPending: true,
        agentActionError: null
      }));
      try {
        const response = await fetch(
          `/api/agents/${encodeURIComponent(agentId)}/select`,
          {
            method: "POST"
          }
        );
        if (!response.ok) {
          const errorBody = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(
            errorBody.error ??
              `Failed to select agent (status ${response.status})`
          );
        }
        const data = (await response.json()) as AgentSelectResponse;
        handleAgentSuccess(data);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setState((prev) => ({
          ...prev,
          agentActionPending: false,
          agentActionError: message
        }));
        throw error;
      }
    },
    [handleAgentSuccess]
  );

  return {
    agents: state.agents,
    activeAgent: state.activeAgent,
    config: state.activeAgent?.config ?? null,
    defaults: state.defaultsProfile?.config ?? null,
    defaultProfile: state.defaultsProfile,
    allowedModels: state.allowedModels,
    effectiveToolNames: state.effectiveToolNames,
    toolPrompt: state.toolPrompt,
    isLoading: state.isLoading,
    error: state.error,
    isSaving: state.isSavingConfig,
    saveError: state.configError,
    agentActionPending: state.agentActionPending,
    agentActionError: state.agentActionError,
    lastSavedAt: state.lastSavedAt,
    refresh: fetchAgents,
    updateConfig,
    resetConfig,
    createAgent,
    updateAgent,
    deleteAgent,
    selectAgent
  };
}
