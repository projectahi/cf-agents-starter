import { useEffect, useMemo, useRef, useState } from "react";

import type { UIMessage } from "@ai-sdk/react";
import { isToolUIPart } from "ai";
import { PaperPlaneTilt, Stop } from "@phosphor-icons/react";

import { Avatar } from "@/components/avatar/Avatar";
import { Card } from "@/components/card/Card";
import { MemoizedMarkdown } from "@/components/memoized-markdown";
import { Textarea } from "@/components/textarea/Textarea";
import { ToolInvocationCard } from "@/components/tool-invocation-card/ToolInvocationCard";
import { cn } from "@/lib/utils";
import type { ChatMessageMetadata } from "@/shared";

interface AgentChatWindowProps {
  messages: UIMessage<ChatMessageMetadata>[];
  status: string;
  confirmationToolNames: Set<string>;
  addToolResult: (input: {
    tool: string;
    toolCallId: string;
    output: unknown;
  }) => void;
  onSendMessage: (
    text: string,
    trigger: "submit" | "enter"
  ) => Promise<void> | void;
  onStop?: () => void;
  showDebug?: boolean;
  disabled?: boolean;
  emptyState?: React.ReactNode;
  placeholder?: string;
  disabledPlaceholder?: string;
  className?: string;
  messagesContainerClassName?: string;
  composerClassName?: string;
  showAvatars?: boolean;
}

function formatTime(date: Date) {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function AgentChatWindow({
  messages,
  status,
  confirmationToolNames,
  addToolResult,
  onSendMessage,
  onStop,
  showDebug = false,
  disabled = false,
  emptyState,
  placeholder = "Send a message...",
  disabledPlaceholder,
  className,
  messagesContainerClassName,
  composerClassName,
  showAvatars = true
}: AgentChatWindowProps) {
  const [inputValue, setInputValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const lastMessageId =
    messages.length > 0 ? (messages[messages.length - 1]?.id ?? null) : null;

  const isGenerating = status === "submitted" || status === "streaming";

  const pendingToolCallConfirmation = useMemo(
    () =>
      messages.some((message) =>
        message.parts?.some((part) => {
          if (!isToolUIPart(part)) return false;
          const toolName = part.type.replace("tool-", "");
          return (
            part.state === "input-available" &&
            confirmationToolNames.has(toolName)
          );
        })
      ),
    [confirmationToolNames, messages]
  );

  useEffect(() => {
    if (!lastMessageId) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lastMessageId]);

  useEffect(() => {
    if (disabled) {
      setInputValue("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    }
  }, [disabled]);

  const resolvedPlaceholder = disabled
    ? (disabledPlaceholder ?? placeholder)
    : pendingToolCallConfirmation
      ? "Please respond to the tool confirmation above..."
      : placeholder;

  const handleSend = async (trigger: "submit" | "enter") => {
    const trimmed = inputValue.trim();
    if (!trimmed || disabled || pendingToolCallConfirmation) return;
    await onSendMessage(trimmed, trigger);
    setInputValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await handleSend("submit");
  };

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div
        className={cn(
          "flex-1 overflow-y-auto p-4 space-y-4 pb-24",
          messagesContainerClassName
        )}
      >
        {messages.length === 0 ? (
          <div className="h-full w-full">{emptyState}</div>
        ) : (
          messages.map((message, index) => {
            const isUser = message.role === "user";
            const respondingAgent =
              !isUser && message.metadata?.respondingAgent
                ? message.metadata.respondingAgent
                : undefined;
            const avatarLabel = isUser
              ? "You"
              : (respondingAgent?.name ?? "Assistant");
            const agentPillAlignment = isUser ? "justify-end" : "justify-start";
            const showAvatar =
              showAvatars &&
              !isUser &&
              (index === 0 || messages[index - 1]?.role !== message.role);

            return (
              <div key={message.id}>
                {showDebug && (
                  <pre className="mb-2 max-h-64 overflow-auto rounded-md bg-neutral-100 p-2 text-xs text-neutral-600 dark:bg-neutral-900 dark:text-neutral-300">
                    {JSON.stringify(message, null, 2)}
                  </pre>
                )}
                <div
                  className={cn(
                    "flex",
                    isUser ? "justify-end" : "justify-start"
                  )}
                >
                  <div
                    className={cn(
                      "flex w-full max-w-[85%] gap-2",
                      isUser ? "flex-row-reverse" : "flex-row"
                    )}
                  >
                    {showAvatars ? (
                      showAvatar ? (
                        <Avatar username={avatarLabel} size="base" />
                      ) : (
                        !isUser && <div className="w-8" />
                      )
                    ) : null}

                    <div className="space-y-2">
                      {respondingAgent ? (
                        <div className={cn("flex", agentPillAlignment)}>
                          <span
                            className="inline-flex items-center gap-1 rounded-full bg-neutral-200 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200"
                            title={
                              respondingAgent.reason
                                ? `${respondingAgent.orchestratorName} routed this conversation here: ${respondingAgent.reason}`
                                : respondingAgent.source === "handoff"
                                  ? `${respondingAgent.orchestratorName} routed this conversation to ${respondingAgent.name}.`
                                  : undefined
                            }
                          >
                            {respondingAgent.name}
                          </span>
                        </div>
                      ) : null}
                      {message.parts?.map((part, partIndex) => {
                        if (part.type === "text") {
                          const isScheduled =
                            part.text.startsWith("scheduled message");
                          return (
                            <div key={`${message.id}-text-${partIndex}`}>
                              <Card
                                className={cn(
                                  "relative rounded-md bg-neutral-100 p-3 dark:bg-neutral-900",
                                  isUser
                                    ? "rounded-br-none"
                                    : "rounded-bl-none border-assistant-border",
                                  isScheduled ? "border-accent/50" : undefined
                                )}
                              >
                                {isScheduled && (
                                  <span className="absolute -left-2 -top-3 text-base">
                                    🕒
                                  </span>
                                )}
                                <MemoizedMarkdown
                                  id={`${message.id}-${partIndex}`}
                                  content={part.text.replace(
                                    /^scheduled message: /,
                                    ""
                                  )}
                                />
                              </Card>
                              <p
                                className={cn(
                                  "mt-1 text-xs text-muted-foreground",
                                  isUser ? "text-right" : "text-left"
                                )}
                              >
                                {formatTime(
                                  message.metadata?.createdAt
                                    ? new Date(message.metadata.createdAt)
                                    : new Date()
                                )}
                              </p>
                            </div>
                          );
                        }

                        if (isToolUIPart(part)) {
                          const toolCallId = part.toolCallId;
                          const toolName = part.type.replace("tool-", "");
                          const needsConfirmation =
                            confirmationToolNames.has(toolName);

                          if (showDebug) return null;

                          return (
                            <ToolInvocationCard
                              // biome-ignore lint/suspicious/noArrayIndexKey: tool UI parts preserve deterministic order from the agent response
                              key={`${toolCallId}-${partIndex}`}
                              toolUIPart={part}
                              toolCallId={toolCallId}
                              needsConfirmation={needsConfirmation}
                              onSubmit={({ toolCallId: submitId, result }) => {
                                addToolResult({
                                  tool: toolName,
                                  toolCallId: submitId,
                                  output: result
                                });
                              }}
                              addToolResult={(toolCallIdParam, result) => {
                                addToolResult({
                                  tool: toolName,
                                  toolCallId: toolCallIdParam,
                                  output: result
                                });
                              }}
                            />
                          );
                        }

                        return null;
                      })}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      <form
        onSubmit={handleSubmit}
        className={cn(
          "relative border-t border-neutral-300 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900",
          composerClassName
        )}
      >
        <div className="flex items-end gap-2">
          <div className="relative flex-1">
            <Textarea
              ref={textareaRef}
              disabled={disabled || pendingToolCallConfirmation}
              placeholder={resolvedPlaceholder}
              className="flex w-full resize-none overflow-hidden rounded-2xl border border-neutral-200 px-3 py-2 pb-10 text-base text-neutral-900 ring-offset-background placeholder:text-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300 focus-visible:ring-offset-2 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-400 dark:focus-visible:ring-neutral-700 dark:focus-visible:ring-offset-neutral-900"
              value={inputValue}
              onChange={(event) => {
                setInputValue(event.target.value);
                const textarea = event.currentTarget;
                textarea.style.height = "auto";
                textarea.style.height = `${textarea.scrollHeight}px`;
              }}
              onKeyDown={async (event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  await handleSend("enter");
                }
              }}
            />
            <div className="absolute bottom-2 right-2 flex gap-2">
              {isGenerating && onStop ? (
                <button
                  type="button"
                  onClick={onStop}
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-neutral-200 bg-primary p-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:border-neutral-800"
                  aria-label="Stop generation"
                >
                  <Stop size={16} />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={
                    disabled ||
                    pendingToolCallConfirmation ||
                    inputValue.trim().length === 0
                  }
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-neutral-200 bg-primary p-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 dark:border-neutral-800"
                  aria-label="Send message"
                >
                  <PaperPlaneTilt size={16} />
                </button>
              )}
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
