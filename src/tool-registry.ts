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
}

type ExecutionHandler = (
  // biome-ignore lint/suspicious/noExplicitAny: execution signature is dynamic per tool
  args: any,
  context: { messages: CoreMessage[]; toolCallId: string }
) => Promise<unknown>;

const dynamicTools: ToolSet = {};
const dynamicExecutions: Record<string, ExecutionHandler> = {};
const dynamicToolMetadata: ToolListItem[] = [];

function getBuiltinToolMetadata(): ToolListItem[] {
  return baseToolMetadata.map((item) => ({
    name: item.name,
    description: item.description,
    requiresConfirmation: item.requiresConfirmation,
    schema: zodToJsonSchema(item.inputSchema),
    source: item.source,
    origin: { type: "manual" },
    createdAt: new Date(0).toISOString()
  }));
}

export function getToolSet(): ToolSet {
  return {
    ...builtinTools,
    ...dynamicTools
  };
}

export function getExecutionHandlers() {
  return {
    ...builtinExecutions,
    ...dynamicExecutions
  };
}

export function listTools(): ToolListItem[] {
  return [...getBuiltinToolMetadata(), ...dynamicToolMetadata];
}

export interface RegisterOpenApiSpecArgs {
  name?: string;
  spec: string;
}

export interface RegisterOpenApiSpecResult {
  tools: ToolListItem[];
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
    }
  }

  const registeredTools: ToolListItem[] = [];

  for (const definition of adjustedDefinitions) {
    dynamicTools[definition.name] = definition.tool;
    if (definition.execution) {
      dynamicExecutions[definition.name] = definition.execution;
    } else {
      delete dynamicExecutions[definition.name];
    }
    dynamicToolMetadata.push(definition.metadata);
    registeredTools.push(definition.metadata);
  }

  return {
    tools: registeredTools
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
}
