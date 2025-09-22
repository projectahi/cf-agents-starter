import { useCallback, useEffect, useMemo, useState } from "react";

import type { ToolListItem } from "@/hooks/useTools";

export interface McpConnectorMetadata extends Record<string, unknown> {
  displayName?: string;
  transportType?: McpTransportType;
  lastError?: string | null;
  lastAuth?: Record<string, unknown> | null;
}

export interface McpConnector {
  id: string;
  url: string;
  status: string;
  metadata: McpConnectorMetadata | null;
  pendingAuthUrl: string | null;
  createdAt: string;
  updatedAt: string;
  tools: ToolListItem[];
}

interface ListResponse {
  servers: McpConnector[];
}

interface SingleResponse {
  server: McpConnector;
}

export type McpTransportType = "streamable-http" | "sse";

export interface CreateMcpConnectorInput {
  id?: string;
  url: string;
  transportType?: McpTransportType;
  metadata?: McpConnectorMetadata | null;
}

export interface UpdateMcpConnectorInput {
  url?: string;
  transportType?: McpTransportType;
  metadata?: McpConnectorMetadata | null;
}

export function useMcpConnectors() {
  const [connectors, setConnectors] = useState<McpConnector[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);

  const fetchConnectors = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/tools/mcp");
      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }
      const data = (await response.json()) as ListResponse;
      setConnectors(data.servers ?? []);
      setLastFetchedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConnectors().catch(() => {
      // handled in fetchConnectors
    });
  }, [fetchConnectors]);

  const createConnector = useCallback(
    async (input: CreateMcpConnectorInput) => {
      const response = await fetch("/api/tools/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(input)
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          details?: unknown;
        };
        const message =
          body.error ?? `Failed to create connector (${response.status})`;
        throw new Error(message);
      }

      const data = (await response.json()) as SingleResponse;
      await fetchConnectors();
      return data.server;
    },
    [fetchConnectors]
  );

  const updateConnector = useCallback(
    async (id: string, input: UpdateMcpConnectorInput) => {
      const response = await fetch(`/api/tools/mcp/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(input)
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        const message =
          body.error ?? `Failed to update connector (${response.status})`;
        throw new Error(message);
      }

      const data = (await response.json()) as SingleResponse;
      setConnectors((prev) =>
        prev.map((connector) =>
          connector.id === data.server.id ? data.server : connector
        )
      );
      return data.server;
    },
    []
  );

  const refreshConnector = useCallback(async (id: string) => {
    const response = await fetch(
      `/api/tools/mcp/${encodeURIComponent(id)}/refresh`,
      {
        method: "POST"
      }
    );

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      const message =
        body.error ?? `Failed to refresh connector (${response.status})`;
      throw new Error(message);
    }

    const data = (await response.json()) as SingleResponse;
    setConnectors((prev) =>
      prev.map((connector) =>
        connector.id === data.server.id ? data.server : connector
      )
    );
    return data.server;
  }, []);

  const deleteConnector = useCallback(async (id: string) => {
    const response = await fetch(`/api/tools/mcp/${encodeURIComponent(id)}`, {
      method: "DELETE"
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      const message =
        body.error ?? `Failed to delete connector (${response.status})`;
      throw new Error(message);
    }

    setConnectors((prev) => prev.filter((connector) => connector.id !== id));
  }, []);

  const pendingAuthConnectors = useMemo(() => {
    return connectors.filter((connector) => connector.pendingAuthUrl);
  }, [connectors]);

  return {
    connectors,
    pendingAuthConnectors,
    isLoading,
    error,
    lastFetchedAt,
    refresh: fetchConnectors,
    createConnector,
    updateConnector,
    refreshConnector,
    deleteConnector
  };
}
