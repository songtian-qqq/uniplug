# Contributing

Thanks for taking the time. This project is deliberately small and
dependency-free; keep it that way.

## Ground rules

1. **No runtime dependencies.** `node:*` builtins only. A dev-only tool is
   acceptable if it is optional, but the framework must run from a bare
   `git clone`.
2. **Every behaviour change comes with a test.** The suite is plain
   `node --test`, no framework.
3. **Public API stays backward compatible within a major version.** Add, don't
   repurpose. New options default to the old behaviour.
4. **Errors are part of the API.** Use the error classes in
   `src/core/errors.js` and write messages that say what to do next, e.g.
   `plugin "x" used api.fetch but did not declare the "net" permission in plugin.json`.

## Workflow

```bash
git clone <your fork>
cd uniplug
node --test                 # must be green
node examples/demo-app.js   # must boot and exit cleanly
node bin/uniplug.js doctor
```

## Where things live

| Change | File |
|---|---|
| new api member | `src/core/kernel.js` (`createApi`) + docs/API.md |
| lifecycle behaviour | `src/core/plugin.js` |
| discovery / ordering | `src/core/loader.js`, `src/core/semver.js` |
| events / hooks semantics | `src/core/events.js`, `src/core/hooks.js` |
| CLI command | `bin/uniplug.js` + `test/cli.test.js` |
| template | `templates/<name>/` |

## Style

- ESM, no build step, 2-space indent, single quotes, semicolons.
- JSDoc on exported functions; comments explain *why*, not *what*.
- Errors: throw, don't log-and-continue inside library code. The kernel decides
  how to isolate.
- Tests: one behaviour per `test()`, name the behaviour ("disable detaches
  events, hooks, services and commands"), assert on message patterns not
  whole stacks.

## Adding a template

1. `templates/<name>/plugin.json`, `index.js`, `README.md`.
2. Use `__ID__`, `__NAME__`, `__VERSION__` and `__IMPORT__` placeholders —
   `uniplug init` substitutes them (including the correct relative import path
   to this package).
3. Add a test in `test/cli.test.js` that scaffolds and asserts the key markers.

## Reporting bugs

Include: node version, the plugin manifest, the exact error with its `code`,
and the smallest reproduction (usually a 5-line plugin + a kernel boot).
