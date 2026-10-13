// Подсказки «Tugmalar bo‘yicha izohlar» (HINTS), «?» у заголовков страниц (PageTip) и карточки помощи (HELP) в app.js:
// у каждой — текст на всех четырёх языках strings.js. Новая кнопка без подсказки молчит — тест этого не ловит,
// но подсказка без текста показывала бы ключ вместо описания. Запуск: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../strings.js', import.meta.url), 'utf8'), ctx);

const part = (a, b) => app.slice(app.indexOf(a), app.indexOf(b, app.indexOf(a)));
function keys() {
  const k = new Set();
  for (const m of part('var HINTS = [', 'var HINT_ALL').matchAll(/, '([a-z_]+)', '([a-z_]+)'\]/g)) { k.add(m[1]); k.add(m[2]); }
  for (const m of app.matchAll(/h\(PageTip, \{ t: t, id: '([a-z]+)'/g)) { k.add('tip_' + m[1] + '_t'); k.add('tip_' + m[1]); }
  for (const m of part('var HELP = {', 'var TOUR').matchAll(/\{ id: '([a-z]+)', ico: '[a-z]+', n: (\d+)/g)) {
    k.add('hp_' + m[1] + '_t'); k.add('hp_' + m[1] + '_s');
    for (let i = 1; i <= +m[2]; i++) k.add('hp_' + m[1] + '_' + i);
  }
  return [...k];
}

test('подсказки, «?» страниц и карточки помощи — текст на uz, ru, en, zh', () => {
  const all = keys();
  assert.ok(all.length > 150, 'ключи нашлись: ' + all.length);
  for (const lang of ['uz', 'ru', 'en', 'zh']) assert.deepEqual(all.filter(k => ctx.APP_T[lang][k] == null), [], 'нет текста (' + lang + ')');
});

test('у новых разделов есть подсказки: зарплата, Excel, профиль, Telegram, адресаты идей, «Kun hikmati», меню', () => {
  const sel = part('var HINTS = [', 'var HINT_ALL');
  for (const s of ['.pay-input', '.pay-who', '.pay-tlrow', '.pay-decide', '.imp-act label', '.lor-btn-secondary', '.pf-tg', '.ini-to-card', '.ld-box', '.wz-admin', '.user-pop .export', 'a[href="#pay"]'])
    assert.ok(sel.includes(s), 'нет подсказки для ' + s);
});
