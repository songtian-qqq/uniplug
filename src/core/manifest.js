/**
 * Manifest loading and validation.
 *
 * `plugin.json` fields
 *   id            string   required, [a-z0-9][a-z0-9._-]*
 *   name          string   optional, human label (defaults to id)
 *   version       string   required, semver
 *   description   string   optional
 *   author        string   optional
 *   main          string   entry file, default "index.js"
 *   dependencies  object   { "plugin-id": "^1.2.0" }
 *   optionalDependencies object  same shape; missing/unmet → skipped, not fatal
 *   loadAfter     string[] order hints, prefer loading after these ids
 *   config        object   default config values
 *   permissions   array    see permissions.js
 *   sandbox       boolean  run the entry in a vm context (CommonJS only)
 *   keywords      string[]
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { ManifestError } from './errors.js';
import { valid } from './semver.js';

const ID_RE = /^[a-z0-9][a-z0-9._-]*$/;

export async function readManifest(dir) {
  const file = path.join(dir, 'plugin.json');
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    throw new ManifestError(`cannot read ${file}: ${err.message}`, { file });
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new ManifestError(`${file} is not valid JSON: ${err.message}`, { file });
  }
  return normalizeManifest(json, dir);
}

export function normalizeManifest(json, dir = process.cwd(), source = 'plugin.json') {
  const errors = [];
  if (!json || typeof json !== 'object') {
    throw new ManifestError(`manifest at ${source} must be an object`);
  }
  if (!json.id || typeof json.id !== 'string' || !ID_RE.test(json.id)) {
    errors.push(`"id" must match ${ID_RE} (got ${JSON.stringify(json.id)})`);
  }
  if (!json.version || !valid(json.version)) {
    errors.push(`"version" must be a semver string (got ${JSON.stringify(json.version)})`);
  }
  if (json.dependencies && typeof json.dependencies !== 'object') {
    errors.push('"dependencies" must be an object of { id: range }');
  }
  if (json.permissions && !Array.isArray(json.permissions)) {
    errors.push('"permissions" must be an array');
  }
  if (json.main && typeof json.main !== 'string') {
    errors.push('"main" must be a string path');
  }
  if (errors.length) {
    throw new ManifestError(`invalid manifest ${source}:\n  - ${errors.join('\n  - ')}`, {
      source,
      errors,
    });
  }

  const main = json.main || 'index.js';
  return {
    id: json.id,
    name: json.name || json.id,
    version: json.version,
    description: json.description || '',
    author: json.author || '',
    license: json.license || '',
    homepage: json.homepage || '',
    main,
    mainFile: path.resolve(dir, main),
    dir,
    source,
    dependencies: json.dependencies || {},
    optionalDependencies: json.optionalDependencies || {},
    loadAfter: Array.isArray(json.loadAfter) ? json.loadAfter : [],
    loadBefore: Array.isArray(json.loadBefore) ? json.loadBefore : [],
    config: json.config || {},
    permissions: json.permissions || [],
    sandbox: json.sandbox === true,
    keywords: Array.isArray(json.keywords) ? json.keywords : [],
    raw: json,
  };
}
