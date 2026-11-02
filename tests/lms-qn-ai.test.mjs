// «Savolnoma» → ИИ: запросы и разбор ответа в app.js (qnAiPrompt, qnAiClean, qnTeamPrompt, qnTeamClean, qnAiRun) —
// ИИ пересказывает измеренное («test o‘lchanmagan» без догадок о характере), у пунктов — evidence (без неё — прочь),
// вместо «fit» — «verify», в ИИ не уходят контакты, паспорт, имя, точная дата рождения (возрастная группа), прежние выводы
// ИИ в анализ коллектива не идут, без согласия на ИИ (u.qa.consent.ai) запрос не отправляется.
// Функции берём из app.js как есть (куски без React). Запуск: node --test tests/
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
  part('  var QN_TYPES', '  function qnYes(') + part('  var LANG_NAME', '  function stems(') +
  part('  /* AI-вывод по ответам', '  function QnAi(') + part('  /* ответ для CEO и SOP-менеджера: скрытый', '  /* карточка одного сотрудника'), ctx);
const { qnAiAllowed, qnAgeGroup, qnScrub, qnAiPrompt, qnAiClean, qnTeamPrompt, qnTeamClean, qnAiStale, qnAiRun, qnScore, qnTemperAll, T } = ctx;
const NOW = Date.UTC(2026, 10, 2, 12);   // 02.11.2026
const J = x => JSON.parse(JSON.stringify(x));   // объекты из vm — в обычные (для deepEqual)

// анкета: имя, телефон, дата рождения, паспорт (maxfiy), свободный текст, вопрос по условию, согласие; тест — одна шкала
const Q = { questions: [
  { id: 'nm', type: 'text', text: 'Ismingiz', prof: 'name' },
  { id: 'ph', type: 'text', text: 'Telefon raqamingiz', prof: 'phone' },
  { id: 'bd', type: 'date', text: 'Tug‘ilgan sanangiz', prof: 'birth' },
  { id: 'ps', type: 'text', text: 'Pasport seriyasi', secret: true },
  { id: 'why', type: 'long', text: 'Nega BURAQ?', key: true },
  { id: 'fam', type: 'one', text: 'Oilaviy holat', options: ['Oilali', 'Yolg‘iz'] },
  { id: 'kids', type: 'text', text: 'Farzandlar soni', when: { q: 'fam', any: ['Oilali'] } },
  { id: 'ok', type: 'consent', text: 'Roziman' },
  { id: 'sec', type: 'section', text: 'Test' },
  { id: 'm1', type: 'scale', scale: 'M', text: 'Yangi odamlar bilan tez chiqishaman' },
  { id: 'm2', type: 'scale', scale: 'M', text: 'Suhbatni o‘zim boshlayman' }
], scales: [{ id: 'M', name: 'Muloqot', bands: [] }] };
const ANS = { nm: 'Dilnoza Karimova', ph: '+998 90 123 45 67', bd: '1999-04-12', ps: 'AA 1234567', why: 'Rivojlanish uchun. Aloqa: dilnoza@mail.uz, @dilnoza_k, t.me/dilnoza, 90 555 66 77; 2015 - 2020 omborda ishladim, maosh 12 000 000',
  fam: 'Yolg‘iz', ok: true, m1: 4, m2: 5 };
const emp = (ans = ANS, extra = {}) => ({ id: 7, name: 'Dilnoza Karimova', role: 'employee', status: 'probation', position: 'Omborchi', department: 'Ombor', qa: { at: 100, answers: ans }, ...extra });
const promptOf = (q, u, o) => { const res = qnScore(q, u); return qnAiPrompt(q, u, res, qnTemperAll(q, res), 'uz', Object.assign({ now: NOW }, o)); };

test('согласие на ИИ: поля согласий нет — можно (как раньше); есть — только consent.ai === true', () => {
  assert.equal(qnAiAllowed(emp()), true);
  assert.equal(qnAiAllowed({ qa: { at: 1, answers: {}, consent: { ai: true } } }), true);
  assert.equal(qnAiAllowed({ qa: { at: 1, answers: {}, consent: { ai: false } } }), false);
  assert.equal(qnAiAllowed({ qa: { at: 1, answers: {}, consent: { general: true } } }), false, 'согласия дали, а на ИИ — нет');
  assert.equal(qnAiAllowed({}), true);
});

test('дата рождения → возрастная группа; контакты из текста убираются, годы, даты и суммы — нет', () => {
  assert.equal(qnAgeGroup('1999-04-12', NOW), '25–34');
  assert.equal(qnAgeGroup('12.04.1999', NOW), '25–34');
  assert.equal(qnAgeGroup('2001-11-03', NOW), '18–24', 'день рождения ещё не наступил — 24');
  assert.equal(qnAgeGroup('2010-01-01', NOW), '18 dan kichik');
  assert.equal(qnAgeGroup('1960-05-05', NOW), '55+');
  assert.equal(qnAgeGroup('bilmayman', NOW), '');
  const s = qnScrub('Tel +998 90 123-45-67, 90 555 66 77, a.b@mail.uz, @dilnoza_k, https://t.me/dilnoza; 2015 - 2020; 12.04.1999; 12 000 000 so‘m');
  assert.ok(!/123|555|mail\.uz|dilnoza/.test(s), 'нет телефонов, почты, ников: ' + s);
  assert.equal((s.match(/\[telefon\]/g) || []).length, 2);
  assert.ok(/\[email\]/.test(s) && /\[kontakt\]/.test(s));
  assert.ok(s.includes('2015 - 2020') && s.includes('12.04.1999') && s.includes('12 000 000'), 'годы, даты и суммы на месте: ' + s);
});

test('запрос по человеку: минимум данных — без имени, телефона, паспорта, согласий, скрытых условием вопросов; дата — группой', () => {
  const p = promptOf(Q, emp());
  assert.ok(/HR-psixolog/.test(p), 'роль в запросе (по ней отвечает заглушка e2e)');
  assert.ok(!/Dilnoza|Karimova/.test(p), 'имени нет');
  assert.ok(!/123 45 67|555 66 77|mail\.uz|dilnoza_k|t\.me/.test(p), 'контактов нет');
  assert.ok(!/AA 1234567|Pasport/.test(p), 'паспорта (maxfiy) нет');
  assert.ok(!/1999|12\.04/.test(p) && /yosh guruhi: 25–34/.test(p), 'дата рождения — возрастной группой');
  assert.ok(!/Roziman|Farzandlar soni|Ismingiz|Telefon raqamingiz/.test(p), 'согласия, скрытый условием вопрос и поля профиля не уходят');
  assert.ok(/Rivojlanish uchun/.test(p) && /2015 - 2020/.test(p), 'сам ответ — на месте');
  assert.ok(/Omborchi, Ombor/.test(p), 'должность и отдел');
});

test('запрос по человеку: пересказ измеренного, evidence, «verify» вместо «fit», запреты; без теста — «test o‘lchanmagan»', () => {
  const p = promptOf(Q, emp());
  assert.ok(/Muloqot: 4,5 \/ 5/.test(p), 'шкала — средним 1–5');
  assert.ok(/"evidence"/.test(p) && /"verify"/.test(p) && /"profile"/.test(p), 'новые поля');
  assert.ok(!/"fit"|"temperament"/.test(p), 'нет «fit» и «temperament»');
  assert.ok(!/taxmin qiling/.test(p.replace(/taxmin qilmang/g, '')), 'нет указания угадывать по ответам');
  assert.ok(/homiladorlik/.test(p) && /solishtirish/.test(p) && /bashorat/.test(p) && /ehtimol/.test(p), 'запреты и осторожные слова');
  assert.ok(/"plan"/.test(p) && /adaptatsiya/.test(p), 'сотруднику — помощь в адаптации');
  assert.ok(!/"plan"/.test(promptOf(Q, emp(ANS, { status: 'candidate' }))), 'кандидату — без «plan»');
  assert.ok(!/JAVOBLAR SIFATI/.test(p), 'пометок о качестве ответов нет — блока нет');
  assert.ok(/JAVOBLAR SIFATI[\s\S]*- test javoblari juda tez berilgan/.test(promptOf(Q, emp(), { notes: ['test javoblari juda tez berilgan', '', 5] })), 'пометки — готовым списком');
  const noTest = { questions: Q.questions.slice(0, 8), scales: [] };
  const p0 = promptOf(noTest, emp());
  assert.ok(/TEST: o‘lchanmagan/.test(p0) && /"profile": ""/.test(p0), 'теста нет — «o‘lchanmagan», профиль пустой');
  assert.ok(!/SHKALALAR/.test(p0));
});

test('разбор ответа: пункты без evidence и с медицинскими словами — прочь (счётчик), без теста — без «profile»', () => {
  const r = { profile: 'Muloqot 4,5 / 5.', summary: 'Javoblar ko‘rsatadiki, rivojlanishni xohlaydi. Ehtimol depressiv holatda.', fit: 'Lavozimga mos', temperament: 'Sangvinik',
    strengths: [{ text: 'Muloqotga ochiq bo‘lishi mumkin', evidence: 'Muloqot: 4,5 / 5' }, { text: 'Hammaga yoqadi', evidence: '' }, 'Puxta', { text: 'Nevrotik emas', evidence: 'Muloqot' }],
    risks: [{ text: 'Ish joyini tez almashtirgan', evidence: '«Tajriba»: 3 ta ish 2 yilda' }, { text: 'X', evidence: 'yo‘q' }],
    growth: [], management: [{ text: 'Aniq vazifa bering', evidence: '«Nega BURAQ?»: rivojlanish' }], roles: 'Mijozlar bilan ishlashda tekshirish mumkin',
    verify: ['Tig‘iz kunlarda qanday ishlaydi', 7], plan: ['Murabbiy biriktirish'], interview: ['Nega omborni tanladingiz?'] };
  const x = qnAiClean(r, { measured: true, emp: true });
  assert.deepEqual(J(x.strengths.map(y => y.text)), ['Muloqotga ochiq bo‘lishi mumkin']);
  assert.equal(x.strengths[0].evidence, 'Muloqot: 4,5 / 5');
  assert.deepEqual(J(x.risks.map(y => y.text)), ['Ish joyini tez almashtirgan']);
  assert.equal(x.summary, 'Javoblar ko‘rsatadiki, rivojlanishni xohlaydi.', 'предложение с медицинским словом убрано');
  assert.equal(x.dropped, 5, 'без основания (3), с запрещённым словом (1), предложение (1)');
  assert.deepEqual(J([x.verify, x.plan, x.interview]), [['Tig‘iz kunlarda qanday ishlaydi'], ['Murabbiy biriktirish'], ['Nega omborni tanladingiz?']]);
  assert.ok(!('fit' in x) && !('temperament' in x), 'прежних полей нет');
  const y = qnAiClean(r, { measured: false, emp: false });
  assert.deepEqual(J([y.profile, y.plan]), ['', []], 'без теста — без «profile», не сотруднику — без «plan»');
  assert.equal(qnAiClean({ text: 'x' }), null);
});

test('вывод ИИ: хранится с версией запроса, кто готовил, входные баллы; без согласия запрос не уходит', async () => {
  const db = { users: [emp()] };
  let sent = '';
  const sampler = { json: (pr) => { sent = pr; return Promise.resolve({ summary: 'Qisqa', strengths: [{ text: 'A', evidence: 'Muloqot: 4,5 / 5' }] }); } };
  await qnAiRun({ sampler, q: Q, u: db.users[0], lang: 'ru', by: 3, auto: true, update: fn => fn(db) });
  const rep = db.users[0].qaReport;
  assert.ok(/HR-psixolog/.test(sent));
  assert.deepEqual([rep.v, rep.by, rep.auto, rep.lang, rep.data.summary], [ctx.QN_AI_V, 3, true, 'ru', 'Qisqa']);
  assert.deepEqual(J(rep.scores), [{ s: 'M', m: 4.5, n: 2 }], 'входные баллы');
  assert.equal(qnAiStale(db.users[0]), false);
  let called = false;
  const no = emp(ANS, { qa: { at: 100, answers: ANS, consent: { ai: false } } });
  await assert.rejects(qnAiRun({ sampler: { json: () => { called = true; return Promise.resolve({}); } }, q: Q, u: no, lang: 'uz', by: 3, update: () => {} }), e => e.code === 'no_consent');
  assert.equal(called, false, 'без согласия — в ИИ ничего');
});

test('устарел: ответы новее, прежняя версия запроса; отклонённый — заново только после новых ответов', () => {
  const V = ctx.QN_AI_V;
  assert.equal(qnAiStale(emp()), true, 'вывода нет');
  assert.equal(qnAiStale(emp(ANS, { qaReport: { at: 200, v: V, data: { summary: 'x' } } })), false);
  assert.equal(qnAiStale(emp(ANS, { qaReport: { at: 50, v: V, data: { summary: 'x' } } })), true, 'ответы новее');
  assert.equal(qnAiStale(emp(ANS, { qaReport: { at: 200, data: { summary: 'x', fit: 'y' } } })), true, 'вывод прежней версии (без v)');
  assert.equal(qnAiStale(emp(ANS, { qaReport: { off: 300, offBy: 3, at: 200, v: V } })), false, 'отклонён — сам не готовится');
  assert.equal(qnAiStale({ ...emp(), qa: { at: 400, answers: ANS }, qaReport: { off: 300, offBy: 3 } }), true, 'отклонён, но ответы новее');
});

test('анализ коллектива: номера вместо имён, без прежних выводов ИИ и контактов, без «состава по темпераментам» и «кого нанять»; от 5 человек', () => {
  const tm = { ...Q, scales: [{ id: 'M', name: 'Muloqot', bands: [] }], temper: { mode: 'max', map: { M: 'sanguine' } } };
  const rows = [1, 2, 3, 4, 5].map(i => { const u = emp(ANS, { id: i, name: 'Xodim ' + i, qaReport: { at: 200, v: 2, data: { summary: 'AVVALGI XULOSA ' + i } } }); const res = qnScore(tm, u); return { u, res, ta: qnTemperAll(tm, res) }; });
  const p = qnTeamPrompt(tm, rows, 'uz', NOW);
  assert.ok(/HR-tahlilchi/.test(p) && /XODIMLAR \(5\)/.test(p) && /#5 — Omborchi, Ombor/.test(p));
  assert.ok(!/Xodim \d|Dilnoza/.test(p), 'имён нет');
  assert.ok(!/AVVALGI XULOSA|AI xulosasi/.test(p), 'прежние выводы ИИ не идут');
  assert.ok(!/temperament: |Yetakchi moyillik/.test(p), 'склонности словами по людям не идут');
  assert.ok(!/mail\.uz|555 66 77/.test(p), 'контактов в главных ответах нет');
  assert.ok(!/"composition"|"hiring"/.test(p) && /"gaps"/.test(p) && /muvozanati/.test(p), 'нет состава и найма; «пробелы» — для обсуждения');
  assert.equal(ctx.QN_TEAM_MIN, 5);
  const x = qnTeamClean({ summary: 'Ko‘pchilik o‘zini puxta deb tasvirlaydi.', composition: 'Sangviniklar ko‘p', hiring: 'Xolerik oling', gaps: ['Savdo tajribasi kam'], people: [{ n: 1, note: 'Hujjatlarda tekshirish mumkin' }, { n: 9, note: 'yo‘q' }], risks: [], actions: ['Muhokama qiling'] }, 5);
  assert.ok(!('composition' in x) && !('hiring' in x));
  assert.deepEqual(J(x.people), [{ n: 1, note: 'Hujjatlarda tekshirish mumkin' }], 'номер вне списка — прочь');
  assert.equal(x.gaps[0], 'Savdo tajribasi kam');
});

test('надписи ИИ — на всех четырёх языках', () => {
  const keys = ['qn_ai_draft', 'qn_ai_dismiss', 'qn_ai_dismiss_q', 'qn_ai_dismissed', 'qn_ai_off', 'qn_ai_off_again', 'qn_ai_old', 'qn_ai_noconsent', 'qn_ai_profile', 'qn_ai_ev',
    'qn_ai_verify', 'qn_ai_dropped', 'qn_ai_made_by', 'qn_team_min', 'qn_team_self', 'qn_team_gaps', 'qn_team_people', 'qn_ai_roles', 'qn_ai_plan'];
  for (const l of ['uz', 'ru', 'en', 'zh']) { const t = T(l); for (const k of keys) assert.notEqual(t(k), k, l + ': ' + k); }
  assert.equal(T('uz')('qn_ai_draft'), 'AI qoralamasi: o‘z-o‘zini baholash javoblari asosida, xato bo‘lishi mumkin');
  assert.ok(!/temperament/i.test(T('uz')('qn_team_none')) && !/temperament/i.test(T('uz')('qn_ai_none')), 'описания без «темперамента»');
});
