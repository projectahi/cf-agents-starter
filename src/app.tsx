/** biome-ignore-all lint/correctness/useUniqueElementIds: it's alright */
import { useEffect, useState, use, useCallback } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "agents/ai-react";
import type { UIMessage } from "@ai-sdk/react";

// Component imports
import { Button } from "@/components/button/Button";
import { Card } from "@/components/card/Card";
import { AgentChatWindow } from "@/components/agent-chat/AgentChatWindow";
import { AgentSelector } from "@/components/agent-chat/AgentSelector";
import { Toggle } from "@/components/toggle/Toggle";
import { ToolsPanel } from "@/components/tools/ToolsPanel";
import { AgentConfigPanel } from "@/components/agent-config/AgentConfigPanel";
import { useAgentConfig } from "@/hooks/useAgentConfig";
import { useTools } from "@/hooks/useTools";
import { cn } from "@/lib/utils";
import type { ChatMessageMetadata } from "@/shared";

// Icon imports
import {
  Bug,
  Moon,
  Robot,
  Sun,
  Trash,
  Wrench,
  Gear
} from "@phosphor-icons/react";

export default function Chat() {
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    // Check localStorage first, default to dark if not found
    const savedTheme = localStorage.getItem("theme");
    return (savedTheme as "dark" | "light") || "dark";
  });
  const [showDebug, setShowDebug] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"chat" | "tools" | "config">(
    "chat"
  );
  const {
    tools: toolMetadata,
    isLoading: isLoadingTools,
    error: toolsError,
    prompt: toolsPrompt,
    refresh: refreshTools,
    registerOpenApiSpec,
    updateToolGuidance,
    deleteTool,
    confirmationToolNames
  } = useTools();

  const {
    agents: agentProfiles,
    activeAgent,
    isLoading: isLoadingAgents,
    error: agentConfigError,
    selectAgent,
    agentActionPending,
    agentActionError
  } = useAgentConfig();

  const isToolsView = activeTab === "tools";
  const isConfigView = activeTab === "config";

  useEffect(() => {
    // Apply theme class on mount and when theme changes
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
      document.documentElement.classList.remove("light");
    } else {
      document.documentElement.classList.remove("dark");
      document.documentElement.classList.add("light");
    }

    // Save theme preference to localStorage
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    const newTheme = theme === "dark" ? "light" : "dark";
    setTheme(newTheme);
  };

  const agent = useAgent({
    agent: "chat"
  });

  const {
    messages: agentMessages,
    addToolResult,
    clearHistory,
    status,
    sendMessage,
    stop
  } = useAgentChat<unknown, UIMessage<ChatMessageMetadata>>({
    agent
  });

  const sendChatMessage = useCallback(
    async (text: string, trigger: "submit" | "enter") => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const extraData =
        trigger === "submit"
          ? {
              annotations: {
                hello: "world"
              }
            }
          : undefined;

      await sendMessage(
        {
          role: "user",
          parts: [{ type: "text", text: trimmed }]
        },
        extraData ? { body: extraData } : undefined
      );
    },
    [sendMessage]
  );

  const handleAgentSelection = useCallback(
    async (agentId: string) => {
      await selectAgent(agentId);
      clearHistory();
    },
    [selectAgent, clearHistory]
  );

  const handleStartNewChat = () => {
    clearHistory();
    setActiveTab("chat");
    setIsSidebarOpen(false);
  };

  const navButtonClass = (isActive: boolean) =>
    `flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm font-medium transition-colors ${
      isActive
        ? "border-neutral-200 bg-neutral-100 text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
        : "border-transparent text-neutral-700 hover:border-neutral-200 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:border-neutral-700 dark:hover:bg-neutral-800"
    }`;

  const headerTitle = isToolsView
    ? "Tool Manager"
    : isConfigView
      ? "Agent Configuration"
      : "AI Chat Agent";

  const contentContainerClass =
    isToolsView || isConfigView
      ? "flex-1 overflow-y-auto p-4"
      : "flex-1 overflow-hidden";

  const wrapperClass = cn(
    "h-[100vh] w-full p-4 flex bg-fixed overflow-hidden",
    isConfigView ? "justify-center items-start" : "justify-center items-center"
  );

  const mainContainerClass = cn(
    "h-[calc(100vh-2rem)] w-full flex flex-col shadow-xl rounded-md overflow-hidden relative border border-neutral-300 dark:border-neutral-800",
    isConfigView ? "max-w-full" : "mx-auto max-w-lg"
  );

  return (
    <div className={wrapperClass}>
      <HasOpenAIKey />
      <div
        className={`fixed inset-0 z-40 bg-black/30 transition-opacity duration-200 ${
          isSidebarOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setIsSidebarOpen(false)}
        aria-hidden="true"
      />
      <aside
        className={`fixed left-0 top-0 bottom-0 z-50 w-64 bg-white dark:bg-neutral-900 border-r border-neutral-200 dark:border-neutral-800 shadow-xl transform transition-transform duration-300 ease-in-out ${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-label="Sidebar navigation"
        id="sidebar-menu"
      >
        <div className="flex items-center justify-between px-4 py-4 border-b border-neutral-200 dark:border-neutral-800">
          <h2 className="text-base font-semibold">Menu</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsSidebarOpen(false)}
            aria-label="Close menu"
          >
            Close
          </Button>
        </div>
        <nav className="p-4 space-y-2">
          <button
            type="button"
            onClick={() => {
              setActiveTab("chat");
              setIsSidebarOpen(false);
            }}
            className={navButtonClass(activeTab === "chat")}
          >
            <Robot size={18} />
            Chat
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab("tools");
              setIsSidebarOpen(false);
            }}
            className={navButtonClass(activeTab === "tools")}
          >
            <Wrench size={18} />
            Tools
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab("config");
              setIsSidebarOpen(false);
            }}
            className={navButtonClass(activeTab === "config")}
          >
            <Gear size={18} />
            Agent config
          </button>
          <button
            type="button"
            onClick={handleStartNewChat}
            disabled={isToolsView || isConfigView}
            className={`${navButtonClass(false)} ${
              isToolsView || isConfigView ? "opacity-60 cursor-not-allowed" : ""
            }`}
          >
            <Robot size={18} />
            Start new chat
          </button>
        </nav>
      </aside>
      <div className={mainContainerClass}>
        <div className="px-4 py-3 border-b border-neutral-300 dark:border-neutral-800 flex items-center gap-3 sticky top-0 z-10">
          <Button
            variant="ghost"
            size="md"
            onClick={() => setIsSidebarOpen(true)}
            aria-expanded={isSidebarOpen}
            aria-controls="sidebar-menu"
            className="text-sm font-medium"
          >
            Menu
          </Button>
          <div className="flex items-center justify-center h-8 w-8">
            <svg
              width="28px"
              height="28px"
              className="text-[#F48120]"
              data-icon="agents"
            >
              <title>Cloudflare Agents</title>
              <symbol id="ai:local:agents" viewBox="0 0 80 79">
                <path
                  fill="currentColor"
                  d="M69.3 39.7c-3.1 0-5.8 2.1-6.7 5H48.3V34h4.6l4.5-2.5c1.1.8 2.5 1.2 3.9 1.2 3.8 0 7-3.1 7-7s-3.1-7-7-7-7 3.1-7 7c0 .9.2 1.8.5 2.6L51.9 30h-3.5V18.8h-.1c-1.3-1-2.9-1.6-4.5-1.9h-.2c-1.9-.3-3.9-.1-5.8.6-.4.1-.8.3-1.2.5h-.1c-.1.1-.2.1-.3.2-1.7 1-3 2.4-4 4 0 .1-.1.2-.1.2l-.3.6c0 .1-.1.1-.1.2v.1h-.6c-2.9 0-5.7 1.2-7.7 3.2-2.1 2-3.2 4.8-3.2 7.7 0 .7.1 1.4.2 2.1-1.3.9-2.4 2.1-3.2 3.5s-1.2 2.9-1.4 4.5c-.1 1.6.1 3.2.7 4.7s1.5 2.9 2.6 4c-.8 1.8-1.2 3.7-1.1 5.6 0 1.9.5 3.8 1.4 5.6s2.1 3.2 3.6 4.4c1.3 1 2.7 1.7 4.3 2.2v-.1q2.25.75 4.8.6h.1c0 .1.1.1.1.1.9 1.7 2.3 3 4 4 .1.1.2.1.3.2h.1c.4.2.8.4 1.2.5 1.4.6 3 .8 4.5.7.4 0 .8-.1 1.3-.1h.1c1.6-.3 3.1-.9 4.5-1.9V62.9h3.5l3.1 1.7c-.3.8-.5 1.7-.5 2.6 0 3.8 3.1 7 7 7s7-3.1 7-7-3.1-7-7-7c-1.5 0-2.8.5-3.9 1.2l-4.6-2.5h-4.6V48.7h14.3c.9 2.9 3.5 5 6.7 5 3.8 0 7-3.1 7-7s-3.1-7-7-7m-7.9-16.9c1.6 0 3 1.3 3 3s-1.3 3-3 3-3-1.3-3-3 1.4-3 3-3m0 41.4c1.6 0 3 1.3 3 3s-1.3 3-3 3-3-1.3-3-3 1.4-3 3-3M44.3 72c-.4.2-.7.3-1.1.3-.2 0-.4.1-.5.1h-.2c-.9.1-1.7 0-2.6-.3-1-.3-1.9-.9-2.7-1.7-.7-.8-1.3-1.7-1.6-2.7l-.3-1.5v-.7q0-.75.3-1.5c.1-.2.1-.4.2-.7s.3-.6.5-.9c0-.1.1-.1.1-.2.1-.1.1-.2.2-.3s.1-.2.2-.3c0 0 0-.1.1-.1l.6-.6-2.7-3.5c-1.3 1.1-2.3 2.4-2.9 3.9-.2.4-.4.9-.5 1.3v.1c-.1.2-.1.4-.1.6-.3 1.1-.4 2.3-.3 3.4-.3 0-.7 0-1-.1-2.2-.4-4.2-1.5-5.5-3.2-1.4-1.7-2-3.9-1.8-6.1q.15-1.2.6-2.4l.3-.6c.1-.2.2-.4.3-.5 0 0 0-.1.1-.1.4-.7.9-1.3 1.5-1.9 1.6-1.5 3.8-2.3 6-2.3q1.05 0 2.1.3v-4.5c-.7-.1-1.4-.2-2.1-.2-1.8 0-3.5.4-5.2 1.1-.7.3-1.3.6-1.9 1s-1.1.8-1.7 1.3c-.3.2-.5.5-.8.8-.6-.8-1-1.6-1.3-2.6-.2-1-.2-2 0-2.9.2-1 .6-1.9 1.3-2.6.6-.8 1.4-1.4 2.3-1.8l1.8-.9-.7-1.9c-.4-1-.5-2.1-.4-3.1s.5-2.1 1.1-2.9q.9-1.35 2.4-2.1c.9-.5 2-.8 3-.7.5 0 1 .1 1.5.2 1 .2 1.8.7 2.6 1.3s1.4 1.4 1.8 2.3l4.1-1.5c-.9-2-2.3-3.7-4.2-4.9q-.6-.3-.9-.6c.4-.7 1-1.4 1.6-1.9.8-.7 1.8-1.1 2.9-1.3.9-.2 1.7-.1 2.6 0 .4.1.7.2 1.1.3V72zm25-22.3c-1.6 0-3-1.3-3-3 0-1.6 1.3-3 3-3s3 1.3 3 3c0 1.6-1.3 3-3 3"
                />
              </symbol>
              <use href="#ai:local:agents" />
            </svg>
          </div>

          <div className="flex-1">
            {activeTab === "chat" ? (
              <AgentSelector
                label="AI Chat Agent"
                agents={agentProfiles}
                activeAgentId={activeAgent?.id ?? null}
                onSelect={handleAgentSelection}
                isLoading={isLoadingAgents}
                isPending={agentActionPending}
                error={agentActionError ?? agentConfigError}
              />
            ) : (
              <h2 className="font-semibold text-base">{headerTitle}</h2>
            )}
          </div>

          {activeTab === "chat" && (
            <div className="flex items-center gap-2 mr-2">
              <Bug size={16} />
              <Toggle
                toggled={showDebug}
                aria-label="Toggle debug mode"
                onClick={() => setShowDebug((prev) => !prev)}
              />
            </div>
          )}

          <Button
            variant="ghost"
            size="md"
            shape="square"
            className="rounded-full h-9 w-9"
            onClick={toggleTheme}
          >
            {theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
          </Button>

          {activeTab === "chat" && (
            <Button
              variant="ghost"
              size="md"
              shape="square"
              className="rounded-full h-9 w-9"
              onClick={clearHistory}
            >
              <Trash size={20} />
            </Button>
          )}
        </div>

        <div className={contentContainerClass}>
          {isToolsView ? (
            <ToolsPanel
              tools={toolMetadata}
              isLoading={isLoadingTools}
              error={toolsError}
              prompt={toolsPrompt}
              onRefresh={refreshTools}
              onRegister={registerOpenApiSpec}
              onUpdateGuidance={updateToolGuidance}
              onDeleteTool={deleteTool}
            />
          ) : isConfigView ? (
            <AgentConfigPanel />
          ) : (
            <AgentChatWindow
              messages={agentMessages}
              status={status}
              confirmationToolNames={confirmationToolNames}
              addToolResult={addToolResult}
              onSendMessage={sendChatMessage}
              onStop={stop}
              showDebug={showDebug}
              emptyState={
                <div className="flex h-full items-center justify-center">
                  <Card className="mx-auto max-w-md bg-neutral-100 p-6 dark:bg-neutral-900">
                    <div className="space-y-4 text-center">
                      <div className="inline-flex rounded-full bg-[#F48120]/10 p-3 text-[#F48120]">
                        <Robot size={24} />
                      </div>
                      <h3 className="text-lg font-semibold">
                        Welcome to AI Chat
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        Start a conversation with your AI assistant. Try asking
                        about:
                      </p>
                      <ul className="space-y-2 text-left text-sm">
                        <li className="flex items-center gap-2">
                          <span className="text-[#F48120]">•</span>
                          <span>Weather information for any city</span>
                        </li>
                        <li className="flex items-center gap-2">
                          <span className="text-[#F48120]">•</span>
                          <span>Local time in different locations</span>
                        </li>
                      </ul>
                    </div>
                  </Card>
                </div>
              }
              className="flex h-full flex-col"
              messagesContainerClassName="space-y-4"
            />
          )}
        </div>
      </div>
    </div>
  );
}

const hasOpenAiKeyPromise = fetch("/check-open-ai-key")
  .then((res) => res.json<{ success: boolean }>())
  .catch(() => {
    // In Replit development mode, assume API key is configured since backend endpoint isn't available
    const isReplit =
      import.meta.env.VITE_REPL_ID !== undefined ||
      window.location.hostname.includes("replit.dev");
    return { success: isReplit };
  });

function HasOpenAIKey() {
  const hasOpenAiKey = use(hasOpenAiKeyPromise);

  if (!hasOpenAiKey.success) {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 bg-red-500/10 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto p-4">
          <div className="bg-white dark:bg-neutral-900 rounded-lg shadow-lg border border-red-200 dark:border-red-900 p-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-full">
                <svg
                  className="w-5 h-5 text-red-600 dark:text-red-400"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-labelledby="warningIcon"
                >
                  <title id="warningIcon">Warning Icon</title>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-red-600 dark:text-red-400 mb-2">
                  OpenAI API Key Not Configured
                </h3>
                <p className="text-neutral-600 dark:text-neutral-300 mb-1">
                  Requests to the API, including from the frontend UI, will not
                  work until an OpenAI API key is configured.
                </p>
                <p className="text-neutral-600 dark:text-neutral-300">
                  Please configure an OpenAI API key by setting a{" "}
                  <a
                    href="https://developers.cloudflare.com/workers/configuration/secrets/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-red-600 dark:text-red-400"
                  >
                    secret
                  </a>{" "}
                  named{" "}
                  <code className="bg-red-100 dark:bg-red-900/30 px-1.5 py-0.5 rounded text-red-600 dark:text-red-400 font-mono text-sm">
                    OPENAI_API_KEY
                  </code>
                  . <br />
                  You can also use a different model provider by following these{" "}
                  <a
                    href="https://github.com/cloudflare/agents-starter?tab=readme-ov-file#use-a-different-ai-model-provider"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-red-600 dark:text-red-400"
                  >
                    instructions.
                  </a>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
  return null;
}
