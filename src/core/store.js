/**
 * Per-plugin key/value storage, JSON-persisted.
 *
 *   await api.store.set('count', 42);
 *   const count = await api.store.get('count', 0);
 *   await api.store.update('count', (n) => (n || 0) + 1);
 *
 * Writes are serialized; `flushSync()` is the last-chance write used on unload.
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

export class Store {
  constructor({ pluginId, file }) {
    this.pluginId = pluginId;
    this.file = file;
    this._cache = null;
    this._queue = Promise.resolve();
    this._dirty = false;
  }

  async _ensure() {
    if (this._cache) return this._cache;
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, 'utf8'));
      this._cache = parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      this._cache = {};
    }
    return this._cache;
  }

  async get(key, fallback = undefined) {
    const data = await this._ensure();
    return Object.prototype.hasOwnProperty.call(data, key) ? structuredClone(data[key]) : fallback;
  }

  async has(key) {
    const data = await this._ensure();
    return Object.prototype.hasOwnProperty.call(data, key);
  }

  async set(key, value) {
    const data = await this._ensure();
    data[key] = structuredClone(value);
    this._dirty = true;
    return this.flush();
  }

  async update(key, updater, fallback) {
    const data = await this._ensure();
    const current = Object.prototype.hasOwnProperty.call(data, key) ? data[key] : fallback;
    data[key] = await updater(current);
    this._dirty = true;
    return this.flush();
  }

  async delete(key) {
    const data = await this._ensure();
    delete data[key];
    this._dirty = true;
    return this.flush();
  }

  async keys() {
    return Object.keys(await this._ensure());
  }

  async all() {
    return structuredClone(await this._ensure());
  }

  async clear() {
    await this._ensure();
    this._cache = {};
    this._dirty = true;
    return this.flush();
  }

  flush() {
    this._queue = this._queue.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.writeFile(this.file, `${JSON.stringify(this._cache, null, 2)}\n`, 'utf8');
      this._dirty = false;
    });
    return this._queue;
  }

  /** Synchronous last-chance write used during unload. */
  flushSync() {
    if (!this._cache || !this._dirty) return;
    try {
      fsSync.mkdirSync(path.dirname(this.file), { recursive: true });
      fsSync.writeFileSync(this.file, `${JSON.stringify(this._cache, null, 2)}\n`, 'utf8');
      this._dirty = false;
    } catch {
      /* best effort */
    }
  }
}
