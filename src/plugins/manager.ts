import { watch, readdirSync, existsSync } from "fs";
import { join } from "path";
import { createRequire } from "module";
import type { HootPlugin, PluginContext } from "./types.js";
import { getDb } from "../store/db.js";
import { config } from "../config.js";
import { createLogger } from "../observability/logger.js";

const log = createLogger("plugins");

interface LoadedPlugin {
  name: string;
  version: string;
  dirName: string;
  tools: unknown[];
  watcher?: ReturnType<typeof watch>;
}

interface PluginManagerOptions {
  pluginsDir?: string;
  bus: { on: (...args: unknown[]) => unknown; emit: (...args: unknown[]) => unknown; off?: (...args: unknown[]) => unknown };
  context?: Partial<PluginContext>;
  onReload?: (name: string) => void;
  onError?: (name: string, err: unknown) => void;
}

export class PluginManager {
  private readonly loaded = new Map<string, LoadedPlugin>();
  private readonly registeredTools: unknown[] = [];
  private readonly opts: PluginManagerOptions;
  private readonly pluginsDir: string;

  get plugins(): LoadedPlugin[] {
    return Array.from(this.loaded.values());
  }

  constructor(opts?: PluginManagerOptions) {
    this.opts = opts ?? { bus: { on: () => {}, emit: () => {} } };
    this.pluginsDir = this.opts.pluginsDir ?? ((process.env.HOOT_PLUGINS_DIR ?? process.env.MAX_PLUGINS_DIR) ?? join(process.env.HOME ?? '~', '.hoot', 'plugins'));
  }

  async loadAll(): Promise<void> {
    if (!existsSync(this.pluginsDir)) {
      log.info("Plugins directory not found, skipping", { dir: this.pluginsDir });
      return;
    }

    let dirs: string[];
    try {
      dirs = readdirSync(this.pluginsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch (err) {
      log.warn("Failed to read plugins directory", { err: String(err) });
      return;
    }

    for (const dir of dirs) {
      await this.loadPlugin(dir);
    }
  }

  private async loadPlugin(dirName: string): Promise<void> {
    const pluginPath = join(this.pluginsDir, dirName, "index.js");
    if (!existsSync(pluginPath)) {
      return;
    }

    if (this.loaded.has(dirName)) {
      await this.unloadPlugin(dirName);
    }

    const pluginTools: unknown[] = [];
    const bus = this.opts.bus;
    const loggerInstance = createLogger(`plugin:${dirName}`);

    const logFn: any = (...args: unknown[]) => loggerInstance.info(String(args[0]), args[1] as Record<string, unknown>);
    logFn.info = loggerInstance.info.bind(loggerInstance);
    logFn.warn = loggerInstance.warn.bind(loggerInstance);
    logFn.error = loggerInstance.error.bind(loggerInstance);
    logFn.debug = loggerInstance.debug.bind(loggerInstance);
    logFn.child = loggerInstance.child.bind(loggerInstance);
    logFn.withCorrelation = loggerInstance.withCorrelation.bind(loggerInstance);

    const ctx: PluginContext = {
      bus: bus as any,
      registerTool: (tool) => {
        pluginTools.push(tool);
        this.registeredTools.push(tool);
        if (this.opts.context?.registerTool) this.opts.context.registerTool(tool as any);
      },
      addApiRoute: (this.opts.context?.addApiRoute as any) ?? ((_method: string, _path: string, _handler: unknown) => {}),
      getDb: (this.opts.context?.getDb as any) ?? getDb,
      log: logFn,
      config: (this.opts.context?.config as any) ?? {
        copilotModel: config.copilotModel,
        apiPort: config.apiPort,
        telegramEnabled: config.telegramEnabled,
      },
    };

    try {
      const require = createRequire(import.meta.url);
      delete require.cache[pluginPath];
      const plugin = require(pluginPath) as HootPlugin;

      if (!plugin || typeof plugin.onLoad !== 'function') {
        return;
      }

      await plugin.onLoad(ctx);

      const loaded: LoadedPlugin = {
        name: plugin.name,
        version: plugin.version,
        dirName,
        tools: pluginTools,
      };

      this.loaded.set(dirName, loaded);
      log.info("Plugin loaded", { name: plugin.name, version: plugin.version });

      if (this.opts.onReload) {
        this.opts.onReload(plugin.name);
      }
    } catch (err) {
      log.error("Plugin load failed — skipping", { dir: dirName, err: String(err) });
      if (this.opts.onError) {
        this.opts.onError(dirName, err);
      }
    }
  }

  private async unloadPlugin(dirName: string): Promise<void> {
    this.loaded.delete(dirName);
  }

  watchForChanges(): ReturnType<typeof watch> | null {
    const debounces = new Map<string, ReturnType<typeof setTimeout>>();

    try {
      const watcher = watch(this.pluginsDir, { recursive: true }, (_event, filename) => {
        if (!filename || !filename.endsWith('index.js')) return;
        const parts = filename.split(/[/\\]/);
        const dirName = parts[0];

        const key = dirName;
        const existing = debounces.get(key);
        if (existing) clearTimeout(existing);
        debounces.set(key, setTimeout(() => {
          debounces.delete(key);
          this.loadPlugin(dirName).then(() => {
            if (this.opts.onReload) this.opts.onReload(dirName);
          }).catch(() => {});
        }, 500));
      });
      return watcher;
    } catch {
      return null;
    }
  }

  startWatcher() { return this.watchForChanges(); }
  watch() { return this.watchForChanges(); }

  getLoadedPlugins(): LoadedPlugin[] {
    return Array.from(this.loaded.values());
  }

  getRegisteredTools(): unknown[] {
    return this.registeredTools;
  }

  getPluginTools(): unknown[] {
    return this.registeredTools;
  }

  async reload(pluginName: string): Promise<void> {
    await this.loadPlugin(pluginName);
  }

  getLoaded(): string[] {
    return Array.from(this.loaded.keys());
  }

  async shutdown(): Promise<void> {
    for (const dirName of this.loaded.keys()) {
      await this.unloadPlugin(dirName);
    }
  }
}

let _pluginManager: PluginManager | undefined;

export function getPluginManager(): PluginManager {
  if (!_pluginManager) {
    _pluginManager = new PluginManager({
      pluginsDir: process.env.HOOT_PLUGINS_DIR ?? process.env.MAX_PLUGINS_DIR,
      bus: { on: () => {}, emit: () => {} },
    });
  }
  return _pluginManager;
}
