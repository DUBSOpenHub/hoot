# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.2.x   | ✅ Yes |
| < 1.2   | ❌ No — please upgrade |

---

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Email **security@hoot.dev** with:

- A description of the vulnerability and its potential impact.
- Steps to reproduce or a proof-of-concept.
- The version of Hoot 🦉 you are using.
- Your preferred contact method for follow-up questions.

**Expected response times:**

| Stage | Target |
|-------|--------|
| Acknowledgement | ≤ 48 hours |
| Initial triage | ≤ 5 business days |
| Patch / mitigation | ≤ 30 days for critical, ≤ 90 days for others |
| Public disclosure | Coordinated with reporter after patch ships |

We follow responsible disclosure. Reporters who follow this policy will be credited in the release notes (unless they request otherwise).

---

## Security Features

### Encryption at rest (`MAX_ENCRYPT_DB`)

When `MAX_ENCRYPT_DB=1` is set in `~/.max/.env` (Hoot config directory), the SQLite database (`~/.max/max.db`) is XOR-obfuscated using a key derived via **HKDF-SHA256** from the daemon's API token with the fixed salt `max-db-v1` (`src/store/migrate-encrypt.ts`). This makes the database unreadable by the standard `sqlite3` CLI or forensic tools without the key.

The encryption key is derived at migration time and never stored on disk separately from the token.

### Audit logging (`src/store/db.ts`, FR-9.1)

Every security-relevant event is written to the `audit_log` SQLite table:

| Action | Trigger |
|--------|---------|
| `auth_reject` | Failed bearer token (HTTP) or unauthorized Telegram user |
| `auth_rotate` | API token rotated via `POST /auth/rotate` |
| `worker_create` | Worker session spawned |
| `worker_blocked_dir` | Worker attempted access to a blocked directory |

The log is pruned to the last 10 000 entries automatically. Retrieve recent entries via `GET /audit` (requires bearer token).

Audit failures are silently swallowed (`try/catch` around every insert) so a full disk or corrupted DB cannot crash the daemon.

### Rate limiting (`src/api/server.ts`, FR-S.1)

The HTTP API enforces **100 requests per minute per source IP**. Requests exceeding this limit receive `429 Too Many Requests`. The `/status` and `/metrics` endpoints are exempt (health-check traffic).

### CORS restrictions (`src/api/server.ts`, FR-S.5)

All API responses include:

```
Access-Control-Allow-Origin: null
```

This restricts cross-origin requests to `null`-origin (local file pages and `fetch` from the same host). The server binds exclusively to `127.0.0.1` — it is not reachable from the network.

### Bearer token authentication (`src/api/server.ts`)

A 32-byte cryptographically random token is generated on first startup and stored at `~/.max/api-token` with mode `0o600`. All API endpoints (except `/status` and `/metrics`) require:

```
Authorization: Bearer <token>
```

Requests without a valid token are rejected with `401 Unauthorized` and the event is written to the audit log.

### Token rotation (`src/api/server.ts`, FR-S.3)

`POST /auth/rotate` (requires current token) generates a new 32-byte random token, persists it to `~/.max/api-token`, closes all active SSE connections, and notifies connected clients via an `auth_rotated` event.

### Worker directory blocking (`src/copilot/tools.ts`)

Workers are prevented from operating in sensitive directories. The following directories are blocked absolutely (including all subdirectories):

```
~/.ssh            ~/.gnupg          ~/.aws
~/.azure          ~/.config/gcloud  ~/.kube
~/.docker         ~/.npmrc          ~/.pypirc
```

Any attempt to create a worker in these directories is rejected and recorded in the audit log as `worker_blocked_dir`.

### Telegram user ID whitelist (`src/telegram/bot.ts`, FR-9.3)

The Telegram bot ignores all messages from users whose numeric Telegram ID does not match `AUTHORIZED_USER_ID` in `~/.max/.env`. Unauthorized messages are silently dropped and logged as `auth_reject` in the audit log. There is no error message sent back to the unknown user.

### Prompt length limit (FR-S.2)

Both the HTTP API (`POST /message`) and the Telegram bot reject prompts exceeding **50 000 characters** with an appropriate error, preventing memory exhaustion via crafted inputs.

### Skill path traversal guard (`src/copilot/skills.ts`)

`createSkill` and `removeSkill` validate that the resolved skill directory path starts with the expected `~/.max/skills/` prefix before any filesystem operation, blocking path-traversal attacks via crafted skill slugs.

---

## Feature Flags Affecting Security Posture

| Flag | Default | Security impact |
|------|---------|-----------------|
| `MAX_ENCRYPT_DB=1` | **off** | Enables XOR-obfuscation of `~/.max/max.db` |
| `MAX_PLUGINS_ENABLED=1` | **off** | Loads arbitrary CommonJS modules from `~/.max/plugins/` |
| `MAX_SELF_EDIT=1` | **off** | Allows Hoot to modify its own source files |
| `MAX_POOL_ENABLED=1` | off | Worker sessions are pooled and reused |

`MAX_PLUGINS_ENABLED` and `MAX_SELF_EDIT` increase the attack surface and should only be enabled when explicitly needed.

---

## Known Limitations

### Plaintext `~/.max/.env`

The `~/.max/.env` file is stored as plaintext and contains `TELEGRAM_BOT_TOKEN`, `AUTHORIZED_USER_ID`, and optionally `COPILOT_MODEL`. It is created with default filesystem permissions (typically `0o644`). On a shared machine this file is readable by other users in the same group. **Mitigation:** restrict permissions manually with `chmod 600 ~/.max/.env`.

### No TLS on the localhost API

The Express server binds to `127.0.0.1:7777` over plain HTTP. TLS is intentionally omitted for a loopback-only service. All traffic between the TUI and the daemon is local IPC. If you use SSH tunnelling or a reverse proxy to expose the API remotely, you are responsible for adding TLS.

### Plugin sandbox

Plugins loaded from `~/.max/plugins/` are executed as full Node.js modules in the daemon's process with no sandbox. A malicious or compromised plugin can read any file the daemon process can read, including `~/.max/api-token` and `~/.max/.env`. Only install plugins from sources you trust.

### XOR obfuscation is not encryption

`MAX_ENCRYPT_DB=1` applies XOR obfuscation, not AES/SQLCipher encryption. It prevents casual inspection but does not provide cryptographic confidentiality against a determined adversary with the token file. If you need strong encryption at rest, use full-disk encryption (FileVault / LUKS) at the OS level.
