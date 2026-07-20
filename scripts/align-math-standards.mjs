#!/usr/bin/env node
/**
 * align-math-standards.mjs — 把上游 mt_ 小学数学节点对齐到中国 2022 数学课标 code。
 *
 * 背景：上游有 446 个小学数学节点（mt_，中文翻译在 topics.zh.json），
 *   但 cnStandards 覆盖率 0%。C1a-1 已补全小学段课标 code（67 条 NA/GE/SP），
 *   本脚本用 LLM 判断每个 mt_ 节点对应哪个课标 code。
 *
 * 方法：按 domain 分批，每批喂给 LLM：①一批 mt_ 节点（id+name+description）
 *   ②对应的学段+领域 code 列表（带 strand 标签）③让 LLM 输出 {id → code} 映射。
 *   temperature=0，response_format=json_object，断点续跑。
 *
 * CLI：
 *   node scripts/align-math-standards.mjs --plan       只看分批 + prompt 样本
 *   node scripts/align-math-standards.mjs --dry-run    调 LLM 写 .align-work/，不写盘
 *   node scripts/align-math-standards.mjs              写盘到 data/topics.zh.json
 *   node scripts/align-math-standards.mjs --limit 20   只跑前 20 个（试跑估准确率）
 *
 * 环境变量（.env）：LLM_BASE_URL / LLM_API_KEY / LLM_MODEL
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data');
const UPSTREAM = resolve(ROOT, '..', 'os-taxonomy', 'data');
const WORK = resolve(DATA, '.align-work');

// --- 解析参数 ---
const argv = process.argv.slice(2);
const mode = argv.includes('--plan') ? 'plan'
  : argv.includes('--dry-run') ? 'dry-run' : 'write';
const limIdx = argv.indexOf('--limit');
const limit = limIdx !== -1 ? parseInt(argv[limIdx + 1], 10) : null;

// --- 加载 .env ---
loadEnv();
const MODEL = process.env.LLM_MODEL;
// LLM_API 决定调用格式：openai（chat/completions，默认）或 anthropic（/messages）
const API_KIND = (process.env.LLM_API || 'openai').toLowerCase();

// --- 加载数据 ---
const zhData = JSON.parse(readFileSync(resolve(DATA, 'topics.zh.json'), 'utf8'));
const upstreamData = existsSync(resolve(UPSTREAM, 'topics.json'))
  ? JSON.parse(readFileSync(resolve(UPSTREAM, 'topics.json'), 'utf8')) : null;
const stdData = JSON.parse(readFileSync(resolve(DATA, 'cn-curriculum-standards.json'), 'utf8'));

if (!upstreamData) {
  console.error('✗ 上游 topics.json 未找到（需要 ../os-taxonomy/data/topics.json）');
  process.exit(1);
}

const upById = new Map(upstreamData.topics.map(t => [t.id, t]));
const mathStd = stdData.curricula.find(c => c.slug === 'moe-2022-math');
const stdCodes = mathStd.topics;

// 学段映射：ageRange → S1/S2/S3
function stageForAge(ageStart, ageEnd) {
  const mid = (ageStart + ageEnd) / 2;
  if (mid <= 7.5) return 'S1';   // 1-2年级（age 6-8）
  if (mid <= 9.5) return 'S2';   // 3-4年级（age 8-10）
  if (mid <= 11.5) return 'S3';  // 5-6年级（age 10-12）
  return null; // 初中以上，不处理
}

// 领域映射：mt_ domain → 课标领域缩写
const DOMAIN_TO_FIELD = {
  'Addition & Subtraction': 'NA', 'Multiplication & Division': 'NA',
  'Fractions': 'NA', 'Number Representation & Place Value': 'NA',
  'Counting & Cardinality': 'NA', 'Ratio & Proportion': 'NA', 'Algebra': 'NA',
  'Measurement': 'GE', 'Geometry': 'GE',
  'Data & Statistics': 'SP', 'Probability': 'SP',
  // Mathematical Thinking（问题解决/推理/数学联系）映射到综合实践 CP
  'Mathematical Thinking': 'CP',
};

// 筛选要处理的 mt_ 节点：小学数学 + 中文已翻译
const targets = zhData.topics.filter(t => {
  const u = upById.get(t.id);
  if (!u || u.subject !== 'Mathematics') return false;
  if (u.ageRangeEnd > 12) return false;
  const stage = stageForAge(u.ageRangeStart, u.ageRangeEnd);
  if (!stage) return false;
  if (!DOMAIN_TO_FIELD[u.domain]) return false;
  return true;
});

console.log(`=== C1a-2 数学课标对齐 ===`);
console.log(`  待对齐节点: ${targets.length}（小学数学 mt_）`);
console.log(`  课标 code: ${stdCodes.length} 条（含小学 ${stdCodes.filter(c=>/^S[123]\./.test(c.code)).length}）`);

if (limit) {
  console.log(`  --limit ${limit}：只跑前 ${limit} 个`);
}

// --- 分批：按 stage|field 分桶，桶内按 20 个一批 ---
const buckets = new Map();
for (const t of targets) {
  const u = upById.get(t.id);
  const stage = stageForAge(u.ageRangeStart, u.ageRangeEnd);
  const field = DOMAIN_TO_FIELD[u.domain];
  const key = `${stage}|${field}`;
  if (!buckets.has(key)) buckets.set(key, []);
  buckets.get(key).push(t);
}

const batches = [];
for (const [key, nodes] of buckets) {
  for (let i = 0; i < nodes.length; i += 20) {
    batches.push({ key, nodes: nodes.slice(i, i + 20), idx: batches.filter(b => b.key === key).length });
  }
}
console.log(`  分桶: ${buckets.size} 个，批次: ${batches.length} 个（每批 ≤20 节点）`);

if (limit) {
  let kept = 0;
  const limited = [];
  for (const b of batches) {
    if (kept >= limit) break;
    const room = limit - kept;
    const take = b.nodes.slice(0, room);
    limited.push({ ...b, nodes: take });
    kept += take.length;
  }
  batches.length = 0;
  batches.push(...limited);
  console.log(`  limit 后批次: ${batches.length}，节点: ${batches.reduce((a, b) => a + b.nodes.length, 0)}`);
}

// --- 构建 prompt ---
function buildPrompt(batch) {
  const [stage, field] = batch.key.split('|');
  // 该学段+领域的所有 code（带 strand + note 作为区分依据）
  const codes = stdCodes.filter(c => c.code.startsWith(stage + '.' + field));
  // 按 strand 子领域分组，每组内带 note
  const byStrand = new Map();
  for (const c of codes) {
    const subField = c.strand.split(' / ').slice(-1)[0]; // 末级子领域
    if (!byStrand.has(subField)) byStrand.set(subField, []);
    byStrand.get(subField).push(c);
  }
  let codeSection = '';
  for (const [subField, groupCodes] of byStrand) {
    codeSection += `\n### ${subField}\n`;
    for (const c of groupCodes) {
      const noteHint = c.note ? ` ${c.note}` : ' (无描述)';
      codeSection += `- ${c.key}${noteHint}\n`;
    }
  }

  const nodeList = batch.nodes.map((t, i) => {
    const u = upById.get(t.id);
    return `${i + 1}. [${t.id}] ${t.name}（age ${u.ageRangeStart}-${u.ageRangeEnd}, domain: ${u.domain}）\n   ${(t.description || '').slice(0, 100)}`;
  }).join('\n');

  const stageZh = { S1: '第一学段(1-2年级)', S2: '第二学段(3-4年级)', S3: '第三学段(5-6年级)' }[stage];
  const fieldZh = { NA: '数与代数', GE: '图形与几何', SP: '统计与概率' }[field];

  return `# 任务：把小学数学微主题对齐到课标 code

## 背景
你是中国小学数学教育专家。下面给出 ${stageZh}「${fieldZh}」领域的一批微主题（已翻译为中文），
请把每个主题对齐到最匹配的课标 code。

**关键**：code 列表已按子领域分组，每条 code 带英文覆盖范围提示（→ 开头）。
**请仔细区分同子领域内的不同 code**——例如"20以内加减"vs"100以内两位数运算"是不同 code。
不要把所有运算类主题都塞到同一个 code。

## ${stageZh}「${fieldZh}」的课标 code（按子领域分组）
${codeSection}
## 微主题列表
${nodeList}

## 输出要求
输出严格 JSON（不要 markdown 代码块、不要多余文字）：
\`\`\`json
{
  "alignments": [
    {"id": "mt_xxx", "code": "moe-2022-math:${stage}.${field}.XX", "confidence": "high", "reason": "一句话说明为什么对齐到这个 code（引用 note 关键词）"}
  ]
}
\`\`\`
- code 必须来自上面的列表
- 每个主题选最匹配的 1 个 code
- reason 必须引用该 code 的 note 英文关键词，说明匹配依据
- confidence: high=note 明确匹配 / medium=合理但不确定 / low=都不太匹配`;
}

// 截断 JSON 修复：LLM 输出被 max_tokens 截断时，尝试截到最后一个完整对象
// 输入形如 {"alignments": [{"id":"a",...}, {"id":"b",...}, {"id":"c"(截断
// 输出 {"alignments": [{"id":"a",...}, {"id":"b",...}]}
export function repairTruncatedJson(text) {
  // 找最后一个完整对象的结尾 "},", " }\n]" 或 "}"
  const lastComplete = text.lastIndexOf('},');
  if (lastComplete < 0) return null;
  const truncated = text.slice(0, lastComplete + 1) + '\n  ]\n}';
  try {
    return JSON.parse(truncated);
  } catch {
    return null;
  }
}

// --- LLM 调用 ---
async function callLLM(prompt, slug) {
  const baseUrl = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  if (!baseUrl || !MODEL) throw new Error('缺少 LLM_BASE_URL / LLM_MODEL');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      let content;
      if (API_KIND === 'anthropic') {
        content = await callAnthropic(baseUrl, apiKey, prompt);
      } else {
        if (!apiKey) throw new Error('openai 格式需要 LLM_API_KEY');
        content = await callOpenAI(baseUrl, apiKey, prompt);
      }
      mkdirSync(WORK, { recursive: true });
      writeFileSync(resolve(WORK, `${slug}.json`), JSON.stringify({ slug, prompt, response: content, ts: new Date().toISOString() }, null, 2));
      const cleaned = content.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
      try {
        return JSON.parse(cleaned);
      } catch (e) {
        // 截断容错：LLM 输出可能因 max_tokens 不够被截断。
        // 尝试截到最后一个完整对象（去掉末尾不完整的 },补 ] 和 }）
        const fixed = repairTruncatedJson(cleaned);
        if (fixed) {
          console.error(`  ⚠ ${slug}: JSON 截断，已修复（建议加大 max_tokens）`);
          return fixed;
        }
        throw e;
      }
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }
}

// OpenAI 兼容（chat/completions）
async function callOpenAI(baseUrl, apiKey, prompt) {
  const url = baseUrl.replace(/\/$/, '') + '/chat/completions';
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0, response_format: { type: 'json_object' } }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}

// Anthropic 兼容（/messages）—— 支持 Claude 等
async function callAnthropic(baseUrl, apiKey, prompt) {
  const url = baseUrl.replace(/\/$/, '') + '/messages';
  const headers = { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' };
  if (apiKey) headers['x-api-key'] = apiKey;
  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8192,  // 中文 reason 占 token 多，20 节点 JSON 需 >4096
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  const block = data.content?.find(b => b.type === 'text');
  return block?.text || '';
}

// --- 主流程 ---
async function main() {
  if (mode === 'plan') {
    console.log('\n=== 前 2 批 prompt 预览 ===\n');
    for (const b of batches.slice(0, 2)) {
      console.log(`──── 桶 ${b.key} 批次 ${b.idx}（${b.nodes.length} 节点）────`);
      console.log(buildPrompt(b).slice(0, 1500) + '...\n');
    }
    return;
  }

  if (!process.env.LLM_BASE_URL || !MODEL) {
    console.error('✗ 缺少 LLM_BASE_URL / LLM_MODEL');
    process.exit(1);
  }
  // openai 格式需要 key；anthropic 本地代理可不要
  if (API_KIND !== 'anthropic' && !process.env.LLM_API_KEY) {
    console.error('✗ openai 格式需要 LLM_API_KEY（或设 LLM_API=anthropic 用本地代理）');
    process.exit(1);
  }
  console.log(`模型: ${MODEL} @ ${process.env.LLM_BASE_URL} (${API_KIND})\n`);

  const all = {}; // id → { code, confidence }
  let done = 0;
  for (const b of batches) {
    const slug = `${b.key.replace(/\|/g, '_')}_b${b.idx}`;
    const cachePath = resolve(WORK, `${slug}.json`);
    let result;
    if (existsSync(cachePath)) {
      const cached = JSON.parse(readFileSync(cachePath, 'utf8'));
      const cleaned = cached.response.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
      result = JSON.parse(cleaned);
    } else {
      result = await callLLM(buildPrompt(b), slug);
    }
    for (const a of (result.alignments || [])) {
      all[a.id] = { code: a.code, confidence: a.confidence, reason: a.reason || '' };
    }
    done++;
    process.stdout.write(`  [${done}/${batches.length}] ${slug}: ${result.alignments?.length || 0} 对齐\n`);
  }

  // 统计
  const confCounts = { high: 0, medium: 0, low: 0 };
  for (const { confidence } of Object.values(all)) confCounts[confidence] = (confCounts[confidence] || 0) + 1;
  console.log(`\n=== 对齐结果 ===`);
  console.log(`  总对齐: ${Object.keys(all).length} / ${targets.length}`);
  console.log(`  confidence: high ${confCounts.high} / medium ${confCounts.medium} / low ${confCounts.low}`);

  if (mode === 'dry-run') {
    writeFileSync(resolve(WORK, 'align-result.json'), JSON.stringify(all, null, 2));
    console.log(`\n（--dry-run，结果在 ${WORK}/align-result.json，未写盘）`);
    return;
  }

  // 写盘到 topics.zh.json
  // 经双审确认：low confidence 含结构性错位（时间金钱塞进容量比较、分数塞进加减法），
  // 不写入 cnStandards（避免污染下游依赖图）。只写 high + medium。
  // low 节点留作后续 fix-list（重新对齐或新建中国特有节点）。
  let updated = 0;
  let skipped = 0;
  const byConfWritten = { high: 0, medium: 0, low: 0 };
  for (const t of zhData.topics) {
    if (all[t.id]) {
      if (all[t.id].confidence === 'low') {
        skipped++;
        byConfWritten.low++;
        continue; // mask：low 不写
      }
      t.cnStandards = [all[t.id].code];
      updated++;
      byConfWritten[all[t.id].confidence]++;
    }
  }
  writeFileSync(resolve(DATA, 'topics.zh.json'), JSON.stringify(zhData, null, 2) + '\n', 'utf8');
  console.log(`\n✓ 已写 data/topics.zh.json`);
  console.log(`  写入 cnStandards: ${updated} 条（high ${byConfWritten.high} / medium ${byConfWritten.medium}）`);
  console.log(`  跳过 low: ${skipped} 条（留作后续 fix-list，不写入避免污染）`);
  console.log('下一步: node scripts/checksum.mjs && node scripts/validate.mjs');
  console.log('  manifest 建议记录: aligned_high=' + byConfWritten.high + ', aligned_medium=' + byConfWritten.medium + ', aligned_low_excluded=' + byConfWritten.low);
}

function loadEnv() {
  const envPath = resolve(ROOT, '.env');
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
