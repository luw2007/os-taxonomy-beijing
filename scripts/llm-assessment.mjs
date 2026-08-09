const MODEL = 'deepseek-v4-flash';
const API_URL = 'https://api.deepseek.com/v1/chat/completions';

export function validateAssessmentRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid request');
  if (typeof input.topicId !== 'string' || !input.topicId.trim()) throw new Error('invalid topicId');
  if (typeof input.answer !== 'string') throw new Error('invalid answer');
  const answer = input.answer.trim();
  if (!answer || answer.length > 500) throw new Error('invalid answer');
  return { topicId: input.topicId.trim(), answer };
}

export function buildAssessmentMessages(topic, answer) {
  const evidence = Array.isArray(topic.evidence) ? topic.evidence.filter(item => typeof item === 'string' && item.trim()).slice(0, 8) : [];
  const system = [
    '你是中文学习形成性评分助手。评分仅供学习参考，不是教师结论或掌握判定。',
    `知识点：${topic.name}`,
    topic.description ? `说明：${topic.description}` : '',
    topic.assessmentPrompt ? `题目：${topic.assessmentPrompt.replaceAll('{{name}}', '学生')}` : '',
    evidence.length ? `掌握证据：${evidence.join('；')}` : '',
    '按题目覆盖度、史实准确性、措施与作用的因果对应评分。对口语表达和常见错别字宽容。',
    '“统一六国”是统一过程，不作为本题的巩固统一措施计分。',
    '只输出 JSON 对象，且只能包含 score、summary、strengths、improvements。',
    'score 为 0–100 整数；summary 为非空短文本；strengths 和 improvements 为数组，各至多 3 个非空字符串。',
  ].filter(Boolean).join('\n');
  return [{ role: 'system', content: system }, { role: 'user', content: answer }];
}

const validStringArray = value => Array.isArray(value) && value.length <= 3
  && value.every(item => typeof item === 'string' && item.trim() && item.length <= 200);

export function parseAssessmentResponse(content, topicId) {
  let value;
  try { value = JSON.parse(content); }
  catch { throw new Error('invalid assessment JSON'); }
  const keys = value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).sort() : [];
  const expected = ['improvements', 'score', 'strengths', 'summary'];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])
    || !Number.isInteger(value.score) || value.score < 0 || value.score > 100
    || typeof value.summary !== 'string' || !value.summary.trim() || value.summary.length > 300
    || !validStringArray(value.strengths) || !validStringArray(value.improvements)) {
    throw new Error('invalid assessment response');
  }
  return {
    score: value.score,
    summary: value.summary.trim(),
    strengths: value.strengths.map(item => item.trim()),
    improvements: value.improvements.map(item => item.trim()),
    topicId,
  };
}

export function createAssessmentResponder({ apiKey = process.env.DEEPSEEK_API_KEY, fetchImpl = fetch } = {}) {
  if (!apiKey) return null;
  return async function assess(topic, input) {
    const request = validateAssessmentRequest(input);
    const options = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        messages: buildAssessmentMessages(topic, request.answer),
        response_format: { type: 'json_object' },
        temperature: 0,
        max_tokens: 500,
      }),
    };
    let response;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await fetchImpl(API_URL, options);
      } catch (error) {
        if (attempt === 1) throw error;
        continue;
      }
      if (response.ok || response.status < 500 || attempt === 1) break;
    }
    if (!response.ok) throw new Error(`AI HTTP ${response.status}: ${(await response.text()).slice(0, 160)}`);
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('invalid assessment response');
    return parseAssessmentResponse(content, topic.id);
  };
}
