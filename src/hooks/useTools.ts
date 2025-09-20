import { useCallback, useEffect, useMemo, useState } from "react";

export interface ToolListItem {
  name: string;
  description: string;
  requiresConfirmation: boolean;
  schema?: Record<string, unknown> | null;
  source: "builtin" | "dynamic";
  origin?: {
    type: "openapi" | "manual" | string;
    specName?: string;
    operationId?: string;
  } | null;
  createdAt: string;
}

interface ToolsResponse {
  tools: ToolListItem[];
}

interface RegisterResponse {
  tools: ToolListItem[];
}

export interface RegisterToolArgs {
  name?: string;
  spec: string;
}

export function useTools() {
  const [tools, setTools] = useState<ToolListItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTools = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/tools");
      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }
      const data = (await response.json()) as ToolsResponse;
      setTools(data.tools);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTools();
  }, [fetchTools]);

  const registerOpenApiSpec = useCallback(
    async ({ name, spec }: RegisterToolArgs): Promise<RegisterResponse> => {
      const response = await fetch("/api/tools", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ name, spec })
      });

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        const message =
          errorBody?.error ??
          `Failed to register spec (status ${response.status})`;
        throw new Error(message);
      }

      const data = (await response.json()) as RegisterResponse;
      await fetchTools();
      return data;
    },
    [fetchTools]
  );

  const confirmationToolNames = useMemo(() => {
    return new Set(
      tools.filter((tool) => tool.requiresConfirmation).map((tool) => tool.name)
    );
  }, [tools]);

  return {
    tools,
    isLoading,
    error,
    refresh: fetchTools,
    registerOpenApiSpec,
    confirmationToolNames
  };
}
