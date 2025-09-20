import { useId, useState } from "react";

import { Button } from "@/components/button/Button";
import { Card } from "@/components/card/Card";
import { Textarea } from "@/components/textarea/Textarea";
import type { RegisterToolArgs, ToolListItem } from "@/hooks/useTools";

interface ToolsPanelProps {
  tools: ToolListItem[];
  isLoading: boolean;
  error: string | null;
  onRefresh: () => Promise<void>;
  onRegister: (args: RegisterToolArgs) => Promise<{ tools: ToolListItem[] }>;
}

export function ToolsPanel({
  tools,
  isLoading,
  error,
  onRefresh,
  onRegister
}: ToolsPanelProps) {
  const specNameInputId = useId();
  const specTextareaId = useId();
  const [specText, setSpecText] = useState("");
  const [specName, setSpecName] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
          {tools.map((tool) => (
            <Card key={`${tool.source}-${tool.name}`} className="p-3">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-semibold">{tool.name}</h4>
                    <p className="text-xs text-neutral-600 dark:text-neutral-300">
                      {tool.description}
                    </p>
                  </div>
                  <span className="text-xs text-neutral-500">
                    {tool.source === "builtin" ? "Built-in" : "Registered"}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-500">
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
          ))}

          {tools.length === 0 && !isLoading && (
            <p className="text-sm text-neutral-500">No tools registered yet.</p>
          )}
        </div>
      </Card>
    </div>
  );
}
