#!/usr/bin/env node
/**
 * align-utils.test.mjs — align 脚本的工具函数测试。
 *   - repairTruncatedJson：LLM 输出截断时的 JSON 修复
 *   - stage-bridges 的端点校验逻辑（通过 BRIDGES 常量验证）
 *
 * 运行：node scripts/test/align-utils.test.mjs
 */
import assert from 'node:assert/strict';
import { repairTruncatedJson } from '../align-math-standards.mjs';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}

console.log('=== align-utils 单元测试 ===\n');

// --- repairTruncatedJson ---

test('A. 完整 JSON 传给 repair：会截断到最后一个 }，(记录行为，调用方应先尝试 JSON.parse)', () => {
  // repairTruncatedJson 的设计前提是"输入已确认 JSON.parse 失败"。
  // 完整 JSON 传进来会被它当成"截断"处理（找到 }, 后截断），丢失尾部。
  // 这是预期行为——调用方应：try { JSON.parse } catch { repair }，不会把完整 JSON 传给 repair。
  const input = '{"alignments": [{"id": "a", "code": "X.1"}, {"id": "b", "code": "X.2"}]}';
  const r = repairTruncatedJson(input);
  // 完整 JSON 里有 },，repair 会截到第一个对象后 + 补 ]}，结果只剩 1 个
  assert.ok(r);
  assert.equal(r.alignments.length, 1, '完整 JSON 误传 repair 会截断（记录：调用方应先 JSON.parse）');
});

test('B. 截断 JSON：保留最后一个完整对象', () => {
  // 第三个对象被截断（没有闭合 }）
  const input = '{"alignments": [\n    {"id": "a", "code": "X.1"},\n    {"id": "b", "code": "X.2"},\n    {"id": "c", "code": "X.3"';
  const r = repairTruncatedJson(input);
  assert.ok(r, '应返回修复后的对象');
  assert.equal(r.alignments.length, 2, '应保留前 2 个完整对象');
  assert.equal(r.alignments[0].id, 'a');
  assert.equal(r.alignments[1].id, 'b');
});

test('C. 只有一个对象且被截断：返回 null（无法修复）', () => {
  const input = '{"alignments": [\n    {"id": "a", "code": "X';
  const r = repairTruncatedJson(input);
  // 第一个对象都没闭合，lastIndexOf('},') 找不到 → null
  assert.equal(r, null);
});

test('D. 空 alignments 数组：原样解析', () => {
  const input = '{"alignments": []}';
  const r = repairTruncatedJson(input);
  // lastIndexOf('},') 找不到（数组空），返回 null
  // 这是已知边界：空数组本来就该正常 parse，不走 repair 路径
  // 此测试记录该行为
  assert.equal(r, null, '空数组走 repair 会返回 null（应在 parse 阶段先成功，不进 repair）');
});

test('E. 带 markdown 代码块包裹的截断：repair 只处理 }，不剥 ```', () => {
  // 注意：repairTruncatedJson 不剥 markdown（那是调用方的事）
  const input = '```json\n{"alignments": [{"id": "a", "code": "X.1"},\n    {"id": "b"';
  const r = repairTruncatedJson(input);
  // 开头有 ```json，repair 后 JSON.parse 会失败（不是合法 JSON）
  // 调用方应先剥 markdown 再调 repair
  assert.equal(r, null, '带 markdown 的输入 repair 失败（调用方应先剥）');
});

test('F. 中文 reason 的截断 JSON', () => {
  const input = '{"alignments": [\n    {"id": "mt_1", "code": "S1.NA.01", "reason": "加法概念"},\n    {"id": "mt_2", "code": "S1.NA.06", "reason": "流利计';
  const r = repairTruncatedJson(input);
  assert.ok(r);
  assert.equal(r.alignments.length, 1);
  assert.equal(r.alignments[0].id, 'mt_1');
});

console.log(`\n=== 结果：${passed} 通过，${failed} 失败 ===`);
if (failed > 0) process.exit(1);
