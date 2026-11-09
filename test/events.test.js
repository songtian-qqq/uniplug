import test from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../src/core/events.js';

test('handlers run in priority order', async () => {
  const bus = new EventBus();
  const order = [];
  bus.on('x', () => order.push('low'), { priority: -5 });
  bus.on('x', () => order.push('mid'));
  bus.on('x', () => order.push('high'), { priority: 10 });

  await bus.emit('x', {});
  assert.deepEqual(order, ['high', 'mid', 'low']);
});

test('same priority keeps registration order', async () => {
  const bus = new EventBus();
  const order = [];
  bus.on('x', () => order.push(1));
  bus.on('x', () => order.push(2));
  bus.on('x', () => order.push(3));

  await bus.emit('x', {});
  assert.deepEqual(order, [1, 2, 3]);
});

test('once fires exactly once', async () => {
  const bus = new EventBus();
  let calls = 0;
  bus.once('x', () => calls++);

  await bus.emit('x', {});
  await bus.emit('x', {});
  assert.equal(calls, 1);
});

test('returning false cancels remaining handlers', async () => {
  const bus = new EventBus();
  const seen = [];
  bus.on('login', () => seen.push('first'));
  bus.on('login', () => {
    seen.push('veto');
    return false;
  });
  bus.on('login', () => seen.push('never'));

  const result = await bus.emit('login', { user: 'a' });
  assert.equal(result.cancelled, true);
  assert.deepEqual(seen, ['first', 'veto']);
});

test('wildcards match everything and namespaces', async () => {
  const bus = new EventBus();
  const seen = [];
  bus.on('*', (payload, meta) => seen.push(`*:${meta.name}`));
  bus.on('billing:*', (payload, meta) => seen.push(`ns:${meta.name}`));

  await bus.emit('billing:charged', {});
  await bus.emit('auth:login', {});

  assert.deepEqual(seen, ['*:billing:charged', 'ns:billing:charged', '*:auth:login']);
});

test('owner deactivation hides listeners without removing them', async () => {
  const bus = new EventBus();
  let calls = 0;
  bus.on('x', () => calls++, { owner: 'p1' });

  bus.setOwnerActive('p1', false);
  await bus.emit('x', {});
  assert.equal(calls, 0);

  bus.setOwnerActive('p1', true);
  await bus.emit('x', {});
  assert.equal(calls, 1);
});

test('removeOwner drops every listener of a plugin', async () => {
  const bus = new EventBus();
  let calls = 0;
  bus.on('a', () => calls++, { owner: 'p1' });
  bus.on('b', () => calls++, { owner: 'p1' });
  bus.on('a', () => calls++, { owner: 'p2' });

  bus.removeOwner('p1');
  await bus.emit('a', {});
  await bus.emit('b', {});
  assert.equal(calls, 1); // only p2's listener remains
});

test('payload is passed through and results collected', async () => {
  const bus = new EventBus();
  const payload = { n: 1 };
  bus.on('x', (p) => (p.n = 2));
  const result = await bus.emit('x', payload);
  assert.deepEqual(result.results, [2]);
  assert.equal(result.payload.n, 2);
});

test('unsubscribe function removes the handler', async () => {
  const bus = new EventBus();
  let calls = 0;
  const off = bus.on('x', () => calls++);
  off();
  await bus.emit('x', {});
  assert.equal(calls, 0);
});

test('a throwing listener goes to the error event when one is registered', async () => {
  const bus = new EventBus();
  const errors = [];
  bus.on('error', (p) => errors.push(p));
  bus.on('boom', () => {
    throw new Error('kaput');
  });
  bus.on('boom', () => errors.push('second listener still ran'));

  await bus.emit('boom', {});
  assert.equal(errors.length, 2);
  assert.equal(errors[0].error.message, 'kaput');
});
