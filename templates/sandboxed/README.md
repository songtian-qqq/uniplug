# __NAME__ (sandboxed template)

This plugin runs in a `node:vm` context.

Rules:

1. CommonJS only — `module.exports = { setup(api) {...} }`. ESM `export` throws.
2. `require()` is limited to pure builtins (`path`, `util`, `crypto`, `buffer`,
   `url`, `querystring`, `assert`, `events`, `string_decoder`, `os`).
   Use `api.fs` (needs `fs` permission) and `api.fetch` (needs `net` permission).
3. Globals are curated: no `global`, no `process.env` (use `api.getEnv`).

Sandboxing is a guardrail, not a security boundary — see `docs/SECURITY.md`.

```bash
node ../../bin/uniplug.js list --dir .
node ../../bin/uniplug.js run __ID__:hello
```
