// Дневная тема (lor.css, блок «DAY PASS»): страница сама говорит браузеру «светлая», автозаполнение не красит поля
// в серый, дневные значения не доходят до ночной темы, цвета — только фирменные (оттенки — через rgba тех же пяти).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../lor.css', import.meta.url), 'utf8');
const day = css.slice(css.indexOf('DAY PASS'));
const before = css.slice(0, css.indexOf('DAY PASS'));
// объявления переменных в блоках с данным селектором (селектор — точно, без потомков)
function tokensIn(src, sel) {
  const out = new Set(), re = new RegExp('(?:^|[\\s}{,])' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:, [^{]*)?\\s*\\{([^{}]*)\\}', 'g');
  for (const m of src.matchAll(re)) for (const d of m[1].matchAll(/(--[\w-]+)\s*:/g)) out.add(d[1]);
  return out;
}
const nightMedia = tokensIn(css, ':root:not([data-theme="light"])');
const nightAttr = tokensIn(css, ':root[data-theme="dark"]');

test('страница светлая сама по себе: тёмное устройство + «Kunduzgi» не рисует тёмные поля, календарь и автозаполнение', () => {
  assert.match(day, /\n:root \{ color-scheme: light; \}/);
  // ночь переопределяет — её селекторы весомее голого :root
  assert.match(css, /@media \(prefers-color-scheme: dark\)\{:root:not\(\[data-theme="light"\]\)\{[^}]*color-scheme:dark;/);
  assert.match(css, /:root\[data-theme="dark"\]\{[^}]*color-scheme:dark;/);
});

test('автозаполнение Chrome/Safari: поле своего цвета, текст — цвет текста, рамка фокуса остаётся', () => {
  const rule = /:is\(\.lor-input:-webkit-autofill, \.lor-input:autofill\),[\s\S]*?\{([^}]*)\}/.exec(day);
  assert.ok(rule, 'правило для :-webkit-autofill и :autofill (в :is — неизвестный псевдокласс не ломает список)');
  assert.match(rule[1], /-webkit-text-fill-color: var\(--ink\)/);
  assert.match(rule[1], /caret-color: var\(--ink\)/);
  assert.match(rule[1], /-webkit-box-shadow: 0 0 0 1000px var\(--field-solid\) inset/);
  assert.match(rule[1], /transition: background-color 600000s/);
  assert.match(day, /:is\(\.lor-input:-webkit-autofill:focus-visible, \.lor-input:autofill:focus-visible\) \{[^}]*var\(--field-solid\) inset, var\(--focus-ring\)/);
  // днём поле белое, ночью — плотный тёмный (тот же, что у полей ночью), не полупрозрачный
  assert.match(day, /--field-solid: var\(--white\)/);
  assert.ok(nightMedia.has('--field-solid') && nightAttr.has('--field-solid'));
  assert.match(day, /\.lor-input, textarea\.lor-input, select\.lor-input \{ background-color: var\(--field\); \}/);
});

test('дневные значения не доходят до ночи: у каждой переменной дня есть ночное значение в обеих ветках', () => {
  const dayOnly = day.replace(/@media \(prefers-reduced-transparency: reduce\) \{[\s\S]*?\n\}\n/g, '');
  const light = new Set();
  for (const m of dayOnly.matchAll(/(?:^|\n):root \{([^{}]*)\}/g)) for (const d of m[1].matchAll(/(--[\w-]+)\s*:/g)) light.add(d[1]);
  assert.ok(light.size > 20, 'блок дня найден: ' + light.size);
  const miss = [...light].filter(k => !nightMedia.has(k) || !nightAttr.has(k));
  assert.deepEqual(miss, [], 'нет ночного значения (тёмное устройство или «Tungi»)');
  // новые переменные дня — с ночным значением прямо в блоке дня; старые ночь уже задавала раньше
  const fresh = [...light].filter(k => !new RegExp(k + '\\s*:').test(before));
  assert.deepEqual(fresh.filter(k => !tokensIn(day, ':root[data-theme="dark"]').has(k)), []);
});

test('цвета дня — пять фирменных: rgba только от них, hex — только в объявлениях переменных', () => {
  const brand = ['14,46,84', '255,255,255', '3,76,170', '191,191,191', '222,4,65'];
  const rgba = [...day.matchAll(/rgba?\((\d+),\s*(\d+),\s*(\d+)/g)].map(m => m[1] + ',' + m[2] + ',' + m[3]);
  assert.ok(rgba.length > 10);
  assert.deepEqual(rgba.filter(x => !brand.includes(x)), [], 'оттенок не фирменного цвета');
  const noComments = day.replace(/\/\*[\s\S]*?\*\//g, '');
  const hexOutside = noComments.split(/[;{}]/).filter(d => /#[0-9a-f]{3,8}\b/i.test(d) && !/^\s*--[\w-]+\s*:/.test(d));
  assert.deepEqual(hexOutside, [], 'hex вне переменной');
});

test('телефон: список уведомлений — от края до края шапки, не уезжает влево', () => {
  assert.match(day, /@media \(max-width: 480px\) \{\n  \.app-header \.bell-wrap \{ position: static; \}\n  \.app-header \.notif-pop \{ left: 10px; right: 10px; width: auto;/);
});
