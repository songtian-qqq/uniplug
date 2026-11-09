# uniplug API reference

Everything a plugin can touch hangs off the frozen `api` object passed to
`setup(api)` / `onEnable(api)` / `onDisable(api)` / `onUnload(api)`.

---

## Identity & introspection

| member | type | description |
|---|---|---|
| `api.id` | `string` | manifest id |
| `api.name` | `string` | display name |
| `api.version` | `string` | manifest version |
| `api.manifest` | `object` | normalized manifest |
| `api.kernel` | `Kernel` | escape hatch to the host kernel |
| `api.dataDir` | `string` | `.uniplug/plugins/<id>` |
| `api.pluginDir` | `string` | directory the plugin was loaded from |
| `api.dataDir` | `string` | `.uniplug/plugins/<id>` |
| `api.plugins()` | `() => {id, version, state}[]` | all loaded plugins |
| `api.getPlugin(id)` | `(id) => api \| null` | another plugin's api |
| `api.isEnabled(id)` | `(id) => boolean` | dependency probe |

## Logging

```js
api.log.debug|info|warn|error(...args)
```

Scoped: every line is prefixed `[uniplug:<plugin-id>]`.

## Events

```js
api.on(name, handler, { priority = 0 } = {})   // → unsubscribe()
api.once(name, handler, opts)
api.off(name, handler)
await api.emit(name, payload)                   // → { cancelled, results, payload }
```

Patterns: exact name, `'ns:*'` prefix, `'*'` everything. Handler signature
`(payload, meta)`; `meta = { name, owner }`. Returning `false` cancels the
remaining handlers.

## Hooks (middleware)

```js
api.hook(name, async (value, next, meta) => { ... }, { priority = 0 })
await api.callHook(name, value, meta)   // → final value
api.hookCount(name)                     // → active interceptor count
```

Onion semantics:

- higher `priority` runs earlier
- `await next(optionalNewValue)` continues the chain and returns its result
- returning a value ends the chain with that value
- returning `undefined` without calling `next()` passes the value through

## Services

```js
api.provide(name, value, { overwrite = false })
api.use(name)                 // throws with a list of available services
api.tryUse(name, fallback)
api.hasService(name)
api.serviceNames()
```

Services are removed from the container when the providing plugin is disabled
and restored when it is re-enabled. Always resolve lazily.

## Commands

```js
api.command(name, fn, description = '')
await api.runCommand(name, ...args)
```

The CLI exposes them as `uniplug run <name> [args...]`. A handler can be async;
its resolved value is printed.

## Configuration

```js
api.config.get('key', fallback)
api.config.get('nested.key')
api.config.get()                 // full deep clone
api.config.has('key')
await api.config.set('key', value)
await api.config.merge({ a: 1 })
await api.config.reset('key')    // reset one key, or all when omitted
```

Priority: manifest `config` < `config/<id>.json` < `UNIPLUG_<ID>__<PATH>` env vars.

## Storage

```js
await api.store.get(key, fallback)
await api.store.has(key)
await api.store.set(key, value)
await api.store.update(key, (current) => nextValue, fallback)
await api.store.delete(key)
await api.store.keys()
await api.store.all()
await api.store.clear()
await api.store.flush()
```

Backed by `.uniplug/plugins/<id>/store.json`, flushed on unload.

## Sandboxed filesystem (`fs` permission)

```js
const p = api.fs.resolve('data/x.txt')       // absolute, validated
await api.fs.read('data/x.txt', 'utf8')
await api.fs.readJSON('data/x.json', {})
await api.fs.write('data/x.txt', 'text')
await api.fs.writeJSON('data/x.json', obj)
await api.fs.append('logs/a.log', 'line\n')
await api.fs.exists('data/x.txt')
await api.fs.list('data')
await api.fs.mkdir('data/nested')
await api.fs.remove('data')
await api.fs.stat('data/x.txt')
```

Root: `.uniplug/plugins/<id>/files`. `..` escapes throw `PermissionError`.

## Timers

```js
const stop = api.every(ms, fn, { immediate })   // setInterval
const stop = api.after(ms, fn)                  // setTimeout
const stop = api.poll(ms, fn)                   // repeat after each completion
```

All cleared automatically on disable / unload / reload. Errors inside callbacks
are caught and logged, never thrown into the host.

## Gated capabilities

```js
await api.fetch(url, init)      // "net" permission, http(s) only, host allow-list
api.getEnv(key, fallback)       // "env" permission
api.env()                       // allow-listed subset (or all, if unrestricted)
api.process.platform / arch / version
api.process.cwd()
api.process.exit(code)          // "process" permission
api.process.on('SIGINT', fn)    // auto-removed on unload
```

## Cleanup

```js
api.dispose(name, async () => { ... })
```

Runs on disable (for timer-like resources) and unload, in reverse registration
order, errors isolated. Registrations made through `api.on`, `api.hook`,
`api.provide` and `api.command` are disposed of automatically — `dispose` is
for anything else you opened (sockets, DB handles, child processes).

## Lifecycle contract

| export | when | async |
|---|---|---|
| `setup(api)` | once, right after import | yes |
| `onEnable(api)` | each time the plugin is enabled | yes |
| `onDisable(api)` | each time it is disabled | yes |
| `onUnload(api)` | once, before removal | yes |

`install(api)` is accepted as an alias of `setup`.

Rules that keep the system sane:

1. `setup` declares; `onEnable` performs side effects; `onDisable` reverses them.
2. Never resolve a service inside `setup` — the provider may not exist yet.
3. Await async work in `onDisable`; it is awaited before the api is torn down.
4. Exceptions in `setup` mark the plugin `failed` without taking down the kernel
   (when `continueOnError: true`, the default).

## Kernel API

```js
await kernel.start()                     // discover → load → enable
await kernel.stop()
await kernel.emit(name, payload)
kernel.on(name, fn, opts)
await kernel.callHook(name, value, meta)
kernel.addHook(name, fn, opts)
kernel.use(name)
await kernel.enable(id) / disable(id)
await kernel.reload(id)                  // re-read manifest + re-import
kernel.require(id) / getPlugin(id)
kernel.list() / activePlugins() / describe() / stats()
kernel.registerCommand(name, fn, { owner, description })
await kernel.runCommand(name, ...args)
kernel.commandsList()
kernel.watch() / unwatch()               // hot reload
kernel.activateOwner(owner, active)
kernel.createApi(plugin)
```

## Events emitted by the framework

| event | payload |
|---|---|
| `kernel:starting` | `{ options }` |
| `kernel:ready` | `{ plugins }` |
| `kernel:stopping` / `kernel:stopped` | `{}` |
| `plugin:loaded` | `{ id, plugin }` |
| `plugin:enabled` / `plugin:disabled` | `{ id, plugin }` |
| `plugin:unloaded` | `{ id, plugin }` |
| `plugin:reload` | `{ id }` |
| `plugin:error` | `{ id, error, phase }` |
| `error` | `{ error, event, owner }` |

## Options

| option | default | description |
|---|---|---|
| `rootDir` | `cwd` | base for relative paths |
| `pluginDirs` | `['plugins']` | directories to scan |
| `dataDir` | `.uniplug` | config / store / plugin files |
| `logLevel` | `$LOG_LEVEL` or `info` | `debug\|info\|warn\|error\|silent` |
| `autoEnable` | `true` | enable after load |
| `continueOnError` | `true` | isolate failing plugins |
| `hotReload` | `false` | watch plugin dirs |
| `hotReloadInterval` | `300` | debounce ms |
| `configFile` | `uniplug.config.mjs` | host config module |
| `logger` | built-in | pass your own `Logger` |
