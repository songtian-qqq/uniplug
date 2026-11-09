# uniplug

A universal, **zero-dependency** plugin system for JavaScript. Drop a folder in,
get a plugin: lifecycle, events, middleware hooks, services, config, storage,
timers, permissions, hot reload and a scaffolding CLI — all in one small
framework. No one has to start from zero again.

```
Node.js >= 18 · ESM + CommonJS · no runtime dependencies
```

## Why

Every project that grows plugins re-implements the same eight things badly:

| Problem | uniplug answer |
|---|---|
| Where do plugins live? | `plugin.json` manifests, directory or single-file discovery |
| What order do they load? | dependency graph with semver ranges, cycle detection |
| How do they talk? | event bus (priority, wildcard, cancellable) + typed services |
| How do they extend the host? | onion middleware hooks (`value, next`) |
| Where does state go? | per-plugin config + JSON store, sandboxed `api.fs` |
| Leaking timers/listeners on disable | ownership tracking: disable detaches everything, silently |
| Trust | declared permissions (`net`/`fs`/`env`/`process`) + optional `vm` sandbox |
| Iteration speed | `--hot` reload, `uniplug init`, `uniplug doctor` |

## 30-second start

```bash
git clone https://github.com/songtian-qqq/uniplug.git
cd uniplug
node bin/uniplug.js init plugins/my-plugin --template advanced
node bin/uniplug.js list
node bin/uniplug.js run my-plugin:status
node examples/demo-app.js
npm test
```

Host application, complete:

```js
import { createKernel } from 'uniplug';

const kernel = await createKernel({ pluginDirs: ['plugins'] });
await kernel.start();

await kernel.emit('demo:message', { text: 'hi' });          // fire an event
const out = await kernel.callHook('demo:transform', value); // run middleware
await kernel.runCommand('hello:greet', 'World');            // invoke a plugin command

await kernel.stop();
```

A plugin, complete:

```js
// plugins/hello/index.js
import { definePlugin } from 'uniplug';

export default definePlugin({
  setup(api) {
    api.command('hello:greet', (name = 'world') => `Hello, ${name}!`);

    api.on('demo:message', ({ text }) => api.log.info('heard:', text));

    api.hook('demo:transform', async (value, next) => {
      value.text = value.text.toUpperCase();
      return next(value);
    });

    api.provide('greeter', { greet: (n) => `Hey ${n}` });

    api.poll(10_000, async () => api.store.update('ticks', (n) => (n ?? 0) + 1));
  },

  async onEnable(api) { api.log.info('enabled'); },
  async onDisable(api) { await api.store.flush(); },
});
```

```json
// plugins/hello/plugin.json
{
  "id": "hello",
  "version": "1.0.0",
  "description": "Minimal example",
  "main": "index.js",
  "dependencies": { "logger-core": "^1.2.0" },
  "permissions": ["storage"],
  "config": { "greeting": "Hello" }
}
```

## Architecture

```
             ┌──────────────────────────────────────────┐
host app ───▶│ Kernel                                   │
             │  ├─ Loader      discovery + semver deps  │
             │  ├─ Plugin      state machine per plugin │
             │  ├─ EventBus    priority / wildcard      │
             │  ├─ HookBus     onion middleware         │
             │  ├─ Services    cross-plugin injection   │
             │  ├─ Config/Store/Fs   per-plugin state   │
             │  └─ Scheduler   auto-cleared timers      │
             └───────────────┬──────────────────────────┘
                             │  api (frozen, per plugin)
                             ▼
                    plugins/*  (your code)
```

Plugin state machine:

```
discovered → loaded → enabled ⇄ disabled → unloaded
                        │
                        └──→ failed (isolated, kernel keeps running)
```

A disabled plugin keeps its registrations but none of them fire: events, hooks,
services and commands are toggled through ownership tracking, so
disable/enable is O(1) and loses nothing. Unload removes them permanently and
runs every cleanup function in reverse order.

## Core concepts

### 1. Manifest

`plugin.json`, or inline in a single-file plugin:

| field | type | notes |
|---|---|---|
| `id` | string | required, `^[a-z0-9][a-z0-9._-]*$` |
| `version` | string | required, semver |
| `main` | string | default `index.js` |
| `dependencies` | object | `{ "id": "^1.2.0" }`, hard requirement |
| `optionalDependencies` | object | missing/unmet → skipped, not fatal |
| `loadAfter` / `loadBefore` | string[] | ordering hints beyond dependency edges |
| `config` | object | default configuration |
| `permissions` | array | `"storage"`, `"fs"`, `"net"`, `"env"`, `"process"`, or `{ "name": "net", "allow": ["api.github.com", "*.internal.dev"] }` |
| `sandbox` | boolean | run entry in a `vm` context (CommonJS only) |

Single-file plugin: any `*.js` / `*.plugin.js` in a plugin directory whose
default export carries `id` + `setup`.

### 2. Events — notifications

```js
api.on('order:created', handler, { priority: 10 });  // higher runs first
api.once('ready', handler);
api.on('billing:*', handler);   // prefix wildcard
api.on('*', (payload, meta) => ...); // meta.name tells you which event
api.emit('order:created', { id: 7 });
```

A handler returning `false` **cancels** the remaining handlers:

```js
const { cancelled } = await kernel.emit('user:login', user);
if (cancelled) throw new Error('login rejected');
```

### 3. Hooks — middleware

```js
api.hook('http:request', async (req, next) => {
  req.headers['x-plugin'] = api.id;
  const res = await next();        // continue the chain
  res.timing = Date.now() - req.start;
  return res;                      // hand back the final value
});
```

`return undefined` without calling `next()` = pass the value through.
Returning anything else = short-circuit with that value.

### 4. Services — cross-plugin injection

```js
api.provide('cache', { get, set });        // errors if the name is taken
const cache = api.use('cache');            // throws a helpful error if missing
const cache = api.tryUse('cache', null);   // never throws
```

Resolve services **lazily** (inside a handler), not at `setup` time — the
provider may load later.

### 5. Config, store, filesystem

```js
api.config.get('port', 8080);
await api.config.set('port', 9090);        // persists to .uniplug/config/<id>.json

await api.store.set('cursor', 42);
await api.store.update('runs', (n) => (n ?? 0) + 1);
await api.store.keys();

await api.fs.writeJSON('cache/state.json', { ok: true });  // needs "fs"
```

`api.fs` is rooted at `.uniplug/plugins/<id>/files`; `..` escapes throw.

Config precedence: `plugin.json` defaults < `config/<id>.json` < env
`UNIPLUG_<ID>__<PATH>` (e.g. `UNIPLUG_MY_PLUGIN__SERVER__PORT=8080`).

### 6. Timers that clean themselves up

```js
api.every(1000, tick);     // setInterval, cleared on disable
api.after(5000, once);     // setTimeout
api.poll(3000, fetchWork); // repeat after completion (no overlap, no drift)
```

Direct `setInterval` inside a plugin is the #1 leak source — this is why the
framework hands you managed ones.

### 7. Commands

```js
api.command('cache:clear', () => api.store.clear(), 'Wipe the cache');
```

```bash
uniplug commands
uniplug run cache:clear
```

### 8. Permissions

```json
"permissions": ["storage", { "name": "net", "allow": ["api.github.com", "*.internal.dev"] }]
```

```js
await api.fetch('https://api.github.com/repos/x/y');  // denied unless "net"
```

Undeclared capability → `PermissionError` with the exact fix in the message. This
stops accidental over-reach (a "greeting" plugin should not be able to read `~/.ssh`).
It is **not** a security boundary against hostile code — see [docs/SECURITY.md](docs/SECURITY.md).

## CLI

```
uniplug init <dir> [--template basic|advanced|sandboxed] [--force]
uniplug list [--json] [--dir plugins]
uniplug commands [--dir plugins]
uniplug run <command> [args...]
uniplug doctor            # validate manifests, deps, entry files
uniplug template basic    # print a template to stdout
```

Useful flags: `--root <dir>`, `--dir <plugins>` (repeatable), `--quiet`, `--verbose`.

## Host API cheat sheet

```js
kernel.start() / stop()
kernel.emit(name, payload)            // → { cancelled, results }
kernel.on(name, fn, opts)
kernel.callHook(name, value, meta)
kernel.addHook(name, fn, opts)
kernel.use(serviceName)
kernel.enable(id) / disable(id) / reload(id)
kernel.runCommand(name, ...args)
kernel.stats() / describe() / list()
kernel.registerCommand(name, fn, { owner, description })
kernel.createApi(plugin)
```

See [docs/API.md](docs/API.md) for the full reference and [docs/PLUGIN-AUTHORING.md](docs/PLUGIN-AUTHORING.md)
for a guided walkthrough.

## Project layout

```
src/core/kernel.js      lifecycle, buses wiring, api factory
src/core/plugin.js      per-plugin state machine
src/core/loader.js      discovery, import, dependency ordering
src/core/manifest.js    validation
src/core/events.js      event bus
src/core/hooks.js       middleware pipeline
src/core/services.js    service container
src/core/config.js      layered config
src/core/store.js       persistent kv
src/core/storage.js     sandboxed fs
src/core/scheduler.js   managed timers
src/core/permissions.js capability checks
src/core/sandbox.js     vm isolation
src/core/semver.js      ranges
bin/uniplug.js          CLI
templates/              basic · advanced · sandboxed
examples/               5 plugins + demo app
test/                   node:test suites
docs/                   API · authoring · architecture · security
```

## Testing

```bash
npm test           # node --test, zero dependencies
```

The suite covers event ordering/cancellation/wildcards, middleware short-circuit
and ordering, semver ranges, dependency resolution and cycles, full kernel
lifecycle, enable/disable/registry toggling, config layering, storage
persistence, permission denial, sandbox behavior and CLI scaffolding.

## Documentation

| Doc | Contents |
|---|---|
| [docs/API.md](docs/API.md) | every api member, option and framework event |
| [docs/PLUGIN-AUTHORING.md](docs/PLUGIN-AUTHORING.md) | guided walk-through for plugin authors |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | design decisions and extension seams |
| [docs/COOKBOOK.md](docs/COOKBOOK.md) | 12 copy-paste recipes (wrapping a web app, TTL cache, cancellation, debugging) |
| [docs/SECURITY.md](docs/SECURITY.md) | what permissions and the sandbox do and do not protect |
| [README.zh-CN.md](README.zh-CN.md) | 中文速览 |

## License

MIT
