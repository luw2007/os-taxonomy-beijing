const MODEL = 'deepseek-v4-flash';
const API_URL = 'https://api.deepseek.com/v1/chat/completions';

export function validateChatRequest(input) {
  if (!input || typeof input !== 'object') throw new Error('invalid request');
  if (typeof input.topicId !== 'string' || !input.topicId.trim()) throw new Error('invalid topicId');
  if (typeof input.message !== 'string' || !input.message.trim() || input.message.length > 500) throw new Error('invalid message');
  const history = Array.isArray(input.history) ? input.history.slice(-8) : [];
  if (history.some(item => !item || !['user', 'assistant'].includes(item.role)
    || typeof item.content !== 'string' || !item.content.trim() || item.content.length > 4000)) {
    throw new Error('invalid history');
  }
  const context = input.context && typeof input.context === 'object' ? input.context : {};
  return { topicId: input.topicId, message: input.message.trim(), history, context };
}

export function buildChatMessages(topic, request) {
  const profileLabel = request.context.hasProfile ? '当前本地学习档案' : '未指定学习档案';
  const subject = String(request.context.subject || topic.subject || '').slice(0, 40);
  const age = Number.isFinite(request.context.age) ? `${request.context.age}岁` : '';
  const evidence = Array.isArray(topic.evidence) ? topic.evidence.slice(0, 5).join('；') : '';
  const system = [
    '你是克制、可信的中文学习助手。围绕指定知识点回答，不把推测伪装成教师结论。',
    '回答简洁、适合家长与学生理解；优先解释概念、给生活例子或短练习。',
    '若问题超出当前知识点，明确说明并给出相关方向。不要索取姓名、联系方式等敏感信息。',
    `学习档案：${profileLabel}`,
    `知识点：${topic.name}`,
    `学科/年龄参考：${subject}${age ? ` · ${age}` : ''}`,
    topic.description ? `说明：${topic.description}` : '',
    evidence ? `掌握证据：${evidence}` : '',
  ].filter(Boolean).join('\n');
  return [{ role: 'system', content: system }, ...request.history, { role: 'user', content: request.message }];
}

export function createSlidingWindowLimiter({ limit = 10, windowMs = 60_000, now = Date.now } = {}) {
  const requests = new Map();
  return function allow(key) {
    const current = now();
    const recent = (requests.get(key) || []).filter(time => current - time < windowMs);
    if (recent.length >= limit) { requests.set(key, recent); return false; }
    recent.push(current);
    requests.set(key, recent);
    if (requests.size > 1000) {
      for (const [storedKey, times] of requests) if (!times.some(time => current - time < windowMs)) requests.delete(storedKey);
    }
    return true;
  };
}

export function createChatResponder() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;
  return async function chat(topic, input) {
    const request = validateChatRequest(input);
    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: MODEL, messages: buildChatMessages(topic, request), max_tokens: 1200, temperature: 0.35 }),
    });
    if (!resp.ok) throw new Error(`AI HTTP ${resp.status}: ${(await resp.text()).slice(0, 160)}`);
    const data = await resp.json();
    const answer = data.choices?.[0]?.message?.content?.trim();
    if (!answer) throw new Error('AI 未返回内容');
    return { answer, topicId: topic.id };
  };
}
