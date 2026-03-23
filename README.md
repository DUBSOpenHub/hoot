# 🦉 Hoot — The AI That Never Sleeps

[![npm version](https://img.shields.io/npm/v/hoot.svg)](https://www.npmjs.com/package/hoot)
[![CI](https://github.com/DUBSOpenHub/hoot/actions/workflows/ci.yml/badge.svg)](https://github.com/DUBSOpenHub/hoot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Node.js ≥18](https://img.shields.io/badge/node-%E2%89%A518-232F3E.svg)
![Default backend: Copilot SDK](https://img.shields.io/badge/default%20backend-Copilot%20SDK-000000.svg)

<img width="503" height="257" alt="Screenshot 2026-03-23 at 10 49 23 AM" src="https://github.com/user-attachments/assets/a7cfa818-0e37-468a-b969-be46d298d146" />

**Your personal AI daemon — it runs 24/7 in the background, remembers your preferences, handles tasks while you sleep, and reaches you on Telegram or your terminal.** Ships with [GitHub Copilot SDK](https://github.com/github/copilot-sdk) as the default backend; swap in Ollama, Anthropic, or OpenAI via the `AIProvider` interface.

> **🤖 Built by 109 AI agents across 10 models in 12 hours.**
> Hoot was designed, implemented, tested, and hardened by a swarm of AI agents orchestrated through 33 primary agents and 76 sub-agents spanning Claude Opus, Sonnet, GPT-5.x, and Gemini. 233 tests. Zero human-written source code.

### 📊 [**Learn more about Hoot here**](https://dubsopenhub.github.io/hoot/)

> ### ⚡ Three Commands. Done.
>
> **Never used Node.js before? No problem.** Here's how to get Hoot running:
>
> **1. Open your terminal**
> - 🍎 **Mac:** Press `⌘ + Space`, type **Terminal**, hit Enter
> - 🪟 **Windows:** Press `Win + X`, choose **Terminal** or **PowerShell**
> - 🐧 **Linux:** Press `Ctrl + Alt + T`
>
> **2. Install Hoot:**
> ```bash
> curl -fsSL https://raw.githubusercontent.com/DUBSOpenHub/hoot/main/install.sh | bash
> ```
>
> **3. Start it:**
> ```bash
> hoot setup && hoot start
> ```
>
> That's it — Hoot is watching! 🦉
>
> *Requires [Node.js ≥18](https://nodejs.org) and an active [Copilot subscription](https://github.com/features/copilot/plans).*

---

## 🦉 What Is Hoot?

Hoot is like having a developer friend who never goes home. It runs on your computer 24/7, remembers your preferences, handles tasks while you're away, and reaches you on your phone via Telegram.

**The before and after:**

| Without Hoot | With Hoot 🦉 |
|---|---|
| Open ChatGPT → paste context → wait → copy answer → paste → repeat | Tell Hoot from your phone → walk away → get notified when done |
| Forget what you asked yesterday | Hoot remembers across 5 memory categories |
| One tab, one conversation | Same brain on Telegram, terminal, and HTTP — pick up where you left off |

---

## 🧠 What Makes It Different

Most AI tools are ephemeral — they forget you the moment the session ends. Hoot is a **daemon**: a persistent background process that runs 24/7 on your machine.

| Capability | Hoot 🦉 |
|-----------|---------|
| Always-on daemon | ✅ Runs 24/7 in the background |
| Long-term memory | ✅ Across 5 categories |
| Multi-channel (mobile + terminal) | ✅ Telegram + TUI + HTTP |
| Background agents | ✅ Up to 5 concurrent |
| Proactive notifications | ✅ Pushes to you |
| Model routing (fast/standard/premium) | ✅ Auto-classifies |
| Local-first, private | ✅ All data on your machine |

**What makes Hoot special:**

- 🧠 **Ambient Awareness** — Hoot remembers what you asked 3 hours ago. Preferences, facts, projects, people, routines — all persisted in local SQLite.
- ⚡ **Background Agency** — Say "refactor the auth module" from Telegram and walk away. Hoot spawns an agent, does the job, and notifies you when it's done.
- 📱 **Channel Convergence** — Same brain serves Telegram (mobile), TUI (terminal), and HTTP API. One daemon, many interfaces, zero context loss.

---

## 🚀 Quick Start

### Step 1: Install

```bash
npm install -g hoot
```

> **What's npm?** It's the Node.js package manager — it comes with [Node.js](https://nodejs.org). Download Node.js ≥18 and npm is included.

### Step 2: Setup

```bash
hoot setup
```

This creates `~/.hoot/` — the Hoot config directory. It stores your config, database, skills, and plugins.

### Step 3: Install the Copilot CLI

```bash
copilot login
```

> **What's the Copilot CLI?** It's the default AI backend Hoot ships with. Hoot's `AIProvider` interface supports pluggable backends — Copilot SDK is the default, but you can swap in Ollama, Anthropic, or OpenAI. For the default setup, you need an active [Copilot subscription](https://github.com/features/copilot/plans).

### Step 4: Start the daemon

```bash
hoot start
```

> **What's a daemon?** A background process that keeps running even when you close the terminal. Like a server, but personal.

### Step 5: Connect via TUI

```bash
hoot tui
```

> **What's a TUI?** A terminal user interface — a chat window inside your terminal.

---

## 💬 Talk to Hoot

From Telegram or the TUI, just type naturally. Here's what it feels like:

```
You: Start working on the auth bug in ~/dev/myapp
🦉: I'll create an agent session for that. Working directory: ~/dev/myapp.
    Spawned agent 'auth-fix' — I'll notify you when it's done.

You: What sessions are running?
🦉: 1 active agent:
    • auth-fix (~/dev/myapp) — running for 2m 30s

You: Remember that I prefer TypeScript over JavaScript
🦉: Got it! Saved to preferences: "Prefers TypeScript over JavaScript"

You: Check on the auth-fix session
🦉: Agent 'auth-fix' completed! Here's what I did:
    - Fixed the JWT expiration check in src/auth/validate.ts
    - Added missing error handling for expired refresh tokens
    - Updated 3 test files to match
```

---

## 🔧 Commands

### CLI Commands

| Command | Description |
|---------|-------------|
| `hoot start` | Start the daemon (background process) |
| `hoot tui` | Connect to the daemon via terminal UI |
| `hoot setup` | Interactive first-run configuration |
| `hoot update` | Check for and install updates |
| `hoot help` | Show available commands |
| `hoot start --self-edit` | Allow Hoot to modify its own source |

### TUI Commands

| Command | Description |
|---------|-------------|
| `/model [name]` | Show or switch the current model |
| `/memory` | Show stored memories |
| `/skills` | List installed skills |
| `/agents` | List active agent sessions |
| `/copy` | Copy last response to clipboard |
| `/status` | Daemon health check |
| `/restart` | Restart the daemon |
| `/cancel` | Cancel in-flight message |
| `/clear` | Clear the screen |
| `/quit` | Exit the TUI |

---

## 🏗️ Architecture

Here's what happens when you send Hoot a message: your input arrives through one of three channels (Telegram, TUI, or HTTP API), gets routed through the Message Bus to the Orchestrator (Hoot's persistent brain), which classifies the message complexity, selects the right AI model, and either responds directly or spawns a background agent for heavy tasks. Everything is backed by SQLite for memory, a Circuit Breaker for resilience, and structured logging for observability.

```
╔═══════════════════════════════════════════════════════════════╗
║                        CHANNELS                               ║
║   ┌──────────┐   ┌──────────┐   ┌──────────┐                ║
║   │ Telegram │   │   TUI    │   │ HTTP API │                ║
║   │ (mobile) │   │(terminal)│   │ (:7777)  │                ║
║   └────┬─────┘   └────┬─────┘   └────┬─────┘                ║
╠════════╪══════════════╪══════════════╪════════════════════════╣
║        └──────────────┼──────────────┘                        ║
║                       ▼                                       ║
║              ┌─────────────────┐                              ║
║              │   Message Bus   │  Typed EventEmitter          ║
║              │   (pub/sub)     │  correlationId tracking      ║
║              └────────┬────────┘                              ║
║                       ▼                                       ║
║         ┌─────────────────────────┐                           ║
║         │  Priority Queue (3 lanes)│                          ║
║         │  fast(2) std(2) prem(1)  │                          ║
║         └────────────┬─────────────┘                          ║
║                      ▼                                        ║
║         ┌──────────────────────┐     ┌──────────────────┐    ║
║         │   Orchestrator       │────▶│  Agent Pool        │    ║
║         │   (persistent brain) │     │  (warm sessions)   │    ║
║         │   + Circuit Breaker  │     │  checkout/return   │    ║
║         └──────────────────────┘     └──────────────────┘    ║
║                      │                                        ║
║    ┌─────────────────┼─────────────────┐                     ║
║    ▼                 ▼                 ▼                      ║
║  ┌──────┐      ┌──────────┐     ┌──────────┐                ║
║  │SQLite│      │  Plugins │     │ Metrics  │                ║
║  │(WAL) │      │(hot-load)│     │(/metrics)│                ║
║  └──────┘      └──────────┘     └──────────┘                ║
╚═══════════════════════════════════════════════════════════════╝
```

**Key components:**

- **Message Bus** — Typed EventEmitter decoupling all components via pub/sub
- **Priority Queue** — 3-lane concurrent processing (fast/standard/premium) with rate limiting
- **Agent Pool** — Pre-warmed AI sessions for instant background task dispatch
- **Circuit Breaker** — Auto-trips after 3 SDK failures, self-heals after 30s
- **Plugin System** — Drop plugins in `~/.hoot/plugins/` with hot-reload
- **Audit Log** — Every auth rejection, model switch, and agent event logged to SQLite

---

## 🔌 Extend Hoot

Hoot has two extension mechanisms:

### Skills (no code — teach Hoot new knowledge)

Hoot ships with 220+ skills from [github/awesome-copilot](https://github.com/github/awesome-copilot) — the community catalog of Copilot customizations. New skills sync automatically via daily auto-sync, so Hoot's capabilities grow without you lifting a finger.

Skills are markdown files that give Hoot new capabilities by adding instructions to its system prompt. You can also create your own — drop a `SKILL.md` into `~/.hoot/skills/your-skill/`:

```markdown
---
name: my-skill
description: Teaches Hoot how to do X
---

When the user asks about X, do the following...
```

Or discover and install community skills: just ask Hoot "find a skill for X".

### Plugins (TypeScript code — hook into events)

Plugins are Node.js modules that register tools, subscribe to bus events, and add API routes. Drop an `index.js` into `~/.hoot/plugins/your-plugin/`:

```typescript
import type { HootPlugin } from 'hoot';

const plugin: HootPlugin = {
  name: 'hello-world',
  version: '1.0.0',
  async onLoad(ctx) {
    ctx.bus.on('message.incoming', (envelope) => {
      ctx.log.info({ msg: envelope.text }, 'New message');
    });
    ctx.registerTool({
      name: 'greet',
      description: 'Say hello',
      handler: async () => ({ greeting: 'Hello from plugin!' }),
    });
  },
};

export default plugin;
```

Enable with `HOOT_PLUGINS_ENABLED=1` in `~/.hoot/.env`. Plugins hot-reload on file changes.

---

## ⚙️ Configuration

All configuration lives in `~/.hoot/.env`. Every variable is optional — Hoot works with zero config.

| Variable | Default | Description |
|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | — | Bot token from [@BotFather](https://t.me/BotFather) |
| `AUTHORIZED_USER_ID` | — | Your Telegram user ID (whitelist) |
| `API_PORT` | `7777` | Local HTTP API port |
| `COPILOT_MODEL` | `claude-sonnet-4.6` | Default AI model |
| `WORKER_TIMEOUT` | `600000` | Worker session timeout in ms (10 min) |
| `HOOT_QUEUE_V2` | `1` | Enable concurrent 3-lane priority queue |
| `HOOT_POOL_ENABLED` | `1` | Enable agent session pool with warm sessions |
| `HOOT_ENCRYPT_DB` | `0` | Enable XOR-obfuscated SQLite at rest |
| `HOOT_LOG_FORMAT` | `json` | Logging format: `json`, `pretty`, or `legacy` |
| `HOOT_LOG_LEVEL` | `info` | Log level: `debug`, `info`, `warn`, `error` |
| `HOOT_PLUGINS_ENABLED` | `0` | Load plugins from `~/.hoot/plugins/` |
| `HOOT_SELF_EDIT` | `0` | Allow Hoot to modify its own source files |
| `HOOT_TUI_DEBUG` | `0` | Enable TUI debug logging |

---

## 🔒 Security

Hoot takes security seriously. Every API call requires a bearer token, Telegram is user-ID whitelisted, and agents are blocked from sensitive directories like `~/.ssh` and `~/.aws`.

| Feature | Status |
|---------|--------|
| Bearer token auth (API) | ✅ Always on |
| Telegram user ID whitelist | ✅ Always on |
| Agent directory blocking (9 sensitive dirs) | ✅ Always on |
| Structured audit logging | ✅ Always on |
| Rate limiting (100 req/min) | ✅ Always on |
| CORS restriction (localhost only) | ✅ Always on |
| Encryption at rest | 🔒 Opt-in (`HOOT_ENCRYPT_DB=1`) |
| Token rotation | ✅ `POST /auth/rotate` |
| Prompt length limit (50K chars) | ✅ Always on |
| Circuit breaker (SDK resilience) | ✅ Always on |

Full details: [SECURITY.md](SECURITY.md) · [Threat Model](docs/threat-model.md)

---

## 📊 Observability

When `HOOT_LOG_FORMAT=json` (default), all output is structured JSON piped to stdout:

```json
{"ts":"2026-03-21T06:29:13Z","level":"info","component":"orchestrator","msg":"Message queued","correlationId":"abc-123"}
```

Prometheus metrics available at `GET http://127.0.0.1:7777/metrics`:

```
max_messages_total{tier="standard",channel="telegram"} 42
max_response_duration_seconds{tier="fast",quantile="0.95"} 0.8
max_workers_active 2
max_uptime_seconds 86400
```

---

## 🛠️ Development

### Prerequisites

- [Node.js ≥18](https://nodejs.org)
- [GitHub Copilot subscription](https://github.com/features/copilot/plans)
- npm (included with Node.js)

### Getting started

```bash
# Clone and install
git clone https://github.com/DUBSOpenHub/hoot.git
cd hoot
npm install

# Watch mode (auto-restart on changes)
npm run dev

# Build TypeScript
npm run build

# Run tests
npx vitest run

# Type check
npx tsc --noEmit
```

---

## ❓ FAQ

**Is Hoot free?**
Yes. You need a [Copilot subscription](https://github.com/features/copilot/plans) for the underlying AI, but Hoot itself is MIT-licensed open source.

**Does Hoot need the internet?**
Yes — the default Copilot SDK backend requires cloud connectivity. But all storage, config, skills, and memories are local. Alternative backends (like Ollama) can run fully offline.

**Can I use it without Telegram?**
Absolutely. Telegram is optional. The TUI and HTTP API work without it.

**How much memory does it use?**
~200MB base + ~400MB per active agent. Each agent is a full Copilot SDK session — not a lightweight thread, a real AI session with its own context, tools, and file access. 5 concurrent agents = ~2.2GB total. This is configurable via `HOOT_CONCURRENT_WORKERS` in `.env`.

**How many things can it do in parallel?**
5 concurrent agents by default. Each agent can independently run commands, edit files, and call tools. Agents can also invoke Stampede (up to 20 parallel CLI agents in tmux panes), so one Telegram message can theoretically orchestrate 100 parallel agents — though API rate limits are the practical ceiling.

**What models does Hoot use?**
3-tier routing: GPT-4.1 (fast/trivial), Claude Sonnet 4.6 (standard/coding), Claude Opus 4.6 (premium/complex). The LLM classifier auto-selects with keyword overrides.

**Can I add custom skills?**
Yes — Hoot ships with 220+ skills from [awesome-copilot](https://github.com/github/awesome-copilot) and syncs new ones daily. You can also create your own: drop a markdown file in `~/.hoot/skills/` or a TypeScript plugin in `~/.hoot/plugins/`.

**Why is the config in `~/.hoot/`?**
The config directory is now `~/.hoot/`. If you're upgrading from an older version that used `~/.max/`, Hoot automatically migrates your config, database, skills, and plugins on first run. No manual steps needed.

**What is the Copilot SDK?**
The [GitHub Copilot SDK](https://github.com/github/copilot-sdk) is a Node.js library that provides AI model access, session management, tool calling, and streaming. It's Hoot's default `AIProvider` backend. The `AIProvider` interface (`src/providers/types.ts`) lets you swap in any backend — implement `createSession()`, `sendAndWait()`, and `listModels()` and Hoot works with your provider instead.

---

## 🤝 Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions and [AGENTS.md](AGENTS.md) for the architecture overview.

---

## 📄 License

[MIT](LICENSE)

---

🐙 Created by **Gregg Cochran** ([@DUBSOpenHub](https://github.com/DUBSOpenHub)) — an AI-native builder who shipped this entire daemon, 220+ superpowers (synced from [awesome-copilot](https://github.com/github/awesome-copilot)), and a Telegram bot using nothing but the [GitHub Copilot CLI](https://docs.github.com/copilot/concepts/agents/about-copilot-cli). No IDE. No hand-written code. Just one terminal and up to 100 AI agents.

**The magic of Hoot 🦉:** You message an owl on your phone. The owl thinks, spawns agents, writes code, runs tests, and messages you back when it's done. You walk away. You come back. The work is finished. That's it. That's the whole product. An owl that never sleeps, never forgets, and does what you tell it — from anywhere.

**Why this matters:** You don't need to be a developer to build things that help you in your role. Find the leverage. Gain the velocity. The CLI is the equalizer — if you can describe what you need, you can ship it. Hoot exists because one person asked "what if I had an AI that never went offline?" and then built it. You can do the same. 🦉
