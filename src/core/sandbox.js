/**
 * Optional soft sandbox for untrusted plugins (`"sandbox": true`).
 *
 * The entry file is evaluated in a fresh `vm` context with a curated global
 * and a whitelisted `require`. Sandboxed plugins must be CommonJS
 * (`module.exports = {...}`).
 *
 * IMPORTANT: `node:vm` is NOT a security boundary — a determined attacker can
 * usually escape it. It protects against *accidental* damage (stray globals,
 * unexpected fs access, prototype pollution of the host). For real isolation
 * run each plugin in its own process/worker. See docs/SECURITY.md.
 */

import fs from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import { LoadError } from './errors.js';

const nodeRequire = createRequire(import.meta.url);

const SAFE_BUILTINS = new Set([
  'path',
  'util',
  'crypto',
  'buffer',
  'url',
  'querystring',
  'assert',
  'events',
  'string_decoder',
  'os',
  'node:path',
  'node:util',
  'node:crypto',
  'node:buffer',
  'node:url',
  'node:querystring',
  'node:assert',
  'node:events',
  'node:string_decoder',
  'node:os',
]);

/**
 * @param {string} file absolute path of the plugin entry
 * @param {object} opts
 * @param {object} opts.api the plugin api object
 * @param {object} opts.logger
 * @param {object} [opts.globals] extra globals to expose
 * @returns {Promise<object>} the module exports
 */
export async function loadInSandbox(file, { api, logger, globals = {} }) {
  let source;
  try {
    source = await fs.readFile(file, 'utf8');
  } catch (err) {
    throw new LoadError(`cannot read sandboxed entry ${file}: ${err.message}`, { file });
  }

  if (/\bexport\s+(default|const|let|var|function|class|async)\b/.test(source)) {
    throw new LoadError(
      `sandboxed plugin ${path.basename(file)} uses ESM syntax; sandboxed plugins must be CommonJS (module.exports = {...})`,
      { file },
    );
  }

  const module = { exports: {} };
  const dirname = path.dirname(file);

  const requireShim = (name) => {
    if (SAFE_BUILTINS.has(name)) return nodeRequire(name);
    if (name === 'uniplug') return api;
    throw new LoadError(
      `sandboxed plugin requested module "${name}" which is not allowed; ` +
        `allowed: ${[...SAFE_BUILTINS].join(', ')} (use api.fs / api.fetch with permissions instead)`,
      { file, module: name },
    );
  };

  const sandbox = {
    module,
    exports: module.exports,
    require: requireShim,
    __filename: file,
    __dirname: dirname,
    api,
    console: logger || console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    setImmediate,
    clearImmediate,
    queueMicrotask,
    structuredClone,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    Buffer,
    process: {
      env: {},
      platform: process.platform,
      arch: process.arch,
      version: process.version,
      nextTick: process.nextTick.bind(process),
    },
    ...globals,
  };

  const context = vm.createContext(sandbox, {
    name: `uniplug:${api.id}`,
    codeGeneration: { strings: false, wasm: false },
  });

  const wrapper = `(function (exports, require, module, __filename, __dirname, api, console) {${source}\n})`;
  let fn;
  try {
    fn = new vm.Script(wrapper, { filename: file }).runInContext(context);
  } catch (err) {
    throw new LoadError(`sandbox syntax error in ${file}: ${err.message}`, { file });
  }

  try {
    fn(module.exports, requireShim, module, file, dirname, api, logger || console);
  } catch (err) {
    throw new LoadError(`sandbox runtime error in ${file}: ${err.message}`, { file, cause: err });
  }

  return module.exports;
}

export { SAFE_BUILTINS };
