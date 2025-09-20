import { useCallback, useEffect, useState } from "react";

import type { AgentConfig } from "@/agent-config";

interface AgentConfigResponse {
  config: AgentConfig;
  defaults: AgentConfig;
  allowedModels: string[];
}

interface UseAgentConfigState {
  config: AgentConfig | null;
  defaults: AgentConfig | null;
  allowedModels: string[];
  isLoading: boolean;
  error: string | null;
  isSaving: boolean;
  saveError: string | null;
  lastSavedAt: string | null;
}

export type AgentConfigUpdate = Partial<
  Pick<AgentConfig, "systemPrompt" | "modelId" | "temperature" | "maxSteps">
>;

export function useAgentConfig() {
  const [state, setState] = useState<UseAgentConfigState>({
    config: null,
    defaults: null,
    allowedModels: [],
    isLoading: false,
    error: null,
    isSaving: false,
    saveError: null,
    lastSavedAt: null
  });

  const fetchConfig = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const response = await fetch("/api/agent-config");
      if (!response.ok) {
        throw new Error(`Failed to load config (status ${response.status})`);
      }
      const data = (await response.json()) as AgentConfigResponse;
      setState((prev) => ({
        ...prev,
        config: data.config,
        defaults: data.defaults,
        allowedModels: data.allowedModels,
        isLoading: false,
        error: null,
        lastSavedAt: data.config.updatedAt
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
    fetchConfig();
  }, [fetchConfig]);

  const updateConfig = useCallback(async (update: AgentConfigUpdate) => {
    setState((prev) => ({ ...prev, isSaving: true, saveError: null }));
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
      const data = (await response.json()) as { config: AgentConfig };
      setState((prev) => ({
        ...prev,
        config: data.config,
        isSaving: false,
        saveError: null,
        lastSavedAt: data.config.updatedAt
      }));
      return data.config;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setState((prev) => ({
        ...prev,
        isSaving: false,
        saveError: message
      }));
      throw error;
    }
  }, []);

  const resetConfig = useCallback(async () => {
    setState((prev) => ({ ...prev, isSaving: true, saveError: null }));
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
      const data = (await response.json()) as { config: AgentConfig };
      setState((prev) => ({
        ...prev,
        config: data.config,
        isSaving: false,
        saveError: null,
        lastSavedAt: data.config.updatedAt
      }));
      return data.config;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setState((prev) => ({
        ...prev,
        isSaving: false,
        saveError: message
      }));
      throw error;
    }
  }, []);

  return {
    ...state,
    refresh: fetchConfig,
    updateConfig,
    resetConfig
  };
}
