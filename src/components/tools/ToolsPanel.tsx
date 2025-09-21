import { useEffect, useId, useState } from "react";

import { Button } from "@/components/button/Button";
import { Card } from "@/components/card/Card";
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
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <form className="space-y-3" onSubmit={handleSubmit}>
          <div>
            <label
              className="block text-sm font-medium mb-1"
              htmlFor={specNameInputId}
            >
              Spec name (optional)
            </label>
            <input
              id={specNameInputId}
              type="text"
              value={specName}
              onChange={(event) => setSpecName(event.target.value)}
              className="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm"
              placeholder="Weather API"
            />
          </div>

          <div>
            <label
              className="block text-sm font-medium mb-1"
              htmlFor={specTextareaId}
            >
              OpenAPI 3.0 spec
            </label>
            <Textarea
              id={specTextareaId}
              value={specText}
              onChange={(event) => setSpecText(event.target.value)}
              placeholder="Paste the OpenAPI 3.0 definition here"
              rows={12}
            />
          </div>

          {submitError && (
            <p className="text-sm text-red-600 dark:text-red-400">
              {submitError}
            </p>
          )}

          {successMessage && (
            <p className="text-sm text-green-600 dark:text-green-400">
              {successMessage}
            </p>
          )}

          <div className="flex items-center gap-2">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Registering..." : "Register tools"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={isLoading}
              onClick={onRefresh}
            >
              Refresh list
            </Button>
          </div>
        </form>
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold">Available tools</h3>
          {isLoading && (
            <span className="text-sm text-neutral-500">Loading…</span>
          )}
        </div>
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>
        )}
        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
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

            return (
              <Card key={`${tool.source}-${tool.name}`} className="p-3">
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-semibold">{tool.name}</h4>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-500 mt-1">
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
                        {tool.origin?.specName && (
                          <span>Spec: {tool.origin.specName}</span>
                        )}
                        {tool.origin?.operationId && (
                          <span>Operation: {tool.origin.operationId}</span>
                        )}
                        <span>Updated: {updatedLabel}</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
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
                    <p className="text-xs text-neutral-500">
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

                  <div className="flex flex-wrap items-center gap-2">
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
                      <span className="text-xs text-neutral-500">
                        Unsaved changes
                      </span>
                    )}
                    {feedback && (
                      <span
                        className={`text-xs ${
                          saveState === "error"
                            ? "text-red-600 dark:text-red-400"
                            : "text-green-600 dark:text-green-400"
                        }`}
                      >
                        {feedback}
                      </span>
                    )}
                  </div>

                  {tool.schema && (
                    <details className="text-xs">
                      <summary className="cursor-pointer select-none text-neutral-500">
                        View schema
                      </summary>
                      <pre className="mt-2 max-h-64 overflow-auto rounded bg-neutral-100 dark:bg-neutral-900 p-2 text-[11px] leading-relaxed">
                        {JSON.stringify(tool.schema, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              </Card>
            );
          })}

          {tools.length === 0 && !isLoading && (
            <p className="text-sm text-neutral-500">No tools registered yet.</p>
          )}
        </div>

        <details className="mt-4 rounded-md border border-dashed border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900/40">
          <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium">
            Agent sees ({prompt ? "preview" : "empty"})
          </summary>
          <div className="border-t border-neutral-200 dark:border-neutral-800 px-3 py-3 space-y-3">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={!prompt}
                onClick={handleCopyPrompt}
              >
                {copyState === "copied" ? "Copied" : "Copy"}
              </Button>
              <p className="text-xs text-neutral-500">
                This text is injected into the system prompt before every
                response.
              </p>
            </div>
            <pre className="max-h-64 overflow-auto rounded bg-neutral-100 dark:bg-neutral-900 p-3 text-xs leading-relaxed whitespace-pre-wrap">
              {prompt ? prompt : "No guidance available yet."}
            </pre>
          </div>
        </details>
      </Card>

      <Modal isOpen={activeCue !== null} onClose={() => setActiveCue(null)}>
        {activeCue && (
          <div className="space-y-3 p-4">
            <h3 className="text-base font-semibold">{activeCue.title}</h3>
            <p className="text-sm whitespace-pre-wrap text-neutral-700 dark:text-neutral-200">
              {activeCue.body}
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
