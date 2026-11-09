import test from 'node:test';
import assert from 'node:assert/strict';
import { satisfies, valid, compareVersions } from '../src/core/semver.js';

test('valid / invalid versions', () => {
  assert.equal(valid('1.2.3'), true);
  assert.equal(valid('v1.2.3'), true);
  assert.equal(valid('1.2'), false);
  assert.equal(valid('nope'), false);
});

test('exact versions', () => {
  assert.equal(satisfies('1.2.3', '1.2.3'), true);
  assert.equal(satisfies('1.2.4', '1.2.3'), false);
  assert.equal(satisfies('1.2.3', '=1.2.3'), true);
});

test('caret ranges', () => {
  assert.equal(satisfies('1.2.3', '^1.0.0'), true);
  assert.equal(satisfies('1.9.9', '^1.0.0'), true);
  assert.equal(satisfies('2.0.0', '^1.0.0'), false);
  assert.equal(satisfies('0.2.5', '^0.2.3'), true);
  assert.equal(satisfies('0.3.0', '^0.2.3'), false);
  assert.equal(satisfies('1.2.3', '^1.2.3'), true);
  assert.equal(satisfies('1.2.2', '^1.2.3'), false);
});

test('tilde ranges', () => {
  assert.equal(satisfies('1.2.9', '~1.2.3'), true);
  assert.equal(satisfies('1.3.0', '~1.2.3'), false);
  assert.equal(satisfies('1.2.3', '~1.2'), true);
});

test('comparators and intersections', () => {
  assert.equal(satisfies('1.5.0', '>=1.0.0'), true);
  assert.equal(satisfies('0.9.0', '>=1.0.0'), false);
  assert.equal(satisfies('1.5.0', '>=1.0.0 <2.0.0'), true);
  assert.equal(satisfies('2.1.0', '>=1.0.0 <2.0.0'), false);
});

test('unions and any', () => {
  assert.equal(satisfies('3.0.0', '^1.0.0 || ^3.0.0'), true);
  assert.equal(satisfies('2.0.0', '^1.0.0 || ^3.0.0'), false);
  assert.equal(satisfies('1.0.0', '*'), true);
  assert.equal(satisfies('1.0.0', ''), true);
});

test('partial versions', () => {
  assert.equal(satisfies('1.4.2', '1'), true);
  assert.equal(satisfies('2.4.2', '1'), false);
  assert.equal(satisfies('1.4.2', '1.4'), true);
  assert.equal(satisfies('1.5.2', '1.4'), false);
});

test('ordering', () => {
  assert.equal(compareVersions('1.0.0', '1.0.1'), -1);
  assert.equal(compareVersions('1.10.0', '1.9.0'), 1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('1.0.0-beta', '1.0.0'), -1);
});

test('invalid concrete version never satisfies a range', () => {
  assert.equal(satisfies('not-a-version', '^1.0.0'), false);
});
