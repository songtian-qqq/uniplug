# Security model

Read this before loading plugins you did not write.

## What uniplug does protect against

1. **Accidental over-reach.** A plugin must declare `net`, `fs`, `env` or
   `process` in its manifest. `api.fetch`, `api.fs`, `api.getEnv` and
   `api.process.exit` throw `PermissionError` otherwise — with the manifest
   line to add. This is the "a greeting plugin should not read `~/.ssh`" layer.
2. **Path escape.** `api.fs` resolves every path inside
   `.uniplug/plugins/<id>/files`; `..` segments and absolute paths outside the
   root throw.
3. **Protocol/host restriction.** `api.fetch` only allows `http(s)` and, when
   an allow-list is declared, only the listed hosts (`*.example.com` matches
   subdomains).
4. **Accidental global damage (sandbox mode).** `"sandbox": true` evaluates the
   entry in a fresh `vm` context with:
   - no host globals (`global`, real `process`, `fetch`, `Buffer` is a copy)
   - `require()` limited to pure builtins
   - `codeGeneration: { strings: false, wasm: false }` (no `eval`, no `new Function`)
   - errors confined to the plugin
5. **Isolation of failure.** A plugin throwing in `setup`, a listener or a timer
   is reported and, with `continueOnError`, does not stop the kernel or other
   plugins.

## What uniplug does NOT protect against

- **`node:vm` is not a security boundary.** Multiple documented escapes exist
  (prototype-chain walks, host-object getters, timing attacks). Treat sandbox
  mode as protection against bugs, not against attackers.
- **Hostile code in the same process.** A non-sandboxed plugin gets the full
  `api.kernel`, and can import anything via normal ESM `import`. It can read
  the filesystem, spawn processes, and mutate the host.
- **Resource exhaustion.** A plugin can allocate memory or spin the CPU.
  Managed timers prevent leaked intervals, not a busy `while (true)`.
- **Supply chain.** Plugins are ordinary code from wherever you got them.

## Recommended posture by trust level

| Trust | Configuration |
|---|---|
| You wrote it / first-party | normal plugins, permissions still declared (catches accidents) |
| Reviewed third-party | normal plugins + pinned versions + `net`/`fs` allow-lists |
| Unreviewed third-party | `"sandbox": true` + minimal permissions, and accept residual risk |
| Genuinely hostile | do not load in-process. Run each plugin in its own OS process/container and expose only an RPC surface |

The last row is the honest answer: process isolation is the only real boundary.
uniplug keeps the api small enough that an RPC adapter is straightforward —
`api` is a plain frozen object of functions, so it can be proxied over a
worker/child-process message channel.

## Operational checklist

- Pin plugin versions (`dependencies` with `^` is convenient, `=1.2.3` is safe).
- Keep `dataDir` writable by the host only; `api.fs` is rooted there.
- Never put secrets in `manifest.config` — it is committed to disk in plain
  JSON and readable by the host.
  Prefer `api.getEnv` with the `env` permission.
- Review `permissions` diffs like you review code diffs.
- Set `LOG_LEVEL=debug` when investigating what a plugin registered.
