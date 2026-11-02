// «Savolnoma» → «Javoblar sifati»: проверки качества ответов в тесте (app.js: QN_Q, qnQuality, qnQWhy, qnQNotes,
// qnQShort, qnQTop — строка в карточке, qnRetake, разбор пометок [diqqat: 2] [tekshiruv] [samimiylik] [juft: N] [shkala: …] в qnParse). Светофор по таблице
// отчёта: скорость (медиана), серия одинаковых, доля «3», обратные пары (meanD, gross), согласие со всем, внимательность;
// красный — хоть один красный или три жёлтых; чего не посчитать — пропуск с причиной; «слишком хорошо» — отдельно.
// Пометки уходят в ИИ готовым списком, сами пункты-проверки — нет. Функции берём из app.js как есть (куски без React).
// Запуск: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const part = (a, b) => { const i = app.indexOf(a); assert.ok(i >= 0, 'нет в app.js: ' + a); return app.slice(i, app.indexOf(b, i)); };
const ctx = { window: {}, LOR: { t: () => k => k } };
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../strings.js', import.meta.url), 'utf8'), ctx);
vm.runInContext('function tpl(s, o) { return s.replace(/\\{(\\w+)\\}/g, function (_, k) { return o[k]; }); }\n' +
  'function patchUser(d, uid, fn) { d.users.forEach(function (x) { if (x.id === uid) fn(x); }); }\n' +
  'var lastId = 0; function nextId() { return ++lastId; }\n' +
  part('  var QN_TYPES', '  function qnYes(') + part('  var LANG_NAME', '  function stems(') +
  part('  /* AI-вывод по ответам', '  function QnAi(') +
  part('  function qnNew(', '  function qnFromText('), ctx);
const { QN_Q, qnQuality, qnQWhy, qnQShort, qnQTop, qnQNotes, qnRetake, qnDone, qnScore, qnParse, qnAiRun, T } = ctx;
const uz = T('uz');
const J = x => JSON.parse(JSON.stringify(x));

// тест из 50 пунктов: 5 шкал вперемешку, пункт 20 — «выберите 2», пункт 40 — «никогда не пользовался телефоном»,
// 10 обратных пар: пункт i ↔ i + 25 (i = 1…10)
function test50() {
  const qs = [];
  for (let i = 1; i <= 50; i++) {
    if (i === 20) qs.push({ id: 'i20', type: 'attn', expect: 2, text: 'Bu savolda «2» ni belgilang' });
    else if (i === 40) qs.push({ id: 'i40', type: 'scale', infreq: true, text: 'Men hech qachon mobil telefondan foydalanmaganman' });
    else qs.push({ id: 'i' + i, type: 'scale', scale: 'S' + (i % 5), text: 'Fikr ' + i, req: true });
  }
  for (let i = 1; i <= 10; i++) qs[i - 1].pair = 'i' + (i + 25);
  return { questions: qs, scales: [0, 1, 2, 3, 4].map(k => ({ id: 'S' + k, name: 'S' + k, bands: [] })) };
}
const Q = test50();
const ids = Q.questions.map(x => x.id);
// честные ответы: разные, пары согласованы (b = 6 − a), «2» на проверке внимательности, «1» — на «телефоне»
function honest() {
  const base = [4, 2, 5, 3, 1, 2, 4, 3, 5, 2], a = {};
  for (let i = 1; i <= 50; i++) a['i' + i] = base[(i - 1) % 10];
  for (let i = 1; i <= 10; i++) a['i' + (i + 25)] = 6 - a['i' + i];
  a.i20 = 2; a.i40 = 1;
  return a;
}
const same = v => Object.fromEntries(ids.map(id => [id, v]));
// время между ответами: первый ответ захода — без времени
const rtOf = f => ({ rt: Object.fromEntries(ids.slice(1).map((id, i) => [id, f(i)])), changes: 0 });
const calm = rtOf(i => 3000 + (i * 137) % 3000);

test('пороги — одним объектом QN_Q (стартовые значения из отчёта)', () => {
  assert.deepEqual(J([QN_Q.t, QN_Q.run, QN_Q.mid, QN_Q.meanD, QN_Q.gross, QN_Q.acq, QN_Q.attn, QN_Q.ambers, QN_Q.hint, QN_Q.gap]),
    [[2, 1], [10, 15], [0.6, 0.9], [1.2, 1.5], [3, 4], [0.6, 1], [0.5, 1.5], 3, 5, 300000]);
  assert.match(app, /СТАРТОВЫЕ[\s\S]{0,80}100–200/, 'у порогов — пометка, что их перенастроить');
});

test('честные ответы в обычном темпе — зелёный: «Javoblar izchil va odatiy tempda berilgan»', () => {
  const r = qnQuality(Q, honest(), calm);
  assert.equal(r.level, 'green');
  assert.equal(r.n, 50);
  assert.deepEqual(J(r.skip), []);
  assert.equal(r.v.meanD, 0); assert.equal(r.v.acq, 0); assert.equal(r.v.attn, 0);
  assert.ok(r.v.t >= 3 && r.v.t < 6, 'медиана в секундах');
  assert.deepEqual(J(qnQWhy(uz, r)), ['Javoblar izchil va odatiy tempda berilgan']);
  assert.deepEqual(J(qnQNotes(r)), [], 'зелёный — в ИИ без пометок');
});

test('«одна кнопка» быстро — красный, 1–3 причины словами, красные первыми', () => {
  const r = qnQuality(Q, same(5), rtOf(() => 400));
  assert.equal(r.level, 'red');
  assert.equal(r.v.run, 50); assert.equal(r.v.t, 0.4); assert.equal(r.v.gross, 10); assert.equal(r.v.acq, 2); assert.equal(r.v.attn, 2);
  assert.deepEqual(J(r.why.map(x => x.k)), ['run', 'attn', 'pairs'], 'не больше трёх, по порядку важности');
  const why = J(qnQWhy(uz, r));
  assert.deepEqual(why, ['Ketma-ket 50 ta bir xil javob', 'Diqqat savollarida xato: 2 (2 ta savoldan)', 'Qarama-qarshi fikrlarning 10 juftidan 10 tasida ziddiyat']);
  const notes = J(qnQNotes(r));
  assert.equal(notes.length, 1);
  assert.match(notes[0], /^Javoblar sifati: Profil talqin qilinmaydi — Ketma-ket 50 ta bir xil javob; /);
});

test('скорость: медиана < 2 с — жёлтый, < 1 с — красный; > 20% ответов быстрее 1 с (10 из 50) — жёлтый', () => {
  const a = honest();
  const slow = qnQuality(Q, a, rtOf(() => 1500));
  assert.equal(slow.level, 'amber'); assert.equal(slow.why[0].k, 'speed');
  assert.deepEqual(J(qnQWhy(uz, slow)), ['Javoblar juda tez: bir fikrga o‘rtacha 1,5 soniya']);
  assert.equal(qnQuality(Q, a, rtOf(() => 900)).level, 'red');
  // медиана 3 с, но 11 из 49 — быстрее секунды
  const some = qnQuality(Q, a, rtOf(i => i < 11 ? 600 : 3000));
  assert.equal(some.level, 'amber');
  assert.deepEqual(J(qnQWhy(uz, some)), ['49 ta javobdan 11 tasi 1 soniyadan tez berilgan']);
  assert.equal(qnQuality(Q, a, rtOf(i => i < 9 ? 600 : 3000)).level, 'green', '9 из 49 — ещё норма');
  // паузы длиннее 5 минут не в счёт, замеров меньше 5 — скорость не считается
  const few = { rt: { i2: 400, i3: 400, i4: 400, i5: 400, i6: 400 * 1000 } };
  const r = qnQuality(Q, a, few);
  assert.ok(r.skip.includes('speed'));
  assert.equal(qnQuality(Q, a, null).skip[0], 'speed', 'старые ответы без времени — скорость пропущена');
});

test('серия одинаковых в порядке показа: 9 — норма, 10 — жёлтый, 15 — красный; доля «3»: 60% — жёлтый, 90% — красный', () => {
  // серия «2» с пункта 11 (пункт 20 — «выберите 2» — в ней верен), до и после — другие ответы
  const run = n => { const a = honest(); for (let i = 11; i < 11 + n; i++) a['i' + i] = 2; a.i10 = 5; a['i' + (11 + n)] = 4; return a; };
  assert.equal(qnQuality(Q, run(9), calm).v.run, 9);
  assert.equal(qnQuality(Q, run(9), calm).ix.find(x => x.k === 'run').lv, 'green');
  assert.equal(qnQuality(Q, run(10), calm).ix.find(x => x.k === 'run').lv, 'amber');
  assert.deepEqual(J(qnQWhy(uz, qnQuality(Q, run(10), calm))), ['Ketma-ket 10 ta bir xil javob']);
  assert.equal(qnQuality(Q, run(14), calm).ix.find(x => x.k === 'run').lv, 'amber');
  assert.equal(qnQuality(Q, run(15), calm).ix.find(x => x.k === 'run').lv, 'red');
  const mid = share => { const a = honest(), k = Math.round(share * 50); ids.slice(0, k).forEach(id => { a[id] = 3; }); return a; };
  const m6 = qnQuality(Q, Object.fromEntries(ids.map((id, i) => [id, i % 5 < 3 ? 3 : i % 2 ? 4 : 2])), calm);
  assert.equal(m6.v.mid, 0.6); assert.equal(m6.ix.find(x => x.k === 'mid').lv, 'amber');
  assert.ok(qnQWhy(uz, m6).includes('Javoblarning 60% — «3» (o‘rtacha)'));
  assert.equal(qnQuality(Q, mid(0.9), calm).ix.find(x => x.k === 'mid').lv, 'red');
});

test('утверждения одной шкалы стоят подряд (раздел «# … [shkala: …]») — серию не судим: пропуск «order», а не жёлтый или красный', () => {
  // тест 5 × 10 из текста, утверждения сгруппированы по шкалам (так его вставляют по умолчанию)
  const names = ['Muloqot', 'Liderlik', 'Ishonchlilik', 'Tartib', 'Xotirjamlik'];
  const txt = names.map((n, k) => '# ' + n + ' [shkala: ' + n + ']\n' + Array.from({ length: 10 }, (_, i) => (k * 10 + i + 1) + '. ' + n + ' fikri ' + (i + 1) + ' [baho]').join('\n')).join('\n');
  const q = qnParse(txt), its = q.questions.filter(x => x.type === 'scale');
  assert.equal(its.length, 50);
  // честный сильный экстраверт: «5» на всё «Muloqot» и на первые пять «Liderlik», дальше — разные
  const a = {}, mix = [3, 4, 2, 4, 3, 2, 4, 3, 1, 2];
  its.forEach((x, i) => { a[x.id] = i < 15 ? 5 : mix[i % 10]; });
  const r = qnQuality(q, a, null);
  assert.equal(r.v.run, 15, 'серия — 15');
  assert.ok(!r.ix.some(x => x.k === 'run'), 'серия не судится');
  assert.ok(r.skip.includes('order'));
  assert.notEqual(r.level, 'red');
  assert.match(T('uz')('qn_q_sk_order'), /aralashtirilmagan/);
  // 10 «5» на «Ishonchlilik» — тоже не жёлтый
  const b = {}; its.forEach((x, i) => { b[x.id] = i >= 20 && i < 30 ? 5 : mix[i % 10]; });
  assert.ok(!qnQuality(q, b, null).ix.some(x => x.k === 'run'));
  // те же утверждения вперемешку — серия снова судится
  const shuffled = { questions: its.map((x, i) => its[(i % 5) * 10 + Math.floor(i / 5)]), scales: q.scales };
  const one = Object.fromEntries(its.map(x => [x.id, 5]));
  const rs = qnQuality(shuffled, one, null);
  assert.equal(rs.ix.find(x => x.k === 'run').lv, 'red');
  assert.ok(!rs.skip.includes('order'));
});

test('обратные пары: d = |a − (6 − b)|; gross ≥ 3 — жёлтый, ≥ 4 — красный; meanD ≥ 1,2 / 1,5; согласие со всем', () => {
  const contra = k => { const a = honest(); for (let i = 1; i <= k; i++) { a['i' + i] = 5; a['i' + (i + 25)] = 5; } return a; };
  const g3 = qnQuality(Q, contra(3), calm).ix.find(x => x.k === 'pairs');
  assert.equal(g3.gross, 3); assert.equal(g3.lv, 'amber');
  assert.deepEqual(J(qnQWhy(uz, qnQuality(Q, contra(3), calm))).slice(0, 1), ['Qarama-qarshi fikrlarning 10 juftidan 3 tasida ziddiyat']);
  assert.equal(qnQuality(Q, contra(4), calm).ix.find(x => x.k === 'pairs').lv, 'red');
  // мелкие расхождения по 2 балла во всех парах: meanD = 2 — красный, хоть грубых и нет
  const soft = honest(); for (let i = 1; i <= 10; i++) { soft['i' + i] = 3; soft['i' + (i + 25)] = 1; }
  const s = qnQuality(Q, soft, calm).ix.find(x => x.k === 'pairs');
  assert.deepEqual([s.meanD, s.gross, s.lv], [2, 0, 'red']);
  // «со всем не согласен»: 1 и 1 во всех парах — acq = −2
  const no = honest(); for (let i = 1; i <= 10; i++) { no['i' + i] = 1; no['i' + (i + 25)] = 1; }
  const r = qnQuality(Q, no, calm);
  assert.equal(r.v.acq, -2); assert.equal(r.ix.find(x => x.k === 'acq').lv, 'red');
  assert.ok(qnQWhy(uz, r).includes('Qarama-qarshi fikrlarning ikkalasini ham rad etish moyilligi'));
  // меньше трёх пар с ответами — не считается
  const q2 = test50(); q2.questions.forEach((x, i) => { if (i > 1) delete x.pair; });
  assert.ok(qnQuality(q2, honest(), calm).skip.includes('pairs'));
});

test('внимательность: ≠ ожидаемого — ошибка, «телефон» 3 — пол-ошибки, 4–5 — ошибка; 0,5–1 — жёлтый, ≥ 1,5 — красный', () => {
  const at = (x, y) => qnQuality(Q, Object.assign(honest(), { i20: x, i40: y }), calm).ix.find(z => z.k === 'attn');
  assert.deepEqual([at(2, 1).err, at(2, 1).lv], [0, 'green']);
  assert.deepEqual([at(2, 3).err, at(2, 3).lv], [0.5, 'amber']);
  assert.deepEqual([at(4, 1).err, at(4, 1).lv], [1, 'amber']);
  assert.deepEqual([at(4, 3).err, at(4, 3).lv], [1.5, 'red']);
  assert.deepEqual(J(qnQWhy(uz, qnQuality(Q, Object.assign(honest(), { i20: 2, i40: 3 }), calm))), ['Diqqat savollarida xato: 0,5 (2 ta savoldan)']);
});

test('три жёлтых сразу — красный; что посчитать нельзя — пропуск с причиной, всё пропущено — «na»', () => {
  // жёлтые: скорость 1,5 с, ошибка внимательности, 3 противоречивые пары
  const a = Object.assign(honest(), { i20: 4, i1: 5, i26: 5, i2: 1, i27: 1, i3: 5, i28: 5 });
  const r = qnQuality(Q, a, rtOf(() => 1500));
  assert.deepEqual(J(r.ix.filter(x => x.lv !== 'green').map(x => x.lv)), ['amber', 'amber', 'amber']);
  assert.equal(r.level, 'red');
  // короткий тест без пар, проверок и времени
  const small = { questions: [1, 2, 3].map(i => ({ id: 's' + i, type: 'scale', scale: 'S', text: 'F' + i })), scales: [{ id: 'S', name: 'S' }] };
  const n = qnQuality(small, { s1: 5, s2: 5, s3: 5 }, null);
  assert.equal(n.level, 'na');
  assert.deepEqual(J(n.skip), ['speed', 'pattern', 'pairs', 'attn']);
  assert.deepEqual(J(qnQWhy(uz, n)), []);
  assert.equal(qnQuality(small, {}, null), null, 'ответов 1–5 нет — проверок нет');
  // оценка без шкалы в анкете («оцените свой Excel») — не пункт теста
  assert.equal(qnQuality({ questions: [{ id: 'x', type: 'scale', text: 'Excel' }] }, { x: 5 }, null), null);
  // зелёный без времени и пар — без слов «в обычном темпе»
  const g = qnQuality(Q, honest(), null);
  assert.equal(g.level, 'green'); assert.deepEqual(J(qnQWhy(uz, g)), ['Tekshirilgan ko‘rsatkichlarda shubhali belgi yo‘q']);
});

test('«слишком хорошо» (sd): «5» у 4 из 6 — пометка «suhbatda aniqlang», в светофор не входит, баллы не меняет', () => {
  const q = test50();
  for (let i = 41; i <= 46; i++) Object.assign(q.questions[i - 1], { sd: true, scale: undefined });
  const a = honest(); [41, 42, 43, 44].forEach(i => { a['i' + i] = 5; }); a.i45 = 4; a.i46 = 2;
  const r = qnQuality(q, a, calm);
  assert.deepEqual(J(r.sd), { n: 4, k: 6, flag: true });
  assert.equal(r.level, 'green', 'в светофор не входит');
  assert.deepEqual(J(qnQNotes(r)), ['Juda ijobiy o‘z-o‘zini ta’riflash — suhbatda aniqlang («juda yaxshi» fikrlarning 6 tasidan 4 tasiga «5»)']);
  a.i44 = 4;
  assert.equal(qnQuality(q, a, calm).sd.flag, false, '3 из 6 — без пометки');
});

test('пункты на внимательность и проверки в шкалы не входят', () => {
  const q = { questions: [
    { id: 'a', type: 'scale', scale: 'S', text: 'A' }, { id: 'b', type: 'attn', expect: 2, scale: 'S', text: 'B' }, { id: 'c', type: 'scale', infreq: true, scale: 'S', text: 'C' }
  ], scales: [{ id: 'S', name: 'S', bands: [] }] };
  const r = qnScore(q, { qa: { answers: { a: 4, b: 1, c: 5 } } })[0];
  assert.deepEqual([r.n, r.total, r.mean], [1, 1, 4]);
});

test('разбор текста: [diqqat: 2], [tekshiruv], [samimiylik], [juft: N] по номеру в тексте, [shkala: …] у вопроса', () => {
  const r = qnParse('@baho: Umuman | Kam | Ba’zan | Ko‘proq | To‘liq\n# Test [shkala: Muloqot] [temperament: sangvinik]\n> Har bir fikrni baholang\n' +
    '1. Yangi odamlar bilan tez tanishaman [baho]\n2. Bu savolda «2» ni belgilang [diqqat: 2]\n3. Men hech qachon mobil telefondan foydalanmaganman [tekshiruv]\n' +
    '4. Men hech qachon ishga kechikmaganman [samimiylik]\n5. Tez qaror qabul qilaman [baho] [shkala: Liderlik]\n6. Yolg‘iz qolishni afzal ko‘raman [baho] [teskari] [juft: 1]\n' +
    '7. Qaror qabul qilishdan oldin uzoq o‘ylayman [juft: 5]\n8. Nima uchun? [qisqa]\n9. Biror narsa [baho] [juft: 8]');
  const [n0, q1, q2, q3, q4, q5, q6, q7, q8, q9] = r.questions.slice(1);
  const sc = n => r.scales.find(x => x.name === n).id;
  assert.equal(n0.type, 'note');
  assert.deepEqual([q1.type, q1.scale], ['scale', sc('Muloqot')]);
  assert.deepEqual(J([q2.type, q2.expect, q2.labels[1]]), ['attn', 2, 'Kam'], 'внимательность — с подписями…');
  assert.equal(q2.scale, undefined, '…и без шкалы');
  assert.deepEqual([q3.type, q3.infreq, q3.scale], ['scale', true, undefined], 'проверка — без шкалы');
  assert.deepEqual([q4.type, q4.sd, q4.scale], ['scale', true, undefined], '«слишком хорошо» — без шкалы раздела');
  assert.equal(q5.scale, sc('Liderlik'), 'своя шкала у вопроса');
  assert.deepEqual([q6.pair, q6.rev, q6.scale], [q1.id, true, sc('Muloqot')]);
  assert.deepEqual([q7.type, q7.pair], ['scale', q5.id], '[juft] сам делает оценку 1–5');
  assert.equal(q9.pair, undefined, 'пара — только с оценкой 1–5');
  assert.equal(q8.type, 'text');
  assert.deepEqual(J(r.temper), { mode: 'max', map: { [sc('Muloqot')]: 'sanguine' } });
  // без номеров — N-й вопрос текста (раздел и пояснение не в счёт)
  const o = qnParse('# A\n> Izoh\nBirinchi [baho]\nIkkinchi [baho]\n# B\nUchinchi [baho] [juft: 1]').questions.filter(x => x.type === 'scale');
  assert.equal(o[2].pair, o[0].id);
  // номера повторяются (анкета 1…, тест 1…) — ближайший
  const d = qnParse('1. Ism [qisqa]\n2. Yosh [qisqa]\n# Test\n1. Birinchi [baho]\n2. Ikkinchi [baho]\n3. Uchinchi [baho] [juft: 1]').questions;
  assert.equal(d.find(x => x.text === 'Uchinchi').pair, d.find(x => x.text === 'Birinchi').id);
  for (const x of r.questions) for (const k of ['_num', '_pair', '_sc', 'typed']) assert.ok(!(k in x), 'служебное поле ' + k + ' не остаётся');
});

test('«пройти тест ещё раз»: ответы теста и их время — в qa.prev, анкета остаётся, до отправки — «к заполнению»', () => {
  const q = { questions: [{ id: 'why', type: 'long', text: 'Nega BURAQ?', req: true }].concat(test50().questions) };
  const answers = Object.assign({ why: 'Rivojlanish' }, same(5));
  const db = { users: [{ id: 7, role: 'employee', qa: { at: 100, answers: J(answers), meta: rtOf(() => 400), consent: { v: 1, base: true, ai: true } } }], audit: [] };
  assert.equal(qnDone(q, db.users[0]), true);
  qnRetake(db, 7, q, 3, 500);
  const qa = db.users[0].qa;
  assert.deepEqual(J(qa.answers), { why: 'Rivojlanish' }, 'анкета на месте, ответов теста нет');
  assert.equal(Object.keys(qa.prev.answers).length, 50, 'все 50 ответов теста — в первой попытке');
  assert.deepEqual([qa.prev.at, qa.prev.asked, qa.prev.by, qa.prev.meta.rt.i2], [100, 500, 3, 400]);
  assert.deepEqual(J(qa.retake), { at: 500, by: 3 });
  assert.deepEqual(J(qa.meta), { rt: {}, changes: 0 });
  assert.equal(qa.at, 100, 'дата отправки анкеты не стирается');
  assert.equal(qa.consent.ai, true, 'согласие на месте');
  assert.equal(qnDone(q, db.users[0]), false, 'пока не отправил заново — «к заполнению»');
  assert.equal(db.audit[0].key, 'qn-retake');
  // первая попытка по-прежнему считается — для строки «Birinchi urinish»
  assert.equal(qnQuality(q, qa.prev.answers, qa.prev.meta).level, 'red');
});

test('ИИ: пометки качества уходят готовым списком, пункты на внимательность и проверки — нет', async () => {
  const q = test50(); q.questions.unshift({ id: 'why', type: 'long', text: 'Nega BURAQ?' });
  const sent = [];
  const sampler = { json: p => { sent.push(p); return Promise.resolve({ summary: 'ok', strengths: [] }); } };
  const u = { id: 7, role: 'employee', qa: { at: 100, answers: Object.assign({ why: 'Rivojlanish' }, same(5)), meta: rtOf(() => 400), consent: { v: 1, base: true, ai: true } } };
  const db = { users: [u] };
  await qnAiRun({ sampler, q, u, lang: 'uz', by: 3, update: fn => fn(db) });
  assert.match(sent[0], /JAVOBLAR SIFATI[^\n]*\n- Javoblar sifati: Profil talqin qilinmaydi — Ketma-ket 50 ta bir xil javob/);
  assert.ok(!/Bu savolda «2» ni belgilang|mobil telefondan/.test(sent[0]), 'пункты-проверки в ИИ не уходят');
  assert.ok(/Fikr 1\n/.test(sent[0]), 'обычные пункты теста — уходят');
  const ok = Object.assign({}, u, { qa: Object.assign({}, u.qa, { answers: Object.assign({ why: 'x' }, honest()), meta: calm }) });
  await qnAiRun({ sampler, q, u: ok, lang: 'uz', by: 3, update: fn => fn({ users: [ok] }) });
  assert.ok(!/JAVOBLAR SIFATI/.test(sent[1]), 'зелёный — без пометок');
});

test('карточка — одной строкой: главная причина коротко (qnQTop), остальное — за «Batafsil»', () => {
  const red = qnQuality(Q, same(5), rtOf(() => 400));
  assert.equal(qnQTop(uz, red), 'ketma-ket 50 ta bir xil javob', 'красный — первая причина в несколько слов');
  assert.deepEqual(J(red.why.map(x => qnQShort(uz, x))), ['ketma-ket 50 ta bir xil javob', 'diqqat savollarida xato: 2 / 2', 'juftlarda ziddiyat: 10 / 10']);
  assert.ok(red.why.every(x => qnQShort(uz, x).length <= qnQWhy(uz, { level: 'red', why: [x] })[0].length), 'не длиннее причины в «Batafsil»');
  const slow = qnQuality(Q, honest(), rtOf(() => 1500));
  assert.equal(qnQTop(uz, slow), 'juda tez: bir fikrga 1,5 s');
  assert.equal(qnQTop(T('ru'), slow), 'слишком быстро: 1,5 с на ответ');
  assert.equal(qnQTop(uz, qnQuality(Q, honest(), rtOf(i => i < 11 ? 600 : 3000))), '1 soniyadan tez: 11 / 49');
  assert.equal(qnQTop(uz, qnQuality(Q, honest(), calm)), 'javoblar izchil, temp odatiy', 'зелёный — словами, без причины');
  assert.equal(qnQTop(uz, qnQuality(Q, honest(), null)), 'tekshirilganida shubhali belgi yo‘q', 'скорость не посчитана — «в проверенном»');
  const small = { questions: [1, 2, 3].map(i => ({ id: 's' + i, type: 'scale', scale: 'A', text: 'F' + i })), scales: [{ id: 'A', name: 'A', bands: [] }] };
  const na = qnQuality(small, { s1: 5, s2: 5, s3: 5 }, null);
  assert.equal(na.level, 'na'); assert.equal(qnQTop(uz, na), '', 'ничего не посчитано — одна приглушённая строка, без причины');
  assert.deepEqual(J(na.skip).sort(), ['attn', 'pairs', 'pattern', 'speed'], 'na — всегда все четыре пропуска (о них — qn_q_na_line)');
  // короткие причины и надписи строки — во всех четырёх языках
  const keys = ['qn_q_det', 'qn_q_why_h', 'qn_q_more', 'qn_q_prev_why', 'qn_q_sd_s', 'qn_q_na_line', 'qn_q_w_ok', 'qn_q_w_ok2', 'qn_q_w_acq_yes', 'qn_q_w_acq_no',
    'qn_q_w_speed', 'qn_q_w_fast', 'qn_q_w_run', 'qn_q_w_mid', 'qn_q_w_gross', 'qn_q_w_meand', 'qn_q_w_attn'];
  for (const l of ['uz', 'ru', 'en', 'zh']) for (const k of keys) assert.ok(T(l)(k) && T(l)(k) !== k, l + ': ' + k);
  const qual = app.slice(app.indexOf('  function QnQual('), app.indexOf('  function qnConsKind('));
  assert.match(qual, /className: 'qn-qual-more', hidden: !on/, '«Batafsil» — скрытый блок под строкой');
  assert.match(qual, /'aria-expanded': on, 'aria-controls': did/);
  const css = readFileSync(new URL('../lor.css', import.meta.url), 'utf8');
  assert.match(css, /body\.qn-printing \.qn-qual-more\[hidden\] \{ display: flex !important; \}/, 'в печати «Batafsil» раскрыт');
  assert.ok(!/^\.qn-q \{[^}]*border/m.test(css), 'у .qn-q (подпись вопроса в анкете) нет рамки блока «Javoblar sifati»');
});
