# Plugin authoring guide

This is the practical path from "I want a plugin" to "it is running". Ten
minutes, no prior knowledge of the framework.

---

## Step 0 — scaffold

```bash
node bin/uniplug.js init plugins/weather --template advanced
```

You get:

```
plugins/weather/
├── plugin.json     manifest
├── index.js        code
└── README.md       notes
```

Run it in isolation:

```bash
node bin/uniplug.js list --dir plugins
node bin/uniplug.js run weather:status
```

## Step 1 — decide what kind of thing you are building

| If your plugin… | register a… | API |
|---|---|---|
| reacts to something that happened | event listener | `api.on(name, fn)` |
| modifies a value the host is about to use | middleware | `api.hook(name, fn)` |
| offers capability to other plugins | service | `api.provide(name, value)` |
| needs a user-triggered action | command | `api.command(name, fn)` |
| needs to do work periodically | managed timer | `api.poll(ms, fn)` |
| needs to remember something | store | `api.store.*` |
| needs user settings | config | `api.config.*` |
| talks to the network / disk | permissions | `plugin.json` |

Most real plugins use three or four of these.

## Step 2 — write it

```js
import { definePlugin } from 'uniplug';

export default definePlugin({
  setup(api) {
    api.command('weather:now', async (city = 'Shanghai') => {
      const res = await api.fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=31.2&longitude=121.5&current=temperature_2m`,
      );
      if (!res.ok) throw new Error(`upstream returned ${res.status}`);
      const json = await res.json();
      const temp = json.current.temperature_2m;
      await api.store.set('lastCity', city);
      return `${city}: ${temp}°C`;
    });
  },
});
```

```json
{
  "id": "weather",
  "version": "1.0.0",
  "main": "index.js",
  "permissions": ["net", "storage"],
  "config": { "units": "metric" }
}
```

Notes:

- with `"permissions": ["net"]` unrestricted, or
  `[{ "name": "net", "allow": ["api.open-meteo.com"] }]` for a tighter scope.
- `setup` is synchronous registration; the network call happens when the
  command runs. Never do slow work in `setup`.

## Step 3 — hook into the host's pipeline

The host decides which hooks exist. A typical pipeline is declared once:

```js
// host
const response = await kernel.callHook('http:response', { status: 200, body, headers: {} });
```

```js
// plugin
api.hook('http:response', async (res, next) => {
  res.headers['x-powered-by'] = 'uniplug';
  res.body = redact(res.body);       // modify before the next handler
  const final = await next(res);
  api.log.debug('response finalized', final.status);
  return final;
});
```

Order is `priority` desc, then registration order. Wrap a step, don't just
replace it — that is what `next()` is for.

## Step 4 — cooperate with other plugins

```js
// provider
api.provide('cache', {
  get: (k) => store[k],
  set: (k, v) => { store[k] = v; },
});

// consumer (lazy, inside a handler)
const cache = api.tryUse('cache', null);
if (cache) return cache.get(key) ?? expensiveCompute();
```

Declare the dependency so ordering is guaranteed:

```json
"dependencies": { "cache": "^1.0.0" }
```

`optionalDependencies` + `tryUse` is the pattern for "works better together,
fine alone".

## Step 5 — survive disable/reload

Three rules:

1. Use `api.every` / `api.poll` / `api.after`, not global `setInterval`.
2. Put cleanup for anything you opened in `api.dispose('name', fn)`.
3. Flush state you care about in `onDisable`.

```js
setup(api) {
  const db = openDatabase();               // resource you own
  api.dispose('db', () => db.close());     // closed on disable & unload
  api.poll(60_000, () => db.vacuum());
}
```

Hot reload (`--hot`) unloads the old instance, so a leaked socket would be
reused forever. This is why `dispose` exists.

## Step 6 — configuration and state

```json
"config": { "threshold": 0.5, "channels": ["general"] }
```

```js
const threshold = api.config.get('threshold', 0.5);   // read
await api.config.set('threshold', 0.7);              // persist
```

Hosts and users can override without touching code:

- `.uniplug/config/my-plugin.json`
- `UNIPLUG_MY_PLUGIN__THRESHOLD=0.9`

Runtime state (cursors, counters, caches) belongs in `api.store`, not config.

## Step 7 — untrusted plugins

```json
{ "sandbox": true }
```

Then the entry must be CommonJS:

```js
module.exports = {
  setup(api) { api.command('x:y', () => 'ok'); },
};
```

`require()` inside is limited to pure builtins; `api.fs` / `api.fetch` still
work subject to permissions. Read `SECURITY.md` before relying on this for
real isolation.

## Step 8 — test it

Framework-free unit test of a plugin is awkward because `api` is provided by
the kernel. Two viable approaches:

```js
// 1) integration: boot a real kernel on a temp dir
import { createKernel } from 'uniplug';

const kernel = await createKernel({ pluginDirs: ['.'], dataDir: tmp });
await kernel.start();
assert.equal(await kernel.runCommand('weather:now'), '...');
```

```js
// 2) unit: hand-build a fake api
const events = new Map();
const api = {
  id: 'x', log: console,
  on: (n, f) => events.set(n, f),
  emit: async () => {},
  command: () => {},
  config: { get: (k, d) => d },
  store: { get: async (k, d) => d, set: async () => {} },
  hook: () => {},
  provide: () => {},
  use: () => ({}) ,
  dispose: () => {},
  every: () => () => {},
  after: () => () => {},
  poll: () => () => {},
};
plugin.setup(api);
```

Pattern 1 is what the bundled `test/kernel.test.js` does and is recommended.

## Anti-patterns

| Don't | Do |
|---|---|
| `setInterval` directly | `api.poll` |
| `require('fs')` and read `~/.ssh` | `api.fs` + `fs` permission |
| resolve services in `setup` | resolve lazily in handlers |
| assume a dependency's `onEnable` already ran | check `api.isEnabled(id)` |
| throw from a timer callback | let the scheduler log it |
| put mutable runtime state in config | `api.store` |
| register the same command name twice | namespace it: `myplugin:action` |

## Naming conventions

- Plugin id: lowercase, hyphenated (`http-cache`, `rate-limiter`).
- Events: `domain:action` past tense (`order:created`, `user:login`).
- Hooks: `domain:pipeline` (`http:request`, `render:markdown`).
- Commands: `<plugin-id>:<verb>` (`cache:clear`).
- Services: a noun (`cache`, `config-registry`, `i18n`).

Consistency here matters more than anything else in the framework: a newcomer
should be able to guess a name and find the right thing.
