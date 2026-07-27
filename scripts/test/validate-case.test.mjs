import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCasePackage } from '../export-case.mjs';
import { validateCasePackage } from '../validate-case.mjs';

const pack = () => buildCasePackage({
  topics: [
    { id: 'mt_a', name: '甲', description: '甲描述', subject: 'Math', ageRangeStart: 7 },
    { id: 'mt_b', name: '乙', description: '乙描述', subject: 'Math', ageRangeStart: 6 },
  ],
  dependencies: [{ topicId: 'mt_a', prerequisiteId: 'mt_b', strength: 'hard', reason: '乙先修', reviewStatus: 'reviewed', reviewProvenance: 'upstream' }],
  baseUrl: 'https://example.invalid/taxonomy', version: '1.2.0-zh.0', generatedAt: '2026-07-20T00:00:00.000Z',
});

test('generated CFPackage satisfies CASE v1.1 required package fields', () => {
  assert.deepEqual(validateCasePackage(pack()), []);
});

test('CASE validator rejects package-only item fields and missing association timestamp', () => {
  const invalid = pack();
  invalid.CFItems[0].CFDocumentURI = { identifier: 'x', uri: 'https://example.invalid', title: 'wrong' };
  delete invalid.CFAssociations[0].lastChangeDateTime;
  const errors = validateCasePackage(invalid);
  assert.ok(errors.some(error => error.includes('CFItems[0].CFDocumentURI')));
  assert.ok(errors.some(error => error.includes('CFAssociations[0].lastChangeDateTime')));
});
