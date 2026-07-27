import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCasePackage, stableUuid } from '../export-case.mjs';

const baseUrl = 'https://example.invalid/taxonomy';
const generatedAt = '2026-07-27T00:00:00.000Z';

test('stableUuid is deterministic and UUID-shaped', () => {
  assert.equal(stableUuid('item:mt_a'), stableUuid('item:mt_a'));
  assert.match(stableUuid('item:mt_a'), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('buildCasePackage emits CASE 1.1 prerequisite association direction', () => {
  const output = buildCasePackage({
    topics: [
      { id: 'mt_a', name: 'A中文', description: '描述', subject: 'Math', ageRangeStart: 7 },
      { id: 'mt_b', name: 'B中文', description: '基础', subject: 'Math', ageRangeStart: 6 },
    ],
    dependencies: [{ topicId: 'mt_a', prerequisiteId: 'mt_b', strength: 'hard', reason: '需要 B', reviewStatus: 'reviewed', reviewProvenance: 'upstream' }],
    baseUrl,
    version: '1.2.0-zh.0',
    generatedAt,
  });

  assert.equal(output.CFDocument.caseVersion, '1.1');
  assert.equal(output.CFItems[0].fullStatement, 'A中文');
  assert.equal(output.CFItems[0].humanCodingScheme, 'mt_a');
  assert.equal(output.CFAssociations[0].associationType, 'precedes');
  assert.equal(output.CFAssociations[0].originNodeURI.identifier, stableUuid('item:mt_b'));
  assert.equal(output.CFAssociations[0].destinationNodeURI.identifier, stableUuid('item:mt_a'));
  assert.equal('reviewNote' in output.CFAssociations[0], false);
});
