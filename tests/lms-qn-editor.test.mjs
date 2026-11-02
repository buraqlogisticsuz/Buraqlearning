// «Savolnoma» → редактор на 100+ вопросов (app.js): разделы для сворачивания (qnSecs), высота поля по тексту (qnRows),
// подсказка условия «faqat «Oilali» bo‘lsa» (qnCondHint, таблица QN_COND), «Qo‘shish (oxiriga)» и «Almashtirish (hammasini)»
// (qnAppend, qnReplace) — в том числе анкета заменой, а тест следом добавлением. Тексты — короткие синтетические.
// Функции берём из app.js как есть (кусок без React). Запуск: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const part = (a, b) => app.slice(app.indexOf(a), app.indexOf(b, app.indexOf(a)));
const ctx = { window: {}, LOR: { t: () => k => k }, localStorage: { getItem: () => null } };
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../strings.js', import.meta.url), 'utf8'), ctx);
vm.runInContext(part('  var QN_TYPES', '  function qnYes(') + part('  function qnNew(', '  function docxQnText('), ctx);
const { qnParse, qnSecs, qnRows, qnCondHint, qnAppend, qnReplace, qnAsk, qnFoldRead } = ctx;
const plain = x => JSON.parse(JSON.stringify(x));

test('разделы: у каждого пункта — свой раздел, в разделе считаются вопросы без пояснений', () => {
  const qs = qnParse('Savol oldin\n# Bir\n> Izoh\nA\nB\n# Ikki\n# Uch\nC').questions;
  const s = qnSecs(qs), sec = qs.filter(x => x.type === 'section');
  assert.deepEqual(plain(s.of), [null, null, sec[0].id, sec[0].id, sec[0].id, null, null, sec[2].id], 'вопрос до первого раздела и сами разделы — без раздела');
  assert.deepEqual([s.n[sec[0].id], s.n[sec[1].id], s.n[sec[2].id]], [2, 0, 1], 'пояснение «>» не считается');
});

test('высота поля — по тексту: раздел и короткий вопрос в одну строку, длинный — несколько, не больше 8', () => {
  assert.equal(qnRows(''), 1);
  assert.equal(qnRows('Shaxsiy ma’lumotlar'), 1);
  assert.equal(qnRows('x'.repeat(120)), 3);
  assert.equal(qnRows('a\nb\nc'), 3, 'переносы — строки');
  assert.equal(qnRows('x'.repeat(5000)), 8);
});

test('подсказка условия: вопрос про детей после «Oilali / …» без условия — «faqat Oilali»', () => {
  const qs = qnParse('Oilaviy holatingiz [tanlov]\n- Oilali\n- Oilali emas\n- Turmush qurmagan\nIsmingiz [qisqa]\nFarzandlaringiz soni [qisqa]').questions;
  assert.deepEqual(plain(qnCondHint(qs, 2)), { q: qs[0].id, any: ['Oilali'] }, '«Oilali emas», «Turmush qurmagan» — не в счёт');
  assert.equal(qnCondHint(qs, 1), null, 'вопрос не про детей — без подсказки');
  assert.equal(qnCondHint(qs, 0), null);
  // по-русски и «Женат / Замужем» — оба варианта; «Не женат» — нет
  const ru = qnParse('Семейное положение [tanlov]\n- Женат / Замужем\n- Не женат / Не замужем\nСколько у вас детей? [qisqa]').questions;
  assert.deepEqual(plain(qnCondHint(ru, 1).any), ['Женат / Замужем']);
  // супруг(а) — то же правило; «детали» — не дети
  const sp = qnParse('Holatingiz [tanlov]\n- Uylangan\n- Turmushga chiqqan\n- Yolg‘iz\nTurmush o‘rtog‘ingizning ismi\nДетали [qisqa]').questions;
  assert.deepEqual(plain(qnCondHint(sp, 1).any), ['Uylangan', 'Turmushga chiqqan']);
  assert.equal(qnCondHint(sp, 2), null, '«Детали» — не про детей');
});

test('подсказки нет: условие уже есть, выбор — несколько вариантов, вопрос далеко, раздел или согласие', () => {
  const qs = qnParse('Oilaviy holatingiz [tanlov]\n- Oilali\n- Yolg‘iz\nFarzandlaringiz bormi? [agar: Oilali]\nBolalaringiz yoshi').questions;
  assert.ok(qs[1].when, '[agar: Oilali] уже дал условие');
  assert.equal(qnCondHint(qs, 1), null, 'условие уже есть — подсказки нет');
  assert.ok(qnCondHint(qs, 2), '…а у следующего без условия — есть');
  const many = qnParse('Kim bilan yashaysiz [bir nechta]\n- Oilali\n- Ota-ona\nFarzandlaringiz bormi?').questions;
  assert.equal(qnCondHint(many, 1), null, 'только вопрос с одним выбором');
  const far = qnParse('Oilaviy holatingiz [tanlov]\n- Oilali\n- Yolg‘iz\n' + Array.from({ length: 12 }, (_, i) => 'Savol ' + i).join('\n') + '\nFarzandlaringiz bormi?').questions;
  assert.equal(qnCondHint(far, far.length - 1), null, 'дальше 10 пунктов — не связываем');
  const sec = qnParse('Oilaviy holatingiz [tanlov]\n- Oilali\n- Yolg‘iz\n# Farzandlar\nFarzandlar haqida ma’lumot to‘g‘ri [rozilik]').questions;
  assert.equal(qnCondHint(sec, 1), null, 'раздел'); assert.equal(qnCondHint(sec, 2), null, 'согласие');
});

test('«Almashtirish»: вопросы, шкалы и темперамент — из текста; название — из текста или прежнее; «yoqilgan» как было', () => {
  const o = { title: 'Eski', intro: 'Eski kirish', on: false, first: true, testWarn: 'W', questions: qnParse('A\nB\nC').questions,
    scales: [{ id: 'old', name: 'Eski shkala', bands: [] }], temper: { mode: 'max', map: { old: 'sanguine' } } };
  const r = qnParse('@sarlavha: Yangi anketa\n# Shaxsiy\nIsmingiz [qisqa]\nOilaviy holatingiz [tanlov]\n- Oilali\n- Yolg‘iz');
  const n = qnReplace(o, r);
  assert.deepEqual(plain(n.questions.map(x => x.text)), ['Shaxsiy', 'Ismingiz', 'Oilaviy holatingiz'], 'старых вопросов нет');
  assert.deepEqual([n.title, n.intro, n.on, n.first, n.testWarn], ['Yangi anketa', 'Eski kirish', false, true, 'W'], 'вступления в тексте нет — прежнее');
  assert.deepEqual([n.scales.length, n.temper], [0, null], 'шкалы и темперамент старой анкеты ушли');
  assert.equal(o.questions.length, 3, 'исходное состояние не тронуто');
  // следом — тест «Qo‘shish»: дописывается в конец, шкалы и темперамент из текста
  const tst = qnParse('@birinchi\n# Muloqot [shkala: Muloqot] [temperament: sangvinik]\nKo‘p gapiraman [baho]');
  const m = qnAppend(n, tst);
  assert.deepEqual(plain(m.questions.map(x => x.text)), ['Shaxsiy', 'Ismingiz', 'Oilaviy holatingiz', 'Muloqot', 'Ko‘p gapiraman']);
  assert.deepEqual([plain(m.scales.map(s => s.name)), m.temper.mode, Object.values(m.temper.map)], [['Muloqot'], 'max', ['sanguine']]);
  assert.deepEqual([m.title, m.first], ['Yangi anketa', true], '@birinchi в тесте включает «сначала анкета»');
  assert.equal(qnAsk(m).length, 3);
});

test('«Qo‘shish» к анкете со шкалами: шкалы и темперамент — вместе', () => {
  const o = { title: '', intro: '', on: true, first: false, questions: [], scales: [{ id: 'a', name: 'A', bands: [] }], temper: { mode: 'max', map: { a: 'choleric' } } };
  const m = qnAppend(o, qnParse('# B [shkala: B] [temperament: flegmatik]\nX [baho]'));
  assert.deepEqual(plain(m.scales.map(s => s.name)), ['A', 'B']);
  assert.deepEqual(Object.values(m.temper.map).sort(), ['choleric', 'phlegmatic']);
});

test('свёрнутые разделы из браузера: пусто или испорчено — ничего не свёрнуто', () => {
  assert.deepEqual(plain(qnFoldRead()), {});
  ctx.localStorage = { getItem: () => '["s1","s2"]' }; assert.deepEqual(plain(vm.runInContext('qnFoldRead()', ctx)), { s1: 1, s2: 1 });
  ctx.localStorage = { getItem: () => '{oops' }; assert.deepEqual(plain(vm.runInContext('qnFoldRead()', ctx)), {});
  ctx.localStorage = { getItem: () => { throw new Error('blocked'); } }; assert.deepEqual(plain(vm.runInContext('qnFoldRead()', ctx)), {});
});
