import { useEffect, useId, useMemo, useState } from "react";

import { Button } from "@/components/button/Button";
import { Card } from "@/components/card/Card";
import { Textarea } from "@/components/textarea/Textarea";
import { useAgentConfig, type AgentConfigUpdate } from "@/hooks/useAgentConfig";

function formatDateTime(isoDate: string | null) {
  if (!isoDate) return "Never";
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "Never";
  return date.toLocaleString();
}

function clampTemperature(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(2, Math.max(0, Number.parseFloat(value.toFixed(2))));
}

function clampMaxSteps(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(50, Math.max(1, Math.round(value)));
}

export function AgentConfigPanel() {
  const {
    config,
    defaults,
    allowedModels,
    isLoading,
    error,
    isSaving,
    saveError,
    lastSavedAt,
    updateConfig,
    resetConfig
  } = useAgentConfig();

  const [systemPrompt, setSystemPrompt] = useState("");
  const [modelId, setModelId] = useState("");
  const [temperature, setTemperature] = useState<number>(0.7);
  const [maxSteps, setMaxSteps] = useState<number>(10);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const systemPromptId = useId();
  const modelFieldId = useId();
  const modelListId = useId();
  const temperatureId = useId();
  const maxStepsId = useId();

  useEffect(() => {
    if (!config) return;
    setSystemPrompt(config.systemPrompt);
    setModelId(config.modelId);
    setTemperature(clampTemperature(config.temperature));
    setMaxSteps(clampMaxSteps(config.maxSteps));
  }, [config]);

  useEffect(() => {
    if (saveError) {
      setSuccessMessage(null);
    }
  }, [saveError]);

  const hasChanges = useMemo(() => {
    if (!config) return false;
    return (
      config.systemPrompt !== systemPrompt ||
      config.modelId !== modelId ||
      config.temperature !== temperature ||
      config.maxSteps !== maxSteps
    );
  }, [config, systemPrompt, modelId, temperature, maxSteps]);

  useEffect(() => {
    if (hasChanges) {
      setSuccessMessage(null);
    }
  }, [hasChanges]);

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!config) return;
    if (!hasChanges) {
      setSuccessMessage("No changes to save.");
      return;
    }

    const update: AgentConfigUpdate = {};
    if (config.systemPrompt !== systemPrompt) {
      update.systemPrompt = systemPrompt.trim();
    }
    if (config.modelId !== modelId) {
      update.modelId = modelId;
    }
    if (config.temperature !== temperature) {
      update.temperature = clampTemperature(temperature);
    }
    if (config.maxSteps !== maxSteps) {
      update.maxSteps = clampMaxSteps(maxSteps);
    }

    try {
      await updateConfig(update);
      setSuccessMessage("Configuration saved.");
    } catch (error) {
      console.error("Failed to update agent config", error);
    }
  };

  const handleReset = async () => {
    if (!defaults) return;
    const confirmed = window.confirm(
      "Reset configuration to defaults? This will overwrite your current settings."
    );
    if (!confirmed) return;

    try {
      const reset = await resetConfig();
      setSystemPrompt(reset.systemPrompt);
      setModelId(reset.modelId);
      setTemperature(clampTemperature(reset.temperature));
      setMaxSteps(clampMaxSteps(reset.maxSteps));
      setSuccessMessage("Configuration reset to defaults.");
    } catch (error) {
      console.error("Failed to reset agent config", error);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-4">
        <div>
          <h3 className="text-base font-semibold">Agent Settings</h3>
          <p className="text-sm text-muted-foreground">
            Adjust the system prompt, model selection, and safety limits for the
            agent. Changes apply to new chat requests immediately.
          </p>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {saveError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {saveError}
          </div>
        )}

        {successMessage && !saveError && (
          <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">
            {successMessage}
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-4">
          <fieldset disabled={isLoading || !config} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor={systemPromptId} className="text-sm font-medium">
                System prompt
              </label>
              <Textarea
                id={systemPromptId}
                value={systemPrompt}
                onChange={(event) => setSystemPrompt(event.target.value)}
                minLength={1}
                rows={8}
                className="min-h-[160px]"
                placeholder={
                  defaults?.systemPrompt ?? "Describe the agent's behavior"
                }
              />
              <p className="text-xs text-muted-foreground">
                Provide context and guardrails that the agent should follow in
                every conversation.
              </p>
            </div>

            <div className="space-y-2">
              <label htmlFor={modelFieldId} className="text-sm font-medium">
                Model
              </label>
              <input
                id={modelFieldId}
                list={modelListId}
                value={modelId}
                onChange={(event) => setModelId(event.target.value)}
                placeholder="gpt-4o-2024-11-20"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
              <datalist id={modelListId}>
                {allowedModels.map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
              <p className="text-xs text-muted-foreground">
                Choose which OpenAI model to run for new requests. You can input
                a custom model identifier if the dropdown does not include it.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor={temperatureId} className="text-sm font-medium">
                  Temperature
                </label>
                <input
                  id={temperatureId}
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
                  Higher values increase creativity. Use lower values for
                  predictable responses.
                </p>
              </div>

              <div className="space-y-2">
                <label htmlFor={maxStepsId} className="text-sm font-medium">
                  Max reasoning steps
                </label>
                <input
                  id={maxStepsId}
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
                  Limits how many reasoning tool calls the agent can make per
                  response.
                </p>
              </div>
            </div>
          </fieldset>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">
              Last saved: {formatDateTime(lastSavedAt)}
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={handleReset}
                disabled={isSaving || isLoading || !config}
              >
                Reset to defaults
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={isSaving || !config || !hasChanges}
              >
                {isSaving ? "Saving..." : "Save changes"}
              </Button>
            </div>
          </div>
        </form>
      </Card>
    </div>
  );
}
