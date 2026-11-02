// «Savolnoma» → вариант «Boshqa» со своим ответом (app.js: QN_OTH_WORDS, qnIsOth, qnOthOpt, qnOthOn, qnOthMiss, qnText,
// qnAnsOut, qnShow, qnCsv, qnAiPrompt, qnTeamPrompt, qnConsSet, qnRetake). У вопроса с одним или несколькими вариантами
// вариант «Boshqa», «Boshqa (yozing)», «Другое», «Other», «其他» — поле «Yozing…»; свой ответ — answers[id + '__other']
// (до 200 знаков), без выбранного «Boshqa» и у скрытого условием вопроса не хранится; обязательный — без текста не отправить;
// в результатах, CSV и ИИ (через qnScrub) — «Boshqa: <текст>». Где ниже есть вопрос по условию [agar: Boshqa] — поля нет.
// Функции берём из app.js как есть (куски без React). Тексты — короткие синтетические. Запуск: node --test tests/
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
  'function fmtDate(ts) { return String(ts); }\n' +
  part('  var QN_TYPES', '  function qnYes(') + part('  var LANG_NAME', '  function stems(') +
  part('  function qnCsv(', '  /* шкалы одного человека') + part('  function qnNew(', '  function docxQnText(') +
  part('  /* AI-вывод по ответам', '  function QnAi(') + part('  /* ответ для CEO и SOP-менеджера: скрытый', '  /* карточка одного сотрудника'), ctx);
const { qnIsOth, qnOthOpt, qnOthOn, qnOthMiss, qnOthLabel, qnText, qnAnsOut, qnShow, qnCsv, qnAiPrompt, qnTeamPrompt, qnConsSet, qnRetake, qnScore, qnTemperAll, qnFromText } = ctx;
const J = x => JSON.parse(JSON.stringify(x));

// анкета: один вариант с «Boshqa (yozing)», несколько — с «Other», «Boshqa» с вопросом по условию (как раньше),
// вопрос по условию с «Другое», [maxfiy] с «Boshqa», необязательный с «Boshqa»
const Q = { questions: [
  { id: 'src', type: 'one', text: 'Biz haqimizda qayerdan bildingiz?', options: ['Telegram', 'Do‘st', 'Boshqa (yozing)'], req: true, key: true },
  { id: 'hob', type: 'many', text: 'Qiziqishlaringiz', options: ['Sport', 'Kitob', 'Other'], req: true },
  { id: 'job', type: 'one', text: 'Oldingi ish', options: ['Logistika', 'Boshqa'], req: true },
  { id: 'jobx', type: 'text', text: 'Qanday ish?', when: { q: 'job', any: ['Boshqa'] }, req: true },
  { id: 'fam', type: 'one', text: 'Oilaviy holat', options: ['Oilali', 'Yolg‘iz'] },
  { id: 'kid', type: 'one', text: 'Farzandlar kim bilan?', options: ['Ota-ona', 'Другое'], when: { q: 'fam', any: ['Oilali'] }, req: true },
  { id: 'hl', type: 'one', text: 'Sog‘liq', options: ['Yaxshi', '其他'], secret: true },
  { id: 'opt', type: 'many', text: 'Transport', options: ['Avtobus', ' BOSHQA '] }
] };

test('вариант «Boshqa»: короткий список слов без регистра и пробелов по краям; не выбор — поля нет', () => {
  for (const o of ['Boshqa', 'boshqa', 'Boshqa (yozing)', ' BOSHQA (YOZING) ', 'Другое', 'другое', 'Other', 'OTHER', '其他']) assert.equal(qnIsOth(o), true, o);
  for (const o of ['Boshqalar', 'Boshqa joyda', 'Другой город', 'Others', '', null, undefined]) assert.equal(qnIsOth(o), false, String(o));
  assert.deepEqual(Q.questions.map(x => qnOthOpt(Q, x)), ['Boshqa (yozing)', 'Other', null, null, null, 'Другое', '其他', ' BOSHQA '],
    '«Boshqa» с вопросом [agar: Boshqa] ниже — без поля: свой ответ пишут там, как раньше');
  assert.equal(qnOthOpt(Q, { id: 'z', type: 'text', text: 'Boshqa', options: ['Boshqa'] }), null, 'текстовый вопрос — нет');
  assert.equal(qnOthOpt(Q, { id: 'z', type: 'grid', options: ['Boshqa'], cols: ['1', '2'] }), null, 'таблица — нет');
  assert.equal(qnOthLabel('Boshqa (yozing)'), 'Boshqa'); assert.equal(qnOthLabel('Other'), 'Other'); assert.equal(qnOthLabel('(yozing)'), '(yozing)');
  // в тексте анкеты: «- Boshqa (yozing)» — обычный вариант; [agar: Boshqa] ведёт «Boshqa» — тогда поля нет
  const p = qnFromText('Qayerdan bildingiz? [tanlov]\n- Telegram\n- Boshqa (yozing)\nIsh [tanlov]\n- Ombor\n- Boshqa\nQanday? [qisqa] [agar: Boshqa]');
  assert.deepEqual(J(p.map(x => qnOthOpt({ questions: p }, x))), ['Boshqa (yozing)', null, null]);
});

test('выбран ли «Boshqa»: один — равенство, несколько — в списке; обязательный без текста — ошибка', () => {
  const [src, hob, job, , , , , opt] = Q.questions;
  assert.equal(qnOthOn(src, 'Boshqa (yozing)', 'Boshqa (yozing)'), true);
  assert.equal(qnOthOn(src, 'Telegram', 'Boshqa (yozing)'), false);
  assert.equal(qnOthOn(hob, ['Sport', 'Other'], 'Other'), true);
  assert.equal(qnOthOn(hob, ['Sport'], 'Other'), false);
  assert.equal(qnOthOn(hob, 'Other', 'Other'), false, 'у «несколько» ответ — список');
  assert.equal(qnOthOn(src, 'Boshqa (yozing)', null), false, 'без поля — никогда');
  assert.equal(qnOthMiss(Q, src, { src: 'Boshqa (yozing)' }), true, 'обязательный, «Boshqa» без текста');
  assert.equal(qnOthMiss(Q, src, { src: 'Boshqa (yozing)', src__other: '   ' }), true, 'пробелы — не ответ');
  assert.equal(qnOthMiss(Q, src, { src: 'Boshqa (yozing)', src__other: 'Instagram' }), false);
  assert.equal(qnOthMiss(Q, src, { src: 'Telegram' }), false, '«Boshqa» не выбран');
  assert.equal(qnOthMiss(Q, hob, { hob: ['Kitob', 'Other'] }), true);
  assert.equal(qnOthMiss(Q, job, { job: 'Boshqa' }), false, 'с вопросом по условию — ошибку даёт тот вопрос, не поле');
  assert.equal(qnOthMiss(Q, opt, { opt: [' BOSHQA '] }), false, 'необязательный — без текста можно');
});

test('ответ к сохранению: свой ответ — только при выбранном «Boshqa» и видимом вопросе, до 200 знаков, без пробелов по краям', () => {
  const cur = { src: 'Boshqa (yozing)', src__other: '  Instagram  ', hob: ['Sport'], hob__other: 'shaxmat', job: 'Boshqa', jobx: 'Bank', fam: 'Yolg‘iz', kid: 'Другое', kid__other: 'buvisi bilan', opt: [' BOSHQA '], opt__other: 'x'.repeat(300) };
  const o = J(qnAnsOut(Q, { old: 1, hob__other: 'eski' }, cur, null));
  assert.equal(o.src__other, 'Instagram');
  assert.equal('hob__other' in o, false, '«Other» снят — свой ответ (и прежний сохранённый) стёрт');
  assert.equal('kid' in o || 'kid__other' in o, false, 'вопрос скрыт условием («Yolg‘iz») — ни ответа, ни своего ответа');
  assert.equal(o.opt__other.length, 200, 'до 200 знаков');
  assert.equal(o.jobx, 'Bank', 'вопрос по условию [agar: Boshqa] — как раньше');
  assert.equal('job__other' in o, false, 'у «Boshqa», который ведёт вопрос по условию, своего поля нет');
  assert.equal(o.old, 1, 'прочие сохранённые ответы — на месте');
  // открыли «Oilali» — вопрос виден, свой ответ хранится; пустой текст — не хранится
  const o2 = J(qnAnsOut(Q, {}, Object.assign({}, cur, { fam: 'Oilali', src__other: '  ' }), null));
  assert.equal(o2.kid__other, 'buvisi bilan');
  assert.equal('src__other' in o2, false, 'пустой свой ответ не хранится');
  // [maxfiy] без согласия на особые данные скрыт — и свой ответ тоже
  const o3 = J(qnAnsOut(Q, {}, { hl: '其他', hl__other: 'allergiya' }, { v: 1, base: true, ai: false, special: false }));
  assert.equal('hl' in o3 || 'hl__other' in o3, false);
  assert.equal(J(qnAnsOut(Q, {}, { hl: '其他', hl__other: 'allergiya' }, { v: 1, base: true, special: true })).hl__other, 'allergiya');
});

test('в результатах: «Boshqa: <текст>» вместо варианта (один и несколько), без текста — сам вариант; [maxfiy] — точками', () => {
  const [src, hob, , , , , hl, opt] = Q.questions;
  assert.equal(qnText(src, 'Boshqa (yozing)', 'Instagram'), 'Boshqa: Instagram');
  assert.equal(qnText(src, 'Boshqa (yozing)'), 'Boshqa (yozing)', 'текста нет — вариант как есть');
  assert.equal(qnText(src, 'Telegram', 'Instagram'), 'Telegram', 'свой ответ без «Boshqa» не показывается');
  assert.equal(qnText(hob, ['Sport', 'Other'], ' shaxmat '), 'Sport, Other: shaxmat');
  assert.equal(qnText(opt, [' BOSHQA '], 'velosiped'), 'BOSHQA: velosiped');
  assert.equal(qnShow(hl, '其他', false, 'allergiya'), '••••••');
  assert.equal(qnShow(hl, '其他', true, 'allergiya'), '其他: allergiya');
  assert.equal(qnShow(src, 'Boshqa (yozing)', false, 'Instagram'), 'Boshqa: Instagram');
});

test('CSV: в столбце вопроса — «Boshqa: <текст>»; ИИ: через qnScrub (контакты убраны), [maxfiy] не уходит', () => {
  const T0 = ctx.T('uz');
  assert.equal(T0('qn_oth_ph'), 'Yozing…'); assert.equal(T0('qn_oth_err'), 'Boshqa variantni yozing');
  for (const l of ['ru', 'en', 'zh']) for (const k of ['qn_oth_ph', 'qn_oth_err', 'qn_oth_tag', 'qn_oth_tag_t']) assert.notEqual(ctx.T(l)(k), k, l + ': ' + k);
  const u = { id: 7, name: 'Dilnoza Karimova', role: 'employee', position: 'Omborchi', qa: { at: 100, consent: { v: 1, base: true, ai: true, special: false },
    answers: { src: 'Boshqa (yozing)', src__other: 'Instagram, @dilnoza_k, +998 90 123 45 67', hob: ['Sport', 'Other'], hob__other: 'Dilnoza bilan shaxmat', hl: '其他', hl__other: 'allergiya' } } };
  const db = { users: [u] };
  const csv = qnCsv(db, Q).replace(/^﻿/, '').split('\r\n').map(r => r.split(';'));
  const col = t => csv[0].indexOf(t);
  assert.equal(csv[1][col('Biz haqimizda qayerdan bildingiz?')], 'Boshqa: Instagram, @dilnoza_k, +998 90 123 45 67', 'CSV — как в карточке');
  assert.equal(csv[1][col('Qiziqishlaringiz')], 'Sport, Other: Dilnoza bilan shaxmat');
  assert.equal(csv[1][col('Sog‘liq')], '其他: allergiya', 'с согласием (шаг согласий пройден) [maxfiy] — в CSV, как и прежде');
  const res = qnScore(Q, u), pr = qnAiPrompt(Q, u, res, qnTemperAll(Q, res), 'uz', { now: 1 });
  assert.match(pr, /Biz haqimizda qayerdan bildingiz\?\n   Javob: Boshqa: Instagram, \[kontakt\], \[telefon\]/, 'свой ответ — в ИИ, контакты убраны');
  assert.match(pr, /Qiziqishlaringiz\n   Javob: Sport, Other: \[ism\] bilan shaxmat/, 'имя человека убрано');
  assert.ok(!/allergiya|Sog‘liq/.test(pr), '[maxfiy] — ни ответа, ни своего ответа');
  const tp = qnTeamPrompt(Q, [{ u, res }], 'uz', 1);
  assert.match(tp, /Biz haqimizda qayerdan bildingiz\?: Boshqa: Instagram, \[kontakt\], \[telefon\]/, 'в анализе коллектива — главный ответ со своим ответом');
});

test('без согласия на особые данные свой ответ [maxfiy] стирается вместе с ответом; повтор теста уносит и свой ответ', () => {
  const d = { settings: { questionnaire: Q }, audit: [], users: [{ id: 7, qa: { at: 1, answers: { hl: '其他', hl__other: 'allergiya', src: 'Telegram' } } }] };
  qnConsSet(d, 7, { v: 1, base: true, ai: false, special: false }, 50);
  assert.deepEqual(J(d.users[0].qa.answers), { src: 'Telegram' });
  // вопрос теста (шкала) с «Boshqa»: «пройти ещё раз» — ответ и свой ответ уходят в qa.prev
  const QT = { questions: [{ id: 't1', type: 'one', text: 'Bo‘sh vaqtda', options: ['Kitob', 'Boshqa'], scale: 'S', pts: [1, 2] }], scales: [{ id: 'S', name: 'S', bands: [] }] };
  const d2 = { audit: [], users: [{ id: 8, qa: { at: 1, answers: { t1: 'Boshqa', t1__other: 'rasm', x: 'q' } } }] };
  qnRetake(d2, 8, QT, 1, 60);
  assert.deepEqual(J(d2.users[0].qa.answers), { x: 'q' });
  assert.deepEqual(J(d2.users[0].qa.prev.answers), { t1: 'Boshqa', t1__other: 'rasm' });
});
