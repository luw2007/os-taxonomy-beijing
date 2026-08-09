const escapeHtml = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export function renderAssessmentForm(topicId) {
  return `<form class="assessment-form" data-topic-id="${escapeHtml(topicId)}">
    <label class="assessment-label">输入作答（可使用系统语音输入）
      <textarea class="assessment-answer" maxlength="500" rows="4" placeholder="请根据上面的评估话术作答"></textarea>
    </label>
    <div class="assessment-actions"><button class="assessment-submit" type="submit">提交 AI 评分</button><span class="assessment-note">评分仅供学习参考，不改变掌握状态</span></div>
    <div class="assessment-result" aria-live="polite"></div>
  </form>`;
}

export function renderAssessmentResult({ score, summary, strengths, improvements }) {
  return `<div class="assessment-score"><strong>${score}</strong><span>/ 100</span></div><p>${escapeHtml(summary)}</p>`
    + (strengths.length ? `<h5>做得好的地方</h5><ul>${strengths.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '')
    + (improvements.length ? `<h5>可以改进</h5><ul>${improvements.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '');
}
