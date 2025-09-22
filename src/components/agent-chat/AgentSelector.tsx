import { useEffect, useMemo, useRef, useState } from "react";

import { CaretDown, Check, MagnifyingGlass } from "@phosphor-icons/react";

import type { AgentProfile } from "@/agent-config";
import { Loader } from "@/components/loader/Loader";
import { cn } from "@/lib/utils";

interface AgentSelectorProps {
  agents: AgentProfile[];
  activeAgentId: string | null | undefined;
  onSelect: (agentId: string) => Promise<void> | void;
  label?: string;
  disabled?: boolean;
  isLoading?: boolean;
  isPending?: boolean;
  error?: string | null;
}

export function AgentSelector({
  agents,
  activeAgentId,
  onSelect,
  label,
  disabled = false,
  isLoading = false,
  isPending = false,
  error
}: AgentSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const activeAgent = useMemo(
    () => agents.find((agent) => agent.id === activeAgentId) ?? null,
    [activeAgentId, agents]
  );

  const normalizedQuery = searchTerm.trim().toLowerCase();
  const filteredAgents = useMemo(() => {
    if (!normalizedQuery) return agents;
    return agents.filter((agent) => {
      const haystack = `${agent.name} ${agent.behavior}`.toLowerCase();
      const model = agent.config.modelId?.toLowerCase() ?? "";
      return (
        haystack.includes(normalizedQuery) || model.includes(normalizedQuery)
      );
    });
  }, [agents, normalizedQuery]);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (containerRef.current.contains(event.target as Node)) return;
      setIsOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      const timer = window.setTimeout(() => {
        searchInputRef.current?.focus();
      }, 0);
      return () => window.clearTimeout(timer);
    }
    setSearchTerm("");
    return undefined;
  }, [isOpen]);

  const toggleOpen = () => {
    if (disabled) return;
    setIsOpen((prev) => !prev);
  };

  const handleSelect = async (agentId: string) => {
    if (agentId === activeAgentId) {
      setIsOpen(false);
      return;
    }
    try {
      await onSelect(agentId);
      setIsOpen(false);
    } catch (error_) {
      // Leave dropdown open so the user can try again
      console.error("Failed to select agent", error_);
    }
  };

  const triggerLabel =
    activeAgent?.name ?? (isLoading ? "Loading agents" : "Select an agent");

  return (
    <div className="relative w-full max-w-xs" ref={containerRef}>
      <button
        type="button"
        className={cn(
          "flex w-full flex-col rounded-md border border-neutral-300 bg-white px-3 py-2 text-left text-sm transition-shadow hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300 dark:border-neutral-700 dark:bg-neutral-800 dark:hover:bg-neutral-700 dark:focus-visible:ring-neutral-600",
          {
            "cursor-not-allowed opacity-60": disabled,
            "ring-2 ring-neutral-300 dark:ring-neutral-600": isOpen
          }
        )}
        onClick={toggleOpen}
        disabled={disabled || isLoading}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        {label ? (
          <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            {label}
          </span>
        ) : null}
        <span className="flex items-center justify-between gap-2 text-sm font-medium text-neutral-900 dark:text-neutral-100">
          <span className="truncate">{triggerLabel}</span>
          {isPending ? (
            <Loader size={16} className="text-neutral-500" />
          ) : (
            <CaretDown size={16} className="shrink-0 text-neutral-500" />
          )}
        </span>
        {activeAgent ? (
          <span className="mt-1 overflow-hidden text-ellipsis text-xs text-neutral-500 dark:text-neutral-400">
            {activeAgent.behavior}
          </span>
        ) : null}
        {error ? (
          <span className="mt-1 text-xs text-red-500 dark:text-red-400">
            {error}
          </span>
        ) : null}
      </button>

      {isOpen ? (
        <div className="absolute right-0 z-50 mt-2 w-80 max-w-sm rounded-lg border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
          <div className="border-b border-neutral-200 p-2 dark:border-neutral-700">
            <label className="flex items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-2 text-sm text-neutral-600 focus-within:border-neutral-300 focus-within:ring-1 focus-within:ring-neutral-200 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:focus-within:border-neutral-600 dark:focus-within:ring-neutral-700">
              <MagnifyingGlass size={16} className="text-neutral-500" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search agents..."
                className="w-full bg-transparent py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none dark:text-neutral-100 dark:placeholder:text-neutral-500"
                aria-label="Search agents"
              />
            </label>
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
            {isLoading ? (
              <div className="flex h-20 items-center justify-center text-sm text-neutral-500 dark:text-neutral-400">
                <Loader size={20} className="text-neutral-500" />
              </div>
            ) : filteredAgents.length === 0 ? (
              <div className="px-3 py-4 text-sm text-neutral-500 dark:text-neutral-400">
                No agents found.
              </div>
            ) : (
              filteredAgents.map((agent) => {
                const isActive = agent.id === activeAgentId;
                return (
                  <button
                    type="button"
                    key={agent.id}
                    onClick={() => handleSelect(agent.id)}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
                      isActive
                        ? "bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                        : "hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                    )}
                    disabled={isPending}
                    role="option"
                    aria-selected={isActive}
                  >
                    <span className="mt-0.5">
                      {isActive ? (
                        <Check size={16} className="text-[#F48120]" />
                      ) : (
                        <span className="block size-4 rounded-full border border-neutral-300 dark:border-neutral-600" />
                      )}
                    </span>
                    <span className="flex-1">
                      <span className="block font-medium text-neutral-900 dark:text-neutral-100">
                        {agent.name}
                      </span>
                      <span className="mt-0.5 block text-xs text-neutral-500 dark:text-neutral-400">
                        {agent.behavior}
                      </span>
                      <span className="mt-1 block text-[11px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                        Model: {agent.config.modelId}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
