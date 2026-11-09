# __NAME__

A plugin for [uniplug](../../README.md).

```bash
node ../../bin/uniplug.js list --dir .
node ../../bin/uniplug.js run __ID__:hello
```

## What it does

- registers the `__ID__:hello` command
- listens for the `__ID__:ping` event
- reads `enabledMessage` from configuration

## Extend it

- add services with `api.provide('name', value)`
- add middleware with `api.hook('some:pipeline', async (value, next) => {...})`
- persist data with `api.store.set(key, value)`
- schedule work with `api.poll(ms, fn)` / `api.every(ms, fn)`
