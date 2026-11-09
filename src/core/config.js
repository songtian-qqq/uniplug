/**
 * Per-plugin configuration store.
 *
 * Layering (lowest → highest priority):
 *   manifest.config defaults  <  config/<id>.json on disk  <  env UNIPLUG_<ID>__<PATH>
 *
 *   api.config.get('port', 8080)
 *   api.config.get('server.host')
 *   await api.config.set('port', 9090)   // persists
 */

import fs from 'node:fs/promises';
import path from 'node:path';

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, patch) {
  if (!isPlainObject(base)) return patch;
  const out = { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out;
}

function getPath(obj, dotted) {
  return String(dotted)
    .split('.')
    .reduce((acc, key) => (acc === undefined || acc === null ? undefined : acc[key]), obj);
}

function setPath(obj, dotted, value) {
  const keys = String(dotted).split('.');
  const last = keys.pop();
  const target = keys.reduce((acc, key) => {
    if (!isPlainObject(acc[key])) acc[key] = {};
    return acc[key];
  }, obj);
  target[last] = value;
  return obj;
}

export class ConfigStore {
  /**
   * @param {object} opts
   * @param {string} opts.pluginId
   * @param {string} opts.file absolute path of the persisted JSON
   * @param {object} [opts.defaults]
   * @param {(msg: string) => void} [opts.warn]
   */
  constructor({ pluginId, file, defaults = {}, warn = () => {} }) {
    this.pluginId = pluginId;
    this.file = file;
    this.warn = warn;
    this.defaults = structuredClone(defaults || {});
    this.data = structuredClone(this.defaults);
    this._dirty = false;
    this._timer = null;
  }

  async load() {
    let fileData = {};
    try {
      fileData = JSON.parse(await fs.readFile(this.file, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') this.warn(`config for "${this.pluginId}" is unreadable (${err.message}); using defaults`);
    }
    this.data = deepMerge(this.defaults, fileData);
    this._applyEnv();
    return this;
  }

  _applyEnv() {
    const prefix = `UNIPLUG_${this.pluginId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}__`;
    for (const [key, raw] of Object.entries(process.env)) {
      if (!key.startsWith(prefix)) continue;
      const dotted = key.slice(prefix.length).toLowerCase().replace(/__/g, '.');
      let value = raw;
      try {
        value = JSON.parse(raw);
      } catch {
        /* keep the raw string */
      }
      setPath(this.data, dotted, value);
    }
  }

  get(key, fallback) {
    if (key === undefined) return structuredClone(this.data);
    const value = getPath(this.data, key);
    return value === undefined ? fallback : value;
  }

  has(key) {
    return getPath(this.data, key) !== undefined;
  }

  async set(key, value) {
    setPath(this.data, key, value);
    await this.save();
    return value;
  }

  async merge(patch) {
    this.data = deepMerge(this.data, patch);
    await this.save();
    return this.get();
  }

  async reset(key) {
    if (key === undefined) {
      this.data = structuredClone(this.defaults);
    } else {
      const defaultVal = getPath(this.defaults, key);
      if (defaultVal === undefined) {
        const keys = String(key).split('.');
        const parent = getPath(this.data, keys.slice(0, -1).join('.'));
        if (parent) delete parent[keys.at(-1)];
      } else {
        setPath(this.data, key, defaultVal);
      }
    }
    await this.save();
    return this.get(key);
  }

  async save() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8');
    this._dirty = false;
  }
}
