/**
 * Declarative capability permissions.
 *
 * A plugin states what it needs in `plugin.json`:
 *
 *   "permissions": ["storage", "net", { "name": "net", "allow": ["api.github.com"] }]
 *
 * Nothing is granted implicitly: without `net` the fetch proxy throws,
 * without `fs` the file API throws. This is a guardrail against accidental
 * over-reach, not a security boundary (see docs/SECURITY.md).
 */

import { PermissionError } from './errors.js';

const KNOWN = new Set(['net', 'fs', 'env', 'process', 'storage']);

export function normalizePermissions(raw = []) {
  const list = Array.isArray(raw) ? raw : [raw];
  const normalized = [];

  for (const item of list) {
    if (typeof item === 'string') {
      if (!KNOWN.has(item)) throw new PermissionError(`unknown permission "${item}"`);
      normalized.push({ name: item, allow: null });
    } else if (item && typeof item === 'object' && typeof item.name === 'string') {
      if (!KNOWN.has(item.name)) throw new PermissionError(`unknown permission "${item.name}"`);
      normalized.push({
        name: item.name,
        allow: Array.isArray(item.allow) ? item.allow.slice() : null,
      });
    } else {
      throw new PermissionError('permissions must be strings or { name, allow } objects');
    }
  }

  // Merge duplicates, union the allow-lists.
  const merged = new Map();
  for (const p of normalized) {
    const prev = merged.get(p.name);
    if (!prev) {
      merged.set(p.name, { name: p.name, allow: p.allow ? p.allow.slice() : null });
      continue;
    }
    if (prev.allow === null || p.allow === null) prev.allow = null;
    else prev.allow = [...new Set([...prev.allow, ...p.allow])];
  }
  return [...merged.values()];
}

export class PermissionSet {
  constructor(raw = [], { pluginId = 'unknown' } = {}) {
    this.pluginId = pluginId;
    this.list = normalizePermissions(raw);
    this._map = new Map(this.list.map((p) => [p.name, p]));
  }

  has(name) {
    return this._map.has(name);
  }

  require(name, what = name) {
    if (!this._map.has(name)) {
      throw new PermissionError(
        `plugin "${this.pluginId}" used ${what} but did not declare the "${name}" permission in plugin.json`,
        { pluginId: this.pluginId, permission: name },
      );
    }
    return this._map.get(name);
  }

  /** Host check for the `net` permission. */
  checkHost(hostname) {
    const entry = this.require('net', 'network access');
    if (!entry.allow) return true;
    const host = String(hostname || '').toLowerCase();
    const ok = entry.allow.some((rule) => {
      const r = String(rule).toLowerCase();
      if (r.startsWith('*.')) {
        const suffix = r.slice(1); // ".example.com"
        return host === suffix.slice(1) || host.endsWith(suffix);
      }
      return host === r;
    });
    if (!ok) {
      throw new PermissionError(
        `plugin "${this.pluginId}" tried to reach "${host}" which is not in its net allow-list`,
        { pluginId: this.pluginId, host, allow: entry.allow },
      );
    }
    return true;
  }

  /** Key check for the `env` permission. */
  checkEnvKey(key) {
    const entry = this.require('env', 'environment variables');
    if (!entry.allow) return true;
    if (!entry.allow.includes(key)) {
      throw new PermissionError(
        `plugin "${this.pluginId}" tried to read env "${key}" which is not allowed`,
        { pluginId: this.pluginId, key, allow: entry.allow },
      );
    }
    return true;
  }

  toJSON() {
    return this.list;
  }
}
