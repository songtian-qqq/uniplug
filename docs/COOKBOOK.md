# Cookbook

Copy-paste recipes for the situations that come up in almost every plugin system.

---

## 1. Add a plugin system to an existing app

```js
import { createKernel } from 'uniplug';
import express from 'express';

const app = express();
const kernel = await createKernel({ pluginDirs: ['plugins', 'node_modules/@myorg/plugin-*'] });

// Expose the buses to plugins through a stable contract:
app.use(async (req, res, next) => {
  const ctx = { req, res, start: Date.now() };

  // 1) let plugins veto the request
  const { cancelled } = await kernel.emit('http:request', ctx);
  if (cancelled) return res.status(403).end();

  // 2) let plugins wrap the response
  await kernel.callHook('http:response', ctx);
  next();
});

await kernel.start();
```

A plugin then does:

```js
api.on('http:request', ({ req }) => {
  if (req.path.startsWith('/admin') && !req.user?.isAdmin) return false; // veto
});

api.hook('http:response', async (ctx, next) => {
  ctx.res.setHeader('x-plugin', api.id);
  return next(ctx);
});
```

## 2. Make long work cancellable

`emit` returns `{ cancelled }`; handlers run in priority order, so put the
guard first:

```js
api.on('job:before-run', (job) => {
  if (job.cost > budget) return false;
}, { priority: 100 });
```

## 3. Rate-limit a capability others use

Wrap a service instead of monkey-patching:

```js
api.provide('mailer', {
  send: rateLimited(async (msg) => transport.send(msg), { perMinute: 20 }),
});
```

## 4. Cache with TTL, shared across plugins

```js
const memory = new Map();

api.provide('cache', {
  get(key) {
    const hit = memory.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    memory.delete(key);
    return undefined;
  },
  set(key, value, ttlMs = 60_000) {
    memory.set(key, { value, expires: Date.now() + ttlMs });
  },
  delete(key) {
    return memory.delete(key);
  },
});
```

Other plugins then call `api.use('cache').set('k', v, 10_000)` with no import.
Provide a **plain object**, so the consumers do not depend on this plugin's
internals — only on the shape.

## 5. Persist a cursor across restarts

```js
let cursor = await api.store.get('cursor', null);
api.poll(5000, async () => {
  const batch = await fetchSince(cursor);
  for (const item of batch) handle(item);
  cursor = batch.at(-1)?.id ?? cursor;
  await api.store.set('cursor', cursor);   // survives reload + restart
});
```

## 6. Config that changes at runtime

```js
api.command('my:config', async (key, value) => {
  if (key === undefined) return api.config.get();
  await api.config.set(key, JSON.parse(value));
  return { [key]: api.config.get(key) };
});
```

```bash
uniplug run my:config threshold 0.8
```

Files on disk and env vars are re-read on the next kernel start; for live
re-read inside one process, reload the plugin:

```bash
uniplug list && # find the id, then from the host:
```
```js
await kernel.reload('my-plugin');
```

## 7. Two plugins that must cooperate

```json
// plugins/consumer/plugin.json
{ "dependencies": { "provider": "^1.0.0" } }
```

```js
// plugins/consumer/index.js
api.hook('provider:transform', async (value, next) => next(value)); // guaranteed to exist
```

For "optional but nice" integration:

```json
{ "optionalDependencies": { "sentry": "^2.0.0" } }
```
```js
const sentry = api.tryUse('sentry', null);
if (sentry) sentry.captureException(err);
```

## 8. Replace a host function safely

```js
const original = kernel.createApi; // or any host hook
api.hook('render:markdown', async (html, next) => {
  return next(html.replace(/<script[\s\S]*?<\/script>/gi, '')); // sanitize, then continue
});
```

Rules: transform, don't discard; always call `next()` unless you intend to
terminate the pipeline; document what you changed.

## 9. Testing a plugin without the whole host

```js
import { createKernel } from 'uniplug';
import fs from 'node:fs/promises';
import os from 'node:os';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'test-'));
await fs.cp('plugins/my-plugin', path.join(root, 'plugins/my-plugin'), { recursive: true });

const kernel = await createKernel({ rootDir: root, dataDir: path.join(root, '.data'), loadConfigFile: false });
await kernel.start();
assert.equal(await kernel.runCommand('my-plugin:hello'), 'hi');
await kernel.stop();
```

The bundled `test/kernel.test.js` is exactly this pattern, repeated 20 times.

## 10. Loading plugins from npm

```js
// plugins are just directories — point the kernel at installed packages
const kernel = await createKernel({
  pluginDirs: ['plugins', 'node_modules'],
});
```

Give published plugins their own `plugin.json` at the package root; npm
packages that are not plugins are ignored (no `plugin.json` → skipped).

## 11. Graceful shutdown

```js
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await kernel.stop();        // onUnload of every plugin, stores flushed
    process.exit(0);
  });
}
```

## 12. Debugging "my plugin did nothing"

In order:

1. `uniplug list` — is it `enabled` or `failed`?
2. `uniplug doctor` — manifest / entry file problems.
3. `LOG_LEVEL=debug node app.js` — see every registration and event.
4. `kernel.stats()` — services, commands, plugin counts.
5. Is the listener registered with the right **event name**? `api.on('*')` +
   `meta.name` logs every event and is the fastest way to find the real name.
6. Did you register in `setup` but the host emits **before** `kernel.start()`
   finished? Emit after start.
