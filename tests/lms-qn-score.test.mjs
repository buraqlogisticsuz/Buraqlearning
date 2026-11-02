// «Savolnoma» → тест: подсчёт шкал и склонности в app.js (qnScore, qnTemperAll, qnTmText) — среднее 1–5 по отвеченным,
// «kam javob» при < 80% ответов, прежние границы (по сырой сумме) работают, «yetakchi moyillik / aralash profil /
// aniq yetakchi yo‘q» с Δ = 0,5, ничьи не решаются порядком шкал, режим «en» — «turlar oralig‘ida» у средней точки.
// Функции берём из app.js как есть (кусок без React). Запуск: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const part = (a, b) => app.slice(app.indexOf(a), app.indexOf(b, app.indexOf(a)));
const ctx = { window: {}, LOR: { t: () => k => k } };
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../strings.js', import.meta.url), 'utf8'), ctx);
vm.runInContext('function tpl(s, o) { return s.replace(/\\{(\\w+)\\}/g, function (_, k) { return o[k]; }); }\n' + part('  var QN_TYPES', '  function qnYes('), ctx);
const { qnScore, qnTemperAll, qnTmText, qnNum, T } = ctx;
const uz = T('uz');

// шкала из k утверждений 1–5 (rev — обратные), id вопросов: <шкала>1…<шкала>k
function likert(id, k, rev = []) { return Array.from({ length: k }, (_, i) => ({ id: id + (i + 1), type: 'scale', scale: id, text: id + ' ' + (i + 1), rev: rev.includes(i + 1) || undefined })); }
function quiz(scales, extra = {}) { return { questions: scales.flatMap(s => likert(s.id, s.k || 10, s.rev)), scales: scales.map(s => ({ id: s.id, name: s.id, bands: s.bands || [] })), ...extra }; }
function user(ans) { return { qa: { at: 1, answers: ans } }; }
// у шкалы id все k ответов = v (или массив ответов; null — пропуск)
function fill(id, vals) { const o = {}; vals.forEach((v, i) => { if (v != null) o[id + (i + 1)] = v; }); return o; }
const same = (v, k = 10) => Array(k).fill(v);
const maxMode = { temper: { mode: 'max', map: { S: 'sanguine', C: 'choleric', P: 'phlegmatic', M: 'melancholic' } } };
const four = [{ id: 'S' }, { id: 'C' }, { id: 'P' }, { id: 'M' }, { id: 'R' }];
function profile(means) { // средние по шкалам через 10 ответов (сумма = mean × 10)
  const ans = {};
  for (const [id, m] of Object.entries(means)) { const tot = Math.round(m * 10), base = Math.floor(tot / 10); Object.assign(ans, fill(id, same(base).map((v, i) => i < tot - base * 10 ? v + 1 : v))); }
  return ans;
}

test('шкала — среднее 1–5 по отвеченным, обратные пункты — 6 − ответ; пропуск не занижает балл', () => {
  const q = quiz([{ id: 'S', k: 10, rev: [10] }]);
  const r = qnScore(q, user(fill('S', [4, 4, 4, 4, 4, 4, 4, 4, 4, 2])))[0];
  assert.equal(r.mean, 4, 'обратный «2» → 4');
  assert.equal(r.n, 10); assert.equal(r.few, false);
  const r9 = qnScore(q, user(fill('S', [4, 4, 4, 4, 4, 4, 4, 4, null, null])))[0];
  assert.equal(r9.mean, 4, 'два пропуска — среднее то же, а не ниже');
  assert.equal(r9.n, 8); assert.equal(r9.few, false, '8 из 10 — ещё толкуется');
  const r7 = qnScore(q, user(fill('S', [5, 5, 5, 5, 5, 5, 5, null, null, null])))[0];
  assert.equal(r7.few, true, '7 из 10 — «kam javob»');
  assert.equal(r7.band, '', 'при «kam javob» вывода границы нет');
  assert.equal(qnScore(q, user({}))[0].mean, null);
});

test('прежние границы (по сырой сумме) работают: среднее × число пунктов; пропуски — по среднему, а не нулём', () => {
  const q = quiz([{ id: 'S', k: 10, bands: [{ from: 10, label: 'Past' }, { from: 24, label: 'O‘rta' }, { from: 38, label: 'Yuqori' }] }]);
  const full = qnScore(q, user(fill('S', same(3))))[0];
  assert.equal(full.raw, 30); assert.equal(full.score, 30); assert.equal(full.band, 'O‘rta', '30 из 50 — как раньше');
  const r = qnScore(q, user(fill('S', [4, 4, 4, 4, 4, 4, 4, 4, null, null])))[0];
  assert.equal(r.raw, 40); assert.equal(r.band, 'Yuqori', 'раньше сумма 32 давала «O‘rta»');
  // варианты «Ha / Yo‘q» (1 / 0): среднее растягивается на 1–5, сырой балл — как прежняя сумма
  const yn = { questions: [1, 2, 3, 4].map(i => ({ id: 'e' + i, type: 'one', scale: 'E', options: ['Ha', 'Yo‘q'], pts: [1, 0] })), scales: [{ id: 'E', name: 'E', bands: [{ from: 0, label: 'Kam' }, { from: 3, label: 'Ko‘p' }] }] };
  const e = qnScore(yn, user({ e1: 'Ha', e2: 'Ha', e3: 'Ha', e4: 'Yo‘q' }))[0];
  assert.equal(e.mean, 4); assert.equal(e.raw, 3); assert.equal(e.band, 'Ko‘p');
});

test('«max»: ведущая склонность, смешанный профиль, нет явного лидера, «ни одна не сильна»', () => {
  const q = quiz(four, maxMode);
  const lead = qnTemperAll(q, qnScore(q, user(profile({ S: 3.2, C: 4.6, P: 2.5, M: 2.0, R: 4 }))));
  assert.equal(lead.kind, 'lead'); assert.equal(lead.main, 'choleric'); assert.equal(lead.weak, false);
  assert.equal(qnTmText(uz, lead), 'Yetakchi moyillik: ko‘proq xolerik uslubi');
  const mixed = qnTemperAll(q, qnScore(q, user(profile({ S: 3.8, C: 4.0, P: 3.0, M: 2.0, R: 4 }))));
  assert.equal(mixed.kind, 'mixed'); assert.deepEqual([...mixed.pair], ['choleric', 'sanguine']); assert.equal(mixed.main, undefined, 'без «основного»');
  assert.equal(qnTmText(uz, mixed), 'Aralash profil: xolerik va sangvinik uslublari');
  const none = qnTemperAll(q, qnScore(q, user(profile({ S: 3.8, C: 4.0, P: 3.7, M: 2.0, R: 4 }))));
  assert.equal(none.kind, 'none'); assert.equal(qnTmText(uz, none), 'Aniq yetakchi moyillik yo‘q');
  const weak = qnTemperAll(q, qnScore(q, user(profile({ S: 2.4, C: 3.0, P: 2.0, M: 1.5, R: 4 }))));
  assert.equal(weak.kind, 'lead'); assert.equal(weak.weak, true);
  assert.match(qnTmText(uz, weak), /hech bir moyillik kuchli emas/);
  assert.equal(qnTemperAll(q, qnScore(q, user(profile({ R: 4 })))), null, 'тест не проходил — склонности нет');
});

test('«max»: ничья не решается порядком шкал; «kam javob» — не толкуется', () => {
  const ans = profile({ S: 4.0, C: 4.0, P: 2.0, M: 2.0 });
  const a = quiz(four, maxMode), b = quiz([...four].reverse(), maxMode);
  const ra = qnTemperAll(a, qnScore(a, user(ans))), rb = qnTemperAll(b, qnScore(b, user(ans)));
  assert.equal(ra.kind, 'mixed'); assert.equal(rb.kind, 'mixed');
  assert.deepEqual([...ra.pair], [...rb.pair], 'порядок шкал в списке не важен');
  const tie3 = qnTemperAll(a, qnScore(a, user(profile({ S: 4.0, C: 4.0, P: 4.0, M: 2.0 }))));
  assert.equal(tie3.kind, 'none');
  // две шкалы темперамента — равенство даёт «aralash profil» (третьей нет)
  const two = quiz([{ id: 'S', k: 1 }, { id: 'C', k: 1 }, { id: 'R', k: 1 }], { temper: { mode: 'max', map: { S: 'sanguine', C: 'choleric' } } });
  const t2 = qnTemperAll(two, qnScore(two, user({ S1: 5, C1: 5, R1: 3 })));
  assert.equal(t2.kind, 'mixed'); assert.equal(qnTmText(uz, t2), 'Aralash profil: sangvinik va xolerik uslublari');
  const few = profile({ S: 4.5, C: 2.0, P: 2.0, M: 2.0 }); delete few.M1; delete few.M2; delete few.M3;
  const f = qnTemperAll(a, qnScore(a, user(few)));
  assert.equal(f.kind, 'few'); assert.equal(qnTmText(uz, f), 'Kam javob — natija talqin qilinmaydi');
});

test('«en»: у средней точки — «turlar oralig‘ida», дальше — квадрант', () => {
  const q = quiz([{ id: 'E', k: 10 }, { id: 'N', k: 10 }], { temper: { e: 'E', n: 'N', eMid: 30, nMid: 30 } });
  // размах шкалы 10…50 → 10% = 4 балла сырой суммы
  const far = qnTemperAll(q, qnScore(q, user({ ...fill('E', same(4)), ...fill('N', same(2)) })));
  assert.equal(far.kind, 'lead'); assert.equal(far.main, 'sanguine');
  const near = qnTemperAll(q, qnScore(q, user({ ...fill('E', [4, 4, 4, 3, 3, 3, 3, 3, 3, 3]), ...fill('N', same(2)) })));
  assert.equal(near.kind, 'between'); assert.deepEqual([...near.near], ['sanguine', 'phlegmatic']);
  assert.equal(qnTmText(uz, near), 'Turlar oralig‘ida: sangvinik / flegmatik');
  assert.equal(qnTemperAll(q, qnScore(q, user({ ...fill('E', [4, 4, 4, 4, 4, null, null, null, null, null]), ...fill('N', same(2)) }))).kind, 'few');
});

test('под шкалой — 2–3 ответа, сильнее всего сдвинувших балл (обратные — перевёрнутыми)', () => {
  const q = quiz([{ id: 'S', k: 6, rev: [6] }]);
  const r = qnScore(q, user(fill('S', [3, 4, 2, 3, 5, 1])))[0];
  assert.deepEqual(Array.from(r.top, z => z.x.id), ['S5', 'S6', 'S2'], '5 и обратная 1 (→ 5) — первыми, тройки не в счёт');
  assert.equal(qnNum(uz, 3.45), '3,5'); assert.equal(qnNum(T('en'), 3.45), '3.5');
});

test('новые надписи профиля — на uz, ru, en, zh', () => {
  const keys = ['qn_dec', 'qn_tm_card', 'qn_tmk_lead', 'qn_tmk_mixed', 'qn_tmk_none', 'qn_tmk_between', 'qn_tmk_few', 'qn_tmd_lead', 'qn_tmd_mixed', 'qn_tm_weak',
    'qn_few', 'qn_few_n', 'qn_grp_tm', 'qn_grp_other', 'qn_why', 'qn_rev', 'qn_bars_hint', 'qn_foot', 'qn_own_t'].concat(['sanguine', 'choleric', 'phlegmatic', 'melancholic'].map(k => 'qn_tma_' + k));
  for (const lang of ['uz', 'ru', 'en', 'zh']) assert.deepEqual(keys.filter(k => ctx.APP_T[lang][k] == null), [], lang);
  assert.match(ctx.APP_T.uz.qn_foot, /qobiliyat yoki xarakterni emas/);
});
