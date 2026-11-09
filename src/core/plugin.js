/**
 * Runtime record for one plugin: state machine + api surface.
 *
 *   discovered → loaded → enabled ⇄ disabled → unloaded
 *
 * Design rule: `setup(api)` runs once at load time and registers
 * *declarations* (events, hooks, services, commands, timers). Enabling and
 * disabling toggle those declarations on and off without losing them, so a
 * disabled plugin costs nothing but can be re-enabled instantly.
 */

import path from 'node:path';
import { ConfigStore } from './config.js';
import { Store } from './store.js';
import { Scheduler } from './scheduler.js';
import { PermissionSet } from './permissions.js';
import { PluginFs } from './storage.js';
import { LifecycleError } from './errors.js';

export const STATE = {
  DISCOVERED: 'discovered',
  LOADED: 'loaded',
  ENABLED: 'enabled',
  DISABLED: 'disabled',
  UNLOADED: 'unloaded',
  FAILED: 'failed',
};

export class Plugin {
  /**
   * @param {object} manifest normalized manifest
   * @param {import('./kernel.js').Kernel} kernel
   */
  constructor(manifest, kernel) {
    this.manifest = manifest;
    this.kernel = kernel;
    this.id = manifest.id;
    this.state = STATE.DISCOVERED;
    this.definition = null;
    this.api = null;
    this.error = null;
    this.loadedAt = null;
    this.enabledAt = null;
    this.pluginDir = manifest.dir;
    this.dataDir = path.join(kernel.options.dataDir, 'plugins', manifest.id);
    this._disposers = [];
    this._setupDone = false;
    this.scheduler = new Scheduler();
    this.scheduler.onError = (err) => this.log.error('timer failed:', err);
    this.permissions = new PermissionSet(manifest.permissions, { pluginId: manifest.id });
    this.config = new ConfigStore({
      pluginId: manifest.id,
      file: path.join(kernel.options.dataDir, 'config', `${manifest.id}.json`),
      defaults: manifest.config,
      warn: (msg) => this.log.warn(msg),
    });
    this.store = new Store({
      pluginId: manifest.id,
      file: path.join(this.dataDir, 'store.json'),
    });
    this.fs = new PluginFs(path.join(this.dataDir, 'files'), (name) => this.permissions.require(name));
    this.log = kernel.logger.child(manifest.id);
  }

  _record(name, undo) {
    this._disposers.push({ name, undo });
  }

  /** Called once after the module is imported. */
  async load(definition) {
    this.definition = definition;
    this.state = STATE.LOADED;
    this.loadedAt = Date.now();
    await this.config.load();
  }

  async enable() {
    if (this.state === STATE.ENABLED) return this;
    if (this.state === STATE.UNLOADED) {
      throw new LifecycleError(`plugin "${this.id}" is unloaded and cannot be enabled`);
    }
    if (!this.api) this.api = this.kernel.createApi(this);

    if (!this._setupDone) {
      if (typeof this.definition.setup === 'function') {
        await this.definition.setup(this.api);
      } else if (typeof this.definition.install === 'function') {
        await this.definition.install(this.api);
      }
      this._setupDone = true;
    } else {
      this.kernel.activateOwner(this.id, true);
      // A re-enable restarts timers that disable() cleared.
      if (typeof this.definition.onEnable === 'function') {
        await this.definition.onEnable(this.api);
      }
      this.state = STATE.ENABLED;
      this.enabledAt = Date.now();
      await this.kernel.events.emit('plugin:enabled', { id: this.id, plugin: this });
      return this;
    }

    if (typeof this.definition.onEnable === 'function') {
      await this.definition.onEnable(this.api);
    }
    this.state = STATE.ENABLED;
    this.enabledAt = Date.now();
    await this.kernel.events.emit('plugin:enabled', { id: this.id, plugin: this });
    return this;
  }

  async disable() {
    if (this.state !== STATE.ENABLED) return this;
    try {
      if (typeof this.definition.onDisable === 'function') {
        await this.definition.onDisable(this.api);
      }
    } finally {
      this.scheduler.clear();
      this.kernel.activateOwner(this.id, false);
      this.state = STATE.DISABLED;
      await this.kernel.events.emit('plugin:disabled', { id: this.id, plugin: this });
    }
    return this;
  }

  async unload() {
    if (this.state === STATE.ENABLED) await this.disable();
    try {
      if (typeof this.definition?.onUnload === 'function') {
        await this.definition.onUnload(this.api);
      }
    } finally {
      for (const disposer of this._disposers.reverse()) {
        try {
          await disposer.undo();
        } catch (err) {
          this.log.warn(`cleanup "${disposer.name}" failed:`, err.message);
        }
      }
      this._disposers = [];
      this.scheduler.dispose();
      this.store.flushSync();
      await this.store.flush().catch(() => {});
      this.kernel.events.removeOwner(this.id);
      this.kernel.hooks.removeOwner(this.id);
      this.kernel.services.removeOwner(this.id);
      this.kernel.commands.delete(`plugin:${this.id}`);
      for (const [name, entry] of this.kernel.commands) {
        if (entry.owner === this.id) this.kernel.commands.delete(name);
      }
      this.state = STATE.UNLOADED;
      await this.kernel.events.emit('plugin:unloaded', { id: this.id, plugin: this });
    }
    return this;
  }

  dispose(name, fn) {
    if (typeof fn !== 'function') throw new TypeError('dispose expects a function');
    this._disposers.push({ name, undo: fn });
  }

  toJSON() {
    return {
      id: this.id,
      name: this.manifest.name,
      version: this.manifest.version,
      state: this.state,
      dir: this.pluginDir,
      description: this.manifest.description,
      permissions: this.permissions.toJSON(),
      error: this.error ? { code: this.error.code, message: this.error.message } : null,
    };
  }
}
