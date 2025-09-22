import { useEffect, useId, useState } from "react";

import { Button } from "@/components/button/Button";
import { Modal } from "@/components/modal/Modal";
import { Textarea } from "@/components/textarea/Textarea";
import type {
  RegisterResponse,
  RegisterToolArgs,
  ToolListItem,
  UpdateToolArgs
} from "@/hooks/useTools";

const usageCueTemplates = [
  {
    key: "trigger-keywords",
    title: "Trigger keywords",
    body: `List 3-5 short phrases that should immediately trigger this tool.\nExample: "weather", "forecast", "temperature", "rain".`
  },
  {
    key: "confirmations",
    title: "Required confirmations",
    body: `Describe the situations where the agent must ask for human approval before using the tool.\nExample: "Only fetch account balances after the user says 'confirm'."`
  },
  {
    key: "output-format",
    title: "Recommended output format",
    body: `Explain how the tool's response should be formatted so the agent can present it cleanly.\nExample: "Return a JSON object with keys 'summary' and 'nextSteps'."`
  }
] as const;

type SaveState = "idle" | "saving" | "success" | "error";
type DeleteState = "idle" | "deleting" | "error";

interface ToolsPanelProps {
  tools: ToolListItem[];
  isLoading: boolean;
  error: string | null;
  prompt: string;
  onRefresh: () => Promise<void>;
  onRegister: (args: RegisterToolArgs) => Promise<RegisterResponse>;
  onUpdateGuidance: (args: UpdateToolArgs) => Promise<ToolListItem>;
  onDeleteTool: (name: string) => Promise<void>;
}

export function ToolsPanel({
  tools,
  isLoading,
  error,
  prompt,
  onRefresh,
  onRegister,
  onUpdateGuidance,
  onDeleteTool
}: ToolsPanelProps) {
  const specNameInputId = useId();
  const specTextareaId = useId();
  const [specText, setSpecText] = useState("");
  const [specName, setSpecName] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saveStates, setSaveStates] = useState<
    Record<string, { state: SaveState; message?: string }>
  >({});
  const [deleteStates, setDeleteStates] = useState<Record<string, DeleteState>>(
    {}
  );
  const [activeCue, setActiveCue] = useState<
    (typeof usageCueTemplates)[number] | null
  >(null);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");

  useEffect(() => {
    setDrafts((previous) => {
      const next: Record<string, string> = {};
      tools.forEach((tool) => {
        const existing = previous[tool.name];
        if (existing !== undefined && existing !== tool.description) {
          next[tool.name] = existing;
        } else {
          next[tool.name] = tool.description;
        }
      });
      return next;
    });
  }, [tools]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError(null);
    setSuccessMessage(null);

    if (!specText.trim()) {
      setSubmitError(
        "Paste an OpenAPI 3.0 specification to register new tools."
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await onRegister({
        name: specName.trim() || undefined,
        spec: specText
      });
      const registeredCount = result.tools.length;
      setSuccessMessage(
        registeredCount > 0
          ? `Registered ${registeredCount} tool${registeredCount === 1 ? "" : "s"}.`
          : "Specification processed, but no operations were registered."
      );
      setSpecText("");
      setSpecName("");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveGuidance = async (tool: ToolListItem) => {
    const draft = drafts[tool.name]?.trim() ?? "";
    if (!draft) {
      setSaveStates((prev) => ({
        ...prev,
        [tool.name]: {
          state: "error",
          message: "Description cannot be empty."
        }
      }));
      return;
    }

    if (draft === tool.description) {
      setSaveStates((prev) => ({
        ...prev,
        [tool.name]: {
          state: "error",
          message: "No changes to save."
        }
      }));
      return;
    }

    setSaveStates((prev) => ({
      ...prev,
      [tool.name]: { state: "saving" }
    }));

    try {
      await onUpdateGuidance({ name: tool.name, description: draft });
      setDrafts((prev) => ({
        ...prev,
        [tool.name]: draft
      }));
      setSaveStates((prev) => ({
        ...prev,
        [tool.name]: {
          state: "success",
          message: "Guidance updated."
        }
      }));
    } catch (error) {
      setSaveStates((prev) => ({
        ...prev,
        [tool.name]: {
          state: "error",
          message: error instanceof Error ? error.message : String(error)
        }
      }));
    }
  };

  const handleDeleteTool = async (tool: ToolListItem) => {
    if (tool.source === "builtin") {
      setDeleteStates((prev) => ({
        ...prev,
        [tool.name]: "error"
      }));
      setSaveStates((prev) => ({
        ...prev,
        [tool.name]: {
          state: "error",
          message: "Built-in tools cannot be deleted."
        }
      }));
      return;
    }

    const confirmed = window.confirm(
      `Remove ${tool.name}? The agent will no longer see or call this tool.`
    );
    if (!confirmed) return;

    setDeleteStates((prev) => ({ ...prev, [tool.name]: "deleting" }));

    try {
      await onDeleteTool(tool.name);
      setDeleteStates((prev) => ({ ...prev, [tool.name]: "idle" }));
      setSaveStates((prev) => {
        const next = { ...prev };
        delete next[tool.name];
        return next;
      });
    } catch (error) {
      setDeleteStates((prev) => ({ ...prev, [tool.name]: "error" }));
      setSaveStates((prev) => ({
        ...prev,
        [tool.name]: {
          state: "error",
          message: error instanceof Error ? error.message : String(error)
        }
      }));
    }
  };

  const handleCopyPrompt = async () => {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 2000);
    } catch (error) {
      console.error("Failed to copy prompt", error);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Tool Manager</h2>
          <p className="text-sm text-muted-foreground">
            Register OpenAPI specifications and manage tool guidance for agents.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={isLoading}
            onClick={onRefresh}
          >
            Refresh list
          </Button>
        </div>
      </div>

      {/* Register Tools Section */}
      <div className="rounded-lg border border-border/70 bg-background">
        <div className="border-b border-border/50 px-6 py-4">
          <h3 className="text-base font-semibold">Register new tools</h3>
          <p className="text-sm text-muted-foreground">
            Add tools by providing an OpenAPI 3.0 specification.
          </p>
        </div>
        <div className="px-6 py-4">
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label
                  className="block text-sm font-medium mb-2"
                  htmlFor={specNameInputId}
                >
                  Spec name (optional)
                </label>
                <input
                  id={specNameInputId}
                  type="text"
                  value={specName}
                  onChange={(event) => setSpecName(event.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  placeholder="Weather API"
                />
              </div>
            </div>

            <div>
              <label
                className="block text-sm font-medium mb-2"
                htmlFor={specTextareaId}
              >
                OpenAPI 3.0 specification
              </label>
              <Textarea
                id={specTextareaId}
                value={specText}
                onChange={(event) => setSpecText(event.target.value)}
                placeholder="Paste the complete OpenAPI 3.0 definition here..."
                rows={12}
              />
            </div>

            {submitError && (
              <div className="rounded-md bg-destructive/10 border border-destructive/40 p-3 text-sm text-destructive">
                {submitError}
              </div>
            )}

            {successMessage && (
              <div className="rounded-md bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/40 p-3 text-sm text-emerald-700 dark:text-emerald-400">
                {successMessage}
              </div>
            )}

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Registering..." : "Register tools"}
              </Button>
            </div>
          </form>
        </div>
      </div>

      {/* Available Tools Section */}
      <div className="rounded-lg border border-border/70 bg-background">
        <div className="border-b border-border/50 px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold">Available tools</h3>
              <p className="text-sm text-muted-foreground">
                Manage tool descriptions and guidance for your agents.
              </p>
            </div>
            {isLoading && (
              <span className="text-sm text-muted-foreground">Loading…</span>
            )}
          </div>
        </div>

        {error && (
          <div className="mx-6 mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="px-6 py-4">
          <div className="space-y-4 max-h-[70vh] overflow-y-auto">
            {tools.map((tool) => {
              const draft = drafts[tool.name] ?? tool.description;
              const saveState = saveStates[tool.name]?.state ?? "idle";
              const feedback = saveStates[tool.name]?.message;
              const hasUnsavedChanges = draft.trim() !== tool.description.trim();
              const updatedAtDate = new Date(tool.updatedAt);
              const updatedLabel =
                Number.isNaN(updatedAtDate.getTime()) ||
                updatedAtDate.getTime() === 0
                  ? "Never"
                  : updatedAtDate.toLocaleString();
              const deleteState = deleteStates[tool.name] ?? "idle";
              const isDeleting = deleteState === "deleting";
              const origin = tool.origin;
              const isOpenApiOrigin = origin?.type === "openapi";
              const openApiSpecName =
                isOpenApiOrigin && typeof origin.specName === "string"
                  ? origin.specName
                  : null;
              const openApiOperationId =
                isOpenApiOrigin && typeof origin.operationId === "string"
                  ? origin.operationId
                  : null;
              const isMcpOrigin = origin?.type === "mcp";
              const mcpServerId =
                isMcpOrigin && typeof origin.serverId === "string"
                  ? origin.serverId
                  : null;
              const mcpToolName =
                isMcpOrigin && typeof origin.toolName === "string"
                  ? origin.toolName
                  : null;

              return (
                <div key={`${tool.source}-${tool.name}`} className="rounded-lg border border-border/50 bg-background/50 p-4">
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <h4 className="text-sm font-semibold">{tool.name}</h4>
                        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>
                            Source:{" "}
                            {tool.source === "builtin"
                              ? "Built-in"
                              : "Registered"}
                          </span>
                          <span>
                            Confirmation:{" "}
                            {tool.requiresConfirmation ? "Required" : "Automatic"}
                          </span>
                          {openApiSpecName && (
                            <span>Spec: {openApiSpecName}</span>
                          )}
                          {openApiOperationId && (
                            <span>Operation: {openApiOperationId}</span>
                          )}
                          {isMcpOrigin && mcpServerId && (
                            <span>
                              MCP tool: {mcpServerId}
                              {mcpToolName ? `/${mcpToolName}` : ""}
                            </span>
                          )}
                          <span>Updated: {updatedLabel}</span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <Textarea
                        value={draft}
                        onChange={(event) =>
                          setDrafts((previous) => ({
                            ...previous,
                            [tool.name]: event.target.value
                          }))
                        }
                        rows={4}
                      />
                      <p className="text-xs text-muted-foreground">
                        The agent reads this description verbatim. Keep it short,
                        decisive, and focused on when the tool should be used.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {usageCueTemplates.map((cue) => (
                          <Button
                            key={cue.key}
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setActiveCue(cue)}
                          >
                            {cue.title}
                          </Button>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        type="button"
                        onClick={() => handleSaveGuidance(tool)}
                        disabled={saveState === "saving" || !hasUnsavedChanges}
                      >
                        {saveState === "saving" ? "Saving…" : "Save guidance"}
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={isDeleting || tool.source === "builtin"}
                        onClick={() => handleDeleteTool(tool)}
                      >
                        {isDeleting ? "Removing…" : "Delete"}
                      </Button>
                      {hasUnsavedChanges && saveState !== "saving" && (
                        <span className="text-xs text-muted-foreground">
                          Unsaved changes
                        </span>
                      )}
                      {feedback && (
                        <span
                          className={`text-xs ${
                            saveState === "error"
                              ? "text-destructive"
                              : "text-emerald-600 dark:text-emerald-400"
                          }`}
                        >
                          {feedback}
                        </span>
                      )}
                    </div>

                    {tool.schema && (
                      <details className="text-xs">
                        <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">
                          View schema
                        </summary>
                        <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted/50 p-3 text-[11px] leading-relaxed">
                          {JSON.stringify(tool.schema, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                </div>
              );
            })}

            {tools.length === 0 && !isLoading && (
              <div className="rounded-lg border border-dashed border-border/70 bg-background/60 p-6 text-center text-sm text-muted-foreground">
                No tools registered yet. Add your first tool by providing an OpenAPI specification above.
              </div>
            )}
          </div>
        </div>

        {/* Agent Preview Section */}
        <div className="border-t border-border/50">
          <details className="group">
            <summary className="cursor-pointer select-none px-6 py-4 text-sm font-medium text-muted-foreground hover:text-foreground">
              Agent sees ({prompt ? "preview" : "empty"})
            </summary>
            <div className="border-t border-border/30 px-6 py-4 space-y-3">
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={!prompt}
                  onClick={handleCopyPrompt}
                >
                  {copyState === "copied" ? "Copied" : "Copy"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  This text is injected into the system prompt before every
                  response.
                </p>
              </div>
              <pre className="max-h-64 overflow-auto rounded-md bg-muted/50 p-4 text-xs leading-relaxed whitespace-pre-wrap">
                {prompt ? prompt : "No guidance available yet."}
              </pre>
            </div>
          </details>
        </div>
      </div>

      <Modal isOpen={activeCue !== null} onClose={() => setActiveCue(null)}>
        {activeCue && (
          <div className="space-y-4 p-6">
            <h3 className="text-lg font-semibold">{activeCue.title}</h3>
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">
              {activeCue.body}
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
