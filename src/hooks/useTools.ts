import { useCallback, useEffect, useMemo, useState } from "react";

export type ToolOrigin =
  | {
      type: "manual";
    }
  | {
      type: "openapi";
      specName?: string;
      operationId?: string;
    }
  | {
      type: "mcp";
      serverId: string;
      toolName: string;
    }
  | {
      type: Exclude<string, "manual" | "openapi" | "mcp">;
      [key: string]: unknown;
    };

export interface ToolListItem {
  name: string;
  description: string;
  requiresConfirmation: boolean;
  schema?: Record<string, unknown> | null;
  source: "builtin" | "dynamic";
  origin?: ToolOrigin | null;
  createdAt: string;
  updatedAt: string;
}

interface ToolsResponse {
  tools: ToolListItem[];
  prompt?: string;
}

export interface RegisterResponse {
  tools: ToolListItem[];
  prompt?: string;
}

export interface RegisterToolArgs {
  name?: string;
  spec: string;
}

export interface UpdateToolArgs {
  name: string;
  description: string;
}

interface DeleteResponse {
  prompt?: string;
}

export function useTools() {
  const [tools, setTools] = useState<ToolListItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<string>("");

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
      setPrompt(data.prompt ?? "");
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
      if (data.prompt) {
        setPrompt(data.prompt);
      }
      await fetchTools();
      return data;
    },
    [fetchTools]
  );

  const updateToolGuidance = useCallback(
    async ({ name, description }: UpdateToolArgs): Promise<ToolListItem> => {
      const response = await fetch(`/api/tools/${encodeURIComponent(name)}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ description })
      });

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        const message =
          errorBody?.error ??
          `Failed to update tool guidance (status ${response.status})`;
        throw new Error(message);
      }

      const data = (await response.json()) as {
        tool: ToolListItem;
        prompt?: string;
      };

      setTools((prev) => {
        const hasTool = prev.some((tool) => tool.name === data.tool.name);
        if (!hasTool) {
          return [...prev, data.tool];
        }
        return prev.map((tool) =>
          tool.name === data.tool.name ? data.tool : tool
        );
      });

      if (data.prompt !== undefined) {
        setPrompt(data.prompt);
      }

      return data.tool;
    },
    []
  );

  const confirmationToolNames = useMemo(() => {
    return new Set(
      tools.filter((tool) => tool.requiresConfirmation).map((tool) => tool.name)
    );
  }, [tools]);

  const deleteTool = useCallback(async (name: string) => {
    const response = await fetch(`/api/tools/${encodeURIComponent(name)}`, {
      method: "DELETE"
    });

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      const message =
        errorBody?.error ?? `Failed to delete tool (status ${response.status})`;
      throw new Error(message);
    }

    const data = (await response.json()) as DeleteResponse;
    if (data.prompt !== undefined) {
      setPrompt(data.prompt);
    }

    setTools((prev) => prev.filter((tool) => tool.name !== name));
  }, []);

  return {
    tools,
    isLoading,
    error,
    prompt,
    refresh: fetchTools,
    registerOpenApiSpec,
    updateToolGuidance,
    confirmationToolNames,
    deleteTool
  };
}
