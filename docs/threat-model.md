# Hoot 🦉 — Threat Model

> **Status:** Living document — update whenever the attack surface changes.
> **Last reviewed:** 2025
> **Scope:** Hoot daemon running on a single-user macOS/Linux workstation. Configuration lives in `~/.max/` (Hoot config directory, kept for backward compatibility).

---

## 1. Attack Surface Map

```
                         ┌─────────────────────────────────────────────┐
                         │               INTERNET                       │
                         │                                              │
                         │  Telegram API (api.telegram.org)  GitHub    │
                         │  Copilot API (api.githubcopilot.com)  npm   │
                         └───────────┬────────────────────┬────────────┘
                                     │ HTTPS               │ HTTPS
                                     ▼                     ▼
          ┌────────────┐   ┌──────────────────┐  ┌──────────────────┐
          │ TUI stdin  │   │  Telegram bot    │  │  Copilot SDK     │
          │ (keyboard) │   │  src/telegram/   │  │  (npm package)   │
          └─────┬──────┘   │  bot.ts          │  └──────────────────┘
                │           └────────┬─────────┘
                │ local IPC          │ grammY long-poll
                ▼                   ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │                    Hoot Daemon  (PID, user-level)                │
  │                                                                  │
  │  Express :7777 ──► src/api/server.ts (bearer token auth)         │
  │  (127.0.0.1 only)                                                │
  │                                                                  │
  │  Orchestrator ──► src/copilot/orchestrator.ts                    │
  │  Workers (up to 5) src/copilot/tools.ts                          │
  │  Plugin loader  ──► src/plugins/manager.ts                       │
  │                                                                  │
  │  SQLite  ~/.max/max.db  (src/store/db.ts)                        │
  │  Env     ~/.max/.env    (plaintext)                              │
  │  Token   ~/.max/api-token  (0o600)                               │
  │  Skills  ~/.max/skills/   ~/.agents/skills/                      │
  │  Plugins ~/.max/plugins/                                         │
  │                                                                  │
  │  npm supply chain: node_modules/                                 │
  │  Worker filesystem access (any path except blocked dirs)         │
  └──────────────────────────────────────────────────────────────────┘
```

---

## 2. Threat Actors

| Actor | Capability | Goal |
|-------|-----------|------|
| **Local user** | Read any file owned by the daemon user; send HTTP to 127.0.0.1; inject TUI stdin | Escalate privilege; exfiltrate secrets; manipulate agent behaviour |
| **Network attacker** | Send packets to localhost only if local or via SSRF from a browser | Reach the HTTP API; hijack SSE stream; trigger worker actions |
| **Malicious skill** | SKILL.md is loaded and injected into the system prompt | Prompt-inject the Orchestrator; exfiltrate memories; pivot to worker filesystem access |
| **Compromised dependency** | Full Node.js process access at import time | Exfiltrate `~/.max/.env`, `~/.max/api-token`; spawn network connections; install backdoor |
| **Unauthorized Telegram user** | Send messages to the bot endpoint | Execute arbitrary prompts; access memory/skills; spawn workers |

---

## 3. Threat Catalogue & Risk Matrix

**Likelihood:** 1 (rare) – 5 (near-certain) on a single-user workstation.
**Impact:** 1 (negligible) – 5 (catastrophic / credential theft / full compromise).
**Risk = Likelihood × Impact**

| ID | Threat | Likelihood | Impact | Risk | Status |
|----|--------|-----------|--------|------|--------|
| T1 | Unauthorized Telegram user sends messages to the bot | 3 | 4 | **12** | Mitigated |
| T2 | API token stolen from `~/.max/api-token` | 2 | 4 | **8** | Partially mitigated |
| T3 | Malicious skill injects adversarial instructions via SKILL.md | 3 | 3 | **9** | Partially mitigated |
| T4 | Worker directed to sensitive directory (e.g. `~/.ssh`) | 2 | 5 | **10** | Mitigated |
| T5 | Prompt injection via crafted user message (50 k char limit bypass) | 2 | 3 | **6** | Mitigated |
| T6 | Compromised npm dependency reads secrets at startup | 2 | 5 | **10** | Residual |
| T7 | Local user reads `~/.max/.env` (plaintext `TELEGRAM_BOT_TOKEN`) | 3 | 4 | **12** | Residual |
| T8 | Rate-limit exhaustion / DoS of HTTP API | 3 | 2 | **6** | Mitigated |
| T9 | Plugin executes arbitrary code in daemon process | 2 | 5 | **10** | Residual |
| T10 | SSRF from browser to `127.0.0.1:7777` | 2 | 3 | **6** | Mitigated |
| T11 | SQLite database read from disk (no encryption) | 3 | 3 | **9** | Partially mitigated |
| T12 | Worker session escapes allowed directory via symlink | 1 | 4 | **4** | Residual |
| T13 | Audit log tampered or deleted by local attacker | 2 | 2 | **4** | Residual |
| T14 | Classifier session (GPT-4.1) hijacked via adversarial tier labels | 1 | 2 | **2** | Acceptable |
| T15 | Circuit breaker forced open via repeated crafted failures | 2 | 2 | **4** | Mitigated |

---

## 4. Current Mitigations (with code citations)

### T1 — Unauthorized Telegram user

**Mitigation:** The grammY middleware in `src/telegram/bot.ts:26-35` compares `ctx.from?.id` against `config.authorizedUserId`. Any mismatch silently drops the message and writes an `auth_reject` audit entry. There is no reply to the unauthorized user, preventing enumeration.

```typescript
// src/telegram/bot.ts:26-35
bot.use(async (ctx, next) => {
  if (config.authorizedUserId !== undefined && ctx.from?.id !== config.authorizedUserId) {
    logAudit("auth_reject", String(ctx.from?.id ?? "unknown"), { ... }, "telegram");
    return; // Silently ignore
  }
  await next();
});
```

### T2 — API token stolen

**Mitigation:** Token is written with `{ mode: 0o600 }` in `src/api/server.ts:52`. Token rotation is available at `POST /auth/rotate` (`src/api/server.ts:225-244`), which invalidates all active SSE connections.

**Residual risk:** The token is also readable by any process running as the same OS user or as root.

### T3 — Malicious skill / prompt injection

**Mitigation:** `createSkill` and `removeSkill` in `src/copilot/skills.ts:74-77` and `src/copilot/skills.ts:97-100` validate that the resolved skill path starts with `LOCAL_SKILLS_DIR + "/"`, blocking path traversal:

```typescript
// src/copilot/skills.ts:74-77
if (!skillDir.startsWith(LOCAL_SKILLS_DIR + "/")) {
  return `Invalid slug '${slug}': must be a simple kebab-case name without path separators.`;
}
```

**Residual risk:** Skill *content* (SKILL.md) is injected verbatim into the Orchestrator's system message. A carefully crafted `SKILL.md` from an untrusted source can influence agent behaviour. No content sanitisation is currently applied.

### T4 — Worker in sensitive directory

**Mitigation:** `src/copilot/tools.ts` defines `BLOCKED_WORKER_DIRS` and resolves the requested path before comparison:

```typescript
// src/copilot/tools.ts (BLOCKED_WORKER_DIRS + resolution check)
const BLOCKED_WORKER_DIRS = [
  ".ssh", ".gnupg", ".aws", ".azure", ".config/gcloud",
  ".kube", ".docker", ".npmrc", ".pypirc",
];
// ...
const resolvedDir = resolve(args.working_dir);
for (const blocked of BLOCKED_WORKER_DIRS) {
  const blockedPath = join(home, blocked);
  if (resolvedDir === blockedPath || resolvedDir.startsWith(blockedPath + sep)) {
    logAudit("worker_blocked_dir", ...);
    return `Refused: '${args.working_dir}' is a sensitive directory.`;
  }
}
```

### T5 — Prompt length / injection

**Mitigation:** Both `src/api/server.ts:120-123` and `src/telegram/bot.ts:104-107` reject prompts longer than 50 000 characters before they reach the Orchestrator.

### T8 — Rate-limit DoS

**Mitigation:** `src/api/server.ts:24-41` implements a per-IP in-process rate limiter at 100 req/min. Exceeding the limit returns `429`. `/status` and `/metrics` are exempt.

### T10 — SSRF from browser

**Mitigation:** CORS header `Access-Control-Allow-Origin: null` (`src/api/server.ts:63-68`) prevents browser `fetch` from cross-origin pages from including the response. The server binds to `127.0.0.1` only (`src/api/server.ts:265`), so it is not reachable from the network. Bearer token auth provides a second layer.

### T11 — SQLite database read

**Mitigation:** `MAX_ENCRYPT_DB=1` triggers XOR obfuscation via HKDF-SHA256 key derivation in `src/store/migrate-encrypt.ts:14-20`. Without the derived key (and thus without the API token), the database bytes are not interpretable by standard tools.

**Residual risk:** XOR obfuscation is not authenticated encryption. A determined attacker with the token file can reconstruct the key.

### T15 — Circuit breaker force-open

**Mitigation:** `src/resilience/circuit-breaker.ts:73-86` implements the half-open → closed recovery path. After `resetTimeoutMs` (30 s), the breaker enters half-open and attempts a single probe. A successful probe closes it. State is visible at `GET /status` for operator monitoring.

---

## 5. Residual Risks

| ID | Description | Severity |
|----|-------------|----------|
| R1 | `~/.max/.env` is world-readable by default (contains Telegram bot token) | High |
| R2 | Plugins run unsandboxed in the daemon process | High |
| R3 | XOR obfuscation (`MAX_ENCRYPT_DB`) is not cryptographic encryption | Medium |
| R4 | Skill SKILL.md content is injected into system prompt without sanitisation | Medium |
| R5 | npm supply chain: any dependency can read `~/.max/` on startup | High |
| R6 | Worker symlink escape: `resolve()` follows symlinks | Low |
| R7 | Audit log stored in same SQLite DB — a compromised DB wipes the audit trail | Low |
| R8 | No TLS on localhost API — tokens visible in process memory | Low |

---

## 6. Recommended Hardening Steps

### Immediate (before production use)

1. **Restrict `~/.max/.env` permissions:**
   ```bash
   chmod 600 ~/.max/.env
   ```

2. **Enable database obfuscation:**
   ```bash
   echo "MAX_ENCRYPT_DB=1" >> ~/.max/.env
   hoot restart
   ```

3. **Rotate the API token after initial setup:**
   ```bash
   curl -s -X POST http://localhost:7777/auth/rotate \
     -H "Authorization: Bearer $(cat ~/.max/api-token)"
   ```

4. **Disable `MAX_SELF_EDIT` and `MAX_PLUGINS_ENABLED` unless explicitly needed** — both flags are off by default; verify they are not set.

### Medium-term

5. **Skill content sanitisation:** Strip or escape YAML front-matter and Markdown from `SKILL.md` content before injecting it into the system message. Reject skills that contain instruction-like patterns (`ignore previous instructions`, role-assignment headers, etc.).

6. **Plugin signature verification:** Require plugins to include a `package.json` with an `integrity` field (SRI hash) verified against a local trust store before `require()`.

7. **Separate audit log store:** Write the audit log to an append-only file (`~/.max/audit.log`) in addition to SQLite, so that a compromised/corrupt database does not erase the audit trail.

8. **Worker chroot / sandbox:** Consider wrapping worker filesystem access in a seccomp/landlock sandbox (Linux) or macOS sandbox profile to enforce the directory allowlist at the OS level rather than in application code.

9. **`~/.max/.env` secrets manager:** Replace plaintext `.env` with a keychain-backed secret store (e.g. macOS Keychain via `keytar`, or `pass`) so that `TELEGRAM_BOT_TOKEN` is not stored on the filesystem in cleartext.

### Long-term

10. **Supply chain hardening:** Add `npm audit` and `socket.dev` CI checks. Pin transitive dependencies with a lockfile integrity check. Consider running the daemon in a Node.js `--permission` sandbox (Node 20+) with explicit filesystem and network grants.

11. **TLS for remote access:** If the API is ever exposed beyond localhost (e.g. via SSH tunnel), add a TLS termination layer (caddy/nginx) with a self-signed or ACME certificate.

12. **Structured threat model review cadence:** Re-run this threat model whenever a new channel adapter, skill source, or plugin host is introduced.
