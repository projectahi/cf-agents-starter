import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from "react";

import { useAgent } from "agents/react";
import { useAgentChat } from "agents/ai-react";
import type { UIMessage } from "@ai-sdk/react";
import { ArrowLeft, PencilSimple, Plus } from "@phosphor-icons/react";

import { defaultAgentConfig, type AgentProfile } from "@/agent-config";
import { Button } from "@/components/button/Button";
import { Card } from "@/components/card/Card";
import { AgentChatWindow } from "@/components/agent-chat/AgentChatWindow";
import { Textarea } from "@/components/textarea/Textarea";
import {
  useAgentConfig,
  type AgentConfigUpdate,
  type CreateAgentInput,
  type UpdateAgentInput
} from "@/hooks/useAgentConfig";
import { useTools, type ToolListItem } from "@/hooks/useTools";
import type { McpConnector } from "@/hooks/useMcpConnectors";
import type { ChatMessageMetadata } from "@/shared";

function clampTemperature(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(2, Math.max(0, Number.parseFloat(value.toFixed(2))));
}

function clampMaxSteps(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(50, Math.max(1, Math.round(value)));
}

function arraysEqual(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const aSorted = [...a].sort();
  const bSorted = [...b].sort();
  return aSorted.every((value, index) => value === bSorted[index]);
}

function formatTime(date: Date) {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

interface AgentChatPreviewProps {
  agentKey: string | null;
  confirmationToolNames: Set<string>;
  disabled: boolean;
}

function AgentChatPreview({
  agentKey,
  confirmationToolNames,
  disabled
}: AgentChatPreviewProps) {
  const agent = useAgent({ agent: "chat" });
  const { messages, addToolResult, clearHistory, status, sendMessage, stop } =
    useAgentChat<unknown, UIMessage<ChatMessageMetadata>>({ agent });

  const previousAgentKeyRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (disabled) {
      previousAgentKeyRef.current = null;
      return;
    }

    if (previousAgentKeyRef.current !== agentKey) {
      clearHistory();
      previousAgentKeyRef.current = agentKey ?? null;
    }
  }, [agentKey, clearHistory, disabled]);

  const handleSendMessage = useCallback(
    async (text: string, _trigger: "submit" | "enter") => {
      await sendMessage({
        role: "user",
        parts: [{ type: "text", text }]
      });
    },
    [sendMessage]
  );

  const emptyState = disabled ? (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      <p>Save the agent first to start testing in chat.</p>
    </div>
  ) : (
    <div className="rounded-md border border-dashed border-border/70 bg-background p-4 text-sm text-muted-foreground">
      Start a conversation to see how this agent behaves with the current
      configuration.
    </div>
  );

  return (
    <Card className="flex h-full flex-col overflow-hidden border border-border/80">
      <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">Test this agent</h3>
          <p className="text-xs text-muted-foreground">
            Chat in real time to validate prompts, tools, and behaviors.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              clearHistory();
            }}
          >
            Clear
          </Button>
        </div>
      </div>

      <AgentChatWindow
        messages={messages}
        status={status}
        confirmationToolNames={confirmationToolNames}
        addToolResult={addToolResult}
        onSendMessage={handleSendMessage}
        onStop={stop}
        disabled={disabled}
        emptyState={emptyState}
        placeholder="Send a test message"
        disabledPlaceholder="Create this agent to start chatting"
        className="flex h-full flex-col"
        messagesContainerClassName="bg-background/60 px-4 py-4 space-y-4"
        composerClassName="border-t border-border/70 bg-background px-4 py-3"
        showAvatars={false}
      />
    </Card>
  );
}

interface AgentConfigPanelProps {
  mcpConnectors?: McpConnector[];
  isLoadingMcpConnectors?: boolean;
}

export function AgentConfigPanel({
  mcpConnectors = [],
  isLoadingMcpConnectors = false
}: AgentConfigPanelProps = {}) {
  const {
    agents,
    activeAgent,
    defaultProfile,
    allowedModels,
    error,
    isSaving,
    saveError,
    agentActionPending,
    agentActionError,
    lastSavedAt,
    refresh,
    updateConfig,
    resetConfig,
    createAgent,
    updateAgent,
    deleteAgent,
    selectAgent
  } = useAgentConfig();
  const {
    tools,
    isLoading: isToolsLoading,
    error: toolsError,
    confirmationToolNames
  } = useTools();

  const [view, setView] = useState<"list" | "edit">("list");
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [isDraftNew, setIsDraftNew] = useState(false);
  const [isSwitchingAgent, setIsSwitchingAgent] = useState(false);

  const [agentName, setAgentName] = useState("");
  const [agentBehavior, setAgentBehavior] = useState("");
  const [allowAllTools, setAllowAllTools] = useState(true);
  const [selectedToolNames, setSelectedToolNames] = useState<string[]>([]);
  const [selectedHandoffAgentIds, setSelectedHandoffAgentIds] = useState<
    string[]
  >([]);
  const [systemPrompt, setSystemPrompt] = useState(
    defaultAgentConfig.systemPrompt
  );
  const [modelId, setModelId] = useState(defaultAgentConfig.modelId);
  const [temperature, setTemperature] = useState(
    defaultAgentConfig.temperature
  );
  const [maxSteps, setMaxSteps] = useState(defaultAgentConfig.maxSteps);
  const [configSuccessMessage, setConfigSuccessMessage] = useState<
    string | null
  >(null);
  const [agentSuccessMessage, setAgentSuccessMessage] = useState<string | null>(
    null
  );
  const [newAgentSetActive, setNewAgentSetActive] = useState(true);

  const agentNameInputId = useId();
  const allowAllToolsId = useId();
  const agentBehaviorId = useId();
  const newAgentActiveId = useId();
  const modelInputId = useId();
  const modelListId = useId();
  const temperatureInputId = useId();
  const maxStepsInputId = useId();
  const systemPromptId = useId();

  const allToolNames = useMemo(
    () => tools.map((tool) => tool.name).sort(),
    [tools]
  );

  const connectorLookup = useMemo(() => {
    return new Map<string, McpConnector>(
      mcpConnectors.map((connector) => [connector.id, connector])
    );
  }, [mcpConnectors]);

  const toolGroups = useMemo(() => {
    const groups = new Map<
      string,
      { key: string; label: string; tools: ToolListItem[] }
    >();

    const sortedTools = [...tools].sort((a, b) => a.name.localeCompare(b.name));

    const getGroupForTool = (tool: ToolListItem) => {
      const origin = tool.origin;
      if (origin?.type === "mcp") {
        const serverId = String(origin.serverId);
        const connector = connectorLookup.get(serverId);
        const displayNameValue = connector?.metadata?.displayName;
        const displayName =
          typeof displayNameValue === "string" ? displayNameValue : serverId;
        const statusBase =
          typeof connector?.status === "string" ? connector.status : null;
        const status =
          statusBase && statusBase.length > 0
            ? ` (${statusBase.replace(/_/g, " ")})`
            : "";
        return {
          key: `mcp:${serverId}`,
          label: `MCP • ${displayName}${status}`
        };
      }
      if (origin?.type === "openapi") {
        const specName = origin.specName ?? "OpenAPI spec";
        return {
          key: `openapi:${specName}`,
          label: `OpenAPI • ${specName}`
        };
      }
      if (origin?.type === "manual" || tool.source === "builtin") {
        return {
          key: "builtin",
          label: "Built-in tools"
        };
      }
      return {
        key: "dynamic",
        label: "Dynamic tools"
      };
    };

    for (const tool of sortedTools) {
      const groupInfo = getGroupForTool(tool);
      if (!groups.has(groupInfo.key)) {
        groups.set(groupInfo.key, {
          key: groupInfo.key,
          label: groupInfo.label,
          tools: []
        });
      }
      groups.get(groupInfo.key)?.tools.push(tool);
    }

    return Array.from(groups.values()).sort((a, b) =>
      a.label.localeCompare(b.label)
    );
  }, [connectorLookup, tools]);

  const availableHandoffAgents = useMemo(() => {
    if (!agents || agents.length === 0) return [] as AgentProfile[];
    return agents
      .filter((agent) => agent.id !== editingAgentId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [agents, editingAgentId]);

  const handoffNameMap = useMemo(() => {
    const entries = agents.map((agent) => [agent.id, agent.name] as const);
    return new Map(entries);
  }, [agents]);

  const selectedHandoffNames = useMemo(
    () => selectedHandoffAgentIds.map((id) => handoffNameMap.get(id) ?? id),
    [handoffNameMap, selectedHandoffAgentIds]
  );

  const activeEditingAgent = useMemo(() => {
    if (isDraftNew || !editingAgentId) return null;
    if (activeAgent && activeAgent.id === editingAgentId) {
      return activeAgent;
    }
    return agents.find((agent) => agent.id === editingAgentId) ?? null;
  }, [activeAgent, agents, editingAgentId, isDraftNew]);

  const isBusy = isSaving || agentActionPending || isSwitchingAgent;

  const initializeFromAgent = useCallback(
    (profile: typeof activeAgent | null) => {
      if (!profile) {
        setAgentName("");
        setAgentBehavior("");
        setAllowAllTools(true);
        setSelectedToolNames([]);
        setSelectedHandoffAgentIds([]);
        const fallbackConfig = defaultProfile?.config ?? defaultAgentConfig;
        setSystemPrompt(fallbackConfig.systemPrompt);
        setModelId(fallbackConfig.modelId);
        setTemperature(clampTemperature(fallbackConfig.temperature));
        setMaxSteps(clampMaxSteps(fallbackConfig.maxSteps));
        return;
      }

      setAgentName(profile.name);
      setAgentBehavior(profile.behavior);
      if (profile.toolNames === null) {
        setAllowAllTools(true);
        setSelectedToolNames([]);
      } else {
        setAllowAllTools(false);
        setSelectedToolNames([...profile.toolNames]);
      }
      setSelectedHandoffAgentIds([...(profile.handoffAgentIds ?? [])].sort());
      setSystemPrompt(profile.config.systemPrompt);
      setModelId(profile.config.modelId);
      setTemperature(clampTemperature(profile.config.temperature));
      setMaxSteps(clampMaxSteps(profile.config.maxSteps));
    },
    [defaultProfile]
  );

  useEffect(() => {
    if (view !== "edit") return;

    if (isDraftNew) {
      initializeFromAgent(null);
      return;
    }

    if (editingAgentId && activeAgent && activeAgent.id === editingAgentId) {
      initializeFromAgent(activeAgent);
    }
  }, [view, isDraftNew, editingAgentId, activeAgent, initializeFromAgent]);

  useEffect(() => {
    if (saveError) {
      setConfigSuccessMessage(null);
    }
  }, [saveError]);

  useEffect(() => {
    if (agentActionError) {
      setAgentSuccessMessage(null);
    }
  }, [agentActionError]);

  useEffect(() => {
    setSelectedHandoffAgentIds((prev) => {
      if (prev.length === 0) return prev;
      const validIds = new Set(availableHandoffAgents.map((agent) => agent.id));
      const filtered = prev.filter((id) => validIds.has(id));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [availableHandoffAgents]);

  const hasProfileChanges = useMemo(() => {
    if (isDraftNew) return true;
    if (!activeEditingAgent) return false;
    const trimmedName = agentName.trim();
    const trimmedBehavior = agentBehavior.trim();
    if (activeEditingAgent.name !== trimmedName) return true;
    if (activeEditingAgent.behavior !== trimmedBehavior) return true;
    if (allowAllTools) {
      return activeEditingAgent.toolNames !== null;
    }
    const currentTools = activeEditingAgent.toolNames ?? [];
    if (activeEditingAgent.toolNames === null) return true;
    if (!arraysEqual(currentTools, selectedToolNames)) return true;
    const currentHandoffs = activeEditingAgent.handoffAgentIds ?? [];
    return !arraysEqual(currentHandoffs, selectedHandoffAgentIds);
  }, [
    activeEditingAgent,
    agentName,
    agentBehavior,
    allowAllTools,
    isDraftNew,
    selectedToolNames,
    selectedHandoffAgentIds
  ]);

  const hasConfigChanges = useMemo(() => {
    if (isDraftNew) return false;
    if (!activeEditingAgent) return false;
    const config = activeEditingAgent.config;
    if (config.systemPrompt !== systemPrompt) return true;
    if (config.modelId !== modelId) return true;
    if (config.temperature !== temperature) return true;
    if (config.maxSteps !== maxSteps) return true;
    return false;
  }, [
    activeEditingAgent,
    isDraftNew,
    modelId,
    maxSteps,
    systemPrompt,
    temperature
  ]);

  const openEditorForAgent = useCallback(
    async (agentId: string) => {
      setAgentSuccessMessage(null);
      setConfigSuccessMessage(null);
      setEditingAgentId(agentId);
      setIsDraftNew(false);
      setView("edit");

      if (activeAgent?.id === agentId) return;

      setIsSwitchingAgent(true);
      try {
        await selectAgent(agentId);
      } finally {
        setIsSwitchingAgent(false);
      }
    },
    [activeAgent?.id, selectAgent]
  );

  const openNewAgentForm = () => {
    setAgentSuccessMessage(null);
    setConfigSuccessMessage(null);
    setIsDraftNew(true);
    setEditingAgentId(null);
    setView("edit");
    initializeFromAgent(null);
  };

  const handleAllowAllToolsChange = (checked: boolean) => {
    setAgentSuccessMessage(null);
    setAllowAllTools(checked);
    if (!checked) {
      const fallback =
        activeEditingAgent && activeEditingAgent.toolNames !== null
          ? activeEditingAgent.toolNames
          : selectedToolNames.length > 0
            ? selectedToolNames
            : allToolNames;
      setSelectedToolNames([...fallback]);
    }
  };

  const handleSaveProfile = async () => {
    if (isDraftNew || !activeEditingAgent) return;
    const trimmedName = agentName.trim();
    const trimmedBehavior = agentBehavior.trim();
    if (!trimmedName || !trimmedBehavior) {
      window.alert("Agent name and behavior are required.");
      return;
    }

    if (!hasProfileChanges) {
      setAgentSuccessMessage("No changes to save.");
      return;
    }

    const update: UpdateAgentInput = {};
    if (activeEditingAgent.name !== trimmedName) {
      update.name = trimmedName;
    }
    if (activeEditingAgent.behavior !== trimmedBehavior) {
      update.behavior = trimmedBehavior;
    }
    if (allowAllTools) {
      if (activeEditingAgent.toolNames !== null) {
        update.toolNames = null;
      }
    } else {
      const normalizedTools = selectedToolNames;
      const currentTools = activeEditingAgent.toolNames ?? [];
      if (
        activeEditingAgent.toolNames === null ||
        !arraysEqual(currentTools, normalizedTools)
      ) {
        update.toolNames = normalizedTools;
      }
    }

    const currentHandoffs = activeEditingAgent.handoffAgentIds ?? [];
    if (!arraysEqual(currentHandoffs, selectedHandoffAgentIds)) {
      update.handoffAgentIds = selectedHandoffAgentIds;
    }

    try {
      await updateAgent(activeEditingAgent.id, update);
      setAgentSuccessMessage("Agent profile updated.");
    } catch (error) {
      console.error("Failed to update agent profile", error);
    }
  };

  const handleSaveConfig = async () => {
    if (isDraftNew || !activeEditingAgent) return;
    if (!hasConfigChanges) {
      setConfigSuccessMessage("No changes to save.");
      return;
    }

    const update: AgentConfigUpdate = {
      systemPrompt: systemPrompt.trim(),
      modelId: modelId.trim(),
      temperature: clampTemperature(temperature),
      maxSteps: clampMaxSteps(maxSteps)
    };

    try {
      await updateConfig(update);
      setConfigSuccessMessage("Configuration saved.");
    } catch (error) {
      console.error("Failed to update agent config", error);
    }
  };

  const handleResetConfig = async () => {
    if (isDraftNew) {
      const fallback = defaultProfile?.config ?? defaultAgentConfig;
      setSystemPrompt(fallback.systemPrompt);
      setModelId(fallback.modelId);
      setTemperature(clampTemperature(fallback.temperature));
      setMaxSteps(clampMaxSteps(fallback.maxSteps));
      setConfigSuccessMessage("Defaults restored.");
      return;
    }

    try {
      const config = await resetConfig();
      setSystemPrompt(config.systemPrompt);
      setModelId(config.modelId);
      setTemperature(clampTemperature(config.temperature));
      setMaxSteps(clampMaxSteps(config.maxSteps));
      setConfigSuccessMessage("Configuration reset to defaults.");
    } catch (error) {
      console.error("Failed to reset agent config", error);
    }
  };

  const handleCreateAgent = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = agentName.trim();
    const trimmedBehavior = agentBehavior.trim();
    if (!trimmedName || !trimmedBehavior) {
      window.alert("Agent name and behavior are required.");
      return;
    }

    const payload: CreateAgentInput = {
      name: trimmedName,
      behavior: trimmedBehavior,
      toolNames: allowAllTools ? null : selectedToolNames,
      handoffAgentIds: selectedHandoffAgentIds,
      config: {
        systemPrompt: systemPrompt.trim(),
        modelId: modelId.trim(),
        temperature: clampTemperature(temperature),
        maxSteps: clampMaxSteps(maxSteps)
      },
      setActive: newAgentSetActive
    };

    try {
      const created = await createAgent(payload);
      setAgentSuccessMessage(`Created agent "${created.name}".`);
      setIsDraftNew(false);
      setEditingAgentId(created.id);
      setNewAgentSetActive(true);
      setIsSwitchingAgent(true);
      try {
        await selectAgent(created.id);
      } finally {
        setIsSwitchingAgent(false);
      }
      await refresh();
    } catch (error) {
      console.error("Failed to create agent", error);
    }
  };

  const handleDeleteAgent = async (agentId: string, label: string) => {
    if (agents.length <= 1) {
      window.alert("At least one agent must remain. Add another agent first.");
      return;
    }
    const confirmed = window.confirm(
      `Remove ${label}? This agent will no longer be available.`
    );
    if (!confirmed) return;

    try {
      await deleteAgent(agentId);
      setAgentSuccessMessage("Agent removed.");
      setView("list");
      setEditingAgentId(null);
      setIsDraftNew(false);
    } catch (error) {
      console.error("Failed to delete agent", error);
    }
  };

  const handleBackToList = () => {
    setView("list");
    setEditingAgentId(null);
    setIsDraftNew(false);
    setAgentSuccessMessage(null);
    setConfigSuccessMessage(null);
  };

  if (view === "list") {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Agents</h2>
            <p className="text-sm text-muted-foreground">
              Review and open any agent to fine-tune settings or run a live
              chat.
            </p>
          </div>
          <Button variant="primary" onClick={openNewAgentForm}>
            <Plus size={16} />
            Add new agent
          </Button>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="space-y-2">
          {agents.map((agent) => (
            <Card
              key={agent.id}
              className="flex items-center justify-between border border-border/70 px-4 py-3"
            >
              <div>
                <div className="text-sm font-semibold">{agent.name}</div>
                <div className="text-xs text-muted-foreground">
                  {agent.behavior}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {activeAgent?.id === agent.id && (
                  <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                    Active
                  </span>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => openEditorForAgent(agent.id)}
                >
                  <PencilSimple size={16} />
                </Button>
              </div>
            </Card>
          ))}

          {agents.length === 0 && (
            <Card className="border border-dashed border-border/70 bg-background/60 p-4 text-sm text-muted-foreground">
              No agents yet. Create one to get started.
            </Card>
          )}
        </div>
      </div>
    );
  }

  const canDeleteAgents = agents.length > 1;
  const disableProfileSubmit =
    isBusy || (!isDraftNew && !hasProfileChanges) || (isDraftNew && isBusy);
  const disableConfigSubmit = isBusy || isDraftNew || !hasConfigChanges;
  const configLastSaved = lastSavedAt
    ? formatTime(new Date(lastSavedAt))
    : "Never";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={handleBackToList}>
          <ArrowLeft size={16} />
          Back to agents
        </Button>
        <div>
          <h2 className="text-lg font-semibold">
            {isDraftNew
              ? "Create agent"
              : (activeEditingAgent?.name ?? "Agent editor")}
          </h2>
          <p className="text-sm text-muted-foreground">
            Configure settings on the left and test live responses on the right.
          </p>
        </div>
      </div>

      {(agentActionError || agentSuccessMessage) && (
        <div className="space-y-2">
          {agentActionError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {agentActionError}
            </div>
          )}
          {agentSuccessMessage && !agentActionError && (
            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">
              {agentSuccessMessage}
            </div>
          )}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.6fr)_minmax(0,0.4fr)]">
        <div className="flex flex-col gap-4">
          <Card className="space-y-4 border border-border/80 p-4">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">Agent profile</h3>
              <p className="text-xs text-muted-foreground">
                Update the name, summary, and tool access for this agent.
              </p>
            </div>

            <form
              onSubmit={
                isDraftNew
                  ? handleCreateAgent
                  : (event) => {
                      event.preventDefault();
                      handleSaveProfile();
                    }
              }
              className="space-y-4"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label
                    htmlFor={agentNameInputId}
                    className="text-sm font-medium"
                  >
                    Agent name
                  </label>
                  <input
                    id={agentNameInputId}
                    value={agentName}
                    onChange={(event) => {
                      setAgentSuccessMessage(null);
                      setAgentName(event.target.value);
                    }}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    placeholder="Ops Assistant"
                  />
                </div>
                <div className="space-y-2">
                  <label
                    htmlFor={allowAllToolsId}
                    className="text-sm font-medium"
                  >
                    Tool access
                  </label>
                  <div className="flex items-center gap-2 text-sm">
                    <input
                      id={allowAllToolsId}
                      type="checkbox"
                      checked={allowAllTools}
                      onChange={(event) =>
                        handleAllowAllToolsChange(event.target.checked)
                      }
                    />
                    <label
                      htmlFor={allowAllToolsId}
                      className="text-sm font-medium"
                    >
                      Allow all tools
                    </label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    When disabled, pick only the tools this agent can access.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <label
                  htmlFor={agentBehaviorId}
                  className="text-sm font-medium"
                >
                  Agent behavior
                </label>
                <Textarea
                  id={agentBehaviorId}
                  value={agentBehavior}
                  onChange={(event) => {
                    setAgentSuccessMessage(null);
                    setAgentBehavior(event.target.value);
                  }}
                  minLength={1}
                  rows={3}
                  placeholder="Helpful general-purpose assistant"
                />
                <p className="text-xs text-muted-foreground">
                  Describe how teammates should use this agent.
                </p>
              </div>

              {!allowAllTools && (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Select tools</p>
                    {isToolsLoading && (
                      <p className="text-xs text-muted-foreground">
                        Loading tools…
                      </p>
                    )}
                    {isLoadingMcpConnectors && (
                      <p className="text-xs text-muted-foreground">
                        Loading MCP connector details…
                      </p>
                    )}
                    {toolsError && (
                      <p className="text-xs text-destructive">{toolsError}</p>
                    )}
                  </div>

                  {toolGroups.map((group) => (
                    <div key={group.key} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {group.label}
                        </p>
                        <span className="text-xs text-muted-foreground">
                          {group.tools.length} tool
                          {group.tools.length === 1 ? "" : "s"}
                        </span>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {group.tools.map((tool) => (
                          <label
                            key={tool.name}
                            className="flex gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm"
                          >
                            <input
                              type="checkbox"
                              checked={selectedToolNames.includes(tool.name)}
                              onChange={() => {
                                setAgentSuccessMessage(null);
                                setSelectedToolNames((prev) =>
                                  prev.includes(tool.name)
                                    ? prev.filter((name) => name !== tool.name)
                                    : [...prev, tool.name].sort()
                                );
                              }}
                            />
                            <div className="flex flex-col gap-1">
                              <span className="text-sm font-semibold">
                                {tool.name}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {tool.description}
                              </span>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}

                  {allToolNames.length === 0 && !isToolsLoading && (
                    <p className="text-xs text-muted-foreground">
                      No tools registered yet. Add tools from the Tools tab or
                      create an MCP connector.
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <p className="text-sm font-medium">Allowed handoff agents</p>
                <p className="text-xs text-muted-foreground">
                  Choose agents this profile may delegate to. Leave empty to
                  respond directly.
                </p>
                {availableHandoffAgents.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {agents.length <= 1
                      ? "Create another agent to enable handoffs."
                      : "No other agents available."}
                  </p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {availableHandoffAgents.map((agent) => (
                      <label
                        key={agent.id}
                        className="flex gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={selectedHandoffAgentIds.includes(agent.id)}
                          onChange={() => {
                            setAgentSuccessMessage(null);
                            setSelectedHandoffAgentIds((prev) => {
                              if (prev.includes(agent.id)) {
                                return prev
                                  .filter((id) => id !== agent.id)
                                  .sort();
                              }
                              return [...prev, agent.id].sort();
                            });
                          }}
                        />
                        <div className="flex flex-col">
                          <span>{agent.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {agent.behavior}
                          </span>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {isDraftNew ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <input
                      id={newAgentActiveId}
                      type="checkbox"
                      checked={newAgentSetActive}
                      onChange={(event) =>
                        setNewAgentSetActive(event.target.checked)
                      }
                    />
                    <label
                      htmlFor={newAgentActiveId}
                      className="text-sm font-medium"
                    >
                      Set as active after creation
                    </label>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={handleBackToList}
                      disabled={isBusy}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" variant="primary" disabled={isBusy}>
                      {isBusy ? "Creating..." : "Create agent"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>
                      {allowAllTools
                        ? "Tools: agent can access all registered tools."
                        : `Tools: ${selectedToolNames.join(", ") || "None"}`}
                    </p>
                    <p>
                      {selectedHandoffAgentIds.length === 0
                        ? "Handoffs: responds directly (no handoffs configured)."
                        : `Handoffs: ${selectedHandoffNames.join(", ")}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={isBusy || !canDeleteAgents || !editingAgentId}
                      onClick={() => {
                        if (editingAgentId) {
                          handleDeleteAgent(
                            editingAgentId,
                            agentName || "agent"
                          );
                        }
                      }}
                    >
                      Delete
                    </Button>
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={disableProfileSubmit}
                    >
                      {isBusy ? "Saving..." : "Save profile"}
                    </Button>
                  </div>
                </div>
              )}
            </form>
          </Card>

          <Card className="space-y-4 border border-border/80 p-4">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">Model & prompt</h3>
              <p className="text-xs text-muted-foreground">
                Fine-tune the base model and guardrails for this agent.
              </p>
            </div>

            {saveError && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {saveError}
              </div>
            )}

            {configSuccessMessage && !saveError && (
              <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">
                {configSuccessMessage}
              </div>
            )}

            <div className="space-y-4">
              <div className="space-y-2">
                <label htmlFor={modelInputId} className="text-sm font-medium">
                  Model
                </label>
                <input
                  id={modelInputId}
                  list={modelListId}
                  value={modelId}
                  onChange={(event) => {
                    setConfigSuccessMessage(null);
                    setModelId(event.target.value);
                  }}
                  placeholder="gpt-4o-2024-11-20"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                />
                <datalist id={modelListId}>
                  {allowedModels.map((value) => (
                    <option key={value} value={value} />
                  ))}
                </datalist>
                <p className="text-xs text-muted-foreground">
                  Use a model identifier available in your account.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label
                    htmlFor={temperatureInputId}
                    className="text-sm font-medium"
                  >
                    Temperature
                  </label>
                  <input
                    id={temperatureInputId}
                    type="number"
                    min={0}
                    max={2}
                    step={0.1}
                    value={temperature}
                    onChange={(event) =>
                      setTemperature(
                        clampTemperature(Number.parseFloat(event.target.value))
                      )
                    }
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  />
                  <p className="text-xs text-muted-foreground">
                    Higher values increase creativity; lower values stay
                    concise.
                  </p>
                </div>
                <div className="space-y-2">
                  <label
                    htmlFor={maxStepsInputId}
                    className="text-sm font-medium"
                  >
                    Max reasoning steps
                  </label>
                  <input
                    id={maxStepsInputId}
                    type="number"
                    min={1}
                    max={50}
                    step={1}
                    value={maxSteps}
                    onChange={(event) =>
                      setMaxSteps(
                        clampMaxSteps(
                          Number.parseInt(event.target.value, 10) || 0
                        )
                      )
                    }
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  />
                  <p className="text-xs text-muted-foreground">
                    Limits the number of tool calls per response.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor={systemPromptId} className="text-sm font-medium">
                  System prompt
                </label>
                <Textarea
                  id={systemPromptId}
                  value={systemPrompt}
                  onChange={(event) => {
                    setConfigSuccessMessage(null);
                    setSystemPrompt(event.target.value);
                  }}
                  minLength={1}
                  rows={8}
                  className="min-h-[160px]"
                  placeholder={
                    defaultProfile?.config.systemPrompt ??
                    "Describe the agent's behavior"
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Provide guardrails that the agent should follow in every
                  conversation.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-muted-foreground">
                Last saved: {configLastSaved}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleResetConfig}
                  disabled={isBusy}
                >
                  Reset to defaults
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  disabled={disableConfigSubmit}
                  onClick={handleSaveConfig}
                >
                  {isBusy ? "Saving..." : "Save changes"}
                </Button>
              </div>
            </div>
          </Card>
        </div>

        <AgentChatPreview
          agentKey={isDraftNew ? null : editingAgentId}
          confirmationToolNames={confirmationToolNames}
          disabled={isDraftNew}
        />
      </div>
    </div>
  );
}
