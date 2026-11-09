import test from 'node:test';
import assert from 'node:assert/strict';
import { HookBus } from '../src/core/hooks.js';

test('interceptors run as an onion', async () => {
  const bus = new HookBus();
  const trace = [];

  bus.add('p', async (value, next) => {
    trace.push('outer:before');
    const result = await next(value);
    trace.push('outer:after');
    return result;
  }, { priority: 10 });

  bus.add('p', async (value, next) => {
    trace.push('inner:before');
    const result = await next(value);
    trace.push('inner:after');
    return result;
  });

  const out = await bus.run('p', 'v');
  assert.equal(out, 'v');
  assert.deepEqual(trace, ['outer:before', 'inner:before', 'inner:after', 'outer:after']);
});

test('value can be replaced along the chain', async () => {
  const bus = new HookBus();
  bus.add('p', async (value, next) => next({ ...value, n: value.n + 1 }));
  bus.add('p', async (value, next) => next({ ...value, n: value.n * 2 }));

  const out = await bus.run('p', { n: 3 });
  assert.deepEqual(out, { n: 8 });
});

test('returning a value short-circuits the chain', async () => {
  const bus = new HookBus();
  let reached = false;
  bus.add('p', async () => 'short-circuit');
  bus.add('p', async (value, next) => {
    reached = true;
    return next(value);
  });

  const out = await bus.run('p', 'ignored');
  assert.equal(out, 'short-circuit');
  assert.equal(reached, false);
});

test('returning undefined without next() passes the value through', async () => {
  const bus = new HookBus();
  let seen;
  bus.add('p', async (value) => {
    seen = value.n;
  });
  bus.add('p', async (value, next) => {
    seen += 1;
    return next(value);
  });

  const out = await bus.run('p', { n: 10 });
  assert.equal(out.n, 10);
  assert.equal(seen, 11);
});

test('priority decides order, run() returns the initial value when no hooks exist', async () => {
  const bus = new HookBus();
  const order = [];
  bus.add('p', async (v, next) => { order.push('b'); return next(v); }, { priority: 1 });
  bus.add('p', async (v, next) => { order.push('a'); return next(v); }, { priority: 5 });

  await bus.run('p', 0);
  assert.deepEqual(order, ['a', 'b']);
  assert.equal(await bus.run('empty', 'untouched'), 'untouched');
});

test('meta is handed to every interceptor', async () => {
  const bus = new HookBus();
  let meta;
  bus.add('p', async (v, next, m) => { meta = m; return next(v); });
  await bus.run('p', 1, { requestId: 'abc' });
  assert.equal(meta.requestId, 'abc');
  assert.equal(meta.hook, 'p');
});

test('inactive owners do not run', async () => {
  const bus = new HookBus();
  let calls = 0;
  bus.add('p', async (v, next) => { calls++; return next(v); }, { owner: 'p1' });

  bus.setOwnerActive('p1', false);
  await bus.run('p', 1);
  assert.equal(calls, 0);

  bus.setOwnerActive('p1', true);
  await bus.run('p', 1);
  assert.equal(calls, 1);
});

test('removeOwner detaches hooks', async () => {
  const bus = new HookBus();
  bus.add('p', async (v, next) => next(v), { owner: 'p1' });
  bus.removeOwner('p1');
  assert.equal(bus.count('p'), 0);
});

test('errors propagate to the caller of run()', async () => {
  const bus = new HookBus();
  bus.add('p', async () => {
    throw new Error('middleware failed');
  });
  await assert.rejects(() => bus.run('p', 1), /middleware failed/);
});
