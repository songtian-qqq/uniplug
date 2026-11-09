/**
 * Plugin discovery + dependency resolution.
 *
 * Discovery accepts two layouts inside each plugin directory:
 *
 *   plugins/hello/plugin.json + index.js      (manifest directory plugin)
 *   plugins/hello.js                          (single-file plugin, metadata inline)
 *   plugins/hello.plugin.js                   (same, explicit suffix)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DependencyError, LoadError, ManifestError } from './errors.js';
import { normalizeManifest } from './manifest.js';
import { isPluginDefinition } from './define.js';
import { loadInSandbox } from './sandbox.js';
import { satisfies, compareVersions } from './semver.js';

async function isDirectory(p) {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Scan the given directories for plugin candidates.
 * @param {string[]} dirs absolute directories
 * @returns {Promise<Array<{kind: 'dir'|'file', path: string}>>}
 */
export async function discoverPlugins(dirs) {
  const found = [];
  for (const dir of dirs) {
    if (!(await isDirectory(dir))) continue;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        try {
          await fs.access(path.join(full, 'plugin.json'));
          found.push({ kind: 'dir', path: full });
        } catch {
          /* not a plugin dir */
        }
      } else if (entry.isFile() && /\.(plugin\.)?(js|mjs|cjs)$/.test(entry.name)) {
        found.push({ kind: 'file', path: full });
      }
    }
  }
  return found;
}

/**
 * Import a plugin module and normalize it to a definition object.
 * @param {object} manifest
 * @param {{api?: object, logger?: object, cacheBust?: boolean}} [opts]
 */
export async function importPluginModule(manifest, { api, logger, cacheBust = false } = {}) {
  let mod;
  if (manifest.sandbox) {
    if (!api) throw new LoadError('sandboxed plugins require an api context', { file: manifest.mainFile });
    mod = await loadInSandbox(manifest.mainFile, { api, logger });
  } else {
    try {
      const url = pathToFileURL(manifest.mainFile);
      if (cacheBust) url.search = `?v=${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
      mod = await import(url.href);
    } catch (err) {
      throw new LoadError(`failed to import ${manifest.mainFile}: ${err.message}`, {
        file: manifest.mainFile,
        cause: err,
      });
    }
  }

  const definition =
    (isPluginDefinition(mod?.default) && mod.default) ||
    (isPluginDefinition(mod) && mod) ||
    (isPluginDefinition(mod?.plugin) && mod.plugin) ||
    null;

  if (!definition) {
    throw new LoadError(
      `${manifest.mainFile} does not export a plugin definition. ` +
        `Expected "export default definePlugin({ setup(api) { ... } })" (ESM) or "module.exports = { setup }" (CJS).`,
      { file: manifest.mainFile },
    );
  }
  return definition;
}

export async function buildManifest(candidate) {
  if (candidate.kind === 'dir') {
    const { readManifest } = await import('./manifest.js');
    return readManifest(candidate.path);
  }
  // Single-file plugin: metadata is read from the default export.
  const mod = await import(pathToFileURL(candidate.path).href);
  const definition = mod?.default || mod;
  const meta = definition?.manifest || definition;
  if (!meta || !meta.id) {
    throw new ManifestError(
      `single-file plugin ${candidate.path} must export { id, version, setup }, ` +
        `e.g. export default definePlugin({ id: 'hello', version: '1.0.0', setup(api) {} })`,
      { file: candidate.path },
    );
  }
  return normalizeManifest(
    {
      id: meta.id,
      name: meta.name,
      version: meta.version || '1.0.0',
      description: meta.description,
      main: path.basename(candidate.path),
      dependencies: meta.dependencies,
      optionalDependencies: meta.optionalDependencies,
      loadAfter: meta.loadAfter,
      config: meta.config,
      permissions: meta.permissions,
      sandbox: false,
    },
    path.dirname(candidate.path),
    candidate.path,
  );
}

/**
 * Order manifests so that dependencies come first (Kahn's algorithm with
 * `loadAfter` / `loadBefore` hints, then id-stable ordering).
 *
 * @param {Map<string, object>} manifestById
 * @returns {object[]} sorted manifests
 */
export function resolveOrder(manifestById) {
  const ids = [...manifestById.keys()];
  const depsOf = new Map();
  const problems = [];

  for (const id of ids) {
    const manifest = manifestById.get(id);
    const deps = [];
    for (const [depId, range] of Object.entries(manifest.dependencies || {})) {
      const target = manifestById.get(depId);
      if (!target) {
        problems.push(`${id} requires missing plugin "${depId}" (${range})`);
        continue;
      }
      if (!satisfies(target.version, range)) {
        problems.push(
          `${id} requires ${depId}@${range} but found ${target.version} ` +
            `(available ids: ${ids.join(', ')})`,
        );
        continue;
      }
      deps.push(depId);
    }
    for (const [depId, range] of Object.entries(manifest.optionalDependencies || {})) {
      const target = manifestById.get(depId);
      if (target && satisfies(target.version, range)) deps.push(depId);
    }
    for (const before of manifest.loadAfter || []) {
      if (manifestById.has(before)) deps.push(before);
    }
    depsOf.set(id, [...new Set(deps)]);
  }

  // A plugin listed in another's loadBefore must run first.
  for (const id of ids) {
    for (const target of manifestById.get(id).loadBefore || []) {
      if (!manifestById.has(target)) continue;
      depsOf.get(target).push(id);
    }
  }

  const inDegree = new Map(ids.map((id) => [id, 0]));
  const dependents = new Map(ids.map((id) => [id, []]));
  for (const [id, deps] of depsOf) {
    for (const dep of deps) {
      if (!inDegree.has(dep)) continue;
      inDegree.set(id, inDegree.get(id) + 1);
      dependents.get(dep).push(id);
    }
  }

  const queue = ids.filter((id) => inDegree.get(id) === 0).sort();
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const dependent of dependents.get(id)) {
      inDegree.set(dependent, inDegree.get(dependent) - 1);
      if (inDegree.get(dependent) === 0) {
        queue.push(dependent);
        queue.sort();
      }
    }
  }

  if (order.length !== ids.length) {
    const cyclic = ids.filter((id) => !order.includes(id));
    throw new DependencyError(
      `circular plugin dependency detected among: ${cyclic.join(', ')}`,
      { cyclic },
    );
  }
  if (problems.length) {
    throw new DependencyError(`plugin dependency problems:\n  - ${problems.join('\n  - ')}`, { problems });
  }
  return order.map((id) => manifestById.get(id));
}

export { compareVersions };
