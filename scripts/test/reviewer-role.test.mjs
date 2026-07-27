import assert from 'node:assert/strict';
import test from 'node:test';

import { reviewerLabel, validateReviewerEvidence } from '../reviewer-evidence.mjs';

test('project curation is never labeled as teacher review', () => {
  assert.equal(reviewerLabel({ reviewProvenance: 'human', reviewerRole: 'curator' }), '人工整理');
});

test('teacher label requires role, rubric and evidence reference', () => {
  assert.equal(reviewerLabel({ reviewProvenance: 'human', reviewerRole: 'teacher', reviewRubric: 'edge-review-v1', reviewEvidenceRef: 'reviews/teacher-001.json' }), '教师审核');
  assert.throws(() => validateReviewerEvidence({ reviewProvenance: 'human', reviewerRole: 'teacher' }), /rubric/);
});
