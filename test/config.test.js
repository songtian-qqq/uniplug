import test from 'node:test';
import assert from 'node:assert/strict';
import { ConfigStore } from '../src/core/config.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

async function tmpFile() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uniplug-config-'));
  return path.join(dir, 'config', 'test.json');
}

test('defaults are used when no file exists', async () => {
  const file = await tmpFile();
  const store = new ConfigStore({ pluginId: 'test', file, defaults: { a: 1, nested: { b: 2 } } });
  await store.load();
  assert.equal(store.get('a'), 1);
  assert.equal(store.get('nested.b'), 2);
  assert.equal(store.get('missing', 'fallback'), 'fallback');
});

test('file values deep-merge over defaults', async () => {
  const file = await tmpFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ nested: { c: 3 } }));
  const store = new ConfigStore({ pluginId: 'test', file, defaults: { nested: { b: 2 } } });
  await store.load();
  assert.deepEqual(store.get('nested'), { b: 2, c: 3 });
});

test('env overrides win over file values', async () => {
  const file = await tmpFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ port: 1 }));
  process.env.UNIPLUG_TEST__PORT = '4242';
  process.env.UNIPLUG_TEST__NESTED__DEEP = 'true';
  const store = new ConfigStore({ pluginId: 'test', file, defaults: {} });
  await store.load();
  assert.equal(store.get('port'), 4242);
  assert.equal(store.get('nested.deep'), true);
  delete process.env.UNIPLUG_TEST__PORT;
  delete process.env.UNIPLUG_TEST__NESTED__DEEP;
});

test('set persists and reset restores the default', async () => {
  const file = await tmpFile();
  const store = new ConfigStore({ pluginId: 'test', file, defaults: { level: 'info' } });
  await store.load();

  await store.set('level', 'debug');
  let onDisk = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(onDisk.level, 'debug');

  await store.reset('level');
  onDisk = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(onDisk.level, 'info');
});

test('nested keys are written as nested objects', async () => {
  const file = await tmpFile();
  const store = new ConfigStore({ pluginId: 'test', file, defaults: {} });
  await store.load();
  await store.set('server.port', 8080);
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), { server: { port: 8080 } });
});

test('a corrupt config file falls back to defaults with a warning', async () => {
  const file = await tmpFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, '{ not json');
  const warnings = [];
  const store = new ConfigStore({ pluginId: 'test', file, defaults: { ok: true }, warn: (m) => warnings.push(m) });
  await store.load();
  assert.equal(store.get('ok'), true);
  assert.equal(warnings.length, 1);
});
