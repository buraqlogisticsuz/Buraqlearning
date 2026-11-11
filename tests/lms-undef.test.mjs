// Все имена, которые использует код сайта, где-то объявлены — иначе «X is not defined» на редкой ветке, до которой
// браузерный тест не доходит (так пропала ADAPT_DAYS: страница сотрудника «Sahifani ochib bo‘lmadi»).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const SITE = ['app.js', 'templates.js', 'strings.js', 'lor-ds.js', 'lms-client.js', 'lms-sync.js', 'lms-pay.js', 'config.js'];

test('код сайта: нет обращений к необъявленным именам', () => {
  const out = execFileSync(process.execPath, ['--expose-internals', 'tests/undef-check.cjs', ...SITE], { cwd: root, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(out), [], 'не объявлены: ' + out);
});
