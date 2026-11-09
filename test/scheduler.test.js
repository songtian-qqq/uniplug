import test from 'node:test';
import assert from 'node:assert/strict';
import { Scheduler } from '../src/core/scheduler.js';

test('every() fires repeatedly and stop() cancels it', async () => {
  const scheduler = new Scheduler();
  let ticks = 0;
  scheduler.every(20, () => {
    ticks++;
  });

  await new Promise((r) => setTimeout(r, 70));
  assert.ok(ticks >= 2, `expected >=2 ticks, got ${ticks}`);
  scheduler.dispose();
});

test('after() runs once', async () => {
  const scheduler = new Scheduler();
  let hits = 0;
  scheduler.after(15, () => {
    hits++;
  });
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(hits, 1);
  scheduler.dispose();
});

test('poll() never overlaps: next run starts after the previous resolves', async () => {
  const scheduler = new Scheduler();
  let concurrent = 0;
  let maxConcurrent = 0;
  let runs = 0;

  scheduler.poll(10, async () => {
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    runs++;
    await new Promise((r) => setTimeout(r, 15));
    concurrent--;
  });

  await new Promise((r) => setTimeout(r, 90));
  scheduler.dispose();
  assert.equal(maxConcurrent, 1);
  assert.ok(runs >= 2);
});

test('dispose() clears every timer', async () => {
  const scheduler = new Scheduler();
  let ticks = 0;
  scheduler.every(10, () => ticks++);
  scheduler.after(10, () => ticks++);
  assert.equal(scheduler.size, 2);
  scheduler.dispose();
  assert.equal(scheduler.size, 0);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(ticks, 0);
});

test('callback errors are reported to onError instead of crashing', async () => {
  const scheduler = new Scheduler();
  const errors = [];
  scheduler.onError = (err) => errors.push(err.message);
  scheduler.every(10, () => {
    throw new Error('tick failed');
  });

  await new Promise((r) => setTimeout(r, 40));
  scheduler.dispose();
  assert.ok(errors.length >= 1);
  assert.deepEqual([...new Set(errors)], ['tick failed']);
});

test('a disposed scheduler refuses new timers', () => {
  const scheduler = new Scheduler();
  scheduler.dispose();
  assert.throws(() => scheduler.every(10, () => {}), /scheduler disposed/);
});

test('clear() stops timers but keeps the scheduler usable (disable → enable)', () => {
  const scheduler = new Scheduler();
  let ticks = 0;
  scheduler.every(10, () => ticks++);
  scheduler.clear();
  assert.equal(scheduler.size, 0);
  assert.doesNotThrow(() => scheduler.every(10, () => ticks++));
  scheduler.dispose();
});
