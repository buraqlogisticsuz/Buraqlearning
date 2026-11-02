// «Savolnoma» → графики: данные для «Profil» человека (qnProfRows — порядок шкал, кто синий, кто приглушён, черта перед
// «Ishonchlilik») и для графиков по коллективу (qnTeam — средние с разбросом, распределение склонностей, правило «от 5
// человек»), разметка графика (QnHBars: доступность, скрытая таблица, только токены цвета). Тексты — короткие синтетические.
// Функции берём из app.js как есть (кусок без React). Запуск: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../lor.css', import.meta.url), 'utf8');
const part = (a, b) => app.slice(app.indexOf(a), app.indexOf(b, app.indexOf(a)));
const ctx = { window: {}, LOR: { t: () => k => k } };
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../strings.js', import.meta.url), 'utf8'), ctx);
vm.runInContext('function tpl(s, o) { return s.replace(/\\{(\\w+)\\}/g, function (_, k) { return o[k]; }); }\n' + part('  var QN_TYPES', '  function qnYes('), ctx);
const { qnScore, qnTemperAll, qnProfRows, qnTeam, T } = ctx;
const plain = x => JSON.parse(JSON.stringify(x));

// пять шкал по 10 утверждений 1–5: четыре темперамента и «Ishonchlilik»
const ids = ['S', 'C', 'P', 'M', 'R'];
const quiz = (temper = { mode: 'max', map: { S: 'sanguine', C: 'choleric', P: 'phlegmatic', M: 'melancholic' } }) => ({
  questions: ids.flatMap(id => Array.from({ length: 10 }, (_, i) => ({ id: id + (i + 1), type: 'scale', scale: id, text: id + i }))),
  scales: ids.map(id => ({ id, name: id === 'R' ? 'Ishonchlilik' : id, bands: [] })), temper });
function ans(means, few = {}) { // среднее шкалы — через 10 ответов; few[id] — сколько ответить
  const a = {};
  for (const [id, m] of Object.entries(means)) {
    const tot = Math.round(m * 10), base = Math.floor(tot / 10);
    for (let i = 0; i < (few[id] || 10); i++) a[id + (i + 1)] = base + (i < tot - base * 10 ? 1 : 0);
  }
  return { qa: { at: 1, answers: a } };
}
const person = (q, means, few) => { const res = qnScore(q, ans(means, few)); return { res, ta: qnTemperAll(q, res) }; };

test('«Profil»: шкалы темперамента по порядку анкеты, «Ishonchlilik» — под чертой; ведущая — синим, остальные приглушены', () => {
  const q = quiz(), p = person(q, { S: 3.2, C: 4.6, P: 2.5, M: 2.0, R: 4.1 });
  const pr = qnProfRows(q, p.res, p.ta);
  assert.deepEqual(plain(pr.rows.map(x => x.r.s.id)), ['S', 'C', 'P', 'M', 'R'], 'порядок анкеты, не по баллу');
  assert.deepEqual(plain(pr.rows.map(x => x.tone)), ['mute', 'acc', 'mute', 'mute', 'mute']);
  assert.deepEqual(plain(pr.rows.map(x => x.sep)), [false, false, false, false, true], 'черта — перед первой шкалой не темперамента');
  assert.equal(pr.emph, true); assert.equal(pr.kind, 'lead');
});

test('«Profil»: aralash profil — синие обе; нет явного лидера и «kam javob» — все приглушены', () => {
  const q = quiz();
  const mixed = person(q, { S: 3.8, C: 4.0, P: 3.0, M: 2.0, R: 4 });
  const pm = qnProfRows(q, mixed.res, mixed.ta);
  assert.deepEqual(plain(pm.rows.filter(x => x.tone === 'acc').map(x => x.r.s.id).sort()), ['C', 'S']); assert.equal(pm.kind, 'mixed');
  const none = person(q, { S: 3.8, C: 4.0, P: 3.7, M: 2.0, R: 4 });
  assert.ok(qnProfRows(q, none.res, none.ta).rows.every(x => x.tone === 'mute'), 'нет явного лидера — выделять нечего');
  const few = person(q, { S: 4.8, C: 2, P: 2, M: 2, R: 4 }, { M: 6 });
  assert.equal(few.ta.kind, 'few');
  assert.ok(qnProfRows(q, few.res, few.ta).rows.every(x => x.tone === 'mute' && !x.lead), '«kam javob» — склонность не толкуется, синего нет');
});

test('«Profil»: «en» — без выделения (склонность — по двум шкалам сразу); без темперамента — все полосы одним синим', () => {
  const en = quiz({ mode: 'en', e: 'S', n: 'C', eMid: 30, nMid: 30 }), p = person(en, { S: 4, C: 2, P: 3, M: 3, R: 3 });
  const pr = qnProfRows(en, p.res, p.ta);
  assert.deepEqual(plain(pr.rows.map(x => x.r.s.id)), ['S', 'C', 'P', 'M', 'R'], 'E и N — сверху, остальные под чертой');
  assert.deepEqual(plain(pr.rows.map(x => x.sep)), [false, false, true, false, false]);
  assert.ok(pr.rows.every(x => x.tone === 'mute') && !pr.emph);
  const no = quiz(null), p2 = person(no, { S: 4, C: 2, P: 3, M: 3, R: 3 });
  const pr2 = qnProfRows(no, p2.res, p2.ta);
  assert.ok(pr2.rows.every(x => x.tone === 'acc' && !x.sep), 'один ряд данных — один цвет, без черты');
});

test('по коллективу: среднее, меньший и больший балл по тем, у кого шкала толкуется; от 5 человек', () => {
  const q = quiz();
  const list = [
    person(q, { S: 4.6, C: 3.0, P: 2.0, M: 2.0, R: 4.0 }), person(q, { S: 3.0, C: 4.6, P: 2.0, M: 2.0, R: 3.0 }),
    person(q, { S: 2.0, C: 2.0, P: 4.4, M: 2.0, R: 5.0 }), person(q, { S: 3.8, C: 4.0, P: 3.0, M: 2.0, R: 4.0 }),
    person(q, { S: 3.8, C: 4.0, P: 3.7, M: 2.0, R: 2.0 }), person(q, { S: 4.0, C: 2.0, P: 2.0, M: 2.0, R: 3.0 }, { R: 5 }),
    person(q, { S: 3.0, C: 3.0, P: 3.0, M: 4.0, R: 3.0 }, { M: 6 })];
  const st = qnTeam(q, list, 5);
  assert.equal(st.people, 7); assert.equal(st.ok, true); assert.equal(st.nt, 7); assert.equal(st.distOk, true);
  const R = st.sc.find(x => x.s.id === 'R'), S = st.sc.find(x => x.s.id === 'S');
  assert.deepEqual([R.n, R.ok, R.lo, R.hi, R.tm], [6, true, 2, 5, false], '«kam javob» у шестого — не в среднем; «Ishonchlilik» — не темперамент');
  assert.equal(Math.round(R.avg * 100) / 100, 3.5);
  assert.deepEqual([S.n, S.lo, S.hi, S.tm], [7, 2, 4.6, true], 'у седьмого «kam javob» в другой шкале — его S в среднем');
  assert.deepEqual(plain(st.dist).map(x => x.k + ':' + x.n), ['sanguine:2', 'choleric:1', 'phlegmatic:1', 'melancholic:0', 'mixed:1', 'none:1', 'few:1'],
    'четыре стиля, aralash profil и «aniq yetakchi yo‘q» — всегда; «kam javob» — раз он есть');
  assert.deepEqual(plain(st.dist.map(x => x.lead)), [true, true, true, true, false, false, false]);
  const four = qnTeam(q, list.slice(0, 4), 5);
  assert.equal(four.ok, false, 'четверо — графиков нет, подсказка');
  assert.equal(qnTeam(q, list.slice(0, 5), 5).sc.find(x => x.s.id === 'R').ok, true);
});

test('по коллективу: «en» — вместо aralash / yetakchisiz — «turlar oralig‘ida»; без темперамента — только средние', () => {
  const en = quiz({ mode: 'en', e: 'S', n: 'C', eMid: 30, nMid: 30 });
  const st = qnTeam(en, [person(en, { S: 4, C: 2, P: 3, M: 3, R: 3 })], 5);
  assert.deepEqual(plain(st.dist.map(x => x.k)), ['sanguine', 'choleric', 'phlegmatic', 'melancholic', 'between']);
  assert.equal(st.dist.find(x => x.k === 'sanguine').n, 1);
  const no = quiz(null);
  assert.deepEqual(plain(qnTeam(no, [person(no, { S: 4, C: 2, P: 3, M: 3, R: 3 })], 5).dist), []);
});

test('график: role=img с подписью, скрытая таблица в обёртке, координаты в %; в стилях — только токены цвета', () => {
  const src = part('  function QnHBars(', '  function QnProfChart(');
  assert.match(src, /role: 'img', 'aria-label': p\.label/);
  assert.match(src, /className: 'sr-only qn-hb-tbl' \}, h\('table'/, 'таблица — внутри скрытой обёртки (иначе раздвинет страницу)');
  assert.match(src, /pc = function \(v\) \{ return X\(v\) \+ '%'; \}/, 'x — в процентах: текст на телефоне не мельчает');
  const blk = css.slice(css.indexOf('.qn-hb, .qn-sl {'), css.indexOf('/* под графиком профиля'));
  assert.ok(blk.length > 1000);
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(blk), 'новых цветов нет — только var(--…)');
  assert.match(blk, /--hb-acc: var\(--blue\)/); assert.match(blk, /--hb-acc: var\(--blue-text\)/, 'в тёмной теме — светлее');
  assert.match(css, /@media print \{\n  \.qn-hb, \.qn-sl \{ --hb-acc: var\(--blue\)/, 'в печати — фирменный синий на белом');
  const uz = T('uz'), ru = T('ru'), en = T('en'), zh = T('zh');
  for (const k of ['qn_pc_t', 'qn_pc_sem', 'qn_pc_hint', 'qn_few_s', 'qn_tbl_sc', 'qn_tbl_avg', 'qn_tbl_band', 'qn_tc_avg_t', 'qn_tc_by', 'qn_tc_avg', 'qn_tc_rng', 'qn_tc_item',
    'qn_tc_few', 'qn_tc_lo', 'qn_tc_hi', 'qn_tc_n', 'qn_tc_dist_t', 'qn_tc_style', 'qn_tc_ppl', 'qn_tc_nolead', 'qn_tc_min'])
    for (const t of [uz, ru, en, zh]) assert.ok(t(k) && t(k) !== k, k + ' — на всех четырёх языках');
  assert.match(uz('qn_tc_min'), /kamida \{n\} kishi/);
});
