import assert from 'node:assert/strict';
import test from 'node:test';
import { ageRangeForAge } from '../../viewer/age-filter.js';

test('serializes an exact selected age as an existing ageRange filter', () => {
  assert.equal(ageRangeForAge('8'), '8-8');
});

test('clears the filter for the all-ages option', () => {
  assert.equal(ageRangeForAge(''), null);
});

test('rejects ages outside the viewer range', () => {
  assert.equal(ageRangeForAge('3'), null);
  assert.equal(ageRangeForAge('16'), null);
});
