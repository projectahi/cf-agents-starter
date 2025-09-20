# ⚠️ CRITICAL REFERENCE FILES

**ALWAYS CHECK BEFORE ANY CODE CHANGES**: `.cursor/rules/cloudflare.mdc` contains comprehensive Cloudflare Workers, Agents SDK, and deployment best practices. This file is MANDATORY reading for any Cloudflare-related development work.

# Overview

The Chat Agent Starter Kit is a modern AI-powered chat application built on Cloudflare's platform. It provides an interactive chat interface with AI agents that can execute tools both automatically and with human-in-the-loop confirmation. The application features real-time streaming responses, advanced task scheduling, and a responsive UI with dark/light theme support.

**Project Status**: Fresh GitHub import successfully configured for Replit environment (September 20, 2025)

# Recent Changes

## September 20, 2025 - Initial Replit Setup
- ✅ Installed all npm dependencies (458 packages)
- ✅ Configured Vite development server for Replit environment (0.0.0.0:5000)
- ✅ Modified vite.config.ts to disable Cloudflare plugin during development in Replit
- ✅ Created .dev.vars file for OpenAI API key configuration
- ✅ Set up Frontend workflow with npm start command
- ✅ Added OpenAI JavaScript integration with proper package installation
- ✅ Configured deployment settings for production environment
- ⚠️ OpenAI API key needs to be configured by user for full functionality

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture

The frontend is built using **React 19** with **TypeScript** and follows a component-based architecture:

- **UI Framework**: React with modern hooks and context patterns
- **Styling**: TailwindCSS v4 with custom CSS variables for theming
- **Component Library**: Custom components built on Radix UI primitives (avatars, dropdowns, switches)
- **State Management**: React Context for global state (modals, tooltips, themes)
- **Build System**: Vite for development and bundling
- **Icons**: Phosphor Icons React library

The application uses a provider pattern with `ModalProvider` and `TooltipProvider` for managing global UI state. Theme switching is handled through localStorage persistence and CSS class toggling.

## Backend Architecture

The backend runs on **Cloudflare Workers** with Durable Objects for state management:

- **Runtime**: Cloudflare Workers edge computing platform
- **State Management**: Durable Objects for persistent chat sessions
- **AI Integration**: OpenAI GPT-4 models via AI SDK
- **Agent Framework**: Cloudflare's `agents` package for chat agent implementation
- **Streaming**: Real-time response streaming using AI SDK's streaming capabilities

The core `Chat` class extends `AIChatAgent` and handles message processing, tool execution, and response streaming. It supports both automatic tool execution and human-confirmation workflows.

## Tool System

The application implements a flexible tool system with two execution modes:

- **Automatic Execution**: Tools with `execute` functions run immediately (low-risk operations)
- **Human Confirmation**: Tools without `execute` functions require user approval before running
- **Scheduling**: Advanced task scheduling with one-time, delayed, and cron-based recurring tasks

Tools are defined in `tools.ts` with Zod schema validation for inputs. The system processes tool invocations through a confirmation workflow when human oversight is required.

## Data Flow

1. User messages are sent to the Durable Object via fetch requests
2. Messages are processed through the AI model with available tools
3. Tool calls are either executed automatically or queued for confirmation
4. Responses are streamed back to the frontend using Server-Sent Events
5. UI updates in real-time as tokens arrive

## Development Environment

**Replit Configuration**: The application has been specially configured for the Replit environment:

- **vite.config.ts**: Modified to detect Replit environment and disable Cloudflare plugin during development
- **Server Configuration**: Configured to serve on 0.0.0.0:5000 with proper host settings for Replit's proxy
- **Workflow**: Frontend workflow set up with npm start command and port 5000 monitoring
- **Environment Variables**: .dev.vars file created for OpenAI API key configuration
- **Deployment**: VM deployment target configured for production builds

# Cloudflare Best Practices Summary

*Full guidelines available in `.cursor/rules/cloudflare.mdc` - MUST be consulted for any Cloudflare development*

## Code Standards

- **Language**: Use TypeScript by default unless JavaScript specifically requested
- **Module Format**: Use ES modules exclusively (never Service Worker format)
- **File Organization**: Keep code in single file unless otherwise specified
- **Dependencies**: Minimize external dependencies; use official SDKs when available
- **Security**: Never bake secrets into code; include proper error handling and logging
- **Types**: Add appropriate TypeScript types and interfaces with explanatory comments

## Configuration Requirements

- **Config Format**: Always use `wrangler.jsonc` (not wrangler.toml)
- **Compatibility**: Set `compatibility_date = "2025-02-11"` and `compatibility_flags = ["nodejs_compat"]`
- **Observability**: Set `enabled = true` and `head_sampling_rate = 1` for observability
- **Bindings**: Only include bindings that are actually used in code

## Cloudflare Service Integration

**Storage & Data:**
- **Workers KV**: Key-value storage for configuration, user profiles, A/B testing
- **Durable Objects**: Strongly consistent state management, multiplayer coordination
- **D1**: Relational data with SQL dialect
- **R2**: Object storage for structured data, AI/image assets, user uploads
- **Hyperdrive**: Connect to existing PostgreSQL databases

**Processing & AI:**
- **Queues**: Asynchronous processing and background tasks
- **Vectorize**: Store embeddings for vector search (with Workers AI)
- **Workers AI**: Default AI API for inference (use official SDKs for Claude/OpenAI)
- **Browser Rendering**: Remote browser capabilities, web scraping, Puppeteer APIs
- **Workers Static Assets**: Host frontend applications and static files

## Agents SDK Best Practices

- **Preference**: Strongly prefer agent-sdk for building AI Agents
- **Streaming**: Use streaming responses from AI SDKs (OpenAI, Workers AI, Anthropic)
- **State Management**: Use `this.setState` API for state; `this.sql` for direct SQLite access
- **Frontend Integration**: Use `useAgent` React hook from `agents/react` for client connections
- **Class Extension**: Provide `Env` and optional state as type parameters: `class AIAgent extends Agent<Env, MyState>`
- **Configuration**: Include valid Durable Object bindings and set `migrations[].new_sqlite_classes` to Agent class name

## WebSocket Guidelines

- **API Choice**: Always use WebSocket Hibernation API (not legacy WebSocket API)
- **Durable Objects**: Use Hibernation API within Durable Objects
- **Connection**: Use `this.ctx.acceptWebSocket(server)` not `server.accept()`
- **Handlers**: Define `webSocketMessage()` and `webSocketClose()` handlers
- **Pattern**: Avoid `addEventListener` pattern for WebSocket events

## Security & Performance

**Security:**
- Implement proper request validation and security headers
- Handle CORS correctly; implement rate limiting where appropriate
- Follow least privilege principle for bindings; sanitize user inputs

**Performance:**
- Optimize for cold starts; minimize unnecessary computation
- Use appropriate caching strategies; consider Workers limits and quotas
- Implement streaming where beneficial

**Error Handling:**
- Implement proper error boundaries with meaningful error messages
- Return appropriate HTTP status codes; log errors appropriately
- Handle edge cases gracefully

# External Dependencies

## AI Services
- **OpenAI API**: GPT-4 model access for chat responses and tool calling
- **AI SDK**: Vercel's AI SDK for streaming, tool handling, and message management
- **Cloudflare AI**: Integrated with Cloudflare's AI platform for model access

## Cloudflare Platform
- **Cloudflare Workers**: Serverless edge computing runtime
- **Durable Objects**: Persistent storage and state management for chat sessions
- **Cloudflare AI Gateway**: Optional API gateway for OpenAI requests (configured but commented)

## Frontend Libraries
- **React & React DOM**: v19 for UI framework
- **Radix UI**: Accessible component primitives (avatar, dropdown-menu, slot, switch)
- **TailwindCSS**: v4 for styling with custom configuration
- **Phosphor Icons**: Icon library for UI elements
- **React Markdown**: Markdown rendering with GitHub Flavored Markdown support
- **Class Variance Authority**: Type-safe component variants
- **Clsx & Tailwind Merge**: Utility for conditional CSS classes

## Development Tools
- **TypeScript**: Type safety and developer experience
- **Vite**: Build tool and development server
- **Biome**: Linting and code formatting
- **Vitest**: Testing framework with Cloudflare Workers support
- **Wrangler**: Cloudflare Workers CLI for deployment and development

## Runtime Environment
- **Node.js**: Development environment
- **Cloudflare Workers Runtime**: Production serverless environment
- **Environment Variables**: OpenAI API key configuration via `.dev.vars`