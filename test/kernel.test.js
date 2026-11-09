import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createKernel } from '../src/index.js';

async function tmpProject(layout) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'uniplug-test-'));
  for (const [rel, content] of Object.entries(layout)) {
    const file = path.join(root, rel);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }
  return root;
}

function pluginFiles(id, manifest, code) {
  return {
    [`plugins/${id}/plugin.json`]: { id, version: '1.0.0', main: 'index.js', ...manifest },
    [`plugins/${id}/index.js`]: code,
  };
}

const SETUP_CODE = (body) => `
import { definePlugin } from '${path.resolve('src/index.js')}';
export default definePlugin({ ${body} });
`;

test('boots plugins in dependency order', async () => {
  const order = [];
  const root = await tmpProject({
    ...pluginFiles('alpha', { dependencies: { beta: '^1.0.0' } }, SETUP_CODE(`
      setup(api) { globalThis.__order = (globalThis.__order||[]); globalThis.__order.push('alpha'); },
      onEnable(api) { globalThis.__order.push('alpha:enabled'); },
    `)),
    ...pluginFiles('beta', {}, SETUP_CODE(`
      setup(api) { globalThis.__order = (globalThis.__order||[]); globalThis.__order.push('beta'); },
      onEnable(api) { globalThis.__order.push('beta:enabled'); },
    `)),
  });

  globalThis.__order = [];
  const kernel = await createKernel({ rootDir: root, dataDir: path.join(root, '.data'), loadConfigFile: false });
  await kernel.start();

  // All plugins are loaded (in dependency order) before any is enabled,
  // so setup() can see the whole plugin set.
  // Modules are imported for every plugin first, then each plugin's
  // setup() + onEnable() run in dependency order (beta before alpha).
  assert.deepEqual(globalThis.__order, ['beta', 'beta:enabled', 'alpha', 'alpha:enabled']);
  assert.deepEqual(kernel.list().map((p) => p.id), ['alpha', 'beta']);
  assert.equal(kernel.stats().enabled, 2);
  await kernel.stop();
  delete globalThis.__order;
});

test('missing hard dependency fails the boot with an actionable message', async () => {
  const root = await tmpProject(
    pluginFiles('needy', { dependencies: { ghost: '^2.0.0' } }, SETUP_CODE('setup(api) {}')),
  );
  await assert.rejects(
    () => createKernel({ rootDir: root, dataDir: path.join(root, '.data'), loadConfigFile: false, continueOnError: false }).then((k) => k.start()),
    /requires missing plugin "ghost"/,
  );
});

test('version mismatch is reported', async () => {
  const root = await tmpProject({
    ...pluginFiles('a', { dependencies: { b: '^2.0.0' } }, SETUP_CODE('setup(api) {}')),
    ...pluginFiles('b', { version: '1.0.0' }, SETUP_CODE('setup(api) {}')),
  });
  await assert.rejects(
    () => createKernel({ rootDir: root, dataDir: path.join(root, '.data'), loadConfigFile: false, continueOnError: false }).then((k) => k.start()),
    /requires b@\^2\.0\.0 but found 1\.0\.0/,
  );
});

test('circular dependencies are rejected', async () => {
  const root = await tmpProject({
    ...pluginFiles('a', { dependencies: { b: '*' } }, SETUP_CODE('setup(api) {}')),
    ...pluginFiles('b', { dependencies: { a: '*' } }, SETUP_CODE('setup(api) {}')),
  });
  await assert.rejects(
    () => createKernel({ rootDir: root, dataDir: path.join(root, '.data'), loadConfigFile: false, continueOnError: false }).then((k) => k.start()),
    /circular plugin dependency/,
  );
});

test('optional missing dependency does not break boot', async () => {
  const root = await tmpProject(
    pluginFiles('opt', { optionalDependencies: { missing: '*' } }, SETUP_CODE('setup(api) {}')),
  );
  const kernel = await createKernel({ rootDir: root, dataDir: path.join(root, '.data'), loadConfigFile: false });
  await kernel.start();
  assert.equal(kernel.getPlugin('opt').state, 'enabled');
  await kernel.stop();
});

test('a broken plugin is isolated and the rest keep running', async () => {
  const root = await tmpProject({
    ...pluginFiles('broken', {}, `import { definePlugin } from '${path.resolve('src/index.js')}';
export default definePlugin({ setup() { throw new Error('setup exploded'); } });`),
    ...pluginFiles('healthy', {}, SETUP_CODE('setup(api) { api.command("healthy:pong", () => "pong"); }')),
  });

  const kernel = await createKernel({ rootDir: root, dataDir: path.join(root, '.data'), loadConfigFile: false });
  await kernel.start();

  assert.equal(kernel.getPlugin('broken').state, 'failed');
  assert.match(kernel.getPlugin('broken').error.message, /setup exploded/);
  assert.equal(kernel.getPlugin('healthy').state, 'enabled');
  assert.equal(await kernel.runCommand('healthy:pong'), 'pong');
  await kernel.stop();
});

test('disable detaches events, hooks, services and commands; enable restores them', async () => {
  const root = await tmpProject(
    pluginFiles('toggle', {}, SETUP_CODE(`
      setup(api) {
        api.provide('svc', { value: 42 });
        api.on('ping', () => 'pong');
        api.hook('pipe', async (v, next) => next(v + 1));
        api.command('toggle:hi', () => 'hi');
      }
    `)),
  );

  const kernel = await createKernel({ rootDir: root, dataDir: path.join(root, '.data'), loadConfigFile: false });
  await kernel.start();

  assert.equal(kernel.services.use('svc').value, 42);
  assert.equal(await kernel.runCommand('toggle:hi'), 'hi');
  assert.equal(await kernel.callHook('pipe', 1), 2);

  await kernel.disable('toggle');
  assert.equal(kernel.services.has('svc'), false);
  assert.equal(kernel.hooks.count('pipe'), 0);
  assert.equal(kernel.commandsList().length, 0);
  const { results } = await kernel.emit('ping');
  assert.deepEqual(results, []);

  await kernel.enable('toggle');
  assert.equal(kernel.services.use('svc').value, 42);
  assert.equal(await kernel.runCommand('toggle:hi'), 'hi');
  assert.equal(await kernel.callHook('pipe', 1), 2);
  assert.deepEqual((await kernel.emit('ping')).results, ['pong']);

  await kernel.stop();
  assert.equal(kernel.services.has('svc'), false);
});

test('lifecycle hooks fire in order and cleanup runs on unload', async () => {
  const calls = [];
  const root = await tmpProject(
    pluginFiles('life', {}, SETUP_CODE(`
      setup(api) {
        api.log.info('setup');
        api.dispose('resource', () => { globalThis.__life.push('cleanup'); });
      },
      async onEnable() { globalThis.__life.push('enable'); },
      async onDisable() { globalThis.__life.push('disable'); },
      async onUnload() { globalThis.__life.push('unload'); },
    `)),
  );
  globalThis.__life = [];
  const kernel = await createKernel({ rootDir: root, dataDir: path.join(root, '.data'), loadConfigFile: false, logLevel: 'silent' });
  await kernel.start();
  await kernel.disable('life');
  await kernel.enable('life');
  await kernel.stop();

  assert.deepEqual(globalThis.__life, ['enable', 'disable', 'enable', 'disable', 'unload', 'cleanup']);
  delete globalThis.__life;
});

test('config is layered: defaults < file < set(), and persists', async () => {
  const root = await tmpProject(
    pluginFiles('conf', { config: { port: 8080, nested: { a: 1 } } }, SETUP_CODE(`
      setup(api) {
        api.command('conf:get', (key) => api.config.get(key));
        api.command('conf:set', (key, value) => api.config.set(key, value));
      }
    `)),
  );
  await fs.mkdir(path.join(root, '.data/config'), { recursive: true });
  await fs.writeFile(path.join(root, '.data/config/conf.json'), JSON.stringify({ port: 9999 }));

  const kernel = await createKernel({ rootDir: root, dataDir: path.join(root, '.data'), loadConfigFile: false });
  await kernel.start();

  assert.equal(await kernel.runCommand('conf:get', 'port'), 9999);
  assert.equal(await kernel.runCommand('conf:get', 'nested.a'), 1);
  const pluginApi = kernel.getPlugin('conf').api;
  assert.equal(pluginApi.config.get('nested.b', 'fallback'), 'fallback');

  await kernel.runCommand('conf:set', 'port', 7777);
  await kernel.stop();

  const saved = JSON.parse(await fs.readFile(path.join(root, '.data/config/conf.json'), 'utf8'));
  assert.equal(saved.port, 7777);

  const again = await createKernel({ rootDir: root, dataDir: path.join(root, '.data'), loadConfigFile: false });
  await again.start();
  assert.equal(await again.runCommand('conf:get', 'port'), 7777);
  await again.stop();
});

test('store survives a disable/enable cycle and a kernel restart', async () => {
  const root = await tmpProject(
    pluginFiles('kv', {}, SETUP_CODE(`
      setup(api) {
        api.command('kv:bump', () => api.store.update('count', (n) => (n || 0) + 1));
        api.command('kv:get', () => api.store.get('count', 0));
      }
    `)),
  );

  const kernel = await createKernel({ rootDir: root, dataDir: path.join(root, '.data'), loadConfigFile: false });
  await kernel.start();
  await kernel.runCommand('kv:bump');
  await kernel.runCommand('kv:bump');
  assert.equal(await kernel.runCommand('kv:get'), 2);

  await kernel.disable('kv');
  await kernel.enable('kv');
  await kernel.stop();

  const again = await createKernel({ rootDir: root, dataDir: path.join(root, '.data'), loadConfigFile: false });
  await again.start();
  assert.equal(await again.runCommand('kv:get'), 2);
  await again.stop();
});

test('single-file plugins with inline metadata are discovered', async () => {
  const root = await tmpProject({
    'plugins/single.js': `import { definePlugin } from '${path.resolve('src/index.js')}';
export default definePlugin({
  id: 'single',
  version: '2.0.0',
  setup(api) { api.command('single:ping', () => 'pong'); },
});`,
  });
  const kernel = await createKernel({ rootDir: root, dataDir: path.join(root, '.data'), loadConfigFile: false });
  await kernel.start();
  assert.equal(kernel.getPlugin('single').manifest.version, '2.0.0');
  assert.equal(await kernel.runCommand('single:ping'), 'pong');
  await kernel.stop();
});

test('sandboxed plugin runs with a restricted context', async () => {
  const root = await tmpProject({
    'plugins/safe/plugin.json': { id: 'safe', version: '1.0.0', main: 'index.js', sandbox: true },
    'plugins/safe/index.js': `
module.exports = {
  setup(api) {
    api.command('safe:hi', () => 'hi from sandbox');
    api.on('safe:ping', () => 'pong');
    const p = require('path');
    api.command('safe:join', (a, b) => p.join(a, b));
  },
};`,
  });
  const kernel = await createKernel({ rootDir: root, dataDir: path.join(root, '.data'), loadConfigFile: false });
  await kernel.start();
  assert.equal(kernel.getPlugin('safe').state, 'enabled');
  assert.equal(await kernel.runCommand('safe:hi'), 'hi from sandbox');
  assert.equal(await kernel.runCommand('safe:join', 'a', 'b'), path.join('a', 'b'));
  await kernel.stop();
});

test('sandboxed plugin cannot require fs', async () => {
  const root = await tmpProject({
    'plugins/bad/plugin.json': { id: 'bad', version: '1.0.0', main: 'index.js', sandbox: true },
    'plugins/bad/index.js': `module.exports = { setup(api) { api.command('bad:read', () => require('fs').readFileSync('/etc/passwd', 'utf8')); } };`,
  });
  const kernel = await createKernel({ rootDir: root, dataDir: path.join(root, '.data'), loadConfigFile: false });
  await kernel.start();
  assert.equal(kernel.getPlugin('bad').state, 'enabled');
  await assert.rejects(() => kernel.runCommand('bad:read'), /not allowed/);
  await kernel.stop();
});

test('sandboxed plugin rejects ESM syntax at load time', async () => {
  const root = await tmpProject({
    'plugins/esm/plugin.json': { id: 'esm', version: '1.0.0', main: 'index.js', sandbox: true },
    'plugins/esm/index.js': `export default { setup(api) {} };`,
  });
  const kernel = await createKernel({ rootDir: root, dataDir: path.join(root, '.data'), loadConfigFile: false });
  await kernel.start();
  const record = kernel.getPlugin('esm');
  assert.equal(record.state, 'failed');
  assert.match(record.error.message, /must be CommonJS/);
  await kernel.stop();
});

test('reload re-imports the plugin code', async () => {
  const root = await tmpProject(
    pluginFiles('hot', {}, SETUP_CODE('setup(api) { api.command("hot:value", () => "v1"); }')),
  );
  const kernel = await createKernel({ rootDir: root, dataDir: path.join(root, '.data'), loadConfigFile: false });
  await kernel.start();
  assert.equal(await kernel.runCommand('hot:value'), 'v1');

  await fs.writeFile(
    path.join(root, 'plugins/hot/index.js'),
    SETUP_CODE('setup(api) { api.command("hot:value", () => "v2"); }'),
  );
  await kernel.reload('hot');
  assert.equal(await kernel.runCommand('hot:value'), 'v2');
  await kernel.stop();
});

test('commands from different plugins coexist and are listed', async () => {
  const root = await tmpProject({
    ...pluginFiles('one', {}, SETUP_CODE('setup(api) { api.command("a:1", () => 1, "first"); }')),
    ...pluginFiles('two', {}, SETUP_CODE('setup(api) { api.command("b:2", () => 2, "second"); }')),
  });
  const kernel = await createKernel({ rootDir: root, dataDir: path.join(root, '.data'), loadConfigFile: false });
  await kernel.start();
  const names = kernel.commandsList().map((c) => c.name).sort();
  assert.deepEqual(names, ['a:1', 'b:2']);
  assert.equal(await kernel.runCommand('a:1'), 1);
  assert.equal(await kernel.runCommand('b:2'), 2);
  await kernel.stop();
});

test('duplicate plugin ids keep the first and warn', async () => {
  const root = await tmpProject({
    ...pluginFiles('dup', {}, SETUP_CODE('setup(api) {}')),
    'plugins2/dup/plugin.json': { id: 'dup', version: '9.9.9', main: 'index.js' },
    'plugins2/dup/index.js': SETUP_CODE('setup(api) {}'),
  });
  const kernel = await createKernel({
    rootDir: root,
    pluginDirs: ['plugins', 'plugins2'],
    dataDir: path.join(root, '.data'),
    loadConfigFile: false,
    logLevel: 'silent',
  });
  await kernel.start();
  assert.equal(kernel.getPlugin('dup').manifest.version, '1.0.0');
  await kernel.stop();
});
