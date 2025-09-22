import {
  env,
  createExecutionContext,
  waitOnExecutionContext
} from "cloudflare:test";
import { describe, it, expect } from "vitest";
// Could import any other source file/function here
import worker from "../src/server";

declare module "cloudflare:test" {
  // Controls the type of `import("cloudflare:test").env`
  interface ProvidedEnv extends Env {}
}

describe("Chat worker", () => {
  it("responds with Not found", async () => {
    const request = new Request("http://example.com");
    // Create an empty context to pass to `worker.fetch()`
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    // Wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
    await waitOnExecutionContext(ctx);
    expect(await response.text()).toBe("Not found");
    expect(response.status).toBe(404);
  });

  it("supports multi-agent CRUD and tool filtering", async () => {
    async function fetchJSON(path: string, init?: RequestInit) {
      const request = new Request(`http://example.com${path}`, init);
      const ctx = createExecutionContext();
      const response = await worker.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);
      const text = await response.text();
      const json = text ? JSON.parse(text) : null;
      return { response, json } as const;
    }

    const initial = await fetchJSON("/api/agents");
    expect(initial.response.status).toBe(200);
    expect(Array.isArray(initial.json.agents)).toBe(true);
    expect(initial.json.agents.length).toBeGreaterThanOrEqual(1);
    expect(initial.json.activeAgent?.toolNames ?? null).toBeNull();
    expect(initial.json.activeAgentEffectiveToolNames).toContain(
      "scheduleTask"
    );

    const defaultAgentId = String(initial.json.activeAgent.id);

    const createBody = {
      name: "Specialist",
      behavior: "Focus on quick lookups only",
      toolNames: ["getLocalTime", "scheduleTask"],
      handoffAgentIds: [defaultAgentId],
      setActive: true
    } satisfies Record<string, unknown>;
    const created = await fetchJSON("/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(createBody)
    });
    expect(created.response.status).toBe(201);
    expect(created.json.agent.toolNames).toEqual([
      "getLocalTime",
      "scheduleTask"
    ]);
    expect(created.json.agent.handoffAgentIds).toEqual([defaultAgentId]);
    expect(created.json.activeAgent?.id).toBe(created.json.agent.id);

    const configAfterCreate = await fetchJSON("/api/agent-config");
    expect(configAfterCreate.response.status).toBe(200);
    expect(configAfterCreate.json.agent.toolNames).toEqual([
      "getLocalTime",
      "scheduleTask"
    ]);
    expect(configAfterCreate.json.agent.handoffAgentIds).toEqual([
      defaultAgentId
    ]);
    expect(configAfterCreate.json.effectiveToolNames.sort()).toEqual([
      "getLocalTime",
      "scheduleTask"
    ]);

    const agentId = String(created.json.agent.id);
    const update = await fetchJSON(`/api/agents/${agentId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        toolNames: ["getLocalTime"],
        handoffAgentIds: []
      })
    });
    expect(update.response.status).toBe(200);
    expect(update.json.agent.toolNames).toEqual(["getLocalTime"]);
    expect(update.json.agent.handoffAgentIds).toEqual([]);

    const configAfterUpdate = await fetchJSON("/api/agent-config");
    expect(configAfterUpdate.response.status).toBe(200);
    expect(configAfterUpdate.json.agent.toolNames).toEqual(["getLocalTime"]);
    expect(configAfterUpdate.json.effectiveToolNames).toEqual(["getLocalTime"]);
    expect(configAfterUpdate.json.agent.handoffAgentIds).toEqual([]);

    const allowAll = await fetchJSON(`/api/agents/${agentId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toolNames: null })
    });
    expect(allowAll.response.status).toBe(200);
    expect(allowAll.json.agent.toolNames ?? null).toBeNull();

    const finalConfig = await fetchJSON("/api/agent-config");
    expect(finalConfig.response.status).toBe(200);
    expect(finalConfig.json.agent.toolNames ?? null).toBeNull();
    expect(finalConfig.json.effectiveToolNames).toContain("scheduleTask");
  });
});
