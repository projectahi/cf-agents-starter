import { tool } from "ai";
import type { CoreMessage } from "ai";
import type { ZodType, ZodTypeAny } from "zod";
import { z } from "zod/v3";
import { parse as parseYaml } from "yaml";

import type { ToolListItem } from "@/tool-registry";

interface OpenAPIObject {
  openapi?: string;
  info?: {
    title?: string;
    version?: string;
  };
  servers?: Array<{
    url?: string;
  }>;
  paths?: Record<string, PathItemObject>;
}

interface PathItemObject {
  [method: string]: OperationObject | undefined;
}

interface OperationObject {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: ParameterObject[];
  requestBody?: RequestBodyObject;
  "x-requires-confirmation"?: boolean;
}

interface ParameterObject {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  description?: string;
  schema?: SchemaObject;
}

interface RequestBodyObject {
  required?: boolean;
  description?: string;
  content?: Record<string, MediaTypeObject>;
}

interface MediaTypeObject {
  schema?: SchemaObject;
}

interface SchemaObject {
  type?: string;
  format?: string;
  description?: string;
  enum?: string[] | number[] | boolean[];
  items?: SchemaObject;
  properties?: Record<string, SchemaObject>;
  required?: string[];
  additionalProperties?: boolean | SchemaObject;
}

interface GeneratedToolDefinition {
  name: string;
  tool: ReturnType<typeof tool>;
  execution?: (
    // biome-ignore lint/suspicious/noExplicitAny: tool args determined at runtime
    args: any,
    context: { messages: CoreMessage[]; toolCallId: string }
  ) => Promise<unknown>;
  metadata: ToolListItem;
}

interface BuildToolsOptions {
  specName: string;
}

export class OpenApiToolError extends Error {}

function parseSpec(spec: string): OpenAPIObject {
  try {
    return JSON.parse(spec) as OpenAPIObject;
  } catch (jsonError) {
    try {
      return parseYaml(spec) as OpenAPIObject;
    } catch (yamlError) {
      throw new OpenApiToolError(
        `Unable to parse specification as JSON (${jsonError}) or YAML (${yamlError})`
      );
    }
  }
}

function ensureOpenApiVersion(doc: OpenAPIObject) {
  if (!doc.openapi || !doc.openapi.startsWith("3")) {
    throw new OpenApiToolError(
      `Unsupported OpenAPI version: ${doc.openapi ?? "unknown"}. Only 3.x is supported.`
    );
  }
}

function convertSchemaToZod(schema?: SchemaObject): ZodTypeAny {
  if (!schema) {
    return z.any();
  }

  switch (schema.type) {
    case "string": {
      if (schema.enum && schema.enum.length > 0) {
        const enumValues = schema.enum.map(String) as string[];
        if (enumValues.length === 1) {
          return z.literal(enumValues[0]);
        }
        return z.enum(enumValues as [string, string, ...string[]]);
      }
      return z.string();
    }
    case "integer":
    case "number": {
      let result = z.number();
      if (schema.type === "integer") {
        result = result.int();
      }
      return result;
    }
    case "boolean":
      return z.boolean();
    case "array":
      return z.array(convertSchemaToZod(schema.items));
    case "object": {
      const properties = schema.properties ?? {};
      const required = new Set(schema.required ?? []);

      if (Object.keys(properties).length === 0) {
        return z.record(z.string(), z.any());
      }

      const objectShape = Object.entries(properties).reduce(
        (acc, [key, value]) => {
          const childSchema = convertSchemaToZod(value);
          acc[key] = required.has(key) ? childSchema : childSchema.optional();
          return acc;
        },
        {} as Record<string, ZodTypeAny>
      );

      let result = z.object(objectShape);
      if (schema.additionalProperties === true) {
        result = result.catchall(z.any());
      }
      return result;
    }
    default:
      return z.any();
  }
}

function schemaToJson(schema?: SchemaObject): Record<string, unknown> | null {
  if (!schema) return null;
  const base: Record<string, unknown> = {};
  if (schema.type) base.type = schema.type;
  if (schema.format) base.format = schema.format;
  if (schema.description) base.description = schema.description;
  if (schema.enum) base.enum = schema.enum;
  if (schema.type === "array" && schema.items) {
    base.items = schemaToJson(schema.items);
  }
  if (schema.type === "object") {
    base.properties = Object.entries(schema.properties ?? {}).reduce(
      (acc, [key, value]) => {
        acc[key] = schemaToJson(value);
        return acc;
      },
      {} as Record<string, unknown>
    );
    if (schema.required) base.required = schema.required;
  }
  return base;
}

function buildInputSchemaForOperation(operation: OperationObject): {
  inputSchema: ZodType<Record<string, unknown>>;
  jsonSchema: Record<string, unknown>;
} {
  const shape: Record<string, ZodTypeAny> = {};
  const jsonProperties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const param of operation.parameters ?? []) {
    if (!param.schema) continue;
    const zodSchema = convertSchemaToZod(param.schema);
    shape[param.name] = param.required ? zodSchema : zodSchema.optional();
    if (param.required) required.push(param.name);
    jsonProperties[param.name] = {
      in: param.in,
      required: param.required ?? false,
      schema: schemaToJson(param.schema)
    };
  }

  if (operation.requestBody) {
    const bodySchema = extractRequestBodySchema(operation.requestBody);
    if (bodySchema) {
      const zodSchema = convertSchemaToZod(bodySchema);
      const jsonSchema = schemaToJson(bodySchema);
      shape.body = operation.requestBody.required
        ? zodSchema
        : zodSchema.optional();
      jsonProperties.body = {
        required: operation.requestBody.required ?? false,
        schema: jsonSchema
      };
      if (operation.requestBody.required) {
        required.push("body");
      }
    }
  }

  const inputSchema = z.object(shape) as unknown as ZodType<
    Record<string, unknown>
  >;
  const jsonSchema: Record<string, unknown> = {
    type: "object",
    properties: Object.fromEntries(
      Object.entries(jsonProperties).map(([key, value]) => {
        if (typeof value === "object" && value !== null && "schema" in value) {
          return [key, value];
        }
        return [key, value];
      })
    )
  };
  if (required.length > 0) {
    jsonSchema.required = required;
  }
  return { inputSchema, jsonSchema };
}

function extractRequestBodySchema(body: RequestBodyObject) {
  if (!body.content) return null;
  const jsonContent =
    body.content["application/json"] ||
    body.content["application/*"] ||
    Object.values(body.content)[0];
  return jsonContent?.schema ?? null;
}

function normaliseOperationName(name: string) {
  return name.replace(/[^a-zA-Z0-9_]/g, "_");
}

function buildExecuteFunction(
  baseUrl: string,
  path: string,
  method: string,
  operation: OperationObject
) {
  return async function execute(args: Record<string, unknown>) {
    const url = new URL(baseUrl.replace(/\/$/, ""));
    let finalPath = path;

    for (const param of operation.parameters ?? []) {
      if (param.in === "path") {
        const value = args?.[param.name];
        if (value === undefined || value === null) {
          if (param.required) {
            throw new Error(`Missing required path parameter: ${param.name}`);
          }
          continue;
        }
        finalPath = finalPath.replace(
          `{${param.name}}`,
          encodeURIComponent(String(value))
        );
      }
    }

    const requestUrl = new URL(finalPath, url);

    for (const param of operation.parameters ?? []) {
      if (param.in === "query") {
        const value = args?.[param.name];
        if (value === undefined || value === null) continue;
        requestUrl.searchParams.append(param.name, String(value));
      }
    }

    const headers = new Headers({ "content-type": "application/json" });
    let body: string | undefined;

    if (operation.requestBody) {
      const requestBody = args?.body;
      if (requestBody === undefined || requestBody === null) {
        if (operation.requestBody.required) {
          throw new Error("Missing required request body");
        }
      } else {
        body = JSON.stringify(requestBody);
      }
    }

    const response = await fetch(requestUrl.toString(), {
      method: method.toUpperCase(),
      headers,
      body
    });

    const contentType = response.headers.get("content-type") || "";
    let result: unknown;
    if (contentType.includes("application/json")) {
      result = await response.json();
    } else {
      result = await response.text();
    }

    if (!response.ok) {
      throw new Error(
        `Request failed with status ${response.status}: ${JSON.stringify(result)}`
      );
    }

    return result;
  };
}

export function buildToolsFromOpenApi(
  specString: string,
  { specName }: BuildToolsOptions
): GeneratedToolDefinition[] {
  const doc = parseSpec(specString);
  ensureOpenApiVersion(doc);

  if (!doc.paths) {
    throw new OpenApiToolError("Specification missing paths definition");
  }

  const baseUrl = doc.servers?.[0]?.url ?? "http://localhost";

  const generated: GeneratedToolDefinition[] = [];
  const createTool = tool as unknown as (
    config: unknown
  ) => ReturnType<typeof tool>;

  for (const [path, pathItem] of Object.entries(doc.paths)) {
    if (!pathItem) continue;

    for (const [method, operation] of Object.entries(pathItem)) {
      const operationObject = operation as OperationObject;
      if (!operationObject) continue;

      const operationId =
        operationObject.operationId ||
        `${method}_${path}`.replace(/[^a-zA-Z0-9]+/g, "_");
      const name = normaliseOperationName(operationId);
      const description =
        operationObject.description ||
        operationObject.summary ||
        `${method.toUpperCase()} ${path}`;

      const { inputSchema, jsonSchema } =
        buildInputSchemaForOperation(operationObject);

      const requiresConfirmation =
        operationObject["x-requires-confirmation"] ?? false;

      const execute = buildExecuteFunction(
        baseUrl,
        path,
        method,
        operationObject
      );

      const toolInstance = createTool({
        description,
        inputSchema,
        ...(requiresConfirmation ? {} : { execute })
      });

      generated.push({
        name,
        tool: toolInstance,
        execution: requiresConfirmation ? execute : undefined,
        metadata: {
          name,
          description,
          requiresConfirmation,
          schema: jsonSchema,
          source: "dynamic",
          origin: {
            type: "openapi",
            specName,
            operationId
          },
          createdAt: new Date().toISOString()
        }
      });
    }
  }

  if (generated.length === 0) {
    throw new OpenApiToolError("No operations found in specification");
  }

  return generated;
}
