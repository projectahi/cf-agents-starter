import { routeAgentRequest, type Schedule } from "agents";

import { getSchedulePrompt } from "agents/schedule";

import { AIChatAgent } from "agents/ai-chat-agent";
import {
  generateId,
  streamText,
  type StreamTextOnFinishCallback,
  stepCountIs,
  createUIMessageStream,
  convertToModelMessages,
  createUIMessageStreamResponse,
  type ToolSet
} from "ai";
import { openai } from "@ai-sdk/openai";
import { processToolCalls, cleanupMessages } from "./utils";
import { ZodError } from "zod";
import { z } from "zod/v3";
import {
  getToolSet,
  getExecutionHandlers,
  listTools,
  registerOpenApiSpec,
  updateToolGuidance,
  getToolPrompt,
  deleteTool
} from "./tool-registry";
import { OpenApiToolError } from "./lib/openapi-tools";
import {
  getAgentConfig,
  updateAgentConfig,
  resetAgentConfig,
  agentConfigValidators,
  ALLOWED_MODEL_IDS,
  defaultAgentConfig
} from "./agent-config";
// import { env } from "cloudflare:workers";

// Cloudflare AI Gateway
// const openai = createOpenAI({
//   apiKey: env.OPENAI_API_KEY,
//   baseURL: env.GATEWAY_BASE_URL,
// });

/**
 * Chat Agent implementation that handles real-time AI chat interactions
 */
export class Chat extends AIChatAgent<Env> {
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
    const registryTools = getToolSet();
    const allTools = {
      ...registryTools,
      ...this.mcp.getAITools()
    };
    const executionHandlers = getExecutionHandlers();

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        // Clean up incomplete tool calls to prevent API errors
        const cleanedMessages = cleanupMessages(this.messages);

        // Process any pending tool calls from previous messages
        // This handles human-in-the-loop confirmations for tools
        const processedMessages = await processToolCalls({
          messages: cleanedMessages,
          dataStream: writer,
          tools: allTools,
          executions: executionHandlers
        });

        const toolPrompt = getToolPrompt();
        const toolsSection = toolPrompt
          ? `\n\nTOOLS AVAILABLE (read carefully before responding):\n${toolPrompt}`
          : "";

        const agentConfig = getAgentConfig();
        const model = openai(agentConfig.modelId);

        const scheduleGuidance = getSchedulePrompt({ date: new Date() });
        const systemPrompt = `${agentConfig.systemPrompt.trim()}

${scheduleGuidance}

If the user asks to schedule a task, use the schedule tool to schedule the task.${toolsSection}`;

        const result = streamText({
          system: systemPrompt,
          messages: convertToModelMessages(processedMessages),
          model,
          temperature: agentConfig.temperature,
          tools: allTools,
          // Type boundary: streamText expects specific tool types, but base class uses ToolSet
          // This is safe because our tools satisfy ToolSet interface (verified by 'satisfies' in tools.ts)
          onFinish: onFinish as unknown as StreamTextOnFinishCallback<
            typeof allTools
          >,
          stopWhen: stepCountIs(agentConfig.maxSteps)
        });

        writer.merge(result.toUIMessageStream());
      }
    });

    return createUIMessageStreamResponse({ stream });
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
      if (request.method === "GET") {
        return Response.json({
          config: getAgentConfig(),
          defaults: defaultAgentConfig,
          allowedModels: Array.from(ALLOWED_MODEL_IDS)
        });
      }

      if (request.method === "PATCH") {
        let parsedBody: unknown;
        try {
          parsedBody = await request.json();
        } catch (error) {
          return Response.json(
            {
              error: "Invalid JSON body",
              details: String(error)
            },
            { status: 400 }
          );
        }

        try {
          const update = agentConfigValidators.update.parse(parsedBody);
          const config = updateAgentConfig(update);
          return Response.json({ config });
        } catch (error) {
          const message =
            error instanceof ZodError ? error.flatten() : String(error);
          return Response.json(
            {
              error: "Invalid agent configuration",
              details: message
            },
            { status: 400 }
          );
        }
      }

      if (request.method === "DELETE") {
        if (request.headers.get("cf-agent-config-reset") !== "confirm") {
          return Response.json(
            {
              error: "Missing confirmation header"
            },
            { status: 400 }
          );
        }
        const config = resetAgentConfig();
        return Response.json({ config });
      }

      return new Response("Method Not Allowed", {
        status: 405,
        headers: {
          Allow: "GET, PATCH, DELETE"
        }
      });
    }

    if (url.pathname.startsWith("/api/tools/")) {
      const toolName = decodeURIComponent(
        url.pathname.replace("/api/tools/", "")
      );

      if (request.method === "PATCH") {
        const bodySchema = z.object({
          description: z.string().min(1)
        });

        let parsedBody: z.infer<typeof bodySchema>;
        try {
          const json = await request.json();
          parsedBody = bodySchema.parse(json);
        } catch (error) {
          return Response.json(
            {
              error: "Invalid request body",
              details:
                error instanceof ZodError ? error.flatten() : String(error)
            },
            { status: 400 }
          );
        }

        try {
          const tool = updateToolGuidance({
            name: toolName,
            description: parsedBody.description
          });
          return Response.json({
            tool,
            prompt: getToolPrompt()
          });
        } catch (error) {
          console.error("Error updating tool guidance", error);
          const status = error instanceof OpenApiToolError ? 404 : 500;
          return Response.json(
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
          deleteTool(toolName);
          return Response.json({
            prompt: getToolPrompt()
          });
        } catch (error) {
          console.error("Error deleting tool", error);
          const status = error instanceof OpenApiToolError ? 404 : 500;
          return Response.json(
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

    if (url.pathname === "/api/tools") {
      if (request.method === "GET") {
        return Response.json({
          tools: listTools(),
          prompt: getToolPrompt()
        });
      }

      if (request.method === "POST") {
        const bodySchema = z.object({
          name: z.string().min(1).optional(),
          spec: z.string().min(1)
        });

        let parsedBody: z.infer<typeof bodySchema>;
        try {
          const json = await request.json();
          parsedBody = bodySchema.parse(json);
        } catch (error) {
          return Response.json(
            {
              error: "Invalid request body",
              details:
                error instanceof ZodError ? error.flatten() : String(error)
            },
            { status: 400 }
          );
        }

        try {
          const result = await registerOpenApiSpec(parsedBody);
          return Response.json(result, { status: 201 });
        } catch (error) {
          console.error("Error registering OpenAPI spec", error);
          const status = error instanceof OpenApiToolError ? 400 : 500;
          return Response.json(
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
