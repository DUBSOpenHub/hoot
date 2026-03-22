/**
 * Acceptance tests for FR-6.1 – FR-6.3: Structured Logging
 * Sealed — implementation team does not see these until after code ships.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function captureStdout(fn: () => void): string[] {
  const lines: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    if (typeof chunk === 'string') lines.push(...chunk.split('\n').filter(Boolean));
    return true;
  });
  fn();
  vi.restoreAllMocks();
  return lines;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.MAX_LOG_FORMAT;
});

// ---------------------------------------------------------------------------
// FR-6.1 — All console.log calls replaced by structured logger
// ---------------------------------------------------------------------------
describe('FR-6.1 — Structured logger replaces console.log', () => {
  it('FR-6.1: src/observability/logger.ts exports a logger object or factory', async () => {
    const mod = await import('../../src/observability/logger');
    const logger = mod.logger ?? mod.createLogger?.() ?? mod.default;
    expect(logger).toBeDefined();
    expect(typeof logger.info === 'function' || typeof logger.log === 'function').toBe(true);
  });

  it('FR-6.1: logger exposes info, warn, error, and debug methods', async () => {
    const mod = await import('../../src/observability/logger');
    const logger = mod.logger ?? mod.createLogger?.({ component: 'test' }) ?? mod.default;
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.debug).toBe('function');
  });

  it('FR-6.1: source files do not use bare console.log for operational logging', async () => {
    const { execSync } = await import('child_process');
    let output = '';
    try {
      output = execSync(
        "grep -rn 'console\\.log(' src/ --include='*.ts' | grep -v '// legacy' | grep -v 'logger' | grep -v 'observability'",
        { encoding: 'utf8', cwd: process.cwd() }
      );
    } catch {
      // grep returns exit code 1 when no matches — that's the pass condition
      output = '';
    }
    // If there are remaining console.log calls they should be zero
    expect(output.trim()).toBe('');
  });
});

// ---------------------------------------------------------------------------
// FR-6.2 — Each log line is valid JSON with required fields
// ---------------------------------------------------------------------------
describe('FR-6.2 — JSON log line schema', () => {
  it('FR-6.2: logger output is valid JSON', async () => {
    process.env.MAX_LOG_FORMAT = 'json';
    const mod = await import('../../src/observability/logger');
    const logger = mod.logger ?? mod.createLogger?.({ component: 'test-component' }) ?? mod.default;

    const lines: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      if (typeof chunk === 'string') lines.push(...chunk.split('\n').filter(Boolean));
      return true;
    });

    logger.info('hello world');
    vi.restoreAllMocks();

    expect(lines.length).toBeGreaterThan(0);
    let parsed: Record<string, unknown>;
    expect(() => { parsed = JSON.parse(lines[0]); }).not.toThrow();
    expect(parsed!).toBeDefined();
  });

  it('FR-6.2: JSON log line includes ts field', async () => {
    process.env.MAX_LOG_FORMAT = 'json';
    const mod = await import('../../src/observability/logger');
    const logger = mod.logger ?? mod.createLogger?.({ component: 'comp' }) ?? mod.default;

    const lines: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      if (typeof chunk === 'string') lines.push(...chunk.split('\n').filter(Boolean));
      return true;
    });

    logger.info('ts-check');
    vi.restoreAllMocks();

    const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(parsed).toHaveProperty('ts');
  });

  it('FR-6.2: JSON log line includes level field', async () => {
    process.env.MAX_LOG_FORMAT = 'json';
    const mod = await import('../../src/observability/logger');
    const logger = mod.logger ?? mod.createLogger?.({ component: 'comp' }) ?? mod.default;

    const lines: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      if (typeof chunk === 'string') lines.push(...chunk.split('\n').filter(Boolean));
      return true;
    });

    logger.warn('level-check');
    vi.restoreAllMocks();

    const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(parsed).toHaveProperty('level');
    expect(['warn', 'warning', 'WARN']).toContain(parsed.level);
  });

  it('FR-6.2: JSON log line includes component field', async () => {
    process.env.MAX_LOG_FORMAT = 'json';
    const mod = await import('../../src/observability/logger');
    const logger = mod.createLogger?.({ component: 'my-component' }) ??
                   mod.logger?.child?.({ component: 'my-component' }) ??
                   mod.logger ??
                   mod.default;

    const lines: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      if (typeof chunk === 'string') lines.push(...chunk.split('\n').filter(Boolean));
      return true;
    });

    logger.info('component-check');
    vi.restoreAllMocks();

    const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(parsed).toHaveProperty('component');
  });

  it('FR-6.2: JSON log line includes msg field', async () => {
    process.env.MAX_LOG_FORMAT = 'json';
    const mod = await import('../../src/observability/logger');
    const logger = mod.logger ?? mod.createLogger?.({ component: 'comp' }) ?? mod.default;

    const lines: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      if (typeof chunk === 'string') lines.push(...chunk.split('\n').filter(Boolean));
      return true;
    });

    logger.info('the-message');
    vi.restoreAllMocks();

    const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(parsed).toHaveProperty('msg');
    expect(parsed.msg).toContain('the-message');
  });

  it('FR-6.2: error log level value is error or ERROR', async () => {
    process.env.MAX_LOG_FORMAT = 'json';
    const mod = await import('../../src/observability/logger');
    const logger = mod.logger ?? mod.createLogger?.({ component: 'comp' }) ?? mod.default;

    const lines: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      if (typeof chunk === 'string') lines.push(...chunk.split('\n').filter(Boolean));
      return true;
    });

    logger.error('something went wrong');
    vi.restoreAllMocks();

    const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(['error', 'ERROR']).toContain(parsed.level);
  });
});

// ---------------------------------------------------------------------------
// FR-6.3 — MAX_LOG_FORMAT=pretty outputs human-readable logs; legacy passes through
// ---------------------------------------------------------------------------
describe('FR-6.3 — MAX_LOG_FORMAT flag behavior', () => {
  it('FR-6.3: MAX_LOG_FORMAT=pretty produces non-JSON (human-readable) output', async () => {
    process.env.MAX_LOG_FORMAT = 'pretty';
    const mod = await import('../../src/observability/logger');
    const logger = mod.logger ?? mod.createLogger?.({ component: 'comp' }) ?? mod.default;

    const lines: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      if (typeof chunk === 'string') lines.push(...chunk.split('\n').filter(Boolean));
      return true;
    });

    logger.info('pretty-output');
    vi.restoreAllMocks();

    expect(lines.length).toBeGreaterThan(0);
    // Pretty format should NOT be raw JSON
    let isParseable = false;
    try { JSON.parse(lines[0]); isParseable = true; } catch { /* expected */ }
    expect(isParseable).toBe(false);
  });

  it('FR-6.3: MAX_LOG_FORMAT=legacy passes output to console.log unchanged', async () => {
    process.env.MAX_LOG_FORMAT = 'legacy';
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const mod = await import('../../src/observability/logger');
    const logger = mod.logger ?? mod.createLogger?.({ component: 'comp' }) ?? mod.default;

    logger.info('legacy message');
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('FR-6.3: MAX_LOG_FORMAT defaults to json when not set', async () => {
    delete process.env.MAX_LOG_FORMAT;
    const mod = await import('../../src/observability/logger');
    const logger = mod.logger ?? mod.createLogger?.({ component: 'comp' }) ?? mod.default;

    const lines: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      if (typeof chunk === 'string') lines.push(...chunk.split('\n').filter(Boolean));
      return true;
    });

    logger.info('default-format');
    vi.restoreAllMocks();

    if (lines.length > 0) {
      expect(() => JSON.parse(lines[0])).not.toThrow();
    }
  });
});
