import { useId, useState } from "react";

import { Button } from "@/components/button/Button";
import { Modal } from "@/components/modal/Modal";
import { Textarea } from "@/components/textarea/Textarea";
import type {
  CreateMcpConnectorInput,
  McpConnector,
  UpdateMcpConnectorInput
} from "@/hooks/useMcpConnectors";
import type { ToolListItem } from "@/hooks/useTools";

import {
  ArrowClockwise,
  PencilSimple,
  Plus,
  Trash,
  WarningCircle,
  LockSimpleOpen
} from "@phosphor-icons/react";

interface McpConnectorsPanelProps {
  connectors: McpConnector[];
  isLoading: boolean;
  error: string | null;
  onRefresh: () => Promise<void>;
  onCreate: (input: CreateMcpConnectorInput) => Promise<McpConnector>;
  onUpdate: (
    id: string,
    input: UpdateMcpConnectorInput
  ) => Promise<McpConnector>;
  onResync: (id: string) => Promise<McpConnector>;
  onDelete: (id: string) => Promise<void>;
}

type FormMode = "create" | "edit";

type TransportOption = "streamable-http" | "sse";

type FormState = {
  id: string;
  url: string;
  transportType: TransportOption;
  metadataText: string;
};

const DEFAULT_FORM_STATE: FormState = {
  id: "",
  url: "",
  transportType: "streamable-http",
  metadataText: ""
};

const METADATA_PLACEHOLDER = `{
  "displayName": "Docs Search",
  "auth": {
    "type": "oauth",
    "redirectBaseUrl": "https://your-worker.example.com/api/tools/mcp/oauth"
  }
}`;

function formatDateTime(value: string) {
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(date);
  } catch (_error) {
    return value;
  }
}

function statusColor(status: string) {
  switch (status) {
    case "ready":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200";
    case "pending_auth":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200";
    case "connecting":
      return "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-200";
    case "failed":
      return "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-200";
    default:
      return "bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100";
  }
}

function formatToolOrigin(tool: ToolListItem): string {
  const origin = tool.origin;
  if (origin?.type === "mcp") {
    return `${origin.serverId}/${origin.toolName}`;
  }
  if (origin?.type === "openapi") {
    const specName = origin.specName;
    return typeof specName === "string" && specName.length > 0
      ? specName
      : "OpenAPI";
  }
  if (origin?.type === "manual") {
    return "Built-in";
  }
  return origin?.type ?? "Dynamic";
}

export function McpConnectorsPanel({
  connectors,
  isLoading,
  error,
  onRefresh,
  onCreate,
  onUpdate,
  onResync,
  onDelete
}: McpConnectorsPanelProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>("create");
  const [formState, setFormState] = useState<FormState>(DEFAULT_FORM_STATE);
  const [activeConnectorId, setActiveConnectorId] = useState<string | null>(
    null
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);
  const [isSyncingId, setIsSyncingId] = useState<string | null>(null);

  const connectorIdInputId = useId();
  const urlInputId = useId();
  const transportInputId = useId();
  const metadataInputId = useId();

  const openCreateModal = () => {
    setFormMode("create");
    setFormState(DEFAULT_FORM_STATE);
    setFormError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (connector: McpConnector) => {
    const metadataForEditor = (() => {
      if (!connector.metadata) return null;
      const cloned = { ...connector.metadata } as Record<string, unknown>;
      delete cloned.transportType;
      delete cloned.lastError;
      delete cloned.lastAuth;
      return Object.keys(cloned).length > 0 ? cloned : null;
    })();

    setFormMode("edit");
    setActiveConnectorId(connector.id);
    setFormState({
      id: connector.id,
      url: connector.url,
      transportType:
        (connector.metadata?.transportType as TransportOption | undefined) ??
        "streamable-http",
      metadataText: metadataForEditor
        ? JSON.stringify(metadataForEditor, null, 2)
        : ""
    });
    setFormError(null);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setActiveConnectorId(null);
    setFormState(DEFAULT_FORM_STATE);
    setFormError(null);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setActionError(null);

    const metadataText = formState.metadataText.trim();
    let metadata: CreateMcpConnectorInput["metadata"];

    if (metadataText.length > 0) {
      try {
        metadata = JSON.parse(metadataText);
      } catch (parseError) {
        setFormError(
          parseError instanceof Error
            ? `Metadata must be valid JSON: ${parseError.message}`
            : "Metadata must be valid JSON"
        );
        return;
      }
    } else if (formMode === "edit") {
      metadata = null;
    }

    if (!formState.url.trim()) {
      setFormError("Enter an MCP server URL.");
      return;
    }

    setIsSubmitting(true);
    try {
      if (formMode === "create") {
        await onCreate({
          id: formState.id.trim() || undefined,
          url: formState.url.trim(),
          transportType: formState.transportType,
          metadata: metadata ?? undefined
        });
      } else if (activeConnectorId) {
        await onUpdate(activeConnectorId, {
          url: formState.url.trim() || undefined,
          transportType: formState.transportType,
          metadata
        });
      }
      closeModal();
    } catch (submissionError) {
      setFormError(
        submissionError instanceof Error
          ? submissionError.message
          : String(submissionError)
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRefreshConnector = async (id: string) => {
    setActionError(null);
    setIsSyncingId(id);
    try {
      await onResync(id);
    } catch (syncError) {
      setActionError(
        syncError instanceof Error ? syncError.message : String(syncError)
      );
    } finally {
      setIsSyncingId(null);
    }
  };

  const handleDeleteConnector = async (id: string) => {
    const connector = connectors.find((item) => item.id === id);
    if (!connector) return;

    const confirmed = window.confirm(
      `Remove MCP connector "${connector.id}"? This will remove its tools from new sessions.`
    );

    if (!confirmed) {
      return;
    }

    setActionError(null);
    setIsDeletingId(id);
    try {
      await onDelete(id);
    } catch (deleteError) {
      setActionError(
        deleteError instanceof Error ? deleteError.message : String(deleteError)
      );
    } finally {
      setIsDeletingId(null);
    }
  };

  const handleOpenAuth = (connector: McpConnector) => {
    if (!connector.pendingAuthUrl) return;
    window.open(connector.pendingAuthUrl, "_blank", "noopener,noreferrer");
  };

  const emptyState = !isLoading && connectors.length === 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">MCP Connectors</h2>
          <p className="text-sm text-muted-foreground">
            Register remote MCP servers and expose their tools to your agents.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={() => onRefresh().catch(() => {})}
            disabled={isLoading}
          >
            <ArrowClockwise size={16} /> Refresh
          </Button>
          <Button type="button" onClick={openCreateModal}>
            <Plus size={16} /> Add MCP Connection
          </Button>
        </div>
      </div>

      {/* Error Messages */}
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {actionError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {actionError}
        </div>
      )}

      {/* Loading State */}
      {isLoading && connectors.length === 0 && (
        <div className="rounded-lg border border-border/70 bg-background p-8 text-center text-sm text-muted-foreground">
          Loading MCP connectors…
        </div>
      )}

      {/* Empty State */}
      {emptyState && (
        <div className="rounded-lg border border-dashed border-border/70 bg-background/60 p-6 text-sm text-muted-foreground">
          <div className="flex flex-col items-start gap-4">
            <div className="inline-flex rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
              No connectors yet
            </div>
            <div className="space-y-2">
              <p className="font-medium">Get started with MCP connectors</p>
              <p>
                Add your first MCP connector to discover tools and make them
                available to your agents.
              </p>
            </div>
            <Button type="button" onClick={openCreateModal}>
              <Plus size={16} /> Add MCP Connection
            </Button>
          </div>
        </div>
      )}

      {/* Connectors List */}
      <div className="space-y-4">
        {connectors.map((connector) => {
          const pendingAuth = Boolean(connector.pendingAuthUrl);
          const transportLabel =
            connector.metadata?.transportType ?? "streamable-http";
          return (
            <div
              key={connector.id}
              className="rounded-lg border border-border/70 bg-background"
            >
              {/* Connector Header */}
              <div className="border-b border-border/50 px-6 py-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="text-base font-semibold">
                        {connector.metadata?.displayName &&
                        typeof connector.metadata.displayName === "string"
                          ? connector.metadata.displayName
                          : connector.id}
                      </h3>
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${statusColor(connector.status)}`}
                      >
                        {connector.status.replace(/_/g, " ")}
                      </span>
                      {pendingAuth && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
                          <WarningCircle size={12} /> Action required
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      <span className="font-medium">URL:</span> {connector.url}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>Created {formatDateTime(connector.createdAt)}</span>
                      <span>Updated {formatDateTime(connector.updatedAt)}</span>
                      <span>Transport {transportLabel}</span>
                      <span>{connector.tools.length} tools</span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 sm:items-end">
                    <div className="flex flex-wrap gap-2">
                      {pendingAuth && (
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => handleOpenAuth(connector)}
                        >
                          <LockSimpleOpen size={16} /> Complete Auth
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => handleRefreshConnector(connector.id)}
                        disabled={isSyncingId === connector.id}
                      >
                        <ArrowClockwise size={16} />
                        {isSyncingId === connector.id ? "Refreshing…" : "Refresh"}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => openEditModal(connector)}
                      >
                        <PencilSimple size={16} /> Edit
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={() => handleDeleteConnector(connector.id)}
                        disabled={isDeletingId === connector.id}
                      >
                        <Trash size={16} />
                        {isDeletingId === connector.id ? "Removing…" : "Remove"}
                      </Button>
                    </div>
                    {pendingAuth && (
                      <p className="max-w-sm text-xs text-muted-foreground">
                        We generated an OAuth request for this connector. Follow the
                        authorization prompt in a new tab, then click Refresh to
                        sync tools.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Tools Section */}
              <div className="px-6 py-4">
                {connector.tools.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No tools available yet. Refresh after authentication to pull
                    the latest tool list.
                  </p>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-medium">
                        Tools ({connector.tools.length})
                      </h4>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {connector.tools.map((tool) => (
                        <div
                          key={tool.name}
                          className="rounded-lg border border-border/50 bg-background/50 p-4"
                        >
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <span className="text-sm font-semibold">
                                {tool.name}
                              </span>
                              {tool.requiresConfirmation && (
                                <span className="inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800 dark:bg-orange-900/40 dark:text-orange-200">
                                  Needs confirmation
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground line-clamp-2">
                              {tool.description}
                            </p>
                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground/70">
                              {formatToolOrigin(tool)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Modal isOpen={isModalOpen} onClose={closeModal}>
        <div className="border-b border-border/50 px-6 py-4">
          <h3 className="text-lg font-semibold">
            {formMode === "create"
              ? "Add MCP Connection"
              : "Edit MCP Connection"}
          </h3>
          <p className="text-sm text-muted-foreground">
            Provide the connection details for the MCP server you want to
            expose.
          </p>
        </div>

        <form className="space-y-5 px-6 py-6" onSubmit={handleSubmit}>
          {formError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {formError}
            </div>
          )}

          {formMode === "create" && (
            <div className="space-y-2">
              <label
                htmlFor={connectorIdInputId}
                className="text-sm font-medium"
              >
                Connector ID (optional)
              </label>
              <input
                id={connectorIdInputId}
                placeholder="e.g. docs-search"
                value={formState.id}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    id: event.target.value
                  }))
                }
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
              <p className="text-xs text-muted-foreground">
                If left blank, an ID will be generated automatically.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor={urlInputId} className="text-sm font-medium">
              MCP server URL
            </label>
            <input
              id={urlInputId}
              placeholder="https://mcp.example.com/sse"
              value={formState.url}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  url: event.target.value
                }))
              }
              required
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              type="url"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor={transportInputId} className="text-sm font-medium">
              Transport
            </label>
            <select
              id={transportInputId}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              value={formState.transportType}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  transportType: event.target.value as TransportOption
                }))
              }
            >
              <option value="streamable-http">
                Streamable HTTP (recommended)
              </option>
              <option value="sse">Server-Sent Events (SSE)</option>
            </select>
            <p className="text-xs text-muted-foreground">
              Remote MCP servers typically require streamable HTTP. Choose SSE
              only if the server documentation explicitly recommends it.
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor={metadataInputId} className="text-sm font-medium">
              Metadata (JSON, optional)
            </label>
            <Textarea
              id={metadataInputId}
              rows={6}
              placeholder={METADATA_PLACEHOLDER}
              value={formState.metadataText}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  metadataText: event.target.value
                }))
              }
            />
            <p className="text-xs text-muted-foreground">
              Configure optional connection details like display name,
              transport, or OAuth settings.
            </p>
          </div>

          <div className="flex items-center justify-end gap-3">
            <Button type="button" variant="ghost" onClick={closeModal}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? formMode === "create"
                  ? "Creating…"
                  : "Saving…"
                : formMode === "create"
                  ? "Create connector"
                  : "Save changes"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
