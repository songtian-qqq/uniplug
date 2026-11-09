#!/usr/bin/env node
/**
 * uniplug CLI
 *
 *   uniplug init <dir> [--template basic|advanced|full] [--force]
 *   uniplug list [--json] [--dir <plugins>]
 *   uniplug commands [--dir <plugins>]
 *   uniplug run <command> [args...] [--dir <plugins>]
 *   uniplug doctor [--dir <plugins>]
 *   uniplug template [name]         # print a template to stdout
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createKernel } from '../src/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TEMPLATE_DIR = path.join(ROOT, 'templates');

const c = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};
const paint = (text, color) => (process.stdout.isTTY && !process.env.NO_COLOR ? `${color}${text}${c.reset}` : text);

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

function help() {
  console.log(`
${paint('uniplug', c.bold)} — universal JavaScript plugin system

Usage: uniplug <command> [options]

Commands
  init <dir>               Scaffold a new plugin (--template basic|advanced|full, --force)
  list                     Show discovered plugins, their state and dependencies (--json)
  commands                 List commands registered by plugins
  run <command> [args...]  Boot the kernel and invoke a plugin command
  doctor                   Validate manifests, dependencies and entry files
  template [name]          Print a template to stdout (basic|advanced|full)

Common options
  --dir <plugins>          Plugin directory (default: plugins, repeatable with --dir)
  --root <dir>             Project root (default: cwd)
  --quiet                  Only print errors

Examples
  npx uniplug init plugins/hello --template advanced
  npx uniplug list
  npx uniplug run hello:greet World
`);
}

async function cmdInit(positional, flags) {
  const target = positional[0];
  if (!target) {
    console.error('error: missing <dir>. Usage: uniplug init <dir> [--template basic|advanced|full]');
    return 1;
  }
  const template = String(flags.template || 'basic');
  const dir = path.resolve(process.cwd(), target);
  const srcDir = path.join(TEMPLATE_DIR, template);
  if (!fsSync.existsSync(srcDir)) {
    console.error(`error: unknown template "${template}". Available: ${(await fs.readdir(TEMPLATE_DIR)).join(', ')}`);
    return 1;
  }
  const id = path.basename(dir).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '');
  if (fsSync.existsSync(dir) && !flags.force) {
    console.error(`error: ${dir} already exists (use --force to overwrite)`);
    return 1;
  }
  await fs.mkdir(dir, { recursive: true });
  const relImport = path
    .relative(dir, path.join(ROOT, 'src', 'index.js'))
    .split(path.sep)
    .join('/');
  const importPath = relImport.startsWith('.') ? relImport : `./${relImport}`;
  await copyTemplate(srcDir, dir, { id, name: id, version: '1.0.0', importPath });
  console.log(`${paint('created', c.green)} ${path.relative(process.cwd(), dir) || '.'}`);
  console.log(`\nNext steps:`);
  console.log(`  ${paint('1.', c.dim)} edit ${path.join(target, 'index.js')}`);
  console.log(`  ${paint('2.', c.dim)} add it to your app and run ${paint(`uniplug list --dir ${path.dirname(target) || '.'}`, c.cyan)}`);
  return 0;
}

async function copyTemplate(srcDir, destDir, vars) {
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name.replace(/__id__/g, vars.id));
    if (entry.isDirectory()) {
      await fs.mkdir(dest, { recursive: true });
      await copyTemplate(src, dest, vars);
      continue;
    }
    let content = await fs.readFile(src, 'utf8');
    content = content
      .replace(/__ID__/g, vars.id)
      .replace(/__NAME__/g, vars.name)
      .replace(/__VERSION__/g, vars.version)
      .replace(/__IMPORT__/g, vars.importPath);
    await fs.writeFile(dest, content, 'utf8');
  }
}

function pluginDirs(flags) {
  const raw = flags.dir;
  const root = path.resolve(flags.root || process.cwd());
  if (!raw) return { root, dirs: null };
  const list = Array.isArray(raw) ? raw : [raw];
  return { root, dirs: list.map((d) => path.resolve(root, d)) };
}

async function bootKernel(flags) {
  const { root, dirs } = pluginDirs(flags);
  const options = {
    rootDir: root,
    dataDir: path.join(root, '.uniplug'),
    loadConfigFile: true,
    logLevel: flags.quiet ? 'error' : flags.verbose ? 'debug' : 'warn',
    continueOnError: true,
  };
  if (dirs) options.pluginDirs = dirs;
  const kernel = await createKernel(options);
  await kernel.start();
  return kernel;
}

async function cmdList(flags) {
  const kernel = await bootKernel({ ...flags, quiet: flags.json || flags.quiet });
  const describe = kernel.describe();
  if (flags.json) {
    console.log(JSON.stringify({ stats: kernel.stats(), plugins: describe }, null, 2));
  } else if (!describe.length) {
    console.log(paint('no plugins found', c.yellow));
    console.log(paint(`searched: ${kernel.options.pluginDirs.join(', ')}`, c.dim));
  } else {
    const rows = describe.map((p) => ({
      id: p.id,
      version: p.version,
      state: p.state,
      name: p.name,
    }));
    const width = Math.max(...rows.map((r) => r.id.length), 2);
    console.log(paint(`${'ID'.padEnd(width)}  VERSION  STATE     NAME`, c.dim));
    for (const r of rows) {
      const stateColor = r.state === 'enabled' ? c.green : r.state === 'failed' ? c.red : c.yellow;
      console.log(`${r.id.padEnd(width)}  ${r.version.padEnd(7)}  ${paint(r.state.padEnd(8), stateColor)}  ${r.name}`);
    }
    console.log(paint(`\n${rows.filter((r) => r.state === 'enabled').length}/${rows.length} enabled · data: ${kernel.options.dataDir}`, c.dim));
  }
  await kernel.stop();
  return describe.some((p) => p.error) ? 1 : 0;
}

async function cmdCommands(flags) {
  const kernel = await bootKernel(flags);
  const commands = kernel.commandsList();
  if (!commands.length) console.log(paint('no commands registered', c.yellow));
  for (const cmd of commands) {
    console.log(`${paint(cmd.name, c.bold)} ${paint(`(${cmd.owner})`, c.dim)}`);
    if (cmd.description) console.log(`  ${cmd.description}`);
  }
  await kernel.stop();
  return 0;
}

async function cmdRun(positional, flags) {
  const name = positional[0];
  if (!name) {
    console.error('error: missing <command>. Usage: uniplug run <command> [args...]');
    return 1;
  }
  const kernel = await bootKernel(flags);
  try {
    const result = await kernel.runCommand(name, ...positional.slice(1));
    if (result !== undefined) console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
    return 0;
  } catch (err) {
    console.error(paint(`error: ${err.message}`, c.red));
    return 1;
  } finally {
    await kernel.stop();
  }
}

async function cmdDoctor(flags) {
  const { root, dirs } = pluginDirs(flags);
  const options = {
    rootDir: root,
    dataDir: path.join(root, '.uniplug'),
    logLevel: 'silent',
    autoEnable: false,
    continueOnError: true,
  };
  if (dirs) options.pluginDirs = dirs;
  const kernel = await createKernel(options);
  const searchDirs = kernel.options.pluginDirs;
  console.log(paint(`checking ${searchDirs.join(', ')}`, c.dim));
  let problems = 0;
  for (const dir of searchDirs) {
    if (!fsSync.existsSync(dir)) {
      console.log(`${paint('warn', c.yellow)} plugin directory does not exist: ${dir}`);
      problems++;
    }
  }
  let manifests = [];
  try {
    manifests = await kernel.discover();
  } catch (err) {
    console.log(`${paint('error', c.red)} ${err.message}`);
    return 1;
  }
  for (const manifest of manifests) {
    const missing = [];
    if (!fsSync.existsSync(manifest.mainFile)) missing.push(`missing entry "${manifest.main}"`);
    if (missing.length) problems++;
    console.log(
      `${missing.length ? paint('fail', c.red) : paint('ok  ', c.green)} ${manifest.id}@${manifest.version}` +
        (missing.length ? ` ${paint(missing.join(', '), c.red)}` : '') +
        ` ${paint(manifest.dir, c.dim)}`,
    );
  }
  console.log(
    `\n${manifests.length} plugin(s) · ${problems ? paint(`${problems} problem(s)`, c.red) : paint('no problems found', c.green)}`,
  );
  return problems ? 1 : 0;
}

async function cmdTemplate(positional) {
  const name = positional[0] || 'basic';
  const file = path.join(TEMPLATE_DIR, name, 'index.js');
  if (!fsSync.existsSync(file)) {
    console.error(`error: unknown template "${name}". Available: ${(await fs.readdir(TEMPLATE_DIR)).join(', ')}`);
    return 1;
  }
  console.log(await fs.readFile(file, 'utf8'));
  return 0;
}

async function main() {
  const argv = process.argv.slice(2);
  const { flags, positional } = parseArgs(argv);
  const command = positional.shift();

  if (!command || command === 'help' || flags.help) {
    help();
    return 0;
  }

  switch (command) {
    case 'init':
    case 'create':
      return cmdInit(positional, flags);
    case 'list':
    case 'ls':
      return cmdList(flags);
    case 'commands':
      return cmdCommands(flags);
    case 'run':
      return cmdRun(positional, flags);
    case 'doctor':
    case 'check':
      return cmdDoctor(flags);
    case 'template':
      return cmdTemplate(positional);
    case 'version':
    case '--version':
      console.log(JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8')).version);
      return 0;
    default:
      console.error(`error: unknown command "${command}"`);
      help();
      return 1;
  }
}

const exitCode = await main();
process.exitCode = exitCode;
