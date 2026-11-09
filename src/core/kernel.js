/**
 * The kernel: discovery, lifecycle, buses and the plugin-facing api.
 *
 *   import { createKernel } from 'uniplug';
 *
 *   const kernel = await createKernel({ pluginDirs: ['plugins'] });
 *   await kernel.start();
 *   await kernel.emit('app:ready', { port: 3000 });
 *   const result = await kernel.callHook('request', payload);
 *   await kernel.stop();
 */

import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { EventBus } from './events.js';
import { HookBus } from './hooks.js';
import { ServiceContainer } from './services.js';
import { Logger } from './logger.js';
import { Plugin, STATE } from './plugin.js';
import { resolveOrder, importPluginModule, discoverPlugins, buildManifest } from './loader.js';
import { LoadError, LifecycleError, PermissionError } from './errors.js';

const KERNEL_STATE = {
  IDLE: 'idle',
  STARTING: 'starting',
  RUNNING: 'running',
  STOPPING: 'stopping',
  STOPPED: 'stopped',
};

export class Kernel {
  /**
   * @param {object} [options]
   * @param {string} [options.rootDir] base for relative paths
   * @param {string[]|string} [options.pluginDirs] plugin search directories
   * @param {string} [options.dataDir] where config/store/plugin data live
   * @param {string} [options.logLevel]
   * @param {boolean} [options.autoEnable] enable plugins right after loading
   * @param {boolean} [options.continueOnError] keep booting when a plugin fails
   * @param {boolean} [options.hotReload] watch plugin dirs for changes
   * @param {object} [options.logger]
   */
  constructor(options = {}) {
    this.options = {
      rootDir: options.rootDir ? path.resolve(options.rootDir) : process.cwd(),
      pluginDirs: options.pluginDirs ?? ['plugins'],
      dataDir: options.dataDir ?? '.uniplug',
      logLevel: options.logLevel ?? process.env.LOG_LEVEL ?? 'info',
      autoEnable: options.autoEnable !== false,
      continueOnError: options.continueOnError !== false,
      hotReload: options.hotReload === true,
      hotReloadInterval: options.hotReloadInterval ?? 300,
    };
    this.options.pluginDirs = (Array.isArray(this.options.pluginDirs)
      ? this.options.pluginDirs
      : [this.options.pluginDirs]
    ).map((d) => path.resolve(this.options.rootDir, d));
    this.options.dataDir = path.resolve(this.options.rootDir, this.options.dataDir);

    this.logger = options.logger || new Logger({ level: this.options.logLevel });
    this.events = new EventBus();
    this.hooks = new HookBus();
    this.services = new ServiceContainer();
    /** @type {Map<string, Plugin>} */
    this.plugins = new Map();
    /** @type {Map<string, {fn: Function, owner: string|null, description: string}>} */
    this.commands = new Map();
    this.state = KERNEL_STATE.IDLE;
    this._watchers = [];
    this._startedAt = null;
    // Last-resort sink so one misbehaving listener cannot crash the host.
    this.events.on(
      'error',
      ({ error, event, owner }) => {
        this.logger.error(`listener for "${event}"${owner ? ` (${owner})` : ''} threw:`, error?.message || error);
      },
      { owner: '@kernel', priority: -100 },
    );
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  /** Discover, load and (optionally) enable every plugin. */
  async start() {
    if (this.state === KERNEL_STATE.RUNNING) return this;
    this.state = KERNEL_STATE.STARTING;
    this._startedAt = Date.now();
    fs.mkdirSync(this.options.dataDir, { recursive: true });

    await this.events.emit('kernel:starting', { options: this.options });

    const manifests = await this.discover();
    for (const manifest of manifests) {
      try {
        await this.loadPlugin(manifest);
      } catch (err) {
        if (!this.options.continueOnError) {
          this.state = KERNEL_STATE.IDLE;
          throw err;
        }
        this.logger.error(`plugin "${manifest.id}" failed to load: ${err.message}`);
        const record = this.plugins.get(manifest.id);
        if (record) {
          record.state = STATE.FAILED;
          record.error = err;
        }
        await this.events.emit('plugin:error', { id: manifest.id, error: err, phase: 'load' });
      }
    }

    if (this.options.autoEnable) {
      for (const plugin of this.plugins.values()) {
        if (plugin.state === STATE.LOADED) {
          await this._guard(plugin, 'enable', () => plugin.enable());
        }
      }
    }

    if (this.options.hotReload) this.watch();

    this.state = KERNEL_STATE.RUNNING;
    await this.events.emit('kernel:ready', { plugins: this.list() });
    return this;
  }

  async stop() {
    if (this.state === KERNEL_STATE.STOPPED) return this;
    this.state = KERNEL_STATE.STOPPING;
    this.unwatch();
    await this.events.emit('kernel:stopping', {});
    for (const plugin of [...this.plugins.values()].reverse()) {
      await this._guard(plugin, 'unload', () => plugin.unload());
    }
    this.state = KERNEL_STATE.STOPPED;
    await this.events.emit('kernel:stopped', {});
    return this;
  }

  async _guard(plugin, phase, fn) {
    try {
      await fn();
    } catch (err) {
      plugin.error = err;
      plugin.state = STATE.FAILED;
      this.logger.error(`plugin "${plugin.id}" failed during ${phase}: ${err.message}`);
      await this.events.emit('plugin:error', { id: plugin.id, error: err, phase });
      if (!this.options.continueOnError) throw err;
    }
    return plugin;
  }

  // ── discovery / load ─────────────────────────────────────────────────────

  /** @returns {Promise<object[]>} manifests in dependency order */
  async discover() {
    const candidates = await discoverPlugins(this.options.pluginDirs);
    const manifestById = new Map();

    for (const candidate of candidates) {
      try {
        const manifest = await buildManifest(candidate);
        if (manifestById.has(manifest.id)) {
          this.logger.warn(
            `duplicate plugin id "${manifest.id}" — keeping ${manifestById.get(manifest.id).dir}, ignoring ${manifest.dir}`,
          );
          continue;
        }
        manifestById.set(manifest.id, manifest);
      } catch (err) {
        if (!this.options.continueOnError) throw err;
        this.logger.error(`skipping ${candidate.path}: ${err.message}`);
      }
    }

    return resolveOrder(manifestById);
  }

  async loadPlugin(manifest, { cacheBust = false } = {}) {
    if (this.plugins.has(manifest.id)) return this.plugins.get(manifest.id);
    const plugin = new Plugin(manifest, this);
    this.plugins.set(manifest.id, plugin);
    // Create the api once, up front: sandboxed plugins need it while evaluating.
    plugin.api = this.createApi(plugin);
    plugin.definition = await importPluginModule(manifest, {
      api: plugin.api,
      logger: plugin.log,
      cacheBust,
    });
    await plugin.load(plugin.definition);
    await this.events.emit('plugin:loaded', { id: plugin.id, plugin });
    return plugin;
  }

  // ── runtime control ──────────────────────────────────────────────────────

  async enable(id) {
    const plugin = this.require(id);
    await plugin.enable();
    return plugin;
  }

  async disable(id) {
    const plugin = this.require(id);
    await plugin.disable();
    return plugin;
  }

  /**
   * Reload a plugin: unload, re-read the manifest, re-import, re-enable.
   * Its dependents are notified via the `plugin:reload` event.
   */
  async reload(id) {
    const plugin = this.require(id);
    const wasEnabled = plugin.state === STATE.ENABLED;
    await plugin.unload();
    this.plugins.delete(id);

    const candidates = await discoverPlugins(this.options.pluginDirs);
    const candidate = candidates.find((c) => path.resolve(c.path) === path.resolve(plugin.pluginDir));
    if (!candidate) throw new LifecycleError(`plugin "${id}" no longer exists in any plugin directory`);

    const manifest = await buildManifest(candidate);
    const fresh = await this.loadPlugin(manifest, { cacheBust: true });
    if (wasEnabled) await fresh.enable();
    await this.events.emit('plugin:reload', { id });
    return fresh;
  }

  require(id) {
    const plugin = this.plugins.get(id);
    if (!plugin) {
      throw new LifecycleError(
        `unknown plugin "${id}". Loaded: ${this.list().map((p) => p.id).join(', ') || '(none)'}`,
      );
    }
    return plugin;
  }

  getPlugin(id) {
    return this.plugins.get(id) || null;
  }

  /** @returns {Plugin[]} */
  list() {
    return [...this.plugins.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  get size() {
    return this.plugins.size;
  }

  activePlugins() {
    return [...this.plugins.values()].filter((p) => p.state === STATE.ENABLED);
  }

  // ── buses ────────────────────────────────────────────────────────────────

  async emit(name, payload = {}) {
    return this.events.emit(name, payload);
  }

  on(name, handler, opts) {
    return this.events.on(name, handler, { owner: '@kernel', ...opts });
  }

  async callHook(name, value, meta = {}) {
    return this.hooks.run(name, value, meta);
  }

  addHook(name, fn, opts = {}) {
    return this.hooks.add(name, fn, { owner: '@kernel', ...opts });
  }

  use(name) {
    return this.services.use(name);
  }

  /** Toggle every registration an owner made (used by enable/disable). */
  activateOwner(owner, active) {
    this.events.setOwnerActive(owner, active);
    this.hooks.setOwnerActive(owner, active);
    this.services.setOwnerActive(owner, active);
    for (const entry of this.commands.values()) {
      if (entry.owner === owner) entry.active = active;
    }
  }

  // ── commands ─────────────────────────────────────────────────────────────

  registerCommand(name, fn, { owner = null, description = '' } = {}) {
    if (typeof fn !== 'function') throw new TypeError('command handler must be a function');
    if (this.commands.has(name)) throw new Error(`command "${name}" already registered`);
    this.commands.set(name, { fn, owner, description, active: true });
    return () => this.commands.delete(name);
  }

  async runCommand(name, ...args) {
    const entry = this.commands.get(name);
    if (!entry || !entry.active) {
      throw new Error(`unknown command "${name}". Available: ${[...this.commands.keys()].join(', ') || '(none)'}`);
    }
    return entry.fn(...args, { kernel: this });
  }

  commandsList() {
    return [...this.commands.entries()]
      .filter(([, e]) => e.active)
      .map(([name, e]) => ({ name, owner: e.owner, description: e.description }));
  }

  // ── plugin api factory ───────────────────────────────────────────────────

  /** Build the `api` object handed to a plugin's setup(). */
  createApi(plugin) {
    const kernel = this;
    const id = plugin.id;
    const guarded = (fn) => fn;

    const requireNet = () => plugin.permissions.require('net', 'api.fetch');
    const fetchProxy = async (input, init) => {
      requireNet();
      const url = typeof input === 'string' ? input : input?.url;
      const parsed = new URL(url);
      if (!/^https?:$/.test(parsed.protocol)) {
        throw new PermissionError(`only http(s) URLs may be fetched (got ${parsed.protocol})`);
      }
      plugin.permissions.checkHost(parsed.hostname);
      return globalThis.fetch(input, init);
    };

    const api = {
      id,
      name: plugin.manifest.name,
      version: plugin.manifest.version,
      manifest: plugin.manifest,
      kernel,
      dataDir: plugin.dataDir,
      pluginDir: plugin.pluginDir,
      log: plugin.log,
      config: plugin.config,
      store: plugin.store,
      fs: plugin.fs,
      scheduler: plugin.scheduler,
      permissions: plugin.permissions,

      // events ------------------------------------------------------------
      on(name, handler, opts = {}) {
        const off = kernel.events.on(name, handler, { ...opts, owner: id });
        plugin.dispose(`event:${name}`, off);
        return off;
      },
      once(name, handler, opts = {}) {
        const off = kernel.events.once(name, handler, { ...opts, owner: id });
        plugin.dispose(`event-once:${name}`, off);
        return off;
      },
      off(name, handler) {
        return kernel.events.off(name, handler);
      },
      emit(name, payload) {
        return kernel.events.emit(name, payload);
      },

      // hooks -------------------------------------------------------------
      hook(name, fn, opts = {}) {
        const remove = kernel.hooks.add(name, fn, { ...opts, owner: id });
        plugin.dispose(`hook:${name}`, remove);
        return remove;
      },
      callHook(name, value, meta) {
        return kernel.hooks.run(name, value, meta);
      },
      hookCount(name) {
        return kernel.hooks.count(name);
      },

      // services ----------------------------------------------------------
      provide(name, value, opts = {}) {
        kernel.services.provide(name, value, { ...opts, owner: id });
        plugin.dispose(`service:${name}`, () => kernel.services.remove(name));
        return value;
      },
      use(name) {
        return kernel.services.use(name);
      },
      tryUse(name, fallback) {
        return kernel.services.tryUse(name, fallback);
      },
      hasService(name) {
        return kernel.services.has(name);
      },
      serviceNames() {
        return kernel.services.names();
      },

      // commands ----------------------------------------------------------
      command(name, fn, description = '') {
        return kernel.registerCommand(name, fn, { owner: id, description });
      },
      runCommand(name, ...args) {
        return kernel.runCommand(name, ...args);
      },

      // timers ------------------------------------------------------------
      every(ms, fn, opts) {
        return plugin.scheduler.every(ms, fn, opts);
      },
      after(ms, fn) {
        return plugin.scheduler.after(ms, fn);
      },
      poll(ms, fn) {
        return plugin.scheduler.poll(ms, fn);
      },

      // cleanup -----------------------------------------------------------
      dispose(name, fn) {
        plugin.dispose(name, fn);
      },

      // gated capabilities -------------------------------------------------
      fetch: fetchProxy,
      getEnv(key, fallback) {
        plugin.permissions.checkEnvKey(key);
        return process.env[key] ?? fallback;
      },
      env() {
        const entry = plugin.permissions.require('env', 'api.env');
        if (!entry.allow) return { ...process.env };
        return Object.fromEntries(entry.allow.map((k) => [k, process.env[k]]));
      },
      process: {
        get platform() {
          return process.platform;
        },
        get arch() {
          return process.arch;
        },
        get version() {
          return process.version;
        },
        cwd: () => process.cwd(),
        exit: (code) => {
          plugin.permissions.require('process', 'api.process.exit');
          process.exit(code);
        },
        on(signal, fn) {
          plugin.permissions.require('process', 'api.process.on');
          process.on(signal, fn);
          plugin.dispose(`signal:${signal}`, () => process.off(signal, fn));
        },
      },

      // introspection -----------------------------------------------------
      getPlugin(otherId) {
        const other = kernel.plugins.get(otherId);
        return other ? other.api : null;
      },
      plugins() {
        return kernel.list().map((p) => ({ id: p.id, version: p.manifest.version, state: p.state }));
      },
      isEnabled(otherId) {
        return kernel.plugins.get(otherId)?.state === STATE.ENABLED;
      },
    };

    return Object.freeze(api);
  }

  // ── hot reload ───────────────────────────────────────────────────────────

  watch() {
    if (this._watchers.length) return this;
    for (const dir of this.options.pluginDirs) {
      if (!fs.existsSync(dir)) continue;
      let timer = null;
      const watcher = fs.watch(dir, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        clearTimeout(timer);
        timer = setTimeout(async () => {
          const rel = String(filename);
          const pluginId = rel.split(/[/\\]/)[0].replace(/\.(plugin\.)?(js|mjs|cjs)$/, '');
          const target = this.plugins.get(pluginId);
          if (!target) return;
          this.logger.debug(`hot reload → ${pluginId} (${eventType})`);
          try {
            await this.reload(pluginId);
            this.logger.info(`hot reloaded "${pluginId}"`);
          } catch (err) {
            this.logger.error(`hot reload of "${pluginId}" failed: ${err.message}`);
          }
        }, this.options.hotReloadInterval);
      });
      watcher.on('error', (err) => this.logger.warn(`watcher error on ${dir}: ${err.message}`));
      this._watchers.push(watcher);
    }
    this.logger.debug(`watching ${this.options.pluginDirs.length} plugin director(ies)`);
    return this;
  }

  unwatch() {
    for (const w of this._watchers) w.close();
    this._watchers = [];
    return this;
  }

  // ── introspection ────────────────────────────────────────────────────────

  stats() {
    return {
      state: this.state,
      uptimeMs: this._startedAt ? Date.now() - this._startedAt : 0,
      plugins: this.plugins.size,
      enabled: this.activePlugins().length,
      services: this.services.names(),
      commands: this.commandsList().length,
      pluginDirs: this.options.pluginDirs,
      dataDir: this.options.dataDir,
    };
  }

  describe() {
    return this.list().map((p) => p.toJSON());
  }
}

/**
 * Create a kernel, reading `uniplug.config.mjs` from the project root when present.
 *
 * @param {object} [options]
 * @returns {Promise<Kernel>}
 */
export async function createKernel(options = {}) {
  const rootDir = path.resolve(options.rootDir || process.cwd());
  const configFile = path.resolve(rootDir, options.configFile || 'uniplug.config.mjs');
  let fileConfig = {};
  if (options.loadConfigFile !== false && fs.existsSync(configFile)) {
    try {
      const mod = await import(pathToFileURL(configFile).href);
      fileConfig = mod.default || mod;
    } catch (err) {
      throw new LoadError(`cannot read ${configFile}: ${err.message}`, { file: configFile });
    }
  }
  return new Kernel({ ...fileConfig, ...options, rootDir });
}

export { Kernel as default, KERNEL_STATE, STATE };
