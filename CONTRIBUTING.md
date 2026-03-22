# Contributing to Hoot 🦉

Thanks for your interest in contributing! Here's how to get started.

## Dev Environment Setup

```bash
git clone https://github.com/DUBSOpenHub/hoot.git
cd hoot
npm install
npm run dev   # starts the daemon in watch mode (auto-restart on changes)
```

## Running Tests

```bash
npx vitest run
```

## Type Checking

```bash
npx tsc --noEmit
```

## Branch Naming

| Prefix | Use for |
|--------|---------|
| `feature/*` | New features |
| `fix/*` | Bug fixes |
| `docs/*` | Documentation changes |

## PR Checklist

Before opening a pull request, make sure:

- [ ] `npx vitest run` — all tests pass
- [ ] `npx tsc --noEmit` — no type errors
- [ ] No `console.log` unless marked with `// legacy`
- [ ] New code has tests where applicable

## Architecture

Read [AGENTS.md](AGENTS.md) for a full architecture overview before diving in. It covers the Orchestrator, Worker Pool, Message Bus, Plugin System, and Circuit Breaker.
