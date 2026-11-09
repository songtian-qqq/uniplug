import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createKernel } from '../src/index.js';
import { PermissionSet, normalizePermissions } from '../src/core/permissions.js';
import { PermissionError } from '../src/core/errors.js';

test('normalizePermissions merges duplicates and keeps allow-lists', () => {
  const list = normalizePermissions([
    'storage',
    { name: 'net', allow: ['api.github.com'] },
    { name: 'net', allow: ['*.example.com'] },
  ]);
  assert.deepEqual(list.map((p) => p.name), ['storage', 'net']);
  assert.deepEqual(list[1].allow, ['api.github.com', '*.example.com']);
});

test('unknown permissions are rejected', () => {
  assert.throws(() => normalizePermissions(['telepathy']), /unknown permission/);
});

test('a bare permission grants everything', () => {
  const set = new PermissionSet(['net']);
  assert.equal(set.has('net'), true);
  assert.equal(set.checkHost('anything.example'), true);
});

test('host allow-list matches exactly and via subdomain wildcard', () => {
  const set = new PermissionSet([{ name: 'net', allow: ['api.github.com', '*.internal.dev'] }]);
  assert.equal(set.checkHost('api.github.com'), true);
  assert.equal(set.checkHost('a.internal.dev'), true);
  assert.equal(set.checkHost('internal.dev'), true);
  assert.throws(() => set.checkHost('evil.com'), PermissionError);
});

test('missing capability throws a pointer to the manifest', () => {
  const set = new PermissionSet([]);
  assert.throws(() => set.require('net', 'api.fetch'), /did not declare the "net" permission/);
});

test('api.fetch is denied without the net permission', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'uniplug-perm-'));
  await fs.mkdir(path.join(root, 'plugins/no-net'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'plugins/no-net/plugin.json'),
    JSON.stringify({ id: 'no-net', version: '1.0.0', main: 'index.js' }),
  );
  await fs.writeFile(
    path.join(root, 'plugins/no-net/index.js'),
    `import { definePlugin } from '${path.resolve('src/index.js')}';
export default definePlugin({ setup(api) { api.command('no-net:go', () => api.fetch('https://example.com')); } });`,
  );

  const kernel = await createKernel({ rootDir: root, dataDir: path.join(root, '.data'), loadConfigFile: false, logLevel: 'silent' });
  await kernel.start();
  await assert.rejects(() => kernel.runCommand('no-net:go'), /did not declare the "net" permission/);
  await kernel.stop();
});

test('api.fetch enforces the host allow-list', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'uniplug-perm-'));
  await fs.mkdir(path.join(root, 'plugins/limited'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'plugins/limited/plugin.json'),
    JSON.stringify({
      id: 'limited',
      version: '1.0.0',
      main: 'index.js',
      permissions: [{ name: 'net', allow: ['api.github.com'] }],
    }),
  );
  await fs.writeFile(
    path.join(root, 'plugins/limited/index.js'),
    `import { definePlugin } from '${path.resolve('src/index.js')}';
export default definePlugin({ setup(api) {
  api.command('limited:ok', () => api.fetch('https://api.github.com/'));
  api.command('limited:blocked', () => api.fetch('https://evil.example.org/'));
} });`,
  );

  const kernel = await createKernel({ rootDir: root, dataDir: path.join(root, '.data'), loadConfigFile: false, logLevel: 'silent' });
  await kernel.start();
  await assert.rejects(() => kernel.runCommand('limited:blocked'), /not in its net allow-list/);
  await kernel.stop();
});

test('api.fs rejects path traversal and requires the fs permission', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'uniplug-perm-'));
  await fs.mkdir(path.join(root, 'plugins/files'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'plugins/files/plugin.json'),
    JSON.stringify({ id: 'files', version: '1.0.0', main: 'index.js', permissions: ['fs'] }),
  );
  await fs.writeFile(
    path.join(root, 'plugins/files/index.js'),
    `import { definePlugin } from '${path.resolve('src/index.js')}';
export default definePlugin({ setup(api) {
  api.command('files:write', (p, data) => api.fs.write(p, data));
  api.command('files:read', (p) => api.fs.read(p));
  api.command('files:realpath', (p) => api.fs.resolve(p));
} });`,
  );

  const kernel = await createKernel({ rootDir: root, dataDir: path.join(root, '.data'), loadConfigFile: false, logLevel: 'silent' });
  await kernel.start();

  await kernel.runCommand('files:write', 'note.txt', 'hello');
  assert.equal(await kernel.runCommand('files:read', 'note.txt'), 'hello');
  await assert.rejects(() => kernel.runCommand('files:write', '../../../escape.txt', 'x'), /escapes the plugin directory/);
  await assert.rejects(() => kernel.runCommand('files:realpath', '/etc/passwd'), /escapes the plugin directory/);

  await kernel.stop();
});

test('api.getEnv requires the env permission and honours the allow-list', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'uniplug-perm-'));
  await fs.mkdir(path.join(root, 'plugins/envy'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'plugins/envy/plugin.json'),
    JSON.stringify({ id: 'envy', version: '1.0.0', main: 'index.js', permissions: [{ name: 'env', allow: ['HOME'] }] }),
  );
  await fs.writeFile(
    path.join(root, 'plugins/envy/index.js'),
    `import { definePlugin } from '${path.resolve('src/index.js')}';
export default definePlugin({ setup(api) {
  api.command('envy:home', () => api.getEnv('HOME'));
  api.command('envy:path', () => api.getEnv('PATH'));
  api.command('envy:all', () => api.env());
} });`,
  );

  process.env.HOME = process.env.HOME || '/tmp';
  const kernel = await createKernel({ rootDir: root, dataDir: path.join(root, '.data'), loadConfigFile: false, logLevel: 'silent' });
  await kernel.start();

  assert.equal(await kernel.runCommand('envy:home'), process.env.HOME);
  await assert.rejects(() => kernel.runCommand('envy:path'), /not allowed/);
  const all = await kernel.runCommand('envy:all');
  assert.deepEqual(Object.keys(all), ['HOME']);

  await kernel.stop();
});
