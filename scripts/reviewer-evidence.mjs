export const REVIEWER_ROLES = Object.freeze(['curator', 'teacher']);

export function validateReviewerEvidence(edge) {
  if (edge?.reviewerRole === undefined) return;
  if (!REVIEWER_ROLES.includes(edge.reviewerRole)) throw new Error('reviewerRole 必须为 curator 或 teacher');
  if (edge.reviewProvenance !== 'human') throw new Error('reviewerRole 仅适用于 human provenance');
  if (edge.reviewerRole === 'teacher') {
    if (typeof edge.reviewRubric !== 'string' || !edge.reviewRubric) throw new Error('teacher review 需要 reviewRubric');
    if (typeof edge.reviewEvidenceRef !== 'string' || !edge.reviewEvidenceRef) throw new Error('teacher review 需要 reviewEvidenceRef');
  }
}

export function reviewerLabel(edge) {
  if (edge?.reviewerRole === 'teacher') {
    validateReviewerEvidence(edge);
    return '教师审核';
  }
  if (edge?.reviewerRole === 'curator') return '人工整理';
  if (edge?.reviewProvenance === 'ai-consensus') return 'AI 共识';
  if (edge?.reviewProvenance === 'rule') return '规则';
  if (edge?.reviewProvenance === 'upstream') return '上游·Marble';
  return '';
}
