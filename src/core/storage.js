/**
 * Sandboxed filesystem view handed to plugins as `api.fs`.
 *
 * Every path is resolved inside the plugin's own data directory; `..`
 * escapes are rejected. Requires the `fs` permission.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { PermissionError } from './errors.js';

export class PluginFs {
  /**
   * @param {string} root absolute root directory (created lazily)
   * @param {(name: string) => void} requirePermission
   */
  constructor(root, requirePermission) {
    this.root = path.resolve(root);
    this.requirePermission = requirePermission;
  }

  _resolve(p) {
    this.requirePermission('fs');
    const target = path.resolve(this.root, String(p ?? '.'));
    const rel = path.relative(this.root, target);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new PermissionError(`path "${p}" escapes the plugin directory`);
    }
    return target;
  }

  resolve(p) {
    return this._resolve(p);
  }

  async read(p, encoding = 'utf8') {
    return fs.readFile(this._resolve(p), encoding);
  }

  async readJSON(p, fallback = undefined) {
    try {
      return JSON.parse(await this.read(p));
    } catch (err) {
      if (fallback !== undefined) return fallback;
      throw err;
    }
  }

  async write(p, data) {
    const target = this._resolve(p);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data);
    return target;
  }

  async writeJSON(p, value) {
    return this.write(p, `${JSON.stringify(value, null, 2)}\n`);
  }

  async append(p, data) {
    const target = this._resolve(p);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.appendFile(target, data);
  }

  async exists(p) {
    try {
      await fs.access(this._resolve(p));
      return true;
    } catch {
      return false;
    }
  }

  async list(p = '.') {
    const target = this._resolve(p);
    const entries = await fs.readdir(target, { withFileTypes: true });
    return entries.map((e) => ({ name: e.name, directory: e.isDirectory() }));
  }

  async mkdir(p) {
    await fs.mkdir(this._resolve(p), { recursive: true });
  }

  async remove(p) {
    await fs.rm(this._resolve(p), { recursive: true, force: true });
  }

  async stat(p) {
    const s = await fs.stat(this._resolve(p));
    return { size: s.size, mtime: s.mtime, isDirectory: s.isDirectory() };
  }
}
