/**
 * llm-resolve.mjs — 「知识脉络」页的自然语言标记解析(实验功能)。
 *
 * createResolver(topics, subjectZh) → async resolve(text, profile)
 *   两阶段: LLM 抽取声明+画像记忆 → 本地 bigram 召回候选 → LLM 精选打分。
 *   记忆只回传前端存 localStorage,本模块不落盘。
 *
 * 环境变量: DEEPSEEK_API_KEY。缺失时 createResolver 返回 null(调用方降级)。
 */

const MODEL = 'deepseek-v4-flash';
const API_URL = 'https://api.deepseek.com/v1/chat/completions';

// --- bigram 召回 ---
const bigrams = (s) => {
  const t = s.replace(/[\s（）()·、,，。:：]/g, '');
  const out = new Set();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
};

// content 里提取 JSON(容错 markdown 围栏)
function parseJson(text) {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
  return JSON.parse(m[1].trim());
}

export function createResolver(topics, subjectZh) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;

  const topicGrams = topics.map(t => ({ t, g: bigrams(t.name) }));

  function recall(claim, n = 15) {
    const qg = bigrams(claim);
    if (qg.size === 0) return [];
    const scored = [];
    for (const { t, g } of topicGrams) {
      let hit = 0;
      for (const b of qg) if (g.has(b)) hit++;
      if (hit > 0) scored.push([hit / Math.max(qg.size, 2) + hit / (g.size + 2), t]);
    }
    return scored.sort((a, b) => b[0] - a[0]).slice(0, n).map(([, t]) => t);
  }

  async function llm(messages, maxTokens = 2000) {
    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: MODEL, messages, max_tokens: maxTokens, temperature: 0.1 }),
    });
    if (!resp.ok) throw new Error(`LLM HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    const data = await resp.json();
    return data.choices?.[0]?.message?.content ?? '';
  }

  return async function resolve(text, profile) {
    // 阶段1: 抽取声明 + 用户画像记忆
    const profileCtx = profile && Object.keys(profile).length
      ? `\n已知孩子画像(仅供理解语境,勿重复输出未变化的项): ${JSON.stringify(profile)}`
      : '';
    const extractRaw = await llm([
      { role: 'system', content: '你是教育知识点解析器。用户会描述孩子已掌握的知识/技能,可能一句话含多项,也可能顺带提到孩子的情况(年龄、年级、性别、所在省市、教材版本、兴趣爱好等)。输出 JSON 对象: {"claims":[{"claim":"简短声明","keywords":"检索关键词(空格分隔,含同义表述)"}],"memory":{"age":数字或null,"grade":"如 三年级 或null","region":"省/市 或null","gender":"男/女 或null","textbook":"教材版本 或null","interests":["兴趣"]或[],"other":"其他值得记住的一句话 或null"}}。memory 只填用户这次明确提到的信息,没提到的字段填 null(interests 填 [])。只输出 JSON,不要解释。' + profileCtx },
      { role: 'user', content: text },
    ]);
    const stage1 = parseJson(extractRaw);
    const claims = Array.isArray(stage1) ? stage1 : (stage1.claims || []);
    const rawMem = (!Array.isArray(stage1) && stage1.memory) || {};
    const memory = {};
    for (const [k, v] of Object.entries(rawMem)) {
      if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
      memory[k] = v;
    }
    if (!Array.isArray(claims) || claims.length === 0) return { claims: [], memory };

    // 阶段2: 逐声明召回 + 汇总一次精选
    const withCands = claims.slice(0, 10).map(c => ({
      claim: c.claim,
      pool: recall(`${c.claim} ${c.keywords || ''}`, 15),
    }));
    const pickPrompt = withCands.map((c, i) =>
      `声明${i}: "${c.claim}"\n候选:\n${c.pool.map(t => `  - ${t.id} | ${t.name} | ${subjectZh(t.subject)} | ${t.age ?? '?'}岁`).join('\n')}`
    ).join('\n\n');
    const pickRaw = await llm([
      { role: 'system', content: '你是知识图谱匹配器。对每条声明,从其候选列表中选出真正匹配的知识点(0~3个)。宁缺毋滥:语义不符就不选。输出 JSON 数组: [{"claimIndex":0,"topicId":"...","confidence":0.9,"note":"一句话说明为何匹配"}]。confidence 取 0~1。只输出 JSON。' },
      { role: 'user', content: pickPrompt },
    ], 3000);
    const picks = parseJson(pickRaw);

    const byId = new Map(topics.map(t => [t.id, t]));
    return {
      memory,
      claims: withCands.map((c, i) => ({
        claim: c.claim,
        candidates: (Array.isArray(picks) ? picks : [])
          .filter(p => p.claimIndex === i && byId.has(p.topicId))
          .map(p => {
            const t = byId.get(p.topicId);
            return { id: t.id, name: t.name, subject: t.subject, subjectZh: subjectZh(t.subject), age: t.age, confidence: p.confidence ?? 0.5, note: p.note || '' };
          })
          .sort((a, b) => b.confidence - a.confidence),
      })),
    };
  };
}
