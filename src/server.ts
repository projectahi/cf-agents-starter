import { routeAgentRequest, type Schedule } from "agents";

import { getSchedulePrompt } from "agents/schedule";

import { AIChatAgent } from "agents/ai-chat-agent";
import { DurableObjectOAuthClientProvider } from "agents/mcp/do-oauth-client-provider";
import {
  generateId,
  streamText,
  generateText,
  type StreamTextOnFinishCallback,
  stepCountIs,
  createUIMessageStream,
  convertToModelMessages,
  createUIMessageStreamResponse,
  type ToolSet,
  type CoreMessage,
  jsonSchema
} from "ai";
import type { UIMessage } from "@ai-sdk/react";
import { openai } from "@ai-sdk/openai";
import { processToolCalls, cleanupMessages } from "./utils";
import { ZodError } from "zod";
import { z } from "zod/v3";
import {
  createToolRegistry,
  type RegisterOpenApiSpecResult,
  type ToolListItem,
  type RegisterMcpToolDefinition
} from "./tool-registry";
import { OpenApiToolError } from "./lib/openapi-tools";
import {
  agentConfigValidators,
  agentProfileValidators,
  createAgentProfile,
  mergeAgentProfile,
  createDefaultAgentProfile,
  createAgentConfig,
  ALLOWED_MODEL_IDS,
  defaultAgentConfig,
  type AgentProfile,
  type AgentProfileInput,
  type AgentProfileUpdateInput
} from "./agent-config";
import type { ChatMessageMetadata, RespondingAgentMetadata } from "./shared";
// import { env } from "cloudflare:workers";

const API_PREFIX = "/api";
const INTERNAL_AGENT_PREFIX = "/_cf-agents";
const AGENT_NAMESPACE = "chat";
const AGENT_ROOM_NAME = "default";
const MCP_TOOL_PREFIX = "mcp";

function sanitizeForToolId(value: string) {
  const cleaned = value.replace(/[^A-Za-z0-9_-]/g, "_");
  if (cleaned.length > 0) {
    return cleaned;
  }
  return "item";
}

function createStableSuffix(input: string) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }
  const positive = Math.abs(hash);
  return positive.toString(36).slice(0, 6) || "0";
}

function toMcpRegistryName(serverId: string, toolName: string) {
  const safeServer = sanitizeForToolId(serverId);
  const safeTool = sanitizeForToolId(toolName);
  const suffix = createStableSuffix(`${serverId}:${toolName}`);
  return `${MCP_TOOL_PREFIX}_${safeServer}_${safeTool}_${suffix}`;
}

function toInternalAgentPath(pathname: string) {
  return `${INTERNAL_AGENT_PREFIX}${pathname.slice(API_PREFIX.length)}`;
}

function safeParseJson<T>(input: string | null | undefined): T | null {
  if (!input) {
    return null;
  }
  try {
    return JSON.parse(input) as T;
  } catch (error) {
    console.warn("Failed to parse JSON payload", error);
    return null;
  }
}

async function forwardToAgentDurableObject(
  env: Env,
  request: Request,
  internalPath: string
) {
  const url = new URL(request.url);
  const target = new URL(url.toString());
  target.pathname = `/agents/${AGENT_NAMESPACE}/${AGENT_ROOM_NAME}${internalPath}`;
  target.search = url.search;
  const forwarded = new Request(target.toString(), request);
  const response = await routeAgentRequest(forwarded, env);
  return response ?? new Response("Not found", { status: 404 });
}

// Cloudflare AI Gateway
// const openai = createOpenAI({
//   apiKey: env.OPENAI_API_KEY,
//   baseURL: env.GATEWAY_BASE_URL,
// });

/**
 * Chat Agent implementation that handles real-time AI chat interactions
 */
type AgentProfileRow = {
  id: string;
  profile: string;
};

type McpServerRow = {
  server_id: string;
  url: string;
  metadata: string | null;
  status: string | null;
  created_at: string;
  updated_at: string;
};

type McpToolRow = {
  server_id: string;
  tool_name: string;
  description: string | null;
  schema: string | null;
  requires_confirmation: number | null;
  created_at: string | null;
  updated_at: string | null;
};

type StoredMcpServerMetadata = {
  displayName?: string;
  transportType?: "sse" | "streamable-http";
  transportOptions?: Record<string, unknown>;
  clientOptions?: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
  auth?: {
    type: "oauth" | "none";
    redirectBaseUrl?: string;
    clientName?: string;
  } & Record<string, unknown>;
  lastAuth?: Record<string, unknown>;
  lastError?: string | null;
  [key: string]: unknown;
};

type StoredMcpServer = {
  id: string;
  url: string;
  metadata: StoredMcpServerMetadata | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export class Chat extends AIChatAgent<Env> {
  private agentRegistryInitialized = false;
  private toolRegistry = createToolRegistry(() => new Date());
  private toolRegistryInitialized = false;
  private pendingRespondingAgent: RespondingAgentMetadata | null = null;
  private mcpServers = new Map<string, StoredMcpServer>();
  private mcpConnectionPromises = new Map<string, Promise<void>>();

  private ensureAgentRegistry() {
    if (this.agentRegistryInitialized) {
      return;
    }

    this.sql`create table if not exists cf_agent_profiles (
      id text primary key,
      profile text not null
    )`;

    this.sql`create table if not exists cf_agent_active_profile (
      pk integer primary key check (pk = 1),
      agent_id text not null
    )`;

    this.sql`create table if not exists cf_agent_profile_handoffs (
      profile_id text not null,
      handoff_id text not null,
      created_at text not null,
      primary key (profile_id, handoff_id)
    )`;

    const countRows = this.sql`select count(*) as count from cf_agent_profiles`;
    const existingCount = Number(countRows?.[0]?.count ?? 0);

    if (existingCount === 0) {
      const defaultProfile = createDefaultAgentProfile();
      this
        .sql`insert or replace into cf_agent_profiles (id, profile) values (${defaultProfile.id}, ${JSON.stringify(defaultProfile)})`;
      this
        .sql`insert or replace into cf_agent_active_profile (pk, agent_id) values (1, ${defaultProfile.id})`;
    } else {
      const activeRows = this
        .sql`select agent_id from cf_agent_active_profile where pk = 1`;
      const activeId = activeRows?.[0]?.agent_id as string | undefined;
      if (!activeId) {
        const firstProfile = this.sql`select id from cf_agent_profiles limit 1`;
        const fallbackId = firstProfile?.[0]?.id as string | undefined;
        if (fallbackId) {
          this
            .sql`insert or replace into cf_agent_active_profile (pk, agent_id) values (1, ${fallbackId})`;
        }
      }
    }

    this.agentRegistryInitialized = true;
  }

  private ensureToolRegistry() {
    if (this.toolRegistryInitialized) {
      return;
    }

    this.ensureAgentRegistry();

    this.sql`create table if not exists cf_agent_tool_specs (
      spec_name text primary key,
      spec text not null,
      created_at text not null,
      updated_at text not null
    )`;

    this.sql`create table if not exists cf_agent_tool_guidance (
      tool_name text primary key,
      description text not null,
      updated_at text not null
    )`;

    this.sql`create table if not exists cf_agent_tool_deletions (
      tool_name text primary key,
      deleted_at text not null
    )`;

    this.sql`create table if not exists cf_agent_mcp_servers (
      server_id text primary key,
      url text not null,
      metadata text,
      status text not null default 'unknown',
      created_at text not null,
      updated_at text not null
    )`;

    this.sql`create table if not exists cf_agent_mcp_tools (
      server_id text not null,
      tool_name text not null,
      description text,
      schema text,
      requires_confirmation integer default 0,
      created_at text not null,
      updated_at text not null,
      primary key (server_id, tool_name)
    )`;

    this.sql`create table if not exists cf_agent_mcp_tokens (
      token_id text primary key,
      server_id text not null,
      user_id text not null,
      tokens text not null,
      expires_at text,
      created_at text not null,
      updated_at text not null
    )`;

    const specRows = this
      .sql`select spec_name, spec, created_at, updated_at from cf_agent_tool_specs order by datetime(created_at) asc`;

    if (Array.isArray(specRows)) {
      for (const row of specRows) {
        const specName = row?.spec_name as string | undefined;
        const spec = row?.spec as string | undefined;
        if (!specName || !spec) continue;
        const updatedAt =
          (row?.updated_at as string | undefined) ??
          (row?.created_at as string | undefined);
        try {
          this.toolRegistry.registerOpenApiSpec(
            { name: specName, spec },
            { timestamp: updatedAt }
          );
        } catch (error) {
          console.error(
            `Failed to hydrate tool spec ${specName} from storage`,
            error
          );
        }
      }
    }

    const guidanceRows = this
      .sql`select tool_name, description, updated_at from cf_agent_tool_guidance`;

    if (Array.isArray(guidanceRows)) {
      for (const row of guidanceRows) {
        const toolName = row?.tool_name as string | undefined;
        const description = row?.description as string | undefined;
        const updatedAt = row?.updated_at as string | undefined;
        if (!toolName || !description || !updatedAt) continue;
        this.toolRegistry.applyGuidanceOverride(
          toolName,
          description,
          updatedAt
        );
      }
    }

    this.hydrateMcpServers();

    const deletedRows = this
      .sql`select tool_name, deleted_at from cf_agent_tool_deletions`;

    if (Array.isArray(deletedRows)) {
      for (const row of deletedRows) {
        const toolName = row?.tool_name as string | undefined;
        const deletedAt = row?.deleted_at as string | undefined;
        if (!toolName || !deletedAt) continue;
        this.toolRegistry.applyDeletedTool(toolName, deletedAt);
      }
    }

    this.toolRegistryInitialized = true;
  }

  private hydrateMcpServers() {
    const serverRows = this
      .sql`select server_id, url, metadata, status, created_at, updated_at from cf_agent_mcp_servers order by datetime(created_at) asc` as
      | McpServerRow[]
      | undefined;

    this.mcpServers.clear();

    if (!Array.isArray(serverRows)) {
      return;
    }

    for (const row of serverRows) {
      const serverId = row?.server_id;
      const url = row?.url;
      if (!serverId || !url) {
        continue;
      }

      const metadata = safeParseJson<StoredMcpServerMetadata>(row?.metadata);
      const createdAt = row?.created_at ?? new Date(0).toISOString();
      const updatedAt = row?.updated_at ?? createdAt;
      const status = row?.status ?? "unknown";

      const stored: StoredMcpServer = {
        id: serverId,
        url,
        metadata,
        status,
        createdAt,
        updatedAt
      };

      this.mcpServers.set(serverId, stored);

      const toolRows = this
        .sql`select server_id, tool_name, description, schema, requires_confirmation, created_at, updated_at from cf_agent_mcp_tools where server_id = ${serverId} order by tool_name asc` as
        | McpToolRow[]
        | undefined;

      if (!Array.isArray(toolRows) || toolRows.length === 0) {
        this.toolRegistry.removeMcpServer(serverId);
        continue;
      }

      const definitions: RegisterMcpToolDefinition[] = [];
      for (const toolRow of toolRows) {
        const definition = this.buildMcpToolDefinitionFromRow(stored, toolRow);
        if (definition) {
          definitions.push(definition);
        }
      }

      if (definitions.length > 0) {
        this.toolRegistry.registerMcpTools(serverId, definitions, {
          timestamp: stored.updatedAt
        });
      } else {
        this.toolRegistry.removeMcpServer(serverId);
      }

      if (stored.status === "ready" || stored.status === "connecting") {
        void this.ensureMcpConnected(serverId);
      }
    }
  }

  private buildMcpToolDefinitionFromRow(
    server: StoredMcpServer,
    row: McpToolRow
  ): RegisterMcpToolDefinition | null {
    const toolName = row?.tool_name;
    if (!toolName) {
      return null;
    }

    const description =
      row?.description ??
      `Tool ${toolName} provided by MCP server ${server.id}`;
    const schema = safeParseJson<Record<string, unknown>>(row?.schema);
    const schemaForRegistration = this.ensureJsonSchemaObject(schema);
    const requiresConfirmation = Boolean(row?.requires_confirmation);
    const name = toMcpRegistryName(server.id, toolName);

    const executor = async (
      // biome-ignore lint/suspicious/noExplicitAny: tool inputs are dynamic per server
      args: any,
      _context: { messages: CoreMessage[]; toolCallId: string }
    ) => this.executeMcpToolCall({ serverId: server.id, toolName, args });

    const aiTool = {
      description,
      parameters: jsonSchema(schemaForRegistration),
      execute: executor
    } as unknown as ToolSet[string];

    return {
      name,
      description,
      requiresConfirmation,
      schema: schema ?? null,
      tool: aiTool,
      execution: executor,
      originalName: toolName,
      createdAt: row?.created_at ?? server.createdAt,
      updatedAt: row?.updated_at ?? server.updatedAt
    } satisfies RegisterMcpToolDefinition;
  }

  private ensureJsonSchemaObject(
    schema: Record<string, unknown> | null
  ): Record<string, unknown> {
    if (!schema || typeof schema !== "object") {
      return {
        type: "object",
        properties: {},
        additionalProperties: true
      } satisfies Record<string, unknown>;
    }

    const typeValue = schema.type;
    if (typeValue !== "object") {
      return {
        type: "object",
        properties: {},
        additionalProperties: true
      } satisfies Record<string, unknown>;
    }

    const properties =
      schema.properties && typeof schema.properties === "object"
        ? Object.fromEntries(
            Object.entries(schema.properties as Record<string, unknown>).map(
              ([key, value]) => {
                if (!value || typeof value !== "object") {
                  return [key, {}];
                }
                return [key, value];
              }
            )
          )
        : {};

    const required = Array.isArray(schema.required)
      ? schema.required.filter((item) => typeof item === "string")
      : [];

    const cleaned: Record<string, unknown> = {
      ...schema,
      type: "object",
      properties,
      required,
      additionalProperties:
        typeof schema.additionalProperties === "boolean"
          ? schema.additionalProperties
          : true
    };

    if (typeof schema.description === "string") {
      cleaned.description = schema.description;
    }

    return cleaned;
  }

  private async executeMcpToolCall({
    serverId,
    toolName,
    args
  }: {
    serverId: string;
    toolName: string;
    // biome-ignore lint/suspicious/noExplicitAny: tool inputs are dynamic per server
    args: any;
  }): Promise<unknown> {
    await this.ensureMcpConnected(serverId);

    try {
      const result = await this.mcp.callTool({
        serverId,
        name: toolName,
        arguments: args
      });

      return result;
    } catch (error) {
      await this.persistMcpServerState(serverId, {
        status: "failed",
        metadataPatch: {
          lastError: String(error)
        }
      });
      throw error;
    }
  }

  private async ensureMcpConnected(serverId: string): Promise<void> {
    if (this.mcpConnectionPromises.has(serverId)) {
      return this.mcpConnectionPromises.get(serverId)!;
    }

    const server = this.mcpServers.get(serverId);
    if (!server) {
      throw new Error(`MCP server ${serverId} not found`);
    }

    const connectPromise = this.connectMcpServer(server)
      .catch(async (error) => {
        console.error(`Failed to connect to MCP server ${serverId}`, error);
        throw error;
      })
      .finally(() => {
        this.mcpConnectionPromises.delete(serverId);
      });

    this.mcpConnectionPromises.set(serverId, connectPromise);
    return connectPromise;
  }

  private async connectMcpServer(server: StoredMcpServer): Promise<void> {
    await this.persistMcpServerState(server.id, {
      status: "connecting",
      metadataPatch: {
        lastError: null
      }
    });

    const metadata = server.metadata ?? {};
    const preferred = this.normaliseTransportType(metadata.transportType);
    const candidates: ("streamable-http" | "sse")[] = preferred
      ? preferred === "streamable-http"
        ? ["streamable-http", "sse"]
        : ["sse", "streamable-http"]
      : ["streamable-http", "sse"];

    let lastError: unknown = null;
    for (const transportType of candidates) {
      try {
        await this.connectUsingTransport(server, transportType);
        await this.persistMcpServerState(server.id, {
          metadataPatch: {
            transportType,
            lastError: null
          }
        });
        return;
      } catch (error) {
        lastError = error;
        console.warn(
          `Failed to connect to MCP server ${server.id} using transport ${transportType}`,
          error
        );
      }
    }

    const message = lastError ? String(lastError) : "Unable to connect";
    await this.persistMcpServerState(server.id, {
      status: "failed",
      metadataPatch: {
        lastError: message
      }
    });
    throw lastError instanceof Error ? lastError : new Error(message);
  }

  private normaliseTransportType(
    value: string | undefined
  ): "streamable-http" | "sse" | null {
    if (value === "streamable-http" || value === "sse") {
      return value;
    }
    return null;
  }

  private async connectUsingTransport(
    server: StoredMcpServer,
    transportType: "streamable-http" | "sse"
  ): Promise<void> {
    const options = this.buildMcpConnectionOptions(server, transportType);
    const reconnectOptions = this.buildMcpReconnectOptions(server);

    const connectResult = await this.mcp.connect(server.url, {
      ...options,
      reconnect: reconnectOptions
    });
    const now = new Date().toISOString();

    if (connectResult.authUrl) {
      await this.persistMcpServerState(server.id, {
        status: "pending_auth",
        updatedAt: now,
        metadataPatch: {
          transportType,
          lastAuth: {
            authUrl: connectResult.authUrl,
            clientId: connectResult.clientId ?? null,
            updatedAt: now
          }
        }
      });
      return;
    }

    await this.syncMcpToolsFromServer(server);
    await this.persistMcpServerState(server.id, {
      status: "ready",
      updatedAt: now,
      metadataPatch: {
        transportType,
        lastError: null
      }
    });
  }

  private buildMcpReconnectOptions(server: StoredMcpServer): {
    id: string;
    oauthClientId?: string;
    oauthCode?: string;
  } {
    const metadata = server.metadata ?? {};
    const reconnect: {
      id: string;
      oauthClientId?: string;
      oauthCode?: string;
    } = {
      id: server.id
    };

    const lastAuth = metadata.lastAuth;
    if (lastAuth && typeof lastAuth === "object" && !Array.isArray(lastAuth)) {
      const authRecord = lastAuth as Record<string, unknown>;
      if (typeof authRecord.clientId === "string") {
        reconnect.oauthClientId = authRecord.clientId;
      }
      if (typeof authRecord.oauthCode === "string") {
        reconnect.oauthCode = authRecord.oauthCode;
      }
    }

    return reconnect;
  }

  private async discoverMcpTransport(
    url: string
  ): Promise<"streamable-http" | "sse" | null> {
    try {
      const target = new URL(url);
      const wellKnownUrl = new URL("/.well-known/mcp.json", target.origin);
      const response = await fetch(wellKnownUrl.toString());
      if (!response.ok) {
        return null;
      }
      const text = await response.text();
      if (!text) {
        return null;
      }
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch (error) {
        console.warn(
          `Failed to parse MCP discovery document at ${wellKnownUrl.toString()}`,
          error
        );
        return null;
      }
      const transports = this.extractTransportCandidates(payload);
      if (!transports || transports.length === 0) {
        return null;
      }
      if (transports.includes("streamable-http")) {
        return "streamable-http";
      }
      if (transports.includes("sse")) {
        return "sse";
      }
      return null;
    } catch (error) {
      console.warn(`Failed to discover transport for MCP server ${url}`, error);
      return null;
    }
  }

  private extractTransportCandidates(payload: unknown): string[] | null {
    if (!payload || typeof payload !== "object") {
      return null;
    }
    const container = payload as Record<string, unknown>;
    const candidateKeys = [
      "transports",
      "recommendedTransports",
      "supportedTransports",
      "transportTypes"
    ];
    for (const key of candidateKeys) {
      const value = container[key];
      if (Array.isArray(value)) {
        return value
          .map((item) =>
            typeof item === "string"
              ? item
              : item && typeof item === "object" && "type" in item
                ? String((item as Record<string, unknown>).type)
                : null
          )
          .filter((item): item is string => typeof item === "string");
      }
    }
    return null;
  }

  private mergeMetadata(
    metadataInput: unknown,
    extras: Partial<StoredMcpServerMetadata>
  ): StoredMcpServerMetadata | null {
    const base: Record<string, unknown> =
      metadataInput &&
      typeof metadataInput === "object" &&
      !Array.isArray(metadataInput)
        ? { ...(metadataInput as Record<string, unknown>) }
        : {};

    for (const [key, value] of Object.entries(extras)) {
      if (value === undefined) {
        continue;
      }
      base[key] = value;
    }

    return Object.keys(base).length > 0
      ? (base as StoredMcpServerMetadata)
      : null;
  }

  private buildMcpConnectionOptions(
    server: StoredMcpServer,
    transportOverride?: "streamable-http" | "sse"
  ) {
    const metadata = server.metadata ?? {};
    const transportType =
      transportOverride ??
      this.normaliseTransportType(metadata.transportType) ??
      "streamable-http";
    const transportOptions = metadata.transportOptions ?? {};
    const clientOptions = metadata.clientOptions ?? {};
    const capabilities = metadata.capabilities ?? {};

    const authProvider = this.createMcpAuthProvider(server, metadata.auth);

    return {
      transport: {
        type: transportType,
        authProvider,
        ...transportOptions
      },
      client: clientOptions,
      capabilities
    };
  }

  private createMcpAuthProvider(
    server: StoredMcpServer,
    authConfig: StoredMcpServerMetadata["auth"]
  ) {
    if (!authConfig || authConfig.type === "none") {
      return undefined;
    }

    const redirectBaseUrl = authConfig.redirectBaseUrl;
    if (!redirectBaseUrl) {
      console.warn(
        `MCP server ${server.id} configured for OAuth without redirectBaseUrl`
      );
      return undefined;
    }

    const provider = new DurableObjectOAuthClientProvider(
      this.ctx.storage,
      authConfig.clientName ?? `cf-agents-mcp-${server.id}`,
      redirectBaseUrl
    );

    return provider;
  }

  private async syncMcpToolsFromServer(server: StoredMcpServer) {
    const now = new Date().toISOString();
    const tools = this.mcp
      .listTools()
      .filter((toolInfo) => toolInfo.serverId === server.id);

    // Reset existing tool snapshot
    this.sql`delete from cf_agent_mcp_tools where server_id = ${server.id}`;

    const definitions: RegisterMcpToolDefinition[] = [];

    for (const toolInfo of tools) {
      const rawSchema =
        toolInfo.inputSchema &&
        typeof toolInfo.inputSchema === "object" &&
        !Array.isArray(toolInfo.inputSchema)
          ? (toolInfo.inputSchema as Record<string, unknown>)
          : null;
      const sanitizedSchema = rawSchema
        ? this.ensureJsonSchemaObject(rawSchema)
        : null;

      const row: McpToolRow = {
        server_id: server.id,
        tool_name: toolInfo.name,
        description: toolInfo.description ?? null,
        schema: sanitizedSchema ? JSON.stringify(sanitizedSchema) : null,
        requires_confirmation: toolInfo.requiresConfirmation ? 1 : 0,
        created_at: now,
        updated_at: now
      };

      this
        .sql`insert or replace into cf_agent_mcp_tools (server_id, tool_name, description, schema, requires_confirmation, created_at, updated_at) values (${row.server_id}, ${row.tool_name}, ${row.description}, ${row.schema}, ${row.requires_confirmation}, ${row.created_at}, ${row.updated_at})`;

      const definition = this.buildMcpToolDefinitionFromRow(server, row);
      if (definition) {
        definitions.push(definition);
      }
    }

    if (definitions.length > 0) {
      this.toolRegistry.registerMcpTools(server.id, definitions, {
        timestamp: now
      });
    } else {
      this.toolRegistry.removeMcpServer(server.id, now);
    }
  }

  private async persistMcpServerState(
    serverId: string,
    updates: {
      status?: string;
      metadataPatch?: Partial<StoredMcpServerMetadata> | null;
      updatedAt?: string;
    }
  ) {
    const server = this.mcpServers.get(serverId);
    if (!server) {
      return;
    }

    const nextStatus = updates.status ?? server.status;
    const nextUpdatedAt = updates.updatedAt ?? new Date().toISOString();
    const nextMetadata =
      updates.metadataPatch === undefined
        ? server.metadata
        : updates.metadataPatch === null
          ? null
          : {
              ...(server.metadata ?? {}),
              ...updates.metadataPatch
            };

    this.mcpServers.set(serverId, {
      ...server,
      status: nextStatus,
      metadata: nextMetadata,
      updatedAt: nextUpdatedAt
    });

    this
      .sql`update cf_agent_mcp_servers set status = ${nextStatus}, metadata = ${nextMetadata ? JSON.stringify(nextMetadata) : null}, updated_at = ${nextUpdatedAt} where server_id = ${serverId}`;
  }

  private getMcpToolMetadataForServer(serverId: string): ToolListItem[] {
    return this.toolRegistry
      .listTools()
      .filter(
        (tool) =>
          tool.origin?.type === "mcp" && tool.origin.serverId === serverId
      );
  }

  private serializeMcpServer(server: StoredMcpServer) {
    const tools = this.getMcpToolMetadataForServer(server.id);
    const pendingAuthUrl =
      typeof server.metadata?.lastAuth?.authUrl === "string"
        ? (server.metadata?.lastAuth?.authUrl as string)
        : null;

    return {
      id: server.id,
      url: server.url,
      status: server.status,
      metadata: server.metadata,
      createdAt: server.createdAt,
      updatedAt: server.updatedAt,
      pendingAuthUrl,
      tools
    };
  }

  private async handleMcpToolsRequest(
    request: Request,
    segments: string[]
  ): Promise<Response> {
    if (segments.length > 0 && segments[0] === "oauth") {
      return this.handleMcpOAuthRequest(request);
    }

    if (segments.length === 0) {
      if (request.method === "GET") {
        return this.jsonResponse({
          servers: Array.from(this.mcpServers.values()).map((server) =>
            this.serializeMcpServer(server)
          )
        });
      }

      if (request.method === "POST") {
        return this.createMcpServer(request);
      }

      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET, POST" }
      });
    }

    const [serverId, ...rest] = segments;
    const server = this.mcpServers.get(serverId);
    if (!server) {
      return this.jsonResponse(
        {
          error: "Server not found",
          details: `MCP server ${serverId} not registered`
        },
        { status: 404 }
      );
    }

    if (rest.length === 0) {
      if (request.method === "GET") {
        return this.jsonResponse({ server: this.serializeMcpServer(server) });
      }

      if (request.method === "PATCH") {
        return this.updateMcpServer(server, request);
      }

      if (request.method === "DELETE") {
        return this.deleteMcpServer(server);
      }

      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET, PATCH, DELETE" }
      });
    }

    if (
      rest.length === 1 &&
      rest[0] === "refresh" &&
      request.method === "POST"
    ) {
      return this.refreshMcpServer(server);
    }

    return new Response("Not Found", { status: 404 });
  }

  private async handleMcpOAuthRequest(request: Request): Promise<Response> {
    if (request.method !== "GET") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET" }
      });
    }

    try {
      const result = await this.mcp.handleCallbackRequest(request);
      const server = this.mcpServers.get(result.serverId);
      if (server) {
        await this.persistMcpServerState(result.serverId, {
          status: "connecting",
          metadataPatch: {
            lastAuth: {
              ...(server.metadata?.lastAuth ?? {}),
              completedAt: new Date().toISOString()
            }
          }
        });
        await this.syncMcpToolsFromServer(server);
        await this.persistMcpServerState(result.serverId, {
          status: "ready"
        });
      }

      return new Response(
        "Authentication completed. You can close this window.",
        { status: 200 }
      );
    } catch (error) {
      console.error("Failed to handle MCP OAuth callback", error);
      return new Response("Failed to complete authentication", {
        status: 400
      });
    }
  }

  private async createMcpServer(request: Request): Promise<Response> {
    const bodySchema = z.object({
      id: z.string().min(1).optional(),
      url: z.string().url(),
      transportType: z
        .enum(["streamable-http", "sse"], {
          invalid_type_error: "transportType must be 'streamable-http' or 'sse'"
        })
        .optional(),
      metadata: z.record(z.unknown()).optional()
    });

    let parsed: z.infer<typeof bodySchema>;
    try {
      parsed = bodySchema.parse(await request.json());
    } catch (error) {
      return this.jsonResponse(
        {
          error: "Invalid request body",
          details: error instanceof ZodError ? error.flatten() : String(error)
        },
        { status: 400 }
      );
    }

    const serverId = parsed.id ?? generateId();
    if (this.mcpServers.has(serverId)) {
      return this.jsonResponse(
        {
          error: "Server already exists",
          details: `MCP server ${serverId} is already registered`
        },
        { status: 409 }
      );
    }

    const now = new Date().toISOString();
    const metadataInput = parsed.metadata ?? null;
    const metadataTransportFromInput =
      metadataInput &&
      typeof metadataInput === "object" &&
      !Array.isArray(metadataInput) &&
      typeof (metadataInput as Record<string, unknown>).transportType ===
        "string"
        ? ((metadataInput as Record<string, unknown>).transportType as string)
        : undefined;

    let transportType =
      this.normaliseTransportType(parsed.transportType) ??
      this.normaliseTransportType(metadataTransportFromInput);

    if (!transportType) {
      transportType = await this.discoverMcpTransport(parsed.url);
    }

    if (!transportType) {
      transportType = "streamable-http";
    }

    const metadata = this.mergeMetadata(metadataInput, {
      transportType
    });

    this
      .sql`insert into cf_agent_mcp_servers (server_id, url, metadata, status, created_at, updated_at) values (${serverId}, ${parsed.url}, ${metadata ? JSON.stringify(metadata) : null}, 'connecting', ${now}, ${now})`;

    const stored: StoredMcpServer = {
      id: serverId,
      url: parsed.url,
      metadata: metadata as StoredMcpServerMetadata | null,
      status: "connecting",
      createdAt: now,
      updatedAt: now
    };

    this.mcpServers.set(serverId, stored);

    let authUrl: string | null = null;
    try {
      await this.ensureMcpConnected(serverId);
      authUrl =
        typeof this.mcpServers.get(serverId)?.metadata?.lastAuth?.authUrl ===
        "string"
          ? (this.mcpServers.get(serverId)?.metadata?.lastAuth
              ?.authUrl as string)
          : null;
    } catch (error) {
      console.error("Failed to initialize MCP server", error);
    }

    const serverResponse = this.serializeMcpServer(
      this.mcpServers.get(serverId) ?? stored
    );

    if (authUrl && !serverResponse.pendingAuthUrl) {
      serverResponse.pendingAuthUrl = authUrl;
    }

    return this.jsonResponse({ server: serverResponse }, { status: 201 });
  }

  private async updateMcpServer(
    server: StoredMcpServer,
    request: Request
  ): Promise<Response> {
    const bodySchema = z.object({
      url: z.string().url().optional(),
      transportType: z
        .enum(["streamable-http", "sse"], {
          invalid_type_error: "transportType must be 'streamable-http' or 'sse'"
        })
        .optional(),
      metadata: z.record(z.unknown()).nullable().optional()
    });

    let parsed: z.infer<typeof bodySchema>;
    try {
      parsed = bodySchema.parse(await request.json());
    } catch (error) {
      return this.jsonResponse(
        {
          error: "Invalid request body",
          details: error instanceof ZodError ? error.flatten() : String(error)
        },
        { status: 400 }
      );
    }

    const nextUrl = parsed.url ?? server.url;
    const metadataPatch =
      parsed.metadata === undefined ? undefined : parsed.metadata;
    const metadataSource =
      metadataPatch === undefined ? server.metadata : metadataPatch;

    const metadataTransportFromSource =
      metadataSource &&
      typeof metadataSource === "object" &&
      !Array.isArray(metadataSource) &&
      typeof (metadataSource as Record<string, unknown>).transportType ===
        "string"
        ? ((metadataSource as Record<string, unknown>).transportType as string)
        : undefined;

    let transportType =
      this.normaliseTransportType(parsed.transportType) ??
      this.normaliseTransportType(metadataTransportFromSource) ??
      this.normaliseTransportType(server.metadata?.transportType);

    if (!transportType) {
      transportType = await this.discoverMcpTransport(nextUrl);
    }

    if (!transportType) {
      transportType = "streamable-http";
    }

    const metadata = this.mergeMetadata(metadataSource, {
      transportType
    });
    const updatedAt = new Date().toISOString();

    this
      .sql`update cf_agent_mcp_servers set url = ${nextUrl}, metadata = ${metadata ? JSON.stringify(metadata) : null}, updated_at = ${updatedAt} where server_id = ${server.id}`;

    const updated: StoredMcpServer = {
      ...server,
      url: nextUrl,
      metadata,
      updatedAt
    };
    this.mcpServers.set(server.id, updated);

    if (parsed.url || parsed.metadata) {
      try {
        await this.ensureMcpConnected(server.id);
      } catch (error) {
        console.error("Failed to reconnect MCP server after update", error);
      }
    }

    return this.jsonResponse({ server: this.serializeMcpServer(updated) });
  }

  private async deleteMcpServer(server: StoredMcpServer): Promise<Response> {
    const removedNames = this.toolRegistry.removeMcpServer(server.id);
    const now = new Date().toISOString();

    for (const name of removedNames) {
      this
        .sql`insert or replace into cf_agent_tool_deletions (tool_name, deleted_at) values (${name}, ${now})`;
      this.sql`delete from cf_agent_tool_guidance where tool_name = ${name}`;
    }

    this.sql`delete from cf_agent_mcp_tools where server_id = ${server.id}`;
    this.sql`delete from cf_agent_mcp_tokens where server_id = ${server.id}`;
    this.sql`delete from cf_agent_mcp_servers where server_id = ${server.id}`;

    this.mcpServers.delete(server.id);
    this.mcpConnectionPromises.delete(server.id);

    try {
      await this.mcp.closeConnection(server.id);
    } catch (error) {
      console.warn("Failed to close MCP connection during deletion", error);
    }

    return this.jsonResponse({
      removed: server.id,
      deletedTools: removedNames
    });
  }

  private async refreshMcpServer(server: StoredMcpServer): Promise<Response> {
    try {
      await this.mcp.closeConnection(server.id);
    } catch (error) {
      console.warn("Failed to close MCP connection before refresh", error);
    }

    this.mcpConnectionPromises.delete(server.id);

    try {
      await this.ensureMcpConnected(server.id);
    } catch (error) {
      console.error("Failed to refresh MCP server", error);
      return this.jsonResponse(
        {
          error: "Failed to refresh server",
          details: String(error)
        },
        { status: 500 }
      );
    }

    const refreshed = this.mcpServers.get(server.id) ?? server;
    return this.jsonResponse({ server: this.serializeMcpServer(refreshed) });
  }

  private listHandoffAgentIds(profileId: string): string[] {
    this.ensureAgentRegistry();
    const rows = this
      .sql`select handoff_id from cf_agent_profile_handoffs where profile_id = ${profileId} order by handoff_id asc`;
    if (!Array.isArray(rows)) {
      return [];
    }
    const ids: string[] = [];
    for (const row of rows) {
      const value = row?.handoff_id as string | undefined;
      if (typeof value === "string" && value.length > 0) {
        ids.push(value);
      }
    }
    return ids;
  }

  private hydrateProfileHandoffs(profile: AgentProfile): AgentProfile {
    const storedIds = this.listHandoffAgentIds(profile.id);
    if (storedIds.length === profile.handoffAgentIds.length) {
      const sameOrder = storedIds.every(
        (id, index) => id === profile.handoffAgentIds[index]
      );
      if (sameOrder) {
        return profile;
      }
    }
    return {
      ...profile,
      handoffAgentIds: storedIds
    } satisfies AgentProfile;
  }

  private replaceProfileHandoffs(profileId: string, handoffIds: string[]) {
    this.ensureAgentRegistry();
    this
      .sql`delete from cf_agent_profile_handoffs where profile_id = ${profileId}`;
    if (handoffIds.length === 0) {
      return;
    }
    const now = new Date().toISOString();
    for (const handoffId of handoffIds) {
      this
        .sql`insert or replace into cf_agent_profile_handoffs (profile_id, handoff_id, created_at) values (${profileId}, ${handoffId}, ${now})`;
    }
  }

  private normalizeHandoffAgentIds(
    profileId: string,
    handoffIds: string[] | null | undefined
  ): string[] {
    if (!handoffIds || handoffIds.length === 0) {
      return [];
    }

    const cleaned = handoffIds
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    const unique: string[] = [];
    const seen = new Set<string>();
    for (const id of cleaned) {
      if (seen.has(id)) continue;
      seen.add(id);
      unique.push(id);
    }

    if (unique.includes(profileId)) {
      throw new Error("An agent cannot hand off to itself");
    }

    for (const id of unique) {
      const rows = this
        .sql`select id from cf_agent_profiles where id = ${id} limit 1`;
      if (!Array.isArray(rows) || rows.length === 0) {
        throw new Error(`Handoff agent ${id} not found`);
      }
    }

    unique.sort();
    return unique;
  }

  private async resolveTargetProfile({
    activeProfile,
    cleanedMessages
  }: {
    activeProfile: AgentProfile;
    cleanedMessages: UIMessage<ChatMessageMetadata>[];
  }): Promise<{
    profile: AgentProfile;
    source: "active" | "handoff";
    reason?: string;
  }> {
    const handoffProfiles = activeProfile.handoffAgentIds
      .map((id) => this.getAgentProfile(id))
      .filter((profile): profile is AgentProfile => profile !== null);

    if (handoffProfiles.length === 0) {
      return { profile: activeProfile, source: "active" };
    }

    try {
      const decision = await this.selectHandoffAgent({
        activeProfile,
        handoffProfiles,
        messages: cleanedMessages
      });
      if (decision) {
        return {
          profile: decision.profile,
          source: "handoff",
          reason: decision.reason
        };
      }
    } catch (error) {
      console.error("Failed to determine handoff agent", error);
    }

    return { profile: activeProfile, source: "active" };
  }

  private async selectHandoffAgent({
    activeProfile,
    handoffProfiles,
    messages
  }: {
    activeProfile: AgentProfile;
    handoffProfiles: AgentProfile[];
    messages: UIMessage<ChatMessageMetadata>[];
  }): Promise<{ profile: AgentProfile; reason?: string } | null> {
    const userMessages = messages.filter((message) => message.role === "user");
    if (userMessages.length === 0) {
      return null;
    }

    const roster = handoffProfiles
      .map((profile) => {
        const { effectiveToolNames } = this.getToolsForProfile(profile);
        const toolSummary =
          effectiveToolNames.length > 0
            ? effectiveToolNames.join(", ")
            : "No tool access";
        return `- ${profile.name} (id: ${profile.id}): ${profile.behavior} Tools: ${toolSummary}`;
      })
      .join("\n");

    const systemPrompt = `${activeProfile.config.systemPrompt.trim()}

You are an orchestration agent responsible for routing user messages to the most capable specialist assistant. Review the conversation so far and select the best agent from the list below. If none apply, choose null.

Respond ONLY with strict JSON of the form {"agentId": "<id or null>", "reason": "<short explanation>"}.

Specialist agents:\n${roster}`;

    try {
      const { text } = await generateText({
        model: openai(activeProfile.config.modelId),
        system: systemPrompt,
        messages: convertToModelMessages(messages),
        temperature: Math.min(
          0.4,
          Math.max(0.1, activeProfile.config.temperature)
        ),
        stopWhen: stepCountIs(
          Math.max(1, Math.min(4, activeProfile.config.maxSteps))
        )
      });

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return null;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch (error) {
        console.warn("Failed to parse triage JSON", error, text);
        return null;
      }
      if (!parsed || typeof parsed !== "object") {
        return null;
      }
      const agentId = (parsed as { agentId?: unknown }).agentId;
      const reasonRaw = (parsed as { reason?: unknown }).reason;
      const reason = typeof reasonRaw === "string" ? reasonRaw : undefined;

      if (agentId === null || agentId === "null") {
        return null;
      }

      if (typeof agentId !== "string" || agentId.length === 0) {
        return null;
      }

      const selected = handoffProfiles.find(
        (profile) => profile.id === agentId
      );
      if (!selected) {
        return null;
      }

      return { profile: selected, reason };
    } catch (error) {
      console.error("Failed to execute triage model", error);
      return null;
    }
  }

  private buildSystemPrompt(
    profile: AgentProfile,
    toolPrompt: string,
    effectiveToolNames: string[],
    options: { reason?: string; parentName?: string } = {}
  ) {
    const scheduleGuidance = getSchedulePrompt({ date: new Date() });
    const hasScheduleTool = effectiveToolNames.includes("scheduleTask");
    const scheduleInstruction = hasScheduleTool
      ? "If the user asks to schedule a task, use the schedule tool to schedule the task."
      : "If the user asks to schedule a task, let them know scheduling is currently unavailable.";
    const selectionNote = options.reason
      ? `\n\nYou were selected by ${options.parentName ?? "the orchestrator"} because: ${options.reason}`
      : "";
    const identityInstruction = options.parentName
      ? `\nIdentify yourself as "${profile.name}" in your first sentence so the user knows which specialist is responding.`
      : "";
    const toolsSection = toolPrompt
      ? `\n\nTOOLS AVAILABLE (read carefully before responding):\n${toolPrompt}`
      : "";

    return `${profile.config.systemPrompt.trim()}

${scheduleGuidance}

${scheduleInstruction}${selectionNote}${identityInstruction}${toolsSection}`;
  }

  private reloadToolRegistryFromStorage() {
    this.toolRegistry = createToolRegistry(() => new Date());
    this.toolRegistryInitialized = false;
    this.ensureToolRegistry();
  }

  private parseAgentProfileRow(row: unknown): AgentProfile | null {
    if (!row || typeof row !== "object") {
      return null;
    }

    const { profile } = row as Partial<AgentProfileRow>;
    if (typeof profile !== "string") {
      return null;
    }

    try {
      const parsed = JSON.parse(profile) as unknown;
      const validated = agentProfileValidators.full.parse(parsed);
      return this.hydrateProfileHandoffs(validated);
    } catch (error) {
      console.error("Failed to parse agent profile", error);
      return null;
    }
  }

  private listAgentProfiles(): AgentProfile[] {
    this.ensureAgentRegistry();
    const rows = this
      .sql`select id, profile from cf_agent_profiles order by datetime(json_extract(profile, '$.createdAt')) asc`;
    if (!rows || !Array.isArray(rows)) {
      return [];
    }
    return rows
      .map((row) => this.parseAgentProfileRow(row))
      .filter((profile): profile is AgentProfile => profile !== null);
  }

  private getAgentProfile(id: string): AgentProfile | null {
    this.ensureAgentRegistry();
    const rows = this
      .sql`select id, profile from cf_agent_profiles where id = ${id} limit 1`;
    if (!rows || rows.length === 0) {
      return null;
    }
    return this.parseAgentProfileRow(rows[0]) ?? null;
  }

  private saveAgentProfile(profile: AgentProfile) {
    this.ensureAgentRegistry();
    this
      .sql`insert or replace into cf_agent_profiles (id, profile) values (${profile.id}, ${JSON.stringify(profile)})`;
    this.replaceProfileHandoffs(profile.id, profile.handoffAgentIds);
  }

  private deleteAgentProfile(id: string) {
    this.ensureAgentRegistry();
    this.sql`delete from cf_agent_profile_handoffs where profile_id = ${id}`;
    this.sql`delete from cf_agent_profile_handoffs where handoff_id = ${id}`;
    this.sql`delete from cf_agent_profiles where id = ${id}`;
  }

  private getActiveAgentId(): string | null {
    this.ensureAgentRegistry();
    const rows = this
      .sql`select agent_id from cf_agent_active_profile where pk = 1`;
    if (!rows || rows.length === 0) {
      return null;
    }
    const agentId = rows[0]?.agent_id as string | undefined;
    return agentId ?? null;
  }

  private setActiveAgentId(id: string) {
    this.ensureAgentRegistry();
    this
      .sql`insert or replace into cf_agent_active_profile (pk, agent_id) values (1, ${id})`;
  }

  private getActiveAgentProfile(): AgentProfile {
    const activeId = this.getActiveAgentId();
    if (activeId) {
      const existing = this.getAgentProfile(activeId);
      if (existing) {
        return existing;
      }
    }

    const allProfiles = this.listAgentProfiles();
    if (allProfiles.length > 0) {
      const fallback = allProfiles[0];
      this.setActiveAgentId(fallback.id);
      return fallback;
    }

    const defaultProfile = createDefaultAgentProfile();
    this.saveAgentProfile(defaultProfile);
    this.setActiveAgentId(defaultProfile.id);
    return defaultProfile;
  }

  private getToolsForProfile(profile: AgentProfile) {
    this.ensureToolRegistry();
    const registryTools = this.toolRegistry.getToolSet();
    const combinedTools: Record<string, ToolSet[string]> = {
      ...registryTools
    };

    const allowedNames =
      profile.toolNames && profile.toolNames.length > 0
        ? new Set(profile.toolNames)
        : null;

    let selectedTools: Record<string, ToolSet[string]> = combinedTools;
    if (allowedNames) {
      selectedTools = {};
      for (const name of allowedNames) {
        if (name in combinedTools) {
          selectedTools[name] = combinedTools[name];
        }
      }
    }

    const effectiveToolNames = Object.keys(selectedTools);

    return {
      tools: selectedTools as ToolSet,
      effectiveToolNames,
      toolPrompt: this.toolRegistry.getToolPrompt(
        allowedNames ? Array.from(allowedNames) : undefined
      )
    };
  }

  private buildAgentPayload(profile: AgentProfile) {
    const toolInfo = this.getToolsForProfile(profile);
    return {
      agent: profile,
      config: profile.config,
      effectiveToolNames: toolInfo.effectiveToolNames,
      toolPrompt: toolInfo.toolPrompt
    };
  }

  private registerOpenApiSpecPersistent(args: { name?: string; spec: string }) {
    this.ensureToolRegistry();
    const specName = (args.name ?? "openapi-spec").trim() || "openapi-spec";
    const now = new Date().toISOString();

    let createdAt = now;
    const existing = this
      .sql`select created_at from cf_agent_tool_specs where spec_name = ${specName} limit 1`;
    if (Array.isArray(existing) && existing.length > 0) {
      createdAt = (existing[0]?.created_at as string | undefined) ?? now;
    }

    let result: RegisterOpenApiSpecResult;
    try {
      result = this.toolRegistry.registerOpenApiSpec(
        { name: specName, spec: args.spec },
        { timestamp: now }
      );
    } catch (error) {
      this.reloadToolRegistryFromStorage();
      throw error;
    }

    try {
      this
        .sql`insert or replace into cf_agent_tool_specs (spec_name, spec, created_at, updated_at) values (${specName}, ${args.spec}, ${createdAt}, ${now})`;
      for (const tool of result.tools) {
        this.toolRegistry.unmarkToolDeletion(tool.name);
        this
          .sql`delete from cf_agent_tool_deletions where tool_name = ${tool.name}`;
      }
    } catch (error) {
      console.error("Failed to persist tool specification", error);
      this.reloadToolRegistryFromStorage();
      throw error;
    }

    return result;
  }

  private updateToolGuidancePersistent(name: string, description: string) {
    this.ensureToolRegistry();
    const updated: ToolListItem = this.toolRegistry.setGuidanceOverride(
      name,
      description
    );

    try {
      this
        .sql`insert or replace into cf_agent_tool_guidance (tool_name, description, updated_at) values (${name}, ${description}, ${updated.updatedAt})`;
    } catch (error) {
      console.error("Failed to persist tool guidance", error);
      this.reloadToolRegistryFromStorage();
      throw error;
    }

    return updated;
  }

  private deleteToolPersistent(name: string) {
    this.ensureToolRegistry();
    const deletedAt = this.toolRegistry.markToolDeleted(name);

    try {
      this
        .sql`insert or replace into cf_agent_tool_deletions (tool_name, deleted_at) values (${name}, ${deletedAt})`;
      this.sql`delete from cf_agent_tool_guidance where tool_name = ${name}`;
    } catch (error) {
      console.error("Failed to persist tool deletion", error);
      this.reloadToolRegistryFromStorage();
      throw error;
    }
  }

  private async handleToolsRequest(
    request: Request,
    segments: string[]
  ): Promise<Response> {
    this.ensureToolRegistry();

    if (segments.length === 0) {
      if (request.method === "GET") {
        return this.jsonResponse({
          tools: this.toolRegistry.listTools(),
          prompt: this.toolRegistry.getToolPrompt()
        });
      }

      if (request.method === "POST") {
        const bodySchema = z.object({
          name: z.string().min(1).optional(),
          spec: z.string().min(1)
        });

        let parsedBody: z.infer<typeof bodySchema>;
        try {
          parsedBody = bodySchema.parse(await request.json());
        } catch (error) {
          return this.jsonResponse(
            {
              error: "Invalid request body",
              details:
                error instanceof ZodError ? error.flatten() : String(error)
            },
            { status: 400 }
          );
        }

        try {
          const result = this.registerOpenApiSpecPersistent(parsedBody);
          return this.jsonResponse(result, { status: 201 });
        } catch (error) {
          console.error("Error registering OpenAPI spec", error);
          const status = error instanceof OpenApiToolError ? 400 : 500;
          return this.jsonResponse(
            {
              error: "Failed to register tool specification",
              details: String(error)
            },
            { status }
          );
        }
      }

      return new Response("Method Not Allowed", {
        status: 405,
        headers: {
          Allow: "GET, POST"
        }
      });
    }

    if (segments[0] === "mcp") {
      return this.handleMcpToolsRequest(request, segments.slice(1));
    }

    const [toolName] = segments;
    const decodedName = decodeURIComponent(toolName);

    if (request.method === "PATCH") {
      const bodySchema = z.object({
        description: z.string().min(1)
      });

      let parsedBody: z.infer<typeof bodySchema>;
      try {
        parsedBody = bodySchema.parse(await request.json());
      } catch (error) {
        return this.jsonResponse(
          {
            error: "Invalid request body",
            details: error instanceof ZodError ? error.flatten() : String(error)
          },
          { status: 400 }
        );
      }

      try {
        const tool = this.updateToolGuidancePersistent(
          decodedName,
          parsedBody.description
        );
        return this.jsonResponse({
          tool,
          prompt: this.toolRegistry.getToolPrompt()
        });
      } catch (error) {
        console.error("Error updating tool guidance", error);
        const status = error instanceof OpenApiToolError ? 404 : 500;
        return this.jsonResponse(
          {
            error: "Failed to update tool",
            details: String(error)
          },
          { status }
        );
      }
    }

    if (request.method === "DELETE") {
      try {
        this.deleteToolPersistent(decodedName);
        return this.jsonResponse({
          prompt: this.toolRegistry.getToolPrompt()
        });
      } catch (error) {
        console.error("Error deleting tool", error);
        const status = error instanceof OpenApiToolError ? 404 : 500;
        return this.jsonResponse(
          {
            error: "Failed to delete tool",
            details: String(error)
          },
          { status }
        );
      }
    }

    return new Response("Method Not Allowed", {
      status: 405,
      headers: {
        Allow: "PATCH, DELETE"
      }
    });
  }

  private createAgentProfileEntry(input: AgentProfileInput): AgentProfile {
    this.ensureAgentRegistry();
    const parsedInput = agentProfileValidators.create.parse(input);
    const id = crypto.randomUUID();
    const normalizedHandoffs = this.normalizeHandoffAgentIds(
      id,
      parsedInput.handoffAgentIds ?? []
    );
    const profile = createAgentProfile({
      ...parsedInput,
      id,
      handoffAgentIds: normalizedHandoffs
    });
    this.saveAgentProfile(profile);
    return profile;
  }

  private updateAgentProfileEntry(
    id: string,
    update: AgentProfileUpdateInput
  ): AgentProfile {
    this.ensureAgentRegistry();
    const parsedUpdate = agentProfileValidators.update.parse(update);
    const existing = this.getAgentProfile(id);
    if (!existing) {
      throw new Error(`Agent ${id} not found`);
    }
    const normalizedUpdate =
      parsedUpdate.handoffAgentIds !== undefined
        ? {
            ...parsedUpdate,
            handoffAgentIds: this.normalizeHandoffAgentIds(
              id,
              parsedUpdate.handoffAgentIds ?? []
            )
          }
        : parsedUpdate;
    const merged = mergeAgentProfile(existing, normalizedUpdate);
    this.saveAgentProfile(merged);
    return merged;
  }

  private deleteAgentProfileEntry(id: string): AgentProfile | null {
    this.ensureAgentRegistry();
    const existing = this.getAgentProfile(id);
    if (!existing) {
      return null;
    }

    const referencingRows = this
      .sql`select profile_id from cf_agent_profile_handoffs where handoff_id = ${id}`;
    if (Array.isArray(referencingRows)) {
      for (const row of referencingRows) {
        const profileId = row?.profile_id as string | undefined;
        if (!profileId) continue;
        if (profileId === id) continue;
        const profile = this.getAgentProfile(profileId);
        if (!profile) continue;
        const filtered = profile.handoffAgentIds.filter(
          (handoffId) => handoffId !== id
        );
        if (filtered.length === profile.handoffAgentIds.length) {
          continue;
        }
        const updated = mergeAgentProfile(profile, {
          handoffAgentIds: filtered
        });
        this.saveAgentProfile(updated);
      }
    }

    const activeId = this.getActiveAgentId();
    this.deleteAgentProfile(id);

    if (activeId === id) {
      const remaining = this.listAgentProfiles();
      if (remaining.length === 0) {
        const defaultProfile = createDefaultAgentProfile();
        this.saveAgentProfile(defaultProfile);
        this.setActiveAgentId(defaultProfile.id);
      } else {
        this.setActiveAgentId(remaining[0].id);
      }
    }

    return existing;
  }

  private setActiveAgentProfile(id: string): AgentProfile {
    this.ensureAgentRegistry();
    const profile = this.getAgentProfile(id);
    if (!profile) {
      throw new Error(`Agent ${id} not found`);
    }
    this.setActiveAgentId(profile.id);
    return profile;
  }

  private jsonResponse(body: unknown, init: ResponseInit = {}) {
    const headers = new Headers(init.headers ?? {});
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    return new Response(JSON.stringify(body), {
      ...init,
      headers
    });
  }

  override async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const internalIndex = url.pathname.indexOf(INTERNAL_AGENT_PREFIX);
    if (internalIndex !== -1) {
      const internalPath = url.pathname.slice(internalIndex);
      const internalUrl = new URL(request.url);
      internalUrl.pathname = internalPath;
      return this.handleInternalAgentRequest(request, internalPath);
    }
    return super.onRequest(request);
  }

  private async handleInternalAgentRequest(
    request: Request,
    internalPath: string
  ) {
    const relativePath =
      internalPath.length > INTERNAL_AGENT_PREFIX.length
        ? internalPath.slice(INTERNAL_AGENT_PREFIX.length)
        : "/";
    const segments = relativePath.split("/").filter(Boolean);

    if (segments.length === 0) {
      return new Response("Not Found", { status: 404 });
    }

    const [head, ...rest] = segments;
    if (head === "agent-config") {
      return this.handleAgentConfigRequest(request);
    }

    if (head === "agents") {
      return this.handleAgentsRequest(request, rest);
    }

    if (head === "tools") {
      return this.handleToolsRequest(request, rest);
    }

    return new Response("Not Found", { status: 404 });
  }

  private async handleAgentConfigRequest(request: Request): Promise<Response> {
    const activeProfile = this.getActiveAgentProfile();
    const basePayload = this.buildAgentPayload(activeProfile);

    if (request.method === "GET") {
      return this.jsonResponse({
        ...basePayload,
        defaults: defaultAgentConfig,
        allowedModels: Array.from(ALLOWED_MODEL_IDS)
      });
    }

    if (request.method === "PATCH") {
      let parsedBody: unknown;
      try {
        parsedBody = await request.json();
      } catch (error) {
        return this.jsonResponse(
          {
            error: "Invalid JSON body",
            details: String(error)
          },
          { status: 400 }
        );
      }

      let configUpdate: AgentProfileUpdateInput["config"];
      try {
        configUpdate = agentConfigValidators.update.parse(parsedBody);
      } catch (error) {
        const details =
          error instanceof ZodError ? error.flatten() : String(error);
        return this.jsonResponse(
          {
            error: "Invalid agent configuration",
            details
          },
          { status: 400 }
        );
      }

      const updatedProfile = this.updateAgentProfileEntry(activeProfile.id, {
        config: configUpdate
      });
      return this.jsonResponse(this.buildAgentPayload(updatedProfile));
    }

    if (request.method === "DELETE") {
      if (request.headers.get("cf-agent-config-reset") !== "confirm") {
        return this.jsonResponse(
          {
            error: "Missing confirmation header"
          },
          { status: 400 }
        );
      }

      const freshDefault = createAgentConfig();
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { updatedAt: _unused, ...configWithoutTimestamp } = freshDefault;
      const updatedProfile = this.updateAgentProfileEntry(activeProfile.id, {
        config: configWithoutTimestamp
      });

      return this.jsonResponse(this.buildAgentPayload(updatedProfile));
    }

    return new Response("Method Not Allowed", {
      status: 405,
      headers: {
        Allow: "GET, PATCH, DELETE"
      }
    });
  }

  private async handleAgentsRequest(
    request: Request,
    segments: string[]
  ): Promise<Response> {
    if (segments.length === 0) {
      if (request.method === "GET") {
        const active = this.getActiveAgentProfile();
        const activePayload = this.buildAgentPayload(active);
        return this.jsonResponse({
          agents: this.listAgentProfiles(),
          activeAgentId: active.id,
          activeAgent: active,
          activeAgentEffectiveToolNames: activePayload.effectiveToolNames,
          activeAgentToolPrompt: activePayload.toolPrompt,
          allowedModels: Array.from(ALLOWED_MODEL_IDS),
          defaults: createDefaultAgentProfile()
        });
      }

      if (request.method === "POST") {
        let parsedBody: unknown;
        try {
          parsedBody = await request.json();
        } catch (error) {
          return this.jsonResponse(
            {
              error: "Invalid JSON body",
              details: String(error)
            },
            { status: 400 }
          );
        }

        const createSchema = agentProfileValidators.create.extend({
          setActive: z.boolean().optional()
        });

        let createInput: z.infer<typeof createSchema>;
        try {
          createInput = createSchema.parse(parsedBody);
        } catch (error) {
          const details =
            error instanceof ZodError ? error.flatten() : String(error);
          return this.jsonResponse(
            {
              error: "Invalid agent definition",
              details
            },
            { status: 400 }
          );
        }

        const { setActive, ...agentInput } = createInput;
        let profile: AgentProfile;
        try {
          profile = this.createAgentProfileEntry(agentInput);
        } catch (error) {
          return this.jsonResponse(
            {
              error: "Failed to create agent",
              details: String(error)
            },
            { status: 400 }
          );
        }
        if (setActive) {
          this.setActiveAgentProfile(profile.id);
        }

        const active = this.getActiveAgentProfile();
        const activePayload = this.buildAgentPayload(active);
        return this.jsonResponse(
          {
            agent: profile,
            activeAgentId: active.id,
            activeAgent: active,
            activeAgentEffectiveToolNames: activePayload.effectiveToolNames,
            activeAgentToolPrompt: activePayload.toolPrompt
          },
          { status: 201 }
        );
      }

      return new Response("Method Not Allowed", {
        status: 405,
        headers: {
          Allow: "GET, POST"
        }
      });
    }

    const [rawAgentId, ...rest] = segments;
    const agentId = decodeURIComponent(rawAgentId);

    if (rest.length === 0) {
      if (request.method === "GET") {
        const agent = this.getAgentProfile(agentId);
        if (!agent) {
          return this.jsonResponse(
            {
              error: "Agent not found"
            },
            { status: 404 }
          );
        }

        return this.jsonResponse({
          agent,
          activeAgentId: this.getActiveAgentId()
        });
      }

      if (request.method === "PATCH") {
        let parsedBody: unknown;
        try {
          parsedBody = await request.json();
        } catch (error) {
          return this.jsonResponse(
            {
              error: "Invalid JSON body",
              details: String(error)
            },
            { status: 400 }
          );
        }

        let updateInput: AgentProfileUpdateInput;
        try {
          updateInput = agentProfileValidators.update.parse(parsedBody);
        } catch (error) {
          const details =
            error instanceof ZodError ? error.flatten() : String(error);
          return this.jsonResponse(
            {
              error: "Invalid agent update",
              details
            },
            { status: 400 }
          );
        }

        try {
          const updated = this.updateAgentProfileEntry(agentId, updateInput);
          const active = this.getActiveAgentProfile();
          const activePayload = this.buildAgentPayload(active);
          return this.jsonResponse({
            agent: updated,
            activeAgentId: active.id,
            activeAgent: active,
            activeAgentEffectiveToolNames: activePayload.effectiveToolNames,
            activeAgentToolPrompt: activePayload.toolPrompt
          });
        } catch (error) {
          const message = String(error);
          const status = message.includes("not found") ? 404 : 400;
          return this.jsonResponse(
            {
              error:
                status === 404 ? "Agent not found" : "Invalid agent update",
              details: message
            },
            { status }
          );
        }
      }

      if (request.method === "DELETE") {
        const removed = this.deleteAgentProfileEntry(agentId);
        if (!removed) {
          return this.jsonResponse(
            {
              error: "Agent not found"
            },
            { status: 404 }
          );
        }

        const active = this.getActiveAgentProfile();
        const activePayload = this.buildAgentPayload(active);
        return this.jsonResponse({
          removed: agentId,
          activeAgentId: active.id,
          activeAgent: active,
          activeAgentEffectiveToolNames: activePayload.effectiveToolNames,
          activeAgentToolPrompt: activePayload.toolPrompt
        });
      }

      return new Response("Method Not Allowed", {
        status: 405,
        headers: {
          Allow: "GET, PATCH, DELETE"
        }
      });
    }

    const [action] = rest;
    if (action === "select" && request.method === "POST") {
      try {
        const active = this.setActiveAgentProfile(agentId);
        const activePayload = this.buildAgentPayload(active);
        return this.jsonResponse({
          agent: active,
          activeAgentId: active.id,
          activeAgentEffectiveToolNames: activePayload.effectiveToolNames,
          activeAgentToolPrompt: activePayload.toolPrompt
        });
      } catch (error) {
        return this.jsonResponse(
          {
            error: "Agent not found",
            details: String(error)
          },
          { status: 404 }
        );
      }
    }

    return new Response("Not Found", { status: 404 });
  }

  /**
   * Handles incoming chat messages and manages the response stream
   */
  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    _options?: { abortSignal?: AbortSignal }
  ) {
    // const mcpConnection = await this.mcp.connect(
    //   "https://path-to-mcp-server/sse"
    // );

    // Collect all tools, including MCP tools
    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        // Clean up incomplete tool calls to prevent API errors
        const cleanedMessages = cleanupMessages(
          this.messages
        ) as UIMessage<ChatMessageMetadata>[];

        const activeProfile = this.getActiveAgentProfile();
        const {
          profile: targetProfile,
          source,
          reason
        } = await this.resolveTargetProfile({
          activeProfile,
          cleanedMessages
        });

        const {
          tools: selectedTools,
          effectiveToolNames,
          toolPrompt
        } = this.getToolsForProfile(targetProfile);

        const respondingAgentMetadata: RespondingAgentMetadata = {
          id: targetProfile.id,
          name: targetProfile.name,
          source,
          orchestratorId: activeProfile.id,
          orchestratorName: activeProfile.name,
          reason: reason ?? null
        };

        this.pendingRespondingAgent = respondingAgentMetadata;

        writer.write({
          type: "message-metadata",
          messageMetadata: {
            respondingAgent: respondingAgentMetadata
          }
        });

        this.ensureToolRegistry();
        const executionHandlers = this.toolRegistry.getExecutionHandlers();
        const allowedExecutionNames = new Set(effectiveToolNames);
        const selectedExecutions = Object.fromEntries(
          Object.entries(executionHandlers).filter(([name]) =>
            allowedExecutionNames.has(name)
          )
        ) as typeof executionHandlers;

        const processedMessages = await processToolCalls({
          messages: cleanedMessages,
          dataStream: writer,
          tools: selectedTools,
          executions: selectedExecutions
        });

        const systemPrompt = this.buildSystemPrompt(
          targetProfile,
          toolPrompt,
          effectiveToolNames,
          source === "handoff"
            ? { reason, parentName: activeProfile.name }
            : undefined
        );

        const model = openai(targetProfile.config.modelId);

        const result = streamText({
          system: systemPrompt,
          messages: convertToModelMessages(processedMessages),
          model,
          temperature: targetProfile.config.temperature,
          tools: selectedTools,
          onFinish,
          stopWhen: stepCountIs(targetProfile.config.maxSteps)
        });

        writer.merge(result.toUIMessageStream());
      }
    });

    return createUIMessageStreamResponse({ stream });
  }

  override async saveMessages(messages: UIMessage[]): Promise<void> {
    const metadata = this.pendingRespondingAgent;
    console.log("[saveMessages] metadata present?", metadata);

    if (!metadata) {
      await super.saveMessages(messages);
      return;
    }

    console.log("[saveMessages] pending responding agent", metadata);

    let lastAssistantIndex = -1;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === "assistant") {
        lastAssistantIndex = index;
        break;
      }
    }

    if (lastAssistantIndex === -1) {
      await super.saveMessages(messages);
      return;
    }

    const targetMessage = messages[
      lastAssistantIndex
    ] as UIMessage<ChatMessageMetadata>;
    console.log("[saveMessages] incoming assistant message", targetMessage);
    const parts = targetMessage.parts ?? [];
    const hasAssistantContent = parts.some((part) => {
      if (part.type === "text") {
        return part.text.trim().length > 0;
      }
      return part.type === "reasoning";
    });

    if (!hasAssistantContent) {
      await super.saveMessages(messages);
      return;
    }

    const existingMetadata = targetMessage.metadata?.respondingAgent;
    if (
      existingMetadata &&
      existingMetadata.id === metadata.id &&
      existingMetadata.source === metadata.source
    ) {
      this.pendingRespondingAgent = null;
      await super.saveMessages(messages);
      return;
    }

    const augmented = messages.map((message, index) => {
      if (index !== lastAssistantIndex) {
        return message;
      }
      const currentMetadata =
        (message.metadata as ChatMessageMetadata | undefined) ?? {};
      const updatedMessage: UIMessage<ChatMessageMetadata> = {
        ...message,
        metadata: {
          ...currentMetadata,
          respondingAgent: metadata
        }
      };
      return updatedMessage;
    });

    console.log(
      "[saveMessages] augmented assistant message",
      augmented[lastAssistantIndex]
    );

    this.pendingRespondingAgent = null;
    await super.saveMessages(augmented as UIMessage[]);
  }
  async executeTask(description: string, _task: Schedule<string>) {
    await this.saveMessages([
      ...this.messages,
      {
        id: generateId(),
        role: "user",
        parts: [
          {
            type: "text",
            text: `Running scheduled task: ${description}`
          }
        ],
        metadata: {
          createdAt: new Date()
        }
      }
    ]);
  }
}

/**
 * Worker entry point that routes incoming requests to the appropriate handler
 */
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/check-open-ai-key") {
      const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
      return Response.json({
        success: hasOpenAIKey
      });
    }

    if (url.pathname === "/api/agent-config") {
      return forwardToAgentDurableObject(
        env,
        request,
        toInternalAgentPath(url.pathname)
      );
    }

    if (url.pathname.startsWith("/api/agents")) {
      return forwardToAgentDurableObject(
        env,
        request,
        toInternalAgentPath(url.pathname)
      );
    }

    if (
      url.pathname === "/api/tools" ||
      url.pathname.startsWith("/api/tools/")
    ) {
      return forwardToAgentDurableObject(
        env,
        request,
        toInternalAgentPath(url.pathname)
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      console.error(
        "OPENAI_API_KEY is not set, don't forget to set it locally in .dev.vars, and use `wrangler secret bulk .dev.vars` to upload it to production"
      );
    }
    return (
      // Route the request to our agent or return 404 if not found
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
