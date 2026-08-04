import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('community contribution entry points are present and link the conduct policy', () => {
  for (const path of [
    'CODE_OF_CONDUCT.md',
    'SUPPORT.md',
    'docs/release-process.md',
    '.github/ISSUE_TEMPLATE/config.yml',
    '.github/ISSUE_TEMPLATE/data-quality.yml',
    '.github/ISSUE_TEMPLATE/bug-report.yml',
    '.github/pull_request_template.md',
  ]) assert.equal(existsSync(new URL(`../../${path}`, import.meta.url)), true, `${path} missing`);
  assert.match(read('.github/ISSUE_TEMPLATE/config.yml'), /blank_issues_enabled: false/);
  assert.match(read('.github/ISSUE_TEMPLATE/data-quality.yml'), /Code of Conduct/);
  assert.match(read('.github/ISSUE_TEMPLATE/bug-report.yml'), /Code of Conduct/);
  assert.match(read('.github/pull_request_template.md'), /CONTRIBUTING\.md/);
  assert.match(read('CODE_OF_CONDUCT.md'), /Contributor Covenant 2\.1/);
  assert.match(read('SUPPORT.md'), /GitHub Issue 模板与 Actions 已启用/);
  assert.match(read('docs/release-process.md'), /首次 push 触发 CI 后/);
});
