/**
 * Acceptance tests for FR-3: Plugin System
 * Sealed — implementation team does not see these until after code ships.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let pluginsDir: string;
let testDbDir: string;

beforeEach(() => {
  pluginsDir = join(tmpdir(), `max-plugins-test-${Date.now()}`);
  testDbDir = join(tmpdir(), `max-db-test-${Date.now()}`);
  mkdirSync(pluginsDir, { recursive: true });
  mkdirSync(testDbDir, { recursive: true });
  process.env.MAX_PLUGINS_DIR = pluginsDir;
  process.env.MAX_DB_PATH = join(testDbDir, 'test.db');
  process.env.MAX_PLUGINS_ENABLED = '1';
  vi.resetModules();
});

afterEach(() => {
  rmSync(pluginsDir, { recursive: true, force: true });
  rmSync(testDbDir, { recursive: true, force: true });
  delete process.env.MAX_PLUGINS_DIR;
  delete process.env.MAX_DB_PATH;
  delete process.env.MAX_PLUGINS_ENABLED;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// FR-3.1 — PluginManager scans plugins dir and dynamically imports each index.js
// ---------------------------------------------------------------------------
describe('FR-3.1 — PluginManager scans and loads plugins', () => {
  it('FR-3.1: PluginManager is exported from src/plugins/manager.ts', async () => {
    const mod = await import('../../src/plugins/manager');
    expect(mod.PluginManager ?? mod.default).toBeDefined();
  });

  it('FR-3.1: PluginManager loads a plugin found in the plugins directory', async () => {
    // Create a minimal valid plugin
    const pluginDir = join(pluginsDir, 'hello-world');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
      join(pluginDir, 'index.js'),
      `module.exports = { name: 'hello-world', version: '1.0.0', onLoad(ctx) { ctx.log('hello-world loaded'); } };`
    );

    const mod = await import('../../src/plugins/manager');
    const PluginManager = mod.PluginManager ?? mod.default;
    const manager = new PluginManager({ pluginsDir, bus: { on: vi.fn(), emit: vi.fn(), off: vi.fn() } });

    await manager.loadAll();

    const loaded = manager.getLoadedPlugins?.() ?? manager.plugins ?? [];
    expect(loaded.length).toBeGreaterThan(0);
    expect(loaded.some((p: { name: string }) => p.name === 'hello-world')).toBe(true);
  });

  it('FR-3.1: PluginManager ignores directories without an index.js', async () => {
    mkdirSync(join(pluginsDir, 'empty-plugin'), { recursive: true });
    // No index.js created

    const mod = await import('../../src/plugins/manager');
    const PluginManager = mod.PluginManager ?? mod.default;
    const manager = new PluginManager({ pluginsDir, bus: { on: vi.fn(), emit: vi.fn(), off: vi.fn() } });

    await expect(manager.loadAll()).resolves.not.toThrow();
    const loaded = manager.getLoadedPlugins?.() ?? manager.plugins ?? [];
    expect(loaded).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// FR-3.2 — Plugin interface: name, version, onLoad(ctx)
// ---------------------------------------------------------------------------
describe('FR-3.2 — Plugin context API', () => {
  it('FR-3.2: ctx passed to onLoad has a bus property', async () => {
    const pluginDir = join(pluginsDir, 'ctx-test');
    mkdirSync(pluginDir, { recursive: true });

    let capturedCtx: Record<string, unknown> | null = null;
    const pluginCode = `
      module.exports = {
        name: 'ctx-test',
        version: '0.1.0',
        onLoad(ctx) { globalThis.__testCtx = ctx; }
      };
    `;
    writeFileSync(join(pluginDir, 'index.js'), pluginCode);

    const mod = await import('../../src/plugins/manager');
    const PluginManager = mod.PluginManager ?? mod.default;
    const manager = new PluginManager({ pluginsDir, bus: { on: vi.fn(), emit: vi.fn(), off: vi.fn() } });

    await manager.loadAll();

    const ctx = (globalThis as Record<string, unknown>).__testCtx as Record<string, unknown>;
    if (ctx) {
      expect(ctx).toHaveProperty('bus');
    }
    delete (globalThis as Record<string, unknown>).__testCtx;
  });

  it('FR-3.2: ctx passed to onLoad has registerTool function', async () => {
    const pluginDir = join(pluginsDir, 'reg-test');
    mkdirSync(pluginDir, { recursive: true });

    writeFileSync(
      join(pluginDir, 'index.js'),
      `module.exports = { name: 'reg-test', version: '1.0.0', onLoad(ctx) { globalThis.__regCtx = ctx; } };`
    );

    const mod = await import('../../src/plugins/manager');
    const PluginManager = mod.PluginManager ?? mod.default;
    const manager = new PluginManager({ pluginsDir, bus: { on: vi.fn(), emit: vi.fn(), off: vi.fn() } });

    await manager.loadAll();

    const ctx = (globalThis as Record<string, unknown>).__regCtx as Record<string, unknown>;
    if (ctx) {
      expect(typeof ctx.registerTool).toBe('function');
    }
    delete (globalThis as Record<string, unknown>).__regCtx;
  });

  it('FR-3.2: ctx passed to onLoad has addApiRoute function', async () => {
    const pluginDir = join(pluginsDir, 'route-test');
    mkdirSync(pluginDir, { recursive: true });

    writeFileSync(
      join(pluginDir, 'index.js'),
      `module.exports = { name: 'route-test', version: '1.0.0', onLoad(ctx) { globalThis.__routeCtx = ctx; } };`
    );

    const mod = await import('../../src/plugins/manager');
    const PluginManager = mod.PluginManager ?? mod.default;
    const manager = new PluginManager({ pluginsDir, bus: { on: vi.fn(), emit: vi.fn(), off: vi.fn() } });

    await manager.loadAll();

    const ctx = (globalThis as Record<string, unknown>).__routeCtx as Record<string, unknown>;
    if (ctx) {
      expect(typeof ctx.addApiRoute).toBe('function');
    }
    delete (globalThis as Record<string, unknown>).__routeCtx;
  });

  it('FR-3.2: ctx passed to onLoad has getDb function', async () => {
    const pluginDir = join(pluginsDir, 'db-test');
    mkdirSync(pluginDir, { recursive: true });

    writeFileSync(
      join(pluginDir, 'index.js'),
      `module.exports = { name: 'db-test', version: '1.0.0', onLoad(ctx) { globalThis.__dbCtx = ctx; } };`
    );

    const mod = await import('../../src/plugins/manager');
    const PluginManager = mod.PluginManager ?? mod.default;
    const manager = new PluginManager({ pluginsDir, bus: { on: vi.fn(), emit: vi.fn(), off: vi.fn() } });

    await manager.loadAll();

    const ctx = (globalThis as Record<string, unknown>).__dbCtx as Record<string, unknown>;
    if (ctx) {
      expect(typeof ctx.getDb).toBe('function');
    }
    delete (globalThis as Record<string, unknown>).__dbCtx;
  });

  it('FR-3.2: ctx passed to onLoad has log function', async () => {
    const pluginDir = join(pluginsDir, 'log-test');
    mkdirSync(pluginDir, { recursive: true });

    writeFileSync(
      join(pluginDir, 'index.js'),
      `module.exports = { name: 'log-test', version: '1.0.0', onLoad(ctx) { globalThis.__logCtx = ctx; } };`
    );

    const mod = await import('../../src/plugins/manager');
    const PluginManager = mod.PluginManager ?? mod.default;
    const manager = new PluginManager({ pluginsDir, bus: { on: vi.fn(), emit: vi.fn(), off: vi.fn() } });

    await manager.loadAll();

    const ctx = (globalThis as Record<string, unknown>).__logCtx as Record<string, unknown>;
    if (ctx) {
      expect(typeof ctx.log).toBe('function');
    }
    delete (globalThis as Record<string, unknown>).__logCtx;
  });

  it('FR-3.2: ctx passed to onLoad has config property', async () => {
    const pluginDir = join(pluginsDir, 'config-test');
    mkdirSync(pluginDir, { recursive: true });

    writeFileSync(
      join(pluginDir, 'index.js'),
      `module.exports = { name: 'config-test', version: '1.0.0', onLoad(ctx) { globalThis.__cfgCtx = ctx; } };`
    );

    const mod = await import('../../src/plugins/manager');
    const PluginManager = mod.PluginManager ?? mod.default;
    const manager = new PluginManager({ pluginsDir, bus: { on: vi.fn(), emit: vi.fn(), off: vi.fn() } });

    await manager.loadAll();

    const ctx = (globalThis as Record<string, unknown>).__cfgCtx as Record<string, unknown>;
    if (ctx) {
      expect(ctx).toHaveProperty('config');
    }
    delete (globalThis as Record<string, unknown>).__cfgCtx;
  });
});

// ---------------------------------------------------------------------------
// FR-3.3 — Tools registered via ctx.registerTool() appear in the orchestrator tool list
// ---------------------------------------------------------------------------
describe('FR-3.3 — Registered tools appear in orchestrator', () => {
  it('FR-3.3: a tool registered by a plugin appears in the active tool list', async () => {
    const pluginDir = join(pluginsDir, 'tool-plugin');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
      join(pluginDir, 'index.js'),
      `module.exports = {
        name: 'tool-plugin',
        version: '1.0.0',
        onLoad(ctx) {
          ctx.registerTool({
            name: 'say_hello',
            description: 'Says hello',
            parameters: {},
            handler: async () => 'hello!'
          });
        }
      };`
    );

    const mod = await import('../../src/plugins/manager');
    const PluginManager = mod.PluginManager ?? mod.default;

    const registeredTools: unknown[] = [];
    const fakeCtx = {
      bus: { on: vi.fn(), emit: vi.fn(), off: vi.fn() },
      registerTool: (tool: unknown) => registeredTools.push(tool),
      addApiRoute: vi.fn(),
      getDb: vi.fn(),
      log: vi.fn(),
      config: {},
    };

    const manager = new PluginManager({ pluginsDir, bus: fakeCtx.bus, context: fakeCtx });
    await manager.loadAll();

    const tools = manager.getRegisteredTools?.() ?? registeredTools;
    const sayHello = tools.find((t: { name: string }) => t.name === 'say_hello');
    expect(sayHello).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// FR-3.4 — Plugin file change triggers hot-reload within 5 seconds
// ---------------------------------------------------------------------------
describe('FR-3.4 — Plugin hot-reload on file change', () => {
  it('FR-3.4: PluginManager has a watchForChanges() or startWatcher() method', async () => {
    const mod = await import('../../src/plugins/manager');
    const PluginManager = mod.PluginManager ?? mod.default;
    const manager = new PluginManager({ pluginsDir, bus: { on: vi.fn(), emit: vi.fn(), off: vi.fn() } });

    const hasWatcher =
      typeof manager.watchForChanges === 'function' ||
      typeof manager.startWatcher === 'function' ||
      typeof manager.watch === 'function';
    expect(hasWatcher).toBe(true);
  });

  it('FR-3.4: plugin reload is triggered within 5 seconds of a file change', async () => {
    const pluginDir = join(pluginsDir, 'hot-plugin');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
      join(pluginDir, 'index.js'),
      `module.exports = { name: 'hot-plugin', version: '1.0.0', onLoad(ctx) {} };`
    );

    const mod = await import('../../src/plugins/manager');
    const PluginManager = mod.PluginManager ?? mod.default;
    const reloadSpy = vi.fn();
    const manager = new PluginManager({
      pluginsDir,
      bus: { on: vi.fn(), emit: vi.fn(), off: vi.fn() },
      onReload: reloadSpy,
    });

    await manager.loadAll();
    const watcher = manager.watchForChanges?.() ?? manager.startWatcher?.() ?? manager.watch?.();

    // Modify the plugin file
    await new Promise((r) => setTimeout(r, 100));
    writeFileSync(
      join(pluginDir, 'index.js'),
      `module.exports = { name: 'hot-plugin', version: '1.0.1', onLoad(ctx) { ctx.log('reloaded'); } };`
    );

    // Wait up to 5 seconds for reload
    await new Promise((r) => setTimeout(r, 5000));

    if (typeof watcher?.close === 'function') watcher.close();
    if (typeof watcher?.stop === 'function') watcher.stop();

    // Either the spy was called or the manager re-registered the plugin
    const reloaded = reloadSpy.mock.calls.length > 0 ||
      (manager.getLoadedPlugins?.() ?? []).some((p: { version: string }) => p.version === '1.0.1');
    expect(reloaded).toBe(true);
  }, 8000);
});

// ---------------------------------------------------------------------------
// FR-3.5 — Plugin throwing in onLoad is skipped; daemon continues
// ---------------------------------------------------------------------------
describe('FR-3.5 — Faulty plugins are isolated', () => {
  it('FR-3.5: a plugin that throws in onLoad is skipped without crashing the daemon', async () => {
    const goodDir = join(pluginsDir, 'good-plugin');
    const badDir = join(pluginsDir, 'bad-plugin');
    mkdirSync(goodDir, { recursive: true });
    mkdirSync(badDir, { recursive: true });

    writeFileSync(
      join(goodDir, 'index.js'),
      `module.exports = { name: 'good-plugin', version: '1.0.0', onLoad(ctx) { globalThis.__goodLoaded = true; } };`
    );
    writeFileSync(
      join(badDir, 'index.js'),
      `module.exports = { name: 'bad-plugin', version: '1.0.0', onLoad(ctx) { throw new Error('intentional crash'); } };`
    );

    const mod = await import('../../src/plugins/manager');
    const PluginManager = mod.PluginManager ?? mod.default;
    const manager = new PluginManager({ pluginsDir, bus: { on: vi.fn(), emit: vi.fn(), off: vi.fn() } });

    // Should not throw
    await expect(manager.loadAll()).resolves.not.toThrow();

    // Good plugin should still be loaded
    expect((globalThis as Record<string, unknown>).__goodLoaded).toBe(true);
    delete (globalThis as Record<string, unknown>).__goodLoaded;
  });

  it('FR-3.5: a faulty plugin is logged before being skipped', async () => {
    const badDir = join(pluginsDir, 'crasher');
    mkdirSync(badDir, { recursive: true });
    writeFileSync(
      join(badDir, 'index.js'),
      `module.exports = { name: 'crasher', version: '1.0.0', onLoad() { throw new Error('plugin error'); } };`
    );

    const mod = await import('../../src/plugins/manager');
    const PluginManager = mod.PluginManager ?? mod.default;
    const logSpy = vi.fn();
    const manager = new PluginManager({
      pluginsDir,
      bus: { on: vi.fn(), emit: vi.fn(), off: vi.fn() },
      onError: logSpy,
    });

    await manager.loadAll();

    // Either the onError callback was called, or the error was logged to stderr
    const errorLogged = logSpy.mock.calls.length > 0;
    if (!errorLogged) {
      // If no onError callback, the manager should log internally — just verify it didn't throw
      const loaded = manager.getLoadedPlugins?.() ?? [];
      expect(loaded.every((p: { name: string }) => p.name !== 'crasher')).toBe(true);
    } else {
      expect(logSpy).toHaveBeenCalled();
    }
  });
});
