// «Savolnoma» → согласие: users[].qa.consent = { v, at, base, ai, special } (app.js: qnCons, qnConsOk, qnConsSet,
// qnShowIf с согласием, qnDone, qnAiAllowed, qnAiGone / qnAiPurge). Без особых данных вопросы [maxfiy] скрыты, не
// обязательны и их ответы стираются; без согласия на ИИ (и у анкет до шага согласий) в ИИ ничего не уходит, а отозвал —
// прежний вывод ИИ удаляется (и анализ коллектива с ним). Анкета, отправленная без согласия, снова «к заполнению» —
// спросят только согласие. Функции берём из app.js как есть (куски без React). Запуск: node --test tests/
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
  part('  /* AI-вывод по ответам', '  function QnAi('), ctx);
const { qnCons, qnConsOk, qnConsSet, qnShowIf, qnDone, qnDue, qnConsOnly, qnSecStored, qnScore, qnAiAllowed, qnAiGone, qnAiPurge, T } = ctx;
const J = x => JSON.parse(JSON.stringify(x));

// анкета: обычный вопрос, паспорт [maxfiy] (обязательный), вопрос по условию
const Q = { questions: [
  { id: 'why', type: 'long', text: 'Nega BURAQ?', req: true },
  { id: 'ps', type: 'text', text: 'Pasport seriyasi', secret: true, req: true },
  { id: 'fam', type: 'one', text: 'Oilaviy holat', options: ['Oilali', 'Yolg‘iz'] },
  { id: 'kids', type: 'text', text: 'Farzandlar soni', when: { q: 'fam', any: ['Oilali'] }, req: true }
] };
const ANS = { why: 'Rivojlanish', ps: 'AA 1234567', fam: 'Yolg‘iz' };
const who = (consent, extra = {}) => ({ id: 7, role: 'employee', qa: Object.assign({ at: 100, answers: Object.assign({}, ANS) }, consent === undefined ? {} : { consent }), ...extra });

test('согласие: действующее — base и версия не ниже QN_CONSENT_V; нет поля или старая версия — шаг согласий', () => {
  assert.equal(ctx.QN_CONSENT_V, 1);
  assert.equal(qnConsOk(who({ v: 1, at: 5, base: true, ai: false, special: false })), true);
  assert.equal(qnConsOk(who()), false, 'анкета до шага согласий');
  assert.equal(qnConsOk(who({ v: 0, base: true })), false, 'старая версия текста');
  assert.equal(qnConsOk(who({ v: 1, base: false, ai: true })), false, 'без обязательной галочки');
  assert.equal(qnCons(who('да')), null, 'не объект — согласия нет');
});

test('особые данные: без согласия на них [maxfiy] скрыт и не обязателен; анкета до согласий — как раньше', () => {
  const ps = Q.questions[1];
  assert.equal(qnShowIf(ps, ANS, { base: true, special: false }), false);
  assert.equal(qnShowIf(ps, ANS, { base: true, special: true }), true);
  assert.equal(qnShowIf(ps, ANS, null), true, 'поля согласий нет — виден, как раньше');
  assert.equal(qnShowIf(Q.questions[0], ANS, { special: false }), true, 'обычный вопрос — виден');
  assert.equal(qnShowIf(Q.questions[3], ANS, { special: true }), false, 'условие по-прежнему работает');
  const noPs = { why: 'Rivojlanish', fam: 'Yolg‘iz' };
  assert.equal(qnDone(Q, { qa: { at: 1, answers: noPs, consent: { v: 1, base: true, special: false } } }), true, 'паспорт не обязателен');
  assert.equal(qnDone(Q, { qa: { at: 1, answers: noPs, consent: { v: 1, base: true, special: true } } }), false, 'с согласием — обязателен');
  assert.equal(qnDone(Q, { qa: { at: 1, answers: noPs } }), false, 'до согласий — как раньше');
  const sq = { questions: [{ id: 'a', type: 'scale', scale: 'S', text: 'A', secret: true }, { id: 'b', type: 'scale', scale: 'S', text: 'B' }], scales: [{ id: 'S', name: 'S', bands: [] }] };
  assert.equal(qnScore(sq, { qa: { at: 1, answers: { a: 5, b: 3 }, consent: { v: 1, base: true, special: false } } })[0].total, 1, 'скрытый пункт не считается в шкале');
});

test('qnConsSet: пишет версию и время, меняет только переданное, без особых данных стирает ответы [maxfiy], пишет в журнал', () => {
  const d = { settings: { questionnaire: Q }, users: [who()], audit: [] };
  const c = qnConsSet(d, 7, { v: 1, base: true, ai: true, special: true }, 1000);
  assert.deepEqual(J(c), { v: 1, at: 1000, base: true, ai: true, special: true });
  assert.equal(d.users[0].qa.answers.ps, 'AA 1234567', 'с особыми данными ответ на месте');
  assert.equal(d.users[0].qa.at, 100, 'прочее в qa не тронуто');
  qnConsSet(d, 7, { ai: false }, 2000);
  assert.deepEqual(J(d.users[0].qa.consent), { v: 1, at: 2000, base: true, ai: false, special: true }, 'отозвал ИИ — остальное как было');
  qnConsSet(d, 7, { special: false }, 3000);
  assert.equal('ps' in d.users[0].qa.answers, false, 'отозвал особые данные — ответ на [maxfiy] стёрт');
  assert.equal(d.users[0].qa.answers.why, 'Rivojlanish', 'остальные ответы на месте');
  assert.deepEqual(J(d.audit.map(x => [x.key, x.userId, x.ai, x.special, x.at])), [['qn-consent', 7, false, false, 3000], ['qn-consent', 7, false, true, 2000], ['qn-consent', 7, true, true, 1000]], 'каждое изменение — в журнале');
  const d2 = { settings: { questionnaire: Q }, users: [who()], audit: [] };
  qnConsSet(d2, 7, { v: 1, base: true, ai: false, special: false }, 10);
  assert.equal('ps' in d2.users[0].qa.answers, false, 'шаг согласий без особых данных — ответ стёрт сразу');
});

test('ИИ: только с consent.ai; отозвал, не дал или анкета до согласий — прежний вывод удаляется', () => {
  const rep = { at: 200, v: 2, data: { summary: 'x' } };
  const d = { users: [
    who({ v: 1, base: true, ai: false }, { id: 1, qaReport: rep }),
    who({ v: 1, base: true, ai: true }, { id: 2, qaReport: rep }),
    who(undefined, { id: 3, qaReport: rep }),
    who({ v: 1, base: true, ai: false }, { id: 4 }),
    who({ v: 1, base: true, ai: false }, { id: 5, qaReport: { off: 300, offBy: 9, at: 200, v: 2 } })
  ] };
  assert.deepEqual(d.users.map(u => qnAiAllowed(u)), [false, true, false, false, false]);
  assert.deepEqual(J(qnAiGone(d)), [1, 3, 5], 'удалить — у тех, кто согласие отозвал, не дал или анкета до шага согласий');
  assert.equal(qnAiPurge(d), 3);
  assert.deepEqual(d.users.map(u => !!u.qaReport), [false, true, false, false, false], 'вывод остаётся только с согласием на ИИ');
  assert.deepEqual(J(qnAiGone(d)), []);
});

test('анализ коллектива: кто-то в нём без согласия на ИИ — текст удаляется, остаётся отметка gone; SOP-менеджер — только свою карточку', () => {
  const team = (ids) => ({ at: 50, by: 90, v: 2, ids, data: { summary: 'jamoa', people: [{ n: 1, note: 'birinchi' }] } });
  const mk = () => ({ users: [
    who({ v: 1, base: true, ai: false }, { id: 1 }),
    who({ v: 1, base: true, ai: true }, { id: 2 }),
    { id: 90, role: 'admin', post: 'ceo', qaTeam: team([1, 2]) },
    { id: 91, role: 'admin', post: 'sop', qaTeam: team([1, 2]) },
    { id: 92, role: 'admin', post: 'sop', qaTeam: team([2]) }] });
  const d = mk();
  const sopMine = u => u.id === 91;
  assert.deepEqual(J(qnAiGone(d, sopMine)), [91], 'SOP-менеджер чужие карточки руководства не пишет — только свою');
  assert.equal(qnAiPurge(d, sopMine, 777), 1);
  assert.deepEqual(J(d.users[3].qaTeam), { gone: 777, at: 50, by: 90, v: 2 }, 'текста и номеров нет — отметка');
  assert.ok(d.users[2].qaTeam.data, 'анализ CEO ждёт CEO (или сервер)');
  const d2 = mk();
  assert.equal(qnAiPurge(d2, null, 5), 2, 'CEO (или без ограничения) — все');
  assert.ok(!d2.users[2].qaTeam.data && !d2.users[3].qaTeam.data && d2.users[4].qaTeam.data, 'анализ, где все согласны, — на месте');
});

test('анкета отправлена без согласия (до шага согласий, старая версия, отозвано) — снова «к заполнению»: спросят только согласие', () => {
  const db = (u) => ({ settings: { questionnaire: Q }, users: [u] });
  const legacy = who();
  assert.equal(qnDone(Q, legacy), true, 'анкета полна');
  assert.equal(qnDue(db(legacy), legacy), true, '…но согласия нет — «к заполнению»');
  assert.equal(qnConsOnly(db(legacy), legacy), true, 'спросить только согласие');
  const ok = who({ v: 1, base: true, ai: false, special: true });
  assert.deepEqual([qnDue(db(ok), ok), qnConsOnly(db(ok), ok)], [false, false]);
  const off = who({ v: 1, base: false, ai: false, special: false }, { qa: { consent: { v: 1, base: false } } });
  assert.deepEqual([qnDue(db(off), off), qnConsOnly(db(off), off)], [true, false], 'отозвал обработку, ответов нет — анкета заново');
  const fresh = { id: 8, role: 'employee' };
  assert.deepEqual([qnDue(db(fresh), fresh), qnConsOnly(db(fresh), fresh)], [true, false]);
  assert.equal(qnSecStored(Q, ANS), true, 'ответ на [maxfiy] сохранён — без особых данных сначала спросить');
  assert.equal(qnSecStored(Q, { why: 'x' }), false);
});

test('надписи согласия — на uz, ru, en, zh; в тексте — Anthropic и США', () => {
  const keys = ['qn_cons_t', 'qn_cons_p', 'qn_cons_later', 'qn_cons_go', 'qn_cons_err', 'qn_cons_req', 'qn_cons_opt', 'qn_cons_base_t', 'qn_cons_base', 'qn_cons_ai_t', 'qn_cons_ai',
    'qn_cons_special_t', 'qn_cons_special', 'qn_cons_none', 'qn_cons_yes', 'qn_cons_no', 'qn_cons_c_base', 'qn_cons_c_ai', 'qn_cons_c_sp', 'qn_cons_c_title', 'qn_cons_l_base',
    'qn_cons_l_ai', 'qn_cons_l_sp', 'qn_cons_l_none', 'qn_ai_noask', 'qn_team_cons', 'qn_cons_box_t', 'qn_cons_saved', 'qn_cons_ai_gone', 'qn_cons_sp_off_q', 'qn_cons_base_on',
    'qn_cons_base_how', 'qn_cons_none_emp', 'qn_cons_give', 'qn_cons_base_off', 'qn_cons_base_off_q', 'qn_cons_base_gone', 'qn_cons_off_emp', 'qn_banner_cons',
    'qn_secret_wait', 'qn_team_gone', 'qn_test_ro', 'qn_q_sk_order'];
  for (const l of ['uz', 'ru', 'en', 'zh']) {
    const t = T(l);
    for (const k of keys) assert.notEqual(t(k), k, l + ': ' + k);
    assert.ok(/Anthropic/.test(t('qn_cons_ai')) && /(AQSH|США|USA|美国)/.test(t('qn_cons_ai')), l + ': ИИ-согласие называет Anthropic и США');
  }
  assert.equal(T('uz')('qn_cons_none'), 'rozilik so‘ralmagan');
  for (const l of ['uz', 'ru', 'en', 'zh']) assert.ok(T(l)('qn_cons_special').length > T('uz')('qn_cons_special_t').length && !/SOP/.test(T(l)('qn_cons_base_how')), l + ': особые — что прежние ответы удалятся; отзыв — не «через SOP»');
  assert.match(T('uz')('qn_cons_special'), /o‘chiriladi/);
});
