import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin/uniplug.js');

async function tmp() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'uniplug-cli-'));
}

test('init scaffolds a working basic plugin', async () => {
  const dir = await tmp();
  const target = path.join(dir, 'plugins', 'demo');
  const { stdout } = await run(process.execPath, [CLI, 'init', target, '--template', 'basic']);
  assert.match(stdout, /created/);

  const manifest = JSON.parse(await fs.readFile(path.join(target, 'plugin.json'), 'utf8'));
  assert.equal(manifest.id, 'demo');
  assert.equal(manifest.version, '1.0.0');

  const code = await fs.readFile(path.join(target, 'index.js'), 'utf8');
  assert.match(code, /demo:hello/);
  assert.equal(await fs.stat(path.join(target, 'README.md')).then(() => true), true);
});

test('init with the advanced template scaffolds every feature', async () => {
  const dir = await tmp();
  const target = path.join(dir, 'plugins', 'advanced-demo');
  await run(process.execPath, [CLI, 'init', target, '--template', 'advanced']);
  const code = await fs.readFile(path.join(target, 'index.js'), 'utf8');
  for (const marker of ['api.provide', 'api.on', 'api.hook', 'api.command', 'api.store', 'api.poll']) {
    assert.match(code, new RegExp(marker.replace('.', '\\.')));
  }
});

test('init refuses to overwrite without --force', async () => {
  const dir = await tmp();
  const target = path.join(dir, 'plugins', 'twice');
  await run(process.execPath, [CLI, 'init', target]);
  await assert.rejects(() => run(process.execPath, [CLI, 'init', target]), /already exists/);
  await run(process.execPath, [CLI, 'init', target, '--force']);
});

test('list reports plugins and their state', async () => {
  const dir = await tmp();
  const target = path.join(dir, 'plugins', 'listed');
  await run(process.execPath, [CLI, 'init', target]);
  const { stdout } = await run(process.execPath, [CLI, 'list', '--dir', path.join(dir, 'plugins'), '--root', dir]);
  assert.match(stdout, /listed/);
  assert.match(stdout, /enabled/);
});

test('list --json emits machine-readable output', async () => {
  const dir = await tmp();
  const target = path.join(dir, 'plugins', 'json');
  await run(process.execPath, [CLI, 'init', target]);
  const { stdout } = await run(process.execPath, [CLI, 'list', '--json', '--dir', path.join(dir, 'plugins'), '--root', dir]);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.plugins[0].id, 'json');
  assert.equal(parsed.stats.plugins, 1);
});

test('run executes a plugin command', async () => {
  const dir = await tmp();
  const target = path.join(dir, 'plugins', 'runner');
  await run(process.execPath, [CLI, 'init', target]);
  const { stdout } = await run(process.execPath, [
    CLI,
    'run',
    'runner:hello',
    'Codex',
    '--dir',
    path.join(dir, 'plugins'),
    '--root',
    dir,
  ]);
  assert.match(stdout, /hello Codex/);
});

test('doctor validates entry files and exits non-zero on problems', async () => {
  const dir = await tmp();
  const target = path.join(dir, 'plugins', 'sick');
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(
    path.join(target, 'plugin.json'),
    JSON.stringify({ id: 'sick', version: '1.0.0', main: 'missing.js' }),
  );
  await assert.rejects(
    () => run(process.execPath, [CLI, 'doctor', '--dir', path.join(dir, 'plugins'), '--root', dir]),
    (err) => {
      assert.match(err.stdout, /missing entry/);
      return true;
    },
  );
});

test('commands lists registered commands', async () => {
  const dir = await tmp();
  await run(process.execPath, [CLI, 'init', path.join(dir, 'plugins', 'cmds')]);
  const { stdout } = await run(process.execPath, [CLI, 'commands', '--dir', path.join(dir, 'plugins'), '--root', dir]);
  assert.match(stdout, /cmds:hello/);
});
