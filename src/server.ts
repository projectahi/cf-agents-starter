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
// import { env } from "cloudflare:workers";

const API_PREFIX = "/api";
const INTERNAL_AGENT_PREFIX = "/_cf-agents";
const AGENT_NAMESPACE = "chat";
const AGENT_ROOM_NAME = "default";

function toInternalAgentPath(pathname: string) {
  return `${INTERNAL_AGENT_PREFIX}${pathname.slice(API_PREFIX.length)}`;
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

export class Chat extends AIChatAgent<Env> {
  private agentRegistryInitialized = false;

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
      return agentProfileValidators.full.parse(parsed);
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
  }

  private deleteAgentProfile(id: string) {
    this.ensureAgentRegistry();
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
    const registryTools = getToolSet();
    const mcpTools = this.mcp.getAITools();
    const combinedTools: Record<string, ToolSet[string]> = {
      ...registryTools,
      ...mcpTools
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
      toolPrompt: getToolPrompt(
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

  private createAgentProfileEntry(input: AgentProfileInput): AgentProfile {
    this.ensureAgentRegistry();
    const parsedInput = agentProfileValidators.create.parse(input);
    const profile = createAgentProfile({
      ...parsedInput,
      id: crypto.randomUUID()
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
    const merged = mergeAgentProfile(existing, parsedUpdate);
    this.saveAgentProfile(merged);
    return merged;
  }

  private deleteAgentProfileEntry(id: string): AgentProfile | null {
    this.ensureAgentRegistry();
    const existing = this.getAgentProfile(id);
    if (!existing) {
      return null;
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
        const profile = this.createAgentProfileEntry(agentInput);
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
          return this.jsonResponse(
            {
              error: "Agent not found",
              details: String(error)
            },
            { status: 404 }
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
        const cleanedMessages = cleanupMessages(this.messages);

        // Process any pending tool calls from previous messages
        // This handles human-in-the-loop confirmations for tools
        const activeProfile = this.getActiveAgentProfile();
        const {
          tools: selectedTools,
          effectiveToolNames,
          toolPrompt
        } = this.getToolsForProfile(activeProfile);

        const executionHandlers = getExecutionHandlers();
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

        const toolsSection = toolPrompt
          ? `\n\nTOOLS AVAILABLE (read carefully before responding):\n${toolPrompt}`
          : "";

        const agentConfig = activeProfile.config;
        const model = openai(agentConfig.modelId);

        const scheduleGuidance = getSchedulePrompt({ date: new Date() });
        const hasScheduleTool = effectiveToolNames.includes("scheduleTask");
        const scheduleInstruction = hasScheduleTool
          ? "If the user asks to schedule a task, use the schedule tool to schedule the task."
          : "If the user asks to schedule a task, let them know scheduling is currently unavailable.";
        const systemPrompt = `${agentConfig.systemPrompt.trim()}

${scheduleGuidance}

${scheduleInstruction}${toolsSection}`;

        const result = streamText({
          system: systemPrompt,
          messages: convertToModelMessages(processedMessages),
          model,
          temperature: agentConfig.temperature,
          tools: selectedTools,
          // Type boundary: streamText expects specific tool types, but base class uses ToolSet
          // This is safe because our tools satisfy ToolSet interface (verified by 'satisfies' in tools.ts)
          onFinish: onFinish as unknown as StreamTextOnFinishCallback<
            typeof selectedTools
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
