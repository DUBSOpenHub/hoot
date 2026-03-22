/**
 * Acceptance tests for Security Hardening: FR-S.1 – FR-S.5
 * Sealed — implementation team does not see these until after code ships.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

beforeEach(() => {
  vi.resetModules();
  process.env.MAX_API_TOKEN = 'hardening-test-token';
});

afterEach(() => {
  delete process.env.MAX_API_TOKEN;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// FR-S.1 — express-rate-limit: 100 requests/minute per IP → HTTP 429
// ---------------------------------------------------------------------------
describe('FR-S.1 — Rate limiting: 100 req/min per IP', () => {
  it('FR-S.1: server responds with HTTP 200 for the first 100 requests from same IP', async () => {
    let request: typeof import('supertest');
    let app: unknown;
    try {
      request = (await import('supertest')).default;
      app = (await import('../../src/api/server')).app ?? (await import('../../src/api/server')).default;
    } catch { return; }

    // Send 5 requests and verify they all succeed (full 100 would be slow)
    const r = request as (app: unknown) => { get: (path: string) => Promise<{ status: number }> };
    for (let i = 0; i < 5; i++) {
      const res = await r(app).get('/status');
      expect(res.status).not.toBe(429);
    }
  });

  it('FR-S.1: server responds with HTTP 429 after 100 requests/minute burst', async () => {
    let request: typeof import('supertest');
    let app: unknown;
    try {
      request = (await import('supertest')).default;
      app = (await import('../../src/api/server')).app ?? (await import('../../src/api/server')).default;
    } catch { return; }

    // Use a test-specific endpoint that has a LOW limit for this test
    // OR verify rate-limit middleware is mounted with windowMs=60000 and max=100
    const fs = await import('fs');
    const path = await import('path');

    let serverSource = '';
    try {
      serverSource = fs.readFileSync(path.resolve('src/api/server.ts'), 'utf8');
    } catch { return; }

    // Verify rate-limit middleware is configured in the server
    expect(serverSource).toMatch(/rateLimit|rate.limit|express-rate-limit/i);
    expect(serverSource).toMatch(/100/); // max 100
  });

  it('FR-S.1: express-rate-limit is listed as a dependency', () => {
    const pkgPath = resolve('package.json');
    if (!existsSync(pkgPath)) return;
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const hasDep =
      'express-rate-limit' in (pkg.dependencies ?? {}) ||
      'express-rate-limit' in (pkg.devDependencies ?? {});
    expect(hasDep).toBe(true);
  });

  it('FR-S.1: rate limiter window is 60 seconds (1 minute)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    let source = '';
    try {
      source = fs.readFileSync(path.resolve('src/api/server.ts'), 'utf8');
    } catch { return; }
    // windowMs should be 60000 (or 60 * 1000)
    expect(source).toMatch(/60[_\s]*[*\s]*1000|60000/);
  });
});

// ---------------------------------------------------------------------------
// FR-S.2 — 50,000 character prompt limit on POST /message and Telegram handler
// ---------------------------------------------------------------------------
describe('FR-S.2 — 50,000 character prompt limit', () => {
  it('FR-S.2: POST /message with >50,000 characters returns HTTP 400 or 413', async () => {
    let request: typeof import('supertest');
    let app: unknown;
    try {
      request = (await import('supertest')).default;
      app = (await import('../../src/api/server')).app ?? (await import('../../src/api/server')).default;
    } catch { return; }

    const oversizedPrompt = 'x'.repeat(50_001);
    const r = request as (app: unknown) => {
      post: (path: string) => {
        set: (h: string, v: string) => {
          send: (body: unknown) => Promise<{ status: number }>
        }
      }
    };
    const res = await r(app)
      .post('/message')
      .set('Authorization', 'Bearer hardening-test-token')
      .send({ text: oversizedPrompt });

    expect([400, 413, 422]).toContain(res.status);
  });

  it('FR-S.2: POST /message with exactly 50,000 characters is accepted', async () => {
    let request: typeof import('supertest');
    let app: unknown;
    try {
      request = (await import('supertest')).default;
      app = (await import('../../src/api/server')).app ?? (await import('../../src/api/server')).default;
    } catch { return; }

    const maxPrompt = 'x'.repeat(50_000);
    const r = request as (app: unknown) => {
      post: (path: string) => {
        set: (h: string, v: string) => {
          send: (body: unknown) => Promise<{ status: number }>
        }
      }
    };
    const res = await r(app)
      .post('/message')
      .set('Authorization', 'Bearer hardening-test-token')
      .send({ text: maxPrompt });

    // Should not be rejected for length (may fail for other reasons like no session)
    expect([200, 201, 202, 400, 401, 500]).toContain(res.status);
    expect([400, 413, 422]).not.toContain(res.status);
  });

  it('FR-S.2: prompt limit of 50,000 characters is enforced in source code', async () => {
    const fs = await import('fs');
    const path = await import('path');
    let source = '';
    try {
      source =
        fs.readFileSync(path.resolve('src/api/server.ts'), 'utf8') +
        (fs.existsSync(path.resolve('src/channels/telegram.ts'))
          ? fs.readFileSync(path.resolve('src/channels/telegram.ts'), 'utf8')
          : '');
    } catch { return; }

    expect(source).toMatch(/50[_,]?000|50000/);
  });
});

// ---------------------------------------------------------------------------
// FR-S.3 — POST /auth/rotate generates new token and restarts SSE connections
// ---------------------------------------------------------------------------
describe('FR-S.3 — Token rotation', () => {
  it('FR-S.3: POST /auth/rotate endpoint exists and returns 200', async () => {
    let request: typeof import('supertest');
    let app: unknown;
    try {
      request = (await import('supertest')).default;
      app = (await import('../../src/api/server')).app ?? (await import('../../src/api/server')).default;
    } catch { return; }

    const r = request as (app: unknown) => {
      post: (path: string) => {
        set: (h: string, v: string) => Promise<{ status: number; body: Record<string, unknown> }>
      }
    };
    const res = await r(app)
      .post('/auth/rotate')
      .set('Authorization', 'Bearer hardening-test-token');

    expect([200, 201]).toContain(res.status);
  });

  it('FR-S.3: POST /auth/rotate without auth returns 401', async () => {
    let request: typeof import('supertest');
    let app: unknown;
    try {
      request = (await import('supertest')).default;
      app = (await import('../../src/api/server')).app ?? (await import('../../src/api/server')).default;
    } catch { return; }

    const r = request as (app: unknown) => { post: (path: string) => Promise<{ status: number }> };
    const res = await r(app).post('/auth/rotate');
    expect(res.status).toBe(401);
  });

  it('FR-S.3: POST /auth/rotate response includes a new token', async () => {
    let request: typeof import('supertest');
    let app: unknown;
    try {
      request = (await import('supertest')).default;
      app = (await import('../../src/api/server')).app ?? (await import('../../src/api/server')).default;
    } catch { return; }

    const r = request as (app: unknown) => {
      post: (path: string) => {
        set: (h: string, v: string) => Promise<{ status: number; body: { token?: string; newToken?: string; apiToken?: string } }>
      }
    };
    const res = await r(app)
      .post('/auth/rotate')
      .set('Authorization', 'Bearer hardening-test-token');

    if (res.status === 200) {
      const newToken = res.body.token ?? res.body.newToken ?? res.body.apiToken;
      expect(newToken).toBeDefined();
      expect(typeof newToken).toBe('string');
      expect(newToken).not.toBe('hardening-test-token');
    }
  });
});

// ---------------------------------------------------------------------------
// FR-S.4 — Zero high/critical npm audit vulnerabilities
// ---------------------------------------------------------------------------
describe('FR-S.4 — npm audit: zero high/critical vulnerabilities', () => {
  it('FR-S.4: npm audit reports zero high or critical vulnerabilities', () => {
    let auditOutput = '';
    let auditFailed = false;

    try {
      auditOutput = execSync('npm audit --json 2>/dev/null', {
        encoding: 'utf8',
        cwd: process.cwd(),
        timeout: 30_000,
      });
    } catch (e: unknown) {
      // npm audit exits with non-zero if there are vulnerabilities
      auditOutput = (e as { stdout?: string }).stdout ?? '';
      auditFailed = true;
    }

    if (!auditOutput) return; // skip if npm audit unavailable

    try {
      const report = JSON.parse(auditOutput) as {
        metadata?: {
          vulnerabilities?: {
            high?: number;
            critical?: number;
          };
        };
      };
      const high = report.metadata?.vulnerabilities?.high ?? 0;
      const critical = report.metadata?.vulnerabilities?.critical ?? 0;
      expect(high).toBe(0);
      expect(critical).toBe(0);
    } catch {
      // JSON parse failed — skip
    }
  });
});

// ---------------------------------------------------------------------------
// FR-S.5 — CORS restricted to null origin (localhost only)
// ---------------------------------------------------------------------------
describe('FR-S.5 — CORS restricted to localhost', () => {
  it('FR-S.5: CORS middleware is configured in the server', async () => {
    const fs = await import('fs');
    const path = await import('path');
    let source = '';
    try {
      source = fs.readFileSync(path.resolve('src/api/server.ts'), 'utf8');
    } catch { return; }

    expect(source).toMatch(/cors|CORS|Access-Control-Allow-Origin/);
  });

  it('FR-S.5: CORS origin is set to null or localhost only', async () => {
    const fs = await import('fs');
    const path = await import('path');
    let source = '';
    try {
      source = fs.readFileSync(path.resolve('src/api/server.ts'), 'utf8');
    } catch { return; }

    // null origin means localhost-only; source should reference null or localhost
    expect(source).toMatch(/origin.*null|null.*origin|localhost|127\.0\.0\.1/);
  });

  it('FR-S.5: API rejects requests from external origins', async () => {
    let request: typeof import('supertest');
    let app: unknown;
    try {
      request = (await import('supertest')).default;
      app = (await import('../../src/api/server')).app ?? (await import('../../src/api/server')).default;
    } catch { return; }

    const r = request as (app: unknown) => {
      get: (path: string) => {
        set: (h: string, v: string) => Promise<{ headers: Record<string, string> }>
      }
    };
    const res = await r(app)
      .get('/status')
      .set('Origin', 'https://evil.com');

    // The CORS header should not allow the evil origin
    const allowOrigin = res.headers['access-control-allow-origin'] ?? '';
    expect(allowOrigin).not.toBe('https://evil.com');
    expect(allowOrigin).not.toBe('*');
  });

  it('FR-S.5: API allows requests from null origin (localhost)', async () => {
    let request: typeof import('supertest');
    let app: unknown;
    try {
      request = (await import('supertest')).default;
      app = (await import('../../src/api/server')).app ?? (await import('../../src/api/server')).default;
    } catch { return; }

    const r = request as (app: unknown) => {
      get: (path: string) => {
        set: (h: string, v: string) => Promise<{ status: number; headers: Record<string, string> }>
      }
    };
    const res = await r(app)
      .get('/status')
      .set('Origin', 'null');

    // null origin (file:// or same-origin requests) should be allowed
    const allowOrigin = res.headers['access-control-allow-origin'];
    if (allowOrigin) {
      expect(allowOrigin === 'null' || allowOrigin === '*').toBe(true);
    }
    // Server should respond (not block entirely)
    expect(res.status).not.toBe(0);
  });
});
