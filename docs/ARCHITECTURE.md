# Architecture notes

Why the framework is shaped the way it is, and where the seams are.

---

## 1. One object, many factories

`Kernel` owns four independent buses plus a plugin registry. They are
deliberately separate because they answer different questions:

| bus | question | ordering |
|---|---|---|
| events | "did something happen?" | priority, cancellable |
| hooks | "what should the value become?" | onion middleware |
| services | "who can do X for me?" | lazy lookup |
| commands | "what can a user trigger?" | flat namespace |

Collapsing them into one "plugin hook" system is the usual shortcut, and it
breaks as soon as you need a value back (hooks) or a provider (services).

## 2. Declarations vs effects

`setup()` is called exactly once. Everything it registers is a declaration and
lives in the buses tagged with the plugin id. Enabling/disabling calls
`activation` on those tags instead of re-running `setup`, which means:

- disable → enable is instant and deterministic
- no duplicate registrations after a reload
- services and commands disappear/appear atomically

The alternative (re-running `setup` on every enable) duplicates listeners on
the second enable — the single most common bug in hand-rolled plugin systems.

## 3. Dependency resolution

Discovery is a two-pass process:

1. scan directories → build manifests (validating id/version/permissions)
2. build a DAG from `dependencies` + `optionalDependencies` + `loadAfter` /
   `loadBefore`, then Kahn topo-sort with id-stable tie-breaking

Semver is intentionally minimal (`^`, `~`, comparators, `||`, partials). A plugin
system does not need npm's full range grammar; it needs predictable behaviour
and a helpful error. Missing or unsatisfied hard dependencies abort the boot
with an actionable message listing available ids; `optionalDependencies` simply
do not create an edge when absent.

Cycles are rejected rather than silently broken — a cyclic plugin graph means
the authoring model is wrong, and hiding that produces nondeterministic boot
order.

## 4. Error isolation

`continueOnError: true` (default) keeps a failing plugin from taking down the
kernel:

- manifest/entry errors → plugin marked `failed`, `plugin:error` emitted
- `setup` throws → same
- a listener throws → the emitter reports to the `error` event and continues
- a timer throws → scheduler logs it; the timer keeps running

The one place errors propagate is an explicit `kernel.callHook` from the host:
a middleware chain is part of the host's control flow, so swallowing errors
there would hide data loss.

## 5. Hot reload

`fs.watch(dir, { recursive: true })` with a debounce, mapping the changed file
to a plugin id. Reload = unload → re-read manifest → re-import → enable.

Because ESM modules are cached by URL, re-import needs a cache-busting query
(`?v=<mtime>`); the loader does this for directory plugins. Long-lived
resources must be closed in `dispose` or they survive the reload, which is the
main reason the api hands out managed timers and a `dispose` hook.

## 6. No dependencies, on purpose

A plugin framework sits at the bottom of a dependency tree. Anything it pulls
in becomes everybody's problem: version conflicts, supply-chain surface,
install friction in air-gapped environments. `uniplug` uses only `node:*`
builtins, so it is one `git clone` away from working and can be vendored into
any project.

## 7. What is deliberately not here

| Not included | Why |
|---|---|
| Process/worker isolation | changes the api to async RPC; provide it as an adapter instead |
| Plugin marketplace / registry | orthogonal to the runtime; publish plugins as npm packages or git repos |
| DI decorators / TS-only metadata | runtime-only framework; ESM + JSDoc keeps it usable everywhere |
| ORM / schema validation | config is JSON by design; validate inside your plugin |
| UI | the framework is UI-agnostic; commands + events are the integration points |

## Extension seams

- `kernel.createApi(plugin)` — add host capabilities to every plugin
- `new Logger({ sink })` — route logs to your own pipeline
- `kernel.registerCommand(name, fn, { owner })` — expose host functions to the CLI
- `importPluginModule(manifest, ctx)` — swap the loader (e.g. TypeScript via a register hook)
- custom buses can be added the same way `hooks` was: owner-tagged + `setOwnerActive`
