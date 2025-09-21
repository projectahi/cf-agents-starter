import type { ToolSet } from "ai";
import type { CoreMessage } from "ai";

import {
  tools as builtinTools,
  executions as builtinExecutions,
  baseToolMetadata
} from "./tools";
import { zodToJsonSchema } from "zod-to-json-schema";

import { buildToolsFromOpenApi, OpenApiToolError } from "./lib/openapi-tools";

export type RegisteredToolSource = "builtin" | "dynamic";

export interface ToolListItem {
  name: string;
  description: string;
  requiresConfirmation: boolean;
  schema?: Record<string, unknown> | null;
  source: RegisteredToolSource;
  origin?: {
    type: "openapi" | "manual";
    specName?: string;
    operationId?: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

type ExecutionHandler = (
  // biome-ignore lint/suspicious/noExplicitAny: execution signature is dynamic per tool
  args: any,
  context: { messages: CoreMessage[]; toolCallId: string }
) => Promise<unknown>;

const dynamicTools: ToolSet = {};
const dynamicExecutions: Record<string, ExecutionHandler> = {};
const dynamicToolMetadata: ToolListItem[] = [];
const guidanceOverrides: Record<string, string> = {};
const guidanceUpdatedAt: Record<string, string> = {};
const deletedTools: Record<string, boolean> = {};

function getBuiltinToolMetadata(): ToolListItem[] {
  return baseToolMetadata.map((item) => ({
    name: item.name,
    description: guidanceOverrides[item.name] ?? item.description,
    requiresConfirmation: item.requiresConfirmation,
    schema: zodToJsonSchema(item.inputSchema),
    source: item.source,
    origin: { type: "manual" },
    createdAt: new Date(0).toISOString(),
    updatedAt: guidanceUpdatedAt[item.name] ?? new Date(0).toISOString()
  }));
}

export function getToolSet(): ToolSet {
  const combined: Record<string, unknown> = {
    ...builtinTools,
    ...dynamicTools
  };

  for (const [name, override] of Object.entries(guidanceOverrides)) {
    if (!override || !(name in combined)) continue;
    const tool = combined[name] as Record<string, unknown>;
    combined[name] = {
      ...tool,
      description: override
    };
  }

  return combined as ToolSet;
}

export function getExecutionHandlers(): Record<string, ExecutionHandler> {
  return {
    ...builtinExecutions,
    ...dynamicExecutions
  } satisfies Record<string, ExecutionHandler>;
}

export function listTools(): ToolListItem[] {
  const builtin = getBuiltinToolMetadata();

  const dynamic = dynamicToolMetadata.map((item) => {
    const override = guidanceOverrides[item.name];
    if (!override) return item;
    return {
      ...item,
      description: override,
      updatedAt: guidanceUpdatedAt[item.name] ?? item.updatedAt
    };
  });

  return [...builtin, ...dynamic];
}

export interface RegisterOpenApiSpecArgs {
  name?: string;
  spec: string;
}

export interface RegisterOpenApiSpecResult {
  tools: ToolListItem[];
  prompt: string;
}

export async function registerOpenApiSpec(
  args: RegisterOpenApiSpecArgs
): Promise<RegisterOpenApiSpecResult> {
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

  const existingNames = new Set(
    Object.keys({
      ...builtinTools,
      ...dynamicTools
    })
  );

  const adjustedDefinitions = generated.map((definition) => {
    let finalName = definition.name;
    let suffix = 1;
    while (existingNames.has(finalName)) {
      finalName = `${definition.name}_${suffix++}`;
    }
    existingNames.add(finalName);

    if (finalName !== definition.name) {
      return {
        ...definition,
        name: finalName,
        metadata: {
          ...definition.metadata,
          name: finalName
        }
      };
    }

    return definition;
  });

  for (let index = dynamicToolMetadata.length - 1; index >= 0; index -= 1) {
    const metadata = dynamicToolMetadata[index];
    if (metadata.origin?.specName === specName) {
      dynamicToolMetadata.splice(index, 1);
      delete dynamicTools[metadata.name];
      delete dynamicExecutions[metadata.name];
      delete guidanceOverrides[metadata.name];
      delete guidanceUpdatedAt[metadata.name];
    }
  }

  const registeredTools: ToolListItem[] = [];

  for (const definition of adjustedDefinitions) {
    dynamicTools[definition.name] = definition.tool;
    delete deletedTools[definition.name];
    if (definition.execution) {
      dynamicExecutions[definition.name] = definition.execution;
    } else {
      delete dynamicExecutions[definition.name];
    }
    const existingIndex = dynamicToolMetadata.findIndex(
      (item) => item.name === definition.name
    );
    if (existingIndex !== -1) {
      dynamicToolMetadata.splice(existingIndex, 1);
    }
    const metadata = {
      ...definition.metadata,
      description:
        guidanceOverrides[definition.name] ?? definition.metadata.description,
      updatedAt:
        guidanceUpdatedAt[definition.name] ?? definition.metadata.updatedAt
    } satisfies ToolListItem;
    dynamicToolMetadata.push(metadata);
    registeredTools.push(metadata);
  }

  return {
    tools: registeredTools,
    prompt: getToolPrompt()
  };
}

export function clearDynamicTools() {
  for (const key of Object.keys(dynamicTools)) {
    delete dynamicTools[key];
  }
  for (const key of Object.keys(dynamicExecutions)) {
    delete dynamicExecutions[key];
  }
  dynamicToolMetadata.length = 0;
  for (const key of Object.keys(guidanceOverrides)) {
    if (!(key in builtinTools)) {
      delete guidanceOverrides[key];
      delete guidanceUpdatedAt[key];
    }
  }
  for (const key of Object.keys(deletedTools)) {
    delete deletedTools[key];
  }
}

export function updateToolGuidance({
  name,
  description
}: {
  name: string;
  description: string;
}): ToolListItem {
  if (deletedTools[name]) {
    throw new OpenApiToolError(`Tool ${name} has been removed`);
  }

  guidanceOverrides[name] = description;
  guidanceUpdatedAt[name] = new Date().toISOString();

  if (name in dynamicTools) {
    const tool = dynamicTools[name] as Record<string, unknown>;
    dynamicTools[name] = {
      ...tool,
      description
    } as ToolSet[string];
  }

  const dynamicIndex = dynamicToolMetadata.findIndex(
    (item) => item.name === name
  );
  if (dynamicIndex !== -1) {
    dynamicToolMetadata[dynamicIndex] = {
      ...dynamicToolMetadata[dynamicIndex],
      description,
      updatedAt: guidanceUpdatedAt[name]
    };
  }

  const updated = listTools().find((item) => item.name === name);
  if (!updated) {
    throw new OpenApiToolError(`Tool ${name} not found`);
  }
  return updated;
}

export function getToolPrompt(allowedNames?: string[] | null): string {
  const allowed =
    allowedNames && allowedNames.length > 0 ? new Set(allowedNames) : null;
  return listTools()
    .filter((tool) => !allowed || allowed.has(tool.name))
    .map((tool) => `- ${tool.name}: ${tool.description}`)
    .join("\n");
}

export function deleteTool(name: string): void {
  if (name in builtinTools) {
    throw new OpenApiToolError(
      `Cannot delete built-in tool ${name}. You can only remove dynamic tools.`
    );
  }

  if (!(name in dynamicTools)) {
    throw new OpenApiToolError(`Tool ${name} not found`);
  }

  delete dynamicTools[name];
  delete dynamicExecutions[name];
  delete guidanceOverrides[name];
  delete guidanceUpdatedAt[name];
  deletedTools[name] = true;

  const index = dynamicToolMetadata.findIndex((tool) => tool.name === name);
  if (index !== -1) {
    dynamicToolMetadata.splice(index, 1);
  }
}
