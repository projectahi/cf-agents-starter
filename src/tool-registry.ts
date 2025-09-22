import type { CoreMessage, ToolSet } from "ai";

import {
  tools as builtinTools,
  executions as builtinExecutions,
  baseToolMetadata
} from "./tools";
import { zodToJsonSchema } from "zod-to-json-schema";

import { buildToolsFromOpenApi, OpenApiToolError } from "./lib/openapi-tools";

export type RegisteredToolSource = "builtin" | "dynamic";

interface McpToolOrigin {
  type: "mcp";
  serverId: string;
  toolName: string;
}

type ToolOrigin =
  | {
      type: "openapi" | "manual";
      specName?: string;
      operationId?: string;
    }
  | McpToolOrigin;

export interface ToolListItem {
  name: string;
  description: string;
  requiresConfirmation: boolean;
  schema?: Record<string, unknown> | null;
  source: RegisteredToolSource;
  origin?: ToolOrigin | null;
  createdAt: string;
  updatedAt: string;
}

type ExecutionHandler = (
  // biome-ignore lint/suspicious/noExplicitAny: execution signature is dynamic per tool
  args: any,
  context: { messages: CoreMessage[]; toolCallId: string }
) => Promise<unknown>;

export interface RegisterOpenApiSpecArgs {
  name?: string;
  spec: string;
}

export interface RegisterOpenApiSpecResult {
  tools: ToolListItem[];
  prompt: string;
}

interface RegisterOptions {
  timestamp?: string;
}

export interface RegisterMcpToolDefinition {
  name: string;
  description: string;
  requiresConfirmation: boolean;
  schema?: Record<string, unknown> | null;
  tool: ToolSet[string];
  execution?: ExecutionHandler | null;
  originalName: string;
  createdAt?: string;
  updatedAt?: string;
}

function normaliseTimestamp(input?: string, fallback?: () => Date): string {
  if (input) return input;
  const now = fallback ? fallback() : new Date();
  return now.toISOString();
}

function cloneWithDescription<T extends Record<string, unknown>>(
  tool: T,
  description: string
): T {
  return {
    ...tool,
    description
  } as T;
}

export class ToolRegistry {
  private dynamicTools: ToolSet = {};
  private dynamicExecutions: Record<string, ExecutionHandler> = {};
  private dynamicToolMetadata: ToolListItem[] = [];
  private guidanceOverrides: Record<string, string> = {};
  private guidanceUpdatedAt: Record<string, string> = {};
  private deletedTools: Record<string, string> = {};

  constructor(private readonly now: () => Date = () => new Date()) {}

  private builtinMetadata(): ToolListItem[] {
    return baseToolMetadata.map((item) => {
      const override = this.guidanceOverrides[item.name];
      const updatedAt =
        this.guidanceUpdatedAt[item.name] ?? new Date(0).toISOString();
      return {
        name: item.name,
        description: override ?? item.description,
        requiresConfirmation: item.requiresConfirmation,
        schema: zodToJsonSchema(item.inputSchema),
        source: item.source,
        origin: { type: "manual" },
        createdAt: new Date(0).toISOString(),
        updatedAt
      } satisfies ToolListItem;
    });
  }

  listTools(): ToolListItem[] {
    return [...this.builtinMetadata(), ...this.dynamicToolMetadata];
  }

  getToolSet(): ToolSet {
    const combined: Record<string, ToolSet[string]> = {
      ...builtinTools,
      ...this.dynamicTools
    };

    for (const [name, override] of Object.entries(this.guidanceOverrides)) {
      if (!override) continue;
      if (!(name in combined)) continue;
      combined[name] = cloneWithDescription(combined[name], override);
    }

    return combined as ToolSet;
  }

  getExecutionHandlers(): Record<string, ExecutionHandler> {
    return {
      ...builtinExecutions,
      ...this.dynamicExecutions
    } satisfies Record<string, ExecutionHandler>;
  }

  getToolPrompt(allowedNames?: string[] | null): string {
    const allowed =
      allowedNames && allowedNames.length > 0 ? new Set(allowedNames) : null;
    return this.listTools()
      .filter((tool) => !allowed || allowed.has(tool.name))
      .map((tool) => `- ${tool.name}: ${tool.description}`)
      .join("\n");
  }

  registerOpenApiSpec(
    args: RegisterOpenApiSpecArgs,
    options: RegisterOptions = {}
  ): RegisterOpenApiSpecResult {
    const specName = (args.name ?? "openapi-spec").trim() || "openapi-spec";

    let generated: ReturnType<typeof buildToolsFromOpenApi>;
    try {
      generated = buildToolsFromOpenApi(args.spec, { specName });
    } catch (error) {
      if (error instanceof OpenApiToolError) {
        throw error;
      }
      throw new OpenApiToolError(`Failed to build tools: ${String(error)}`);
    }

    // Remove any previously registered tools for this spec before we start.
    for (
      let index = this.dynamicToolMetadata.length - 1;
      index >= 0;
      index -= 1
    ) {
      const metadata = this.dynamicToolMetadata[index];
      if (
        metadata.origin?.type === "openapi" &&
        metadata.origin.specName === specName
      ) {
        delete this.dynamicTools[metadata.name];
        delete this.dynamicExecutions[metadata.name];
        this.dynamicToolMetadata.splice(index, 1);
        delete this.deletedTools[metadata.name];
      }
    }

    const existingNames = new Set(
      Object.keys({
        ...builtinTools,
        ...this.dynamicTools
      })
    );

    const timestamp = normaliseTimestamp(options.timestamp, this.now);
    const registeredTools: ToolListItem[] = [];

    for (const definition of generated) {
      let finalName = definition.name;
      let suffix = 1;
      while (existingNames.has(finalName)) {
        finalName = `${definition.name}_${suffix++}`;
      }
      existingNames.add(finalName);

      const metadata: ToolListItem = {
        ...definition.metadata,
        name: finalName,
        description:
          this.guidanceOverrides[finalName] ?? definition.metadata.description,
        createdAt: definition.metadata.createdAt ?? timestamp,
        updatedAt: this.guidanceOverrides[finalName]
          ? (this.guidanceUpdatedAt[finalName] ?? timestamp)
          : (definition.metadata.updatedAt ?? timestamp)
      };

      const toolWithDescription = cloneWithDescription(
        definition.tool,
        metadata.description
      );
      this.dynamicTools[finalName] = toolWithDescription;
      delete this.deletedTools[finalName];

      if (definition.execution) {
        this.dynamicExecutions[finalName] = definition.execution;
      } else {
        delete this.dynamicExecutions[finalName];
      }

      const existingIndex = this.dynamicToolMetadata.findIndex(
        (item) => item.name === finalName
      );
      if (existingIndex !== -1) {
        this.dynamicToolMetadata.splice(existingIndex, 1);
      }

      this.dynamicToolMetadata.push(metadata);
      registeredTools.push(metadata);
    }

    return {
      tools: registeredTools,
      prompt: this.getToolPrompt()
    };
  }

  registerMcpTools(
    serverId: string,
    definitions: RegisterMcpToolDefinition[],
    options: RegisterOptions = {}
  ): ToolListItem[] {
    const timestamp = normaliseTimestamp(options.timestamp, this.now);
    const registered: ToolListItem[] = [];

    for (
      let index = this.dynamicToolMetadata.length - 1;
      index >= 0;
      index -= 1
    ) {
      const metadata = this.dynamicToolMetadata[index];
      if (
        metadata.origin?.type === "mcp" &&
        metadata.origin.serverId === serverId
      ) {
        delete this.dynamicTools[metadata.name];
        delete this.dynamicExecutions[metadata.name];
        this.dynamicToolMetadata.splice(index, 1);
        delete this.guidanceOverrides[metadata.name];
        delete this.guidanceUpdatedAt[metadata.name];
        this.deletedTools[metadata.name] = timestamp;
      }
    }

    for (const definition of definitions) {
      const name = definition.name;
      const description =
        this.guidanceOverrides[name] ?? definition.description;
      const createdAt = definition.createdAt ?? timestamp;
      const updatedAt = this.guidanceOverrides[name]
        ? (this.guidanceUpdatedAt[name] ?? timestamp)
        : (definition.updatedAt ?? timestamp);

      const metadata: ToolListItem = {
        name,
        description,
        requiresConfirmation: definition.requiresConfirmation,
        schema: definition.schema ?? null,
        source: "dynamic",
        origin: {
          type: "mcp",
          serverId,
          toolName: definition.originalName
        },
        createdAt,
        updatedAt
      } satisfies ToolListItem;

      const toolWithDescription = cloneWithDescription(
        definition.tool,
        description
      );
      this.dynamicTools[name] = toolWithDescription;
      if (definition.execution) {
        this.dynamicExecutions[name] = definition.execution;
      } else {
        delete this.dynamicExecutions[name];
      }
      this.dynamicToolMetadata.push(metadata);
      delete this.deletedTools[name];
      delete this.guidanceOverrides[name];
      delete this.guidanceUpdatedAt[name];
      registered.push(metadata);
    }

    return registered;
  }

  removeMcpServer(serverId: string, removedAt?: string): string[] {
    const timestamp = normaliseTimestamp(removedAt, this.now);
    const removedNames: string[] = [];

    for (
      let index = this.dynamicToolMetadata.length - 1;
      index >= 0;
      index -= 1
    ) {
      const metadata = this.dynamicToolMetadata[index];
      if (
        metadata.origin?.type === "mcp" &&
        metadata.origin.serverId === serverId
      ) {
        removedNames.push(metadata.name);
        this.dynamicToolMetadata.splice(index, 1);
        delete this.dynamicTools[metadata.name];
        delete this.dynamicExecutions[metadata.name];
        delete this.guidanceOverrides[metadata.name];
        delete this.guidanceUpdatedAt[metadata.name];
        this.deletedTools[metadata.name] = timestamp;
      }
    }

    return removedNames;
  }

  clearDynamicTools() {
    this.dynamicTools = {};
    this.dynamicExecutions = {};
    this.dynamicToolMetadata = [];
    for (const key of Object.keys(this.guidanceOverrides)) {
      if (!(key in builtinTools)) {
        delete this.guidanceOverrides[key];
        delete this.guidanceUpdatedAt[key];
      }
    }
    this.deletedTools = {};
  }

  setGuidanceOverride(
    name: string,
    description: string,
    updatedAt?: string
  ): ToolListItem {
    if (this.deletedTools[name]) {
      throw new OpenApiToolError(`Tool ${name} has been removed`);
    }

    this.guidanceOverrides[name] = description;
    this.guidanceUpdatedAt[name] = normaliseTimestamp(updatedAt, this.now);

    if (name in this.dynamicTools) {
      this.dynamicTools[name] = cloneWithDescription(
        this.dynamicTools[name],
        description
      );
    }

    const dynamicIndex = this.dynamicToolMetadata.findIndex(
      (item) => item.name === name
    );
    if (dynamicIndex !== -1) {
      this.dynamicToolMetadata[dynamicIndex] = {
        ...this.dynamicToolMetadata[dynamicIndex],
        description,
        updatedAt: this.guidanceUpdatedAt[name]
      };
    }

    const updated = this.listTools().find((item) => item.name === name);
    if (!updated) {
      throw new OpenApiToolError(`Tool ${name} not found`);
    }
    return updated;
  }

  applyGuidanceOverride(name: string, description: string, updatedAt: string) {
    this.guidanceOverrides[name] = description;
    this.guidanceUpdatedAt[name] = updatedAt;

    if (name in this.dynamicTools) {
      this.dynamicTools[name] = cloneWithDescription(
        this.dynamicTools[name],
        description
      );
    }

    const dynamicIndex = this.dynamicToolMetadata.findIndex(
      (item) => item.name === name
    );
    if (dynamicIndex !== -1) {
      this.dynamicToolMetadata[dynamicIndex] = {
        ...this.dynamicToolMetadata[dynamicIndex],
        description,
        updatedAt
      };
    }
  }

  markToolDeleted(name: string, deletedAt?: string): string {
    if (name in builtinTools) {
      throw new OpenApiToolError(
        `Cannot delete built-in tool ${name}. You can only remove dynamic tools.`
      );
    }

    if (!(name in this.dynamicTools)) {
      if (this.deletedTools[name]) {
        return this.deletedTools[name];
      }
      throw new OpenApiToolError(`Tool ${name} not found`);
    }

    delete this.dynamicTools[name];
    delete this.dynamicExecutions[name];
    this.dynamicToolMetadata = this.dynamicToolMetadata.filter(
      (tool) => tool.name !== name
    );
    delete this.guidanceOverrides[name];
    delete this.guidanceUpdatedAt[name];

    const deletedTimestamp = normaliseTimestamp(deletedAt, this.now);
    this.deletedTools[name] = deletedTimestamp;
    return deletedTimestamp;
  }

  applyDeletedTool(name: string, deletedAt: string) {
    if (name in builtinTools) {
      return;
    }

    if (name in this.dynamicTools) {
      delete this.dynamicTools[name];
      delete this.dynamicExecutions[name];
      this.dynamicToolMetadata = this.dynamicToolMetadata.filter(
        (tool) => tool.name !== name
      );
    }

    delete this.guidanceOverrides[name];
    delete this.guidanceUpdatedAt[name];
    this.deletedTools[name] = deletedAt;
  }

  unmarkToolDeletion(name: string) {
    delete this.deletedTools[name];
  }

  getDeletedTools(): Record<string, string> {
    return { ...this.deletedTools };
  }
}

export function createToolRegistry(
  now: () => Date = () => new Date()
): ToolRegistry {
  return new ToolRegistry(now);
}
