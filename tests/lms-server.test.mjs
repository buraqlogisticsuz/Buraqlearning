// Сервер учебной платформы (tools/lms-gs/Server.gs) на заглушках Apps Script: запуск, вход, что видит сотрудник,
// какие правки он может делать, тест урока, пароли, копии. Запуск: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pbkdf2Sync } from 'node:crypto';
import { loadLms } from './lms-gs-mock.mjs';
import { buildLmsGs, pageScript } from '../tools/build-lms-gs.mjs';
import { createRequire } from 'node:module';

const g_pay = createRequire(import.meta.url)('../lms-pay.js');

const DAY = 864e5;
const quiz = [{ q: 'Q1', options: ['a', 'b'], answer: 1 }, { q: 'Q2', options: ['a', 'b'], answer: 0 }];
const course = { sections: [
  { id: 's1', title: 'Ombor', officialOnly: false, lessons: [{ id: 'b4-1', title: '4.1', html: '<p>matn</p>', quiz }, { id: 'b4-2', title: '4.2', html: '<p>ikki</p>', quiz }] },
  { id: 's2', title: 'Bojxona', officialOnly: true, lessons: [{ id: 'b4-9', title: '4.9', html: '<p>yopiq</p>', quiz, intro: 'x' }] }] };

// руководство: первый вход CEO создаёт SOP-менеджер (пока CEO нет), PM и руководителя (владельца) — CEO
function chiefs({ A, login }) {
  assert.deepEqual(A({ action: 'patch', ops: [{ op: 'set', path: ['users', { id: 10901 }], value: { id: 10901, role: 'admin', post: 'ceo', login: 'ceo', password: 'pw-ceo-1', name: 'Bosh direktor', position: 'CEO' } }] }).rejected, []);
  const C = login('ceo', 'pw-ceo-1');
  assert.deepEqual(C({ action: 'patch', ops: [
    { op: 'set', path: ['users', { id: 10902 }], value: { id: 10902, role: 'leader', post: 'pm', login: 'pm', password: 'pw-pm-1', name: 'Loyiha rahbari', position: 'Project Manager' } },
    { op: 'set', path: ['users', { id: 10903 }], value: { id: 10903, role: 'admin', post: 'boss', login: 'boss', password: 'pw-boss-1', name: 'Kompaniya egasi', position: 'Rahbar' } }] }).rejected, []);
  return { C, P: login('pm', 'pw-pm-1'), B: login('boss', 'pw-boss-1') };
}

// запущенная платформа: SOP-менеджер, три сотрудника (наставник Sardor — официальный), курс, журнал и кейсы
function platform(opts = {}) {
  const g = loadLms({ iter: 50, ...opts });
  const adm = g.ctx.setup();
  const a = g.post({ action: 'login', login: adm.login, password: adm.password });
  assert.equal(a.ok, true, JSON.stringify(a));
  const A = body => g.post({ token: a.token, ...body });
  const users = [
    { id: 10427, role: 'employee', login: 'd.karimova', password: 'pw-dilnoza', name: 'Dilnoza Karimova', position: 'Mijozlar menejeri', department: 'Logistika bo‘limi', status: 'probation', passport: { name: 'p.pdf' } },
    { id: 10391, role: 'employee', login: 'a.yusupova', password: 'pw-aziza', name: 'Aziza Yusupova', position: 'Omborchi', department: 'Ombor (Yiwu)', status: 'probation', pulse: { n: 4, answers: ['секрет'] } },
    { id: 10288, role: 'employee', login: 's.rahimov', password: 'pw-sardor', name: 'Sardor Rahimov', position: 'Logistika menejeri', department: 'Logistika bo‘limi', status: 'official', mentor: true, level: 1 }];
  const r = A({ action: 'patch', ops: [
    { op: 'set', path: ['course'], value: course },
    ...users.map(u => ({ op: 'set', path: ['users', { id: u.id }], value: u })),
    { op: 'set', path: ['progress', '10391'], value: { 'b4-1': { status: 'passed', score: 90, comment: 'yaxshi', at: 1 } } },
    { op: 'set', path: ['notifications', { id: 1 }], value: { id: 1, userId: 10391, text: 'Azizaga', read: false } },
    { op: 'set', path: ['notifications', { id: 2 }], value: { id: 2, userId: 10427, text: 'Dilnozaga', read: false } },
    { op: 'set', path: ['surveys', { id: 's1' }], value: { id: 's1', uid: 10391, answers: ['shaxsiy'] } },
    { op: 'set', path: ['journals', { id: 'j1' }], value: { id: 'j1', status: 'published', title: 'Ombor', access: { mode: 'all', canAdd: 'viewers' }, rows: [] } },
    { op: 'set', path: ['journals', { id: 'j2' }], value: { id: 'j2', status: 'published', title: 'Bojxona', access: { mode: 'custom', depts: ['Bojxona bo‘limi'] }, rows: [] } },
    { op: 'set', path: ['journals', { id: 'j3' }], value: { id: 'j3', status: 'draft', title: 'Qoralama', access: { mode: 'all' }, rows: [] } },
    { op: 'set', path: ['cases', { id: 'c1' }], value: { id: 'c1', status: 'published', title: 'Ochiq' } },
    { op: 'set', path: ['cases', { id: 'c2' }], value: { id: 'c2', status: 'draft', title: 'Qoralama' } },
    { op: 'set', path: ['initiatives', { id: 'i1' }], value: { id: 'i1', uid: 10391, status: 'accepted', title: 'Aziza g‘oyasi', text: 'batafsil' } },
    { op: 'set', path: ['xtasks', { id: 'x1' }], value: { id: 'x1', uid: 10427, title: 'Vazifa', xp: 50, status: 'open', by: adm.login } },
    { op: 'set', path: ['sopUpdates', { id: 'u1' }], value: { id: 'u1', lessonId: 'b4-1', required: [10427], acks: {} } }] });
  assert.deepEqual(r.rejected, []);
  const login = (l, p) => { const x = g.post({ action: 'login', login: l, password: p }); assert.equal(x.ok, true, JSON.stringify(x)); return body => g.post({ token: x.token, ...body }); };
  return { g, adm, A, login, D: login('d.karimova', 'pw-dilnoza'), Z: login('a.yusupova', 'pw-aziza'), M: login('s.rahimov', 'pw-sardor') };
}
const rejected = r => r.rejected.map(x => x.reason);

test('setup: папка и state.json на Диске, вход SOP-менеджера в журнале, ночная копия; повторный setup отказывает', () => {
  const g = loadLms({ iter: 50 });
  assert.equal(g.get().ready, false);
  assert.equal(g.post({ action: 'load', token: 'x' }).code, 'auth');
  const adm = g.ctx.setup();
  assert.equal(adm.login, 'metodist'); assert.match(adm.password, /^[a-z2-9]{10}$/);
  assert.ok(g.logs.includes('логин: metodist') && g.logs.includes('пароль: ' + adm.password), 'логин и пароль — каждый в своей строке журнала');
  assert.equal(g.get().ready, true);
  const st = g.state();
  assert.equal(st.users.length, 1); assert.equal(st.users[0].role, 'admin'); assert.equal(st.users[0].password, undefined);
  assert.ok(!JSON.stringify(st).includes(adm.password));
  assert.deepEqual(g.triggers.map(t => [t.getHandlerFunction(), t.hour, t.every]), [['backup', 3, undefined], ['ppSweep', undefined, 1]]);
  assert.throws(() => g.ctx.setup(), /уже настроена/);
  const second = g.ctx.newAdmin();
  assert.equal(second.login, 'metodist2');
  assert.equal(g.post({ action: 'login', login: 'METODIST2 ', password: second.password }).ok, true);
  // скопирован из журнала с точкой или пробелом — тоже входит; чужой пароль — нет
  assert.equal(g.post({ action: 'login', login: 'metodist2', password: second.password + '.' }).ok, true);
  assert.equal(g.post({ action: 'login', login: 'metodist2', password: ' ' + second.password + ' ' }).ok, true);
  assert.equal(g.post({ action: 'login', login: 'metodist2', password: adm.password + '.' }).code, 'login');
});

test('пароль хранится как PBKDF2-SHA256 с солью (10 000 повторов), а не открытым текстом', () => {
  const g = loadLms();
  const adm = g.ctx.setup();
  const cred = JSON.parse(Object.entries(g.props).find(([k]) => k.startsWith('cred:'))[1]);
  assert.equal(cred.iter, 10000);
  assert.equal(cred.hash, pbkdf2Sync(adm.password, cred.salt, 10000, 32, 'sha256').toString('hex'));
  assert.ok(!JSON.stringify(g.props).includes(adm.password));
});

test('вход: неверный пароль и чужой логин — одна ошибка; 5 неверных подряд — 15 минут без входа', () => {
  const now = { value: Date.UTC(2026, 9, 10, 8) };
  const g = loadLms({ iter: 50, now });
  const adm = g.ctx.setup();
  assert.equal(g.post({ action: 'login', login: 'nobody', password: 'x' }).code, 'login');
  for (let i = 0; i < 5; i++) assert.equal(g.post({ action: 'login', login: 'metodist', password: 'bad' + i }).code, 'login');
  const locked = g.post({ action: 'login', login: 'metodist', password: adm.password });
  assert.equal(locked.code, 'locked'); assert.match(locked.error, /15 мин/);
  now.value += 16 * 6e4;
  const ok = g.post({ action: 'login', login: 'metodist', password: adm.password });
  assert.equal(ok.ok, true); assert.ok(ok.token.length >= 64);
  // счётчики — только в кэше (живут 15 минут), свойства скрипта не засоряются перебором логинов
  assert.equal(Object.keys(g.props).filter(k => k.startsWith('fail:')).length, 0);
  assert.equal(g.cache.size, 1);
  now.value += 16 * 6e4;
  assert.equal(g.ctx.CacheService.getScriptCache().get([...g.cache.keys()][0]), null);
});

test('один человек — не больше 10 входов одновременно: самый старый закрывается', () => {
  const now = { value: Date.UTC(2026, 9, 10, 8) };
  const g = loadLms({ iter: 50, now });
  const adm = g.ctx.setup();
  const tokens = [];
  for (let i = 0; i < 11; i++) { now.value += 1000; tokens.push(g.post({ action: 'login', login: 'metodist', password: adm.password }).token); }
  assert.equal(Object.keys(g.props).filter(k => k.startsWith('sess:')).length, 10);
  assert.equal(g.post({ action: 'load', token: tokens[0] }).code, 'auth');
  assert.equal(g.post({ action: 'load', token: tokens[10] }).ok, true);
});

test('сессия: выход закрывает токен; через 30 дней без запросов нужен новый вход', () => {
  const now = { value: Date.UTC(2026, 9, 10, 8) };
  const g = loadLms({ iter: 50, now });
  const adm = g.ctx.setup();
  const t1 = g.post({ action: 'login', login: 'metodist', password: adm.password }).token;
  const t2 = g.post({ action: 'login', login: 'metodist', password: adm.password }).token;
  assert.equal(g.post({ action: 'load', token: t1 }).ok, true);
  assert.equal(g.post({ action: 'logout', token: t1 }).ok, true);
  assert.equal(g.post({ action: 'load', token: t1 }).code, 'auth');
  now.value += 31 * DAY;
  assert.equal(g.post({ action: 'load', token: t2 }).code, 'auth');
  assert.ok(!Object.keys(g.props).some(k => k.startsWith('sess:') && JSON.parse(g.props[k]).exp < now.value));
});

test('SOP-менеджер добавляет сотрудника с паролем: пароль уходит в учётную запись, в данных его нет; занятый логин не принимается', () => {
  const { g, A, login } = platform();
  assert.ok(!g.state().users.some(u => 'password' in u));
  assert.ok(!g.files[g.props.LMS_STATE].content.includes('pw-dilnoza'));
  const dup = A({ action: 'patch', ops: [{ op: 'set', path: ['users', { id: 10500 }], value: { id: 10500, role: 'employee', login: 'D.Karimova', password: 'x1234567', name: 'Dubl' } }] });
  assert.match(rejected(dup)[0], /логин «d.karimova» уже занят/);
  assert.equal(g.state().users.find(u => u.id === 10500).login, undefined);
  assert.equal(g.post({ action: 'login', login: 'd.karimova', password: 'x1234567' }).code, 'login');
  // смена логина SOP-менеджером
  A({ action: 'patch', ops: [{ op: 'set', path: ['users', { id: 10427 }, 'login'], value: 'dilnoza' }] });
  login('dilnoza', 'pw-dilnoza');
  // удалённый сотрудник теряет вход и сессии
  const S = login('a.yusupova', 'pw-aziza');
  A({ action: 'patch', ops: [{ op: 'del', path: ['users', { id: 10391 }] }] });
  assert.equal(S({ action: 'load' }).code, 'auth');
  assert.equal(g.post({ action: 'login', login: 'a.yusupova', password: 'pw-aziza' }).code, 'login');
  assert.ok(!g.props['cred:10391']);
});

test('сотрудник видит только своё: ответы тестов, закрытые разделы, чужие анкеты, опросы и уведомления скрыты', () => {
  const { D, M } = platform();
  const v = D({ action: 'load' }), st = v.state;
  assert.equal(v.me, 10427);
  const s1 = st.course.sections[0], s2 = st.course.sections[1];
  assert.equal(s1.lessons[0].html, '<p>matn</p>');
  assert.ok(s1.lessons[0].quiz.every(q => !('answer' in q)));
  assert.deepEqual(s2.lessons[0], { id: 'b4-9', title: '4.9' });
  const aziza = st.users.find(u => u.id === 10391), me = st.users.find(u => u.id === 10427);
  assert.deepEqual(aziza.pulse, { n: 4 }); assert.equal(aziza.login, undefined);
  assert.deepEqual(me.passport, { name: 'p.pdf' });
  assert.ok(!st.users.some(u => 'password' in u));
  assert.deepEqual(st.progress['10391'], { 'b4-1': { status: 'passed', score: 90 } });
  assert.deepEqual(st.notifications.map(n => n.id), [2]);
  assert.deepEqual(st.surveys, []);
  assert.deepEqual(st.initiatives, [{ id: 'i1', uid: 10391, status: 'accepted' }]);
  assert.deepEqual(st.journals.map(j => j.id), ['j1']);
  assert.deepEqual(st.cases.map(c => c.id), ['c1']);
  assert.deepEqual(st.xtasks[0].title, 'Vazifa');
  // официальный сотрудник видит закрытый раздел целиком, но без ответов
  const ms = M({ action: 'load' }).state.course.sections[1].lessons[0];
  assert.equal(ms.html, '<p>yopiq</p>'); assert.ok(!('answer' in ms.quiz[0]));
});

test('сотрудник: свои правки проходят, чужие и «методистские» — нет', () => {
  const { g, D } = platform(), today = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
  const r = D({ action: 'patch', ops: [
    /* 0 */ { op: 'set', path: ['progress', '10427'], value: { 'b4-1': { status: 'in-progress', at: 5 } } },
    /* 1 */ { op: 'set', path: ['users', { id: 10427 }, 'reminderTime'], value: '20:00' },
    /* 2 */ { op: 'set', path: ['users', { id: 10427 }, 'plan', 'p1'], value: { at: 6, by: 10427 } },
    /* 3 */ { op: 'set', path: ['study', '10427', today], value: 40 },
    /* 4 */ { op: 'set', path: ['notifications', { id: 2 }, 'read'], value: true },
    /* 5 */ { op: 'set', path: ['requests', { id: 'q1' }], value: { id: 'q1', type: 'question', userId: 10427, lessonId: 'b4-1', text: 'savol', state: 'open' }, after: null },
    /* 6 */ { op: 'set', path: ['notifications', { id: 3 }], value: { id: 3, userId: 10001, kind: 'shot', shot: { uid: 10427, name: 'Dilnoza Karimova', how: 'prtsc' } }, after: null },
    /* 7 */ { op: 'set', path: ['sopUpdates', { id: 'u1' }, 'acks', '10427'], value: 77 },
    /* 8 */ { op: 'set', path: ['journals', { id: 'j1' }, 'rows', { id: 'r1' }], value: { id: 'r1', by: 10427, v: { a: 1 } }, after: null },
    /* 9 */ { op: 'set', path: ['xtasks', { id: 'x1' }, 'sub'], value: { text: 'bajarildi' } },
    /* 10 */ { op: 'set', path: ['xtasks', { id: 'x1' }, 'status'], value: 'review' },
    // дальше — отказы
    /* 11 */ { op: 'set', path: ['progress', '10391', 'b4-2'], value: { status: 'in-progress' } },
    /* 12 */ { op: 'set', path: ['users', { id: 10427 }, 'level'], value: 5 },
    /* 13 */ { op: 'set', path: ['users', { id: 10427 }, 'status'], value: 'official' },
    /* 14 */ { op: 'set', path: ['users', { id: 10391 }, 'reminderTime'], value: '06:00' },
    /* 15 */ { op: 'set', path: ['notifications', { id: 1 }, 'read'], value: true },
    /* 16 */ { op: 'set', path: ['course', 'sections'], value: [] },
    /* 17 */ { op: 'set', path: ['xtasks', { id: 'x1' }, 'xp'], value: 5000 },
    /* 18 */ { op: 'set', path: ['xtasks', { id: 'x2' }], value: { id: 'x2', uid: 10427, xp: 900 } },
    /* 19 */ { op: 'set', path: ['initiatives', { id: 'i2' }], value: { id: 'i2', uid: 10427, status: 'accepted' } },
    /* 20 */ { op: 'set', path: ['requests', { id: 'q2' }], value: { id: 'q2', userId: 10391, text: 'Aziza nomidan' } },
    /* 21 */ { op: 'set', path: ['journals', { id: 'j2' }, 'rows', { id: 'r2' }], value: { id: 'r2', by: 10427 } },
    /* 22 */ { op: 'set', path: ['session'], value: { userId: 10001 } },
    /* 23 */ { op: 'set', path: ['notifications'], value: [] },
    /* 24 */ { op: 'set', path: ['errors', { id: 'e1' }], value: { id: 'e1', uid: 10391, by: 10427, text: 'xato' } },
    /* 25 */ { op: 'set', path: ['audit', { id: 'a1' }], value: { id: 'a1', userId: 10391 } },
    /* 26 */ { op: 'set', path: ['sopUpdates', { id: 'u1' }, 'acks', '10391'], value: 1 },
    /* 27 */ { op: 'set', path: ['users', { id: 10427 }], value: { id: 10427, role: 'admin' } },
    /* 28 */ null,
    /* 29 */ { op: 'set', path: ['notifications', { id: 4 }], value: { id: 4, userId: 10391, promo: { li: 5 } } },
    // v20: другому — только уведомление о своём действии, не любой текст; минуты учёбы — только за сегодня и не больше суток
    /* 30 */ { op: 'set', path: ['notifications', { id: 5 }], value: { id: 5, userId: 10001, text: 'Maoshingiz tasdiqlandi' } },
    /* 31 */ { op: 'set', path: ['notifications', { id: 6 }], value: { id: 6, userId: 10391, kind: 'pay', pay: { s: 'ok', total: 1 } } },
    /* 32 */ { op: 'set', path: ['study', '10427', '2025-01-01'], value: 600 },
    /* 33 */ { op: 'set', path: ['study', '10427', today], value: 99999 }] });
  assert.deepEqual(r.rejected.map(x => x.i), [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33]);
  assert.equal(r.applied, 11);
  const st = g.state();
  assert.equal(st.users.find(u => u.id === 10427).reminderTime, '20:00');
  assert.equal(st.users.find(u => u.id === 10427).level, undefined);
  assert.deepEqual(st.notifications.map(n => [n.id, n.read, n.from]), [[3, undefined, 10427], [1, false, undefined], [2, true, undefined]]);
  assert.equal(st.journals[0].rows[0].id, 'r1');
  assert.equal(st.xtasks[0].status, 'review'); assert.equal(st.xtasks[0].xp, 50);
  assert.equal(st.session, undefined);
});

test('идеи: адресат — CEO, Project Manager или руководитель; он видит и отвечает только на свои, SOP-менеджер их не читает', () => {
  const pf = platform(), { g, A, D, Z } = pf, { C, P } = chiefs(pf);
  const idea = (id, to, extra) => ({ op: 'set', path: ['initiatives', { id }], value: { id, uid: 10427, to, type: 'idea', area: 'it', title: 'G‘oya ' + id, text: 'Batafsil matn ' + id, status: 'new', at: 5, ...extra } });
  const sent = D({ action: 'patch', ops: [
    idea('i5', 'ceo'), idea('i6', 'pm'),
    /* 2 */ idea('i7', undefined), /* 3 */ idea('i8', 'hr'), /* 4 */ idea('i9', 'ceo', { reply: 'o‘zim javob berdim' }),
    { op: 'set', path: ['notifications', { id: 50 }], value: { id: 50, userId: 10901, kind: 'ini_in', ini: { to: 'ceo' }, at: 5, read: false } },
    // несколько адресатов: список без повторов, только CEO, Project Manager, руководитель
    /* 6 */ idea('i10', ['ceo', 'pm']), /* 7 */ idea('i11', []), /* 8 */ idea('i12', ['ceo', 'ceo']), /* 9 */ idea('i13', ['pm', 'hr'])] });
  assert.deepEqual(sent.rejected.map(x => x.i), [2, 3, 4, 7, 8, 9]);
  assert.match(sent.rejected[0].reason, /кому отправить идею/); assert.match(sent.rejected[2].reason, /даёт её адресат/);

  // CEO видит всю платформу; идеи, адресованные CEO, — целиком, адресованные только PM — без названия и текста
  const cv = C({ action: 'load' }).state;
  assert.equal(cv.initiatives.find(x => x.id === 'i5').text, 'Batafsil matn i5');
  assert.equal(cv.initiatives.find(x => x.id === 'i6').text, undefined, 'идея только для PM');
  assert.equal(cv.course.sections.length, 2); assert.ok(cv.notifications.some(n => n.id === 50));
  // PM видит только свои идеи и почти ничего больше
  const pv = P({ action: 'load' }).state;
  assert.deepEqual(pv.initiatives.map(x => x.id).sort(), ['i10', 'i6']);
  assert.deepEqual(pv.course.sections, []); assert.deepEqual(pv.progress, {}); assert.deepEqual(pv.journals, []); assert.deepEqual(pv.errors, []);
  const author = pv.users.find(u => u.id === 10427);
  assert.equal(author.name, 'Dilnoza Karimova'); assert.equal(author.passport, undefined); assert.equal(author.login, undefined);

  // ответ на свою идею — можно; чужую идею, текст идеи, курс, свою должность — нельзя
  const ans = C({ action: 'patch', ops: [
    { op: 'set', path: ['initiatives', { id: 'i5' }, 'status'], value: 'accepted' },
    { op: 'set', path: ['initiatives', { id: 'i5' }, 'reply'], value: 'Zo‘r, qilamiz' },
    { op: 'set', path: ['initiatives', { id: 'i5' }, 'acceptedAt'], value: 9 },
    { op: 'set', path: ['notifications', { id: 51 }], value: { id: 51, userId: 10427, kind: 'ini', ini: { title: 'G‘oya i5', s: 'accepted', reply: 'Zo‘r, qilamiz', xp: 25, to: 'ceo' }, at: 9, read: false } },
    { op: 'set', path: ['users', { id: 10901 }, 'hints'], value: false },
    /* 5 */ { op: 'set', path: ['initiatives', { id: 'i6' }, 'status'], value: 'declined' },
    /* 6 */ { op: 'set', path: ['initiatives', { id: 'i5' }, 'title'], value: 'boshqa' },
    /* 7 */ { op: 'set', path: ['initiatives', { id: 'i5' }, 'status'], value: 'zo‘r' }] });
  assert.deepEqual(ans.rejected.map(x => x.i), [5, 6, 7]);
  assert.match(ans.rejected[0].reason, /отвечает её адресат/); assert.match(ans.rejected[1].reason, /меняет автор идеи/);
  // PM — только ответ на свои идеи: ни курса, ни своей должности, ни удаления
  const pno = P({ action: 'patch', ops: [
    { op: 'set', path: ['course', 'sections'], value: [] }, { op: 'set', path: ['users', { id: 10902 }, 'post'], value: 'boss' },
    { op: 'del', path: ['initiatives', { id: 'i6' }] }, { op: 'set', path: ['initiatives', { id: 'i1' }, 'status'], value: 'done' }] });
  assert.equal(pno.applied, 0); assert.match(pno.rejected[3].reason, /адресована не вам/);
  const i5 = g.state().initiatives.find(x => x.id === 'i5');
  assert.equal(i5.status, 'accepted'); assert.equal(i5.reply, 'Zo‘r, qilamiz'); assert.equal(i5.title, 'G‘oya i5');

  // идея нескольким адресатам: видят оба, отвечает любой — только от своего имени
  const pa = P({ action: 'patch', ops: [
    { op: 'set', path: ['initiatives', { id: 'i10' }, 'status'], value: 'review' },
    { op: 'set', path: ['initiatives', { id: 'i10' }, 'repliedBy'], value: 'pm' },
    /* 2 */ { op: 'set', path: ['initiatives', { id: 'i10' }, 'repliedBy'], value: 'ceo' },
    /* 3 */ { op: 'set', path: ['initiatives', { id: 'i5' }, 'status'], value: 'done' }] });
  assert.deepEqual(pa.rejected.map(x => x.i), [2, 3]);
  assert.match(pa.rejected[0].reason, /от своего имени/);
  assert.equal(C({ action: 'load' }).state.initiatives.find(x => x.id === 'i10').repliedBy, 'pm');
  assert.deepEqual(A({ action: 'load' }).state.initiatives.find(x => x.id === 'i10'), { id: 'i10', uid: 10427, to: ['ceo', 'pm'], status: 'review', at: 5 });

  // автор: ответ видит, но сам ни ответ, ни адресата не меняет
  const mine = D({ action: 'load' }).state.initiatives.find(x => x.id === 'i5');
  assert.equal(mine.reply, 'Zo‘r, qilamiz');
  const dno = D({ action: 'patch', ops: [{ op: 'set', path: ['initiatives', { id: 'i5' }, 'to'], value: 'pm' }, { op: 'set', path: ['initiatives', { id: 'i5' }, 'status'], value: 'done' }] });
  assert.equal(dno.applied, 0); assert.match(dno.rejected[0].reason, /меняет адресат идеи/);
  // коллега — только то, из чего считается рейтинг
  assert.deepEqual(Z({ action: 'load' }).state.initiatives.find(x => x.id === 'i5'), { id: 'i5', uid: 10427, status: 'accepted' });

  // SOP-менеджер: статус и даты (для XP и уровней), без названия, текста и ответа; старые идеи без адресата — как раньше
  const av = A({ action: 'load' }).state;
  assert.deepEqual(av.initiatives.find(x => x.id === 'i5'), { id: 'i5', uid: 10427, to: 'ceo', status: 'accepted', at: 5, acceptedAt: 9 });
  assert.equal(av.initiatives.find(x => x.id === 'i1').title, 'Aziza g‘oyasi');
  assert.deepEqual(av.notifications.find(n => n.id === 51).ini, { s: 'accepted', xp: 25, to: 'ceo' });
  assert.ok(!JSON.stringify(av).includes('Zo‘r, qilamiz') && !JSON.stringify(av).includes('Batafsil matn i5'));
  const ano = A({ action: 'patch', ops: [
    { op: 'set', path: ['initiatives', { id: 'i5' }, 'title'], value: 'x' },
    { op: 'set', path: ['initiatives', { id: 'i5' }], value: { id: 'i5', uid: 10427, to: 'ceo', status: 'accepted' } },
    { op: 'set', path: ['initiatives'], value: [] },
    { op: 'set', path: ['initiatives', { id: 'i1' }, 'reply'], value: 'rahmat' }] });
  assert.deepEqual(ano.rejected.map(x => x.i), [0, 1, 2]);
  assert.match(ano.rejected[0].reason, /отвечает её адресат/);
  assert.equal(g.state().initiatives.find(x => x.id === 'i5').text, 'Batafsil matn i5');
});

test('профиль: своё имя и фото — сам, логин и пароль — с текущим паролем; фото видно коллегам и остаётся в данных', () => {
  const { g, A, D, Z, login } = platform();
  const jpg = 'data:image/jpeg;base64,' + Buffer.alloc(6000, 7).toString('base64');
  const ok = D({ action: 'patch', ops: [
    { op: 'set', path: ['users', { id: 10427 }, 'name'], value: 'Dilnoza Karimova-Aliyeva' },
    { op: 'set', path: ['users', { id: 10427 }, 'avatar'], value: jpg },
    /* 2 */ { op: 'set', path: ['users', { id: 10427 }, 'name'], value: ' ' },
    /* 3 */ { op: 'set', path: ['users', { id: 10427 }, 'avatar'], value: 'data:text/html;base64,PHNjcmlwdD4=' },
    /* 4 */ { op: 'set', path: ['users', { id: 10427 }, 'avatar'], value: 'data:image/jpeg;base64,' + 'A'.repeat(20000) },
    /* 5 */ { op: 'set', path: ['users', { id: 10391 }, 'name'], value: 'Boshqa' },
    /* 6 */ { op: 'set', path: ['users', { id: 10427 }, 'login'], value: 'dilnoza' }] });
  assert.deepEqual(ok.rejected.map(x => x.i), [2, 3, 4, 5, 6]);
  const me = g.state().users.find(u => u.id === 10427);
  assert.equal(me.name, 'Dilnoza Karimova-Aliyeva'); assert.equal(me.avatar, jpg);            // в данных, не lmsfile:
  const col = Z({ action: 'load' }).state.users.find(u => u.id === 10427);
  assert.equal(col.avatar, jpg); assert.equal(col.login, undefined);
  assert.equal(D({ action: 'patch', ops: [{ op: 'del', path: ['users', { id: 10427 }, 'avatar'] }] }).applied, 1);

  // логин — сам, с текущим паролем: свободный и по формату; пароль — только SOP-менеджер
  assert.equal(D({ action: 'account', old: 'neto‘g‘ri', login: 'dilnoza' }).code, 'login');
  assert.equal(D({ action: 'account', old: 'pw-dilnoza', login: 'a.yusupova' }).code, 'taken');
  assert.equal(D({ action: 'account', old: 'pw-dilnoza', login: 'Ди' }).code, 'login_format');
  assert.equal(D({ action: 'account', old: 'pw-dilnoza', password: 'yangi-parol-1' }).code, 'forbidden');
  assert.equal(D({ action: 'account', old: 'pw-dilnoza' }).code, 'bad');
  const D2 = login('d.karimova', 'pw-dilnoza');                                                 // второе устройство
  const r = D({ action: 'account', old: 'pw-dilnoza', login: 'Dilnoza.K' });
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.login, 'dilnoza.k');
  assert.equal(g.state().users.find(u => u.id === 10427).login, 'dilnoza.k');
  assert.equal(g.post({ action: 'login', login: 'd.karimova', password: 'pw-dilnoza' }).code, 'login');
  assert.equal(g.post({ action: 'login', login: 'dilnoza.k', password: 'pw-dilnoza' }).ok, true);
  assert.equal(D2({ action: 'load' }).ok, true);                                                // логин сменился — входы те же
  assert.equal(A({ action: 'account', old: 'xato', login: 'sop' }).code, 'login');
});

test('прогресс урока: сотрудник ставит «читаю / вопрос / готов к тесту», балл и итог — нет', () => {
  const { g, D, Z } = platform();
  const ok = D({ action: 'patch', ops: [
    { op: 'set', path: ['progress', '10427', 'b4-1'], value: { status: 'in-progress', at: 1 } },
    { op: 'set', path: ['progress', '10427', 'b4-1', 'status'], value: 'exam-ready' },
    { op: 'set', path: ['progress', '10427', 'b4-1', 'score'], value: null },
    { op: 'set', path: ['progress', '10427', 'b4-1', 'comment'], value: null }] });
  assert.deepEqual(ok.rejected, []);
  const no = D({ action: 'patch', ops: [
    { op: 'set', path: ['progress', '10427', 'b4-1', 'score'], value: 100 },
    { op: 'set', path: ['progress', '10427', 'b4-1', 'status'], value: 'passed' },
    { op: 'set', path: ['progress', '10427', 'b4-2'], value: { status: 'passed', score: 100 } },
    { op: 'del', path: ['progress', '10427', 'b4-1'] }] });
  assert.equal(no.applied, 0);
  assert.match(rejected(no)[0], /балл ставит сервер/); assert.match(rejected(no)[1], /итог урока ставит SOP-менеджер/);
  // сданный урок назад не откатить
  const back = Z({ action: 'patch', ops: [{ op: 'set', path: ['progress', '10391', 'b4-1', 'status'], value: 'in-progress' }] });
  assert.match(rejected(back)[0], /уже сдан/);
  assert.deepEqual(g.state().progress['10427']['b4-1'].status, 'exam-ready');
});

test('тест урока: балл считает сервер, один раз после «Готов к тесту», заявка на экзамен получает балл', () => {
  const { g, D } = platform();
  assert.equal(D({ action: 'quiz', lessonId: 'b4-1', answers: [1, 0] }).code, 'quiz');
  D({ action: 'patch', ops: [
    { op: 'set', path: ['progress', '10427'], value: { 'b4-1': { status: 'exam-ready', score: null } } },
    { op: 'set', path: ['requests', { id: 'e1' }], value: { id: 'e1', type: 'exam', userId: 10427, lessonId: 'b4-1', score: null, state: 'open', unread: true } }] });
  assert.equal(D({ action: 'quiz', lessonId: 'b4-1', answers: [1] }).code, 'bad');
  const r = D({ action: 'quiz', lessonId: 'b4-1', answers: [1, 1] });
  assert.equal(r.ok, true); assert.equal(r.score, 50); assert.deepEqual(r.answers, [1, 0]);
  const st = g.state();
  assert.equal(st.progress['10427']['b4-1'].score, 50);
  assert.equal(st.requests[0].score, 50);
  assert.equal(D({ action: 'quiz', lessonId: 'b4-1', answers: [1, 0] }).code, 'quiz');
  // закрытый раздел до испытательного срока
  assert.equal(D({ action: 'quiz', lessonId: 'b4-9', answers: [1, 0] }).code, 'forbidden');
});

test('наставник записывает ошибку сотруднику и видит свои записи; сотрудник видит свою ошибку', () => {
  const { M, D, Z } = platform();
  const r = M({ action: 'patch', ops: [{ op: 'set', path: ['errors', { id: 'e1' }], value: { id: 'e1', uid: 10427, by: 10288, text: 'PL yo‘q', status: 'assigned' } }] });
  assert.deepEqual(r.rejected, []);
  assert.deepEqual(M({ action: 'load' }).state.errors.map(e => e.id), ['e1']);
  assert.deepEqual(D({ action: 'load' }).state.errors.map(e => e.id), ['e1']);
  assert.deepEqual(Z({ action: 'load' }).state.errors, []);
  const fix = D({ action: 'patch', ops: [{ op: 'set', path: ['errors', { id: 'e1' }, 'text'], value: 'yo‘q edi' }, { op: 'set', path: ['errors', { id: 'e1' }, 'retest'], value: { score: 90 } },
    { op: 'set', path: ['errors', { id: 'e1' }, 'status'], value: 'done' }, { op: 'set', path: ['errors', { id: 'e1' }], value: { id: 'e1', uid: 10427, by: 10288, text: 'PL yo‘q', status: 'closed' } }] });
  assert.deepEqual(fix.rejected.map(x => x.i), [0, 1, 2, 3], 'повторную проверку закрывает только сервер (v20)');
});

test('повторная проверка после ошибки: балл считает сервер, сдал — ошибка закрыта, наставнику уведомление', () => {
  const { g, M, D, Z } = platform();
  M({ action: 'patch', ops: [{ op: 'set', path: ['errors', { id: 'e1' }], value: { id: 'e1', uid: 10427, by: 10288, lessonId: 'b4-1', text: 'PL yo‘q', status: 'assigned' } }] });
  assert.equal(Z({ action: 'retest', errorId: 'e1', answers: [1, 0] }).code, 'forbidden');
  assert.equal(D({ action: 'retest', errorId: 'e1', answers: [1] }).code, 'bad');
  const bad = D({ action: 'retest', errorId: 'e1', answers: [0, 1] });
  assert.equal(bad.score, 0); assert.equal(g.state().errors[0].status, 'assigned');
  const ok = D({ action: 'retest', errorId: 'e1', answers: [1, 0] });
  assert.equal(ok.score, 100);
  const st = g.state();
  assert.equal(st.errors[0].status, 'done'); assert.equal(st.errors[0].retest.score, 100);
  assert.deepEqual(pickN(st.notifications[0]), { userId: 10288, kind: 'errfix', route: 'quality', err: { name: 'Dilnoza Karimova', ttl: '4.1', score: 100 } });
  assert.equal(D({ action: 'retest', errorId: 'e1', answers: [1, 0] }).code, 'quiz');
  // сам сотрудник ошибку не закрывает и отметки шкалы уровня не ставит
  const r = D({ action: 'patch', ops: [{ op: 'set', path: ['users', { id: 10427 }, 'levelTasks'], value: { t1: { at: 1 } } }] });
  assert.match(rejected(r)[0], /levelTasks/);
});
test('мол-мулк: сотрудник сообщает о проблеме со своим имуществом, подтверждает его SOP-менеджер', () => {
  const { g, D, A } = platform();
  A({ action: 'patch', ops: [{ op: 'set', path: ['assets', { id: 'as1' }], value: { id: 'as1', uid: 10427, type: 'laptop', name: 'Noutbuk', status: 'active' } }] });
  const r = D({ action: 'patch', ops: [
    { op: 'set', path: ['assets', { id: 'as1' }, 'status'], value: 'issue' },
    { op: 'set', path: ['assets', { id: 'as1' }, 'issue'], value: { kind: 'broken', text: 'Ekran singan', at: 1 } },
    { op: 'set', path: ['assets', { id: 'as1' }, 'confirmedAt'], value: 5 }] });
  assert.deepEqual(r.rejected.map(x => x.i), [2]);
  assert.equal(g.state().assets[0].issue.text, 'Ekran singan');
});
const pickN = n => ({ userId: n.userId, kind: n.kind, route: n.route, err: n.err });

test('since: та же версия — без данных; после правки — новое состояние', () => {
  const { D, A } = platform();
  const v = D({ action: 'load' });
  assert.deepEqual(D({ action: 'since', rev: v.rev }), { ok: true, v: 21, ai: false, rev: v.rev, same: true });
  A({ action: 'patch', ops: [{ op: 'set', path: ['notifications', { id: 9 }], value: { id: 9, userId: 10427, text: 'yangi' }, after: null }] });
  const n = D({ action: 'since', rev: v.rev });
  assert.equal(n.rev, v.rev + 1); assert.equal(n.state.notifications[0].text, 'yangi');
});

test('файлы: скан паспорта и вложения — на Диск, в данных ссылка; файл получает только тот, кому он виден', () => {
  const { g, D, Z, A } = platform();
  const pdf = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4 ' + 'x'.repeat(3000)).toString('base64');
  const r = D({ action: 'patch', ops: [
    { op: 'set', path: ['users', { id: 10427 }, 'profile'], value: { lastName: 'Karimova', passportFile: { name: 'pasport.pdf', size: 3009, type: 'application/pdf', data: pdf } } },
    { op: 'set', path: ['users', { id: 10427 }, 'avatar'], value: 'data:image/png;base64,iVBORw0KGgo=' }] });
  assert.deepEqual(r.rejected, []);
  const st = g.state(), me = st.users.find(u => u.id === 10427);
  const ref = me.profile.passportFile.data;
  assert.match(ref, /^lmsfile:[\w-]{8,}$/);
  assert.equal(me.avatar, 'data:image/png;base64,iVBORw0KGgo=');   // короткое — остаётся в данных
  assert.ok(!g.files[g.props.LMS_STATE].content.includes('%PDF'));
  const id = ref.slice(8), f = g.files[id];
  assert.equal(f.name, 'pasport.pdf'); assert.equal(f.type, 'application/pdf'); assert.match(f.description, /10427/);
  assert.equal(g.folders[f.folder].name, 'files');
  // своё — можно, SOP-менеджеру — можно, коллеге — нельзя
  const mine = D({ action: 'file', id });
  assert.equal(mine.name, 'pasport.pdf'); assert.equal(Buffer.from(mine.data, 'base64').toString().slice(0, 8), '%PDF-1.4');
  assert.equal(A({ action: 'file', id }).ok, true);
  assert.equal(Z({ action: 'file', id }).code, 'forbidden');
  assert.equal(Z({ action: 'file', id: '../../etc' }).code, 'bad');
  // чужую ссылку себе в анкету не вписать; свою — можно (анкета сохраняется целиком)
  const steal = Z({ action: 'patch', ops: [{ op: 'set', path: ['users', { id: 10391 }, 'profile'], value: { passportFile: { name: 'x.pdf', data: ref } } }] });
  assert.deepEqual(rejected(steal), ['чужой файл']);
  assert.equal(Z({ action: 'file', id }).code, 'forbidden');
  const again = D({ action: 'patch', ops: [{ op: 'set', path: ['users', { id: 10427 }, 'profile'], value: { lastName: 'Karimova', passportFile: me.profile.passportFile } }] });
  assert.deepEqual(again.rejected, []);
});

test('журнал нарушений: сотрудник добавляет только свою запись, сервер хранит последние 500', () => {
  const { g, D, A } = platform();
  A({ action: 'patch', ops: [{ op: 'set', path: ['audit'], value: Array.from({ length: 500 }, (_, i) => ({ id: 'old' + i, userId: 10391, key: 'copy' })) }] });
  const r = D({ action: 'patch', ops: [{ op: 'set', path: ['audit', { id: 'a1' }], value: { id: 'a1', userId: 10427, key: 'blur', lessonId: 'b4-1' }, after: null }] });
  assert.deepEqual(r.rejected, []);
  const au = g.state().audit;
  assert.equal(au.length, 500); assert.equal(au[0].id, 'a1'); assert.equal(au[499].id, 'old498');
});

test('ИИ: без ключа — «не подключён»; с ключом — Claude API, ключ только на сервере, отказ и ошибки понятны', () => {
  const replies = [];
  const { g, D, A } = platform({ fetch: (url, body, opts) => replies.shift() });
  const ask = (who, extra = {}) => who({ action: 'ai', messages: [{ role: 'user', content: 'Packing list nima?' }], ...extra });
  assert.equal(ask(D).code, 'ai_off');
  assert.equal(D({ action: 'load' }).ai, false);
  g.props.ANTHROPIC_API_KEY = 'sk-ant-test';
  assert.equal(D({ action: 'load' }).ai, true);

  replies.push({ body: { model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { input_tokens: 120, output_tokens: 30 },
    content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'Packing list — ' }, { type: 'text', text: 'yuk ro‘yxati.' }] } });
  const r = ask(D, { tier: 'quick' });
  assert.deepEqual([r.ok, r.text, r.truncated], [true, 'Packing list — yuk ro‘yxati.', false]);
  const c = g.calls[0];
  assert.equal(c.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(c.opts.headers['x-api-key'], 'sk-ant-test'); assert.equal(c.opts.headers['anthropic-version'], '2023-06-01');
  assert.equal(c.opts.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  assert.equal(c.body.model, 'claude-opus-5-5'); assert.equal(c.body.fallbacks, 'default');
  assert.deepEqual(c.body.output_config, { effort: 'low' }); assert.equal(c.body.system, undefined);
  assert.equal(c.body.thinking, undefined); assert.equal(c.body.max_tokens, 4096);
  assert.ok(!JSON.stringify(D({ action: 'load' })).includes('sk-ant-test'), 'ключ не уходит на страницу');

  // JSON-режим и обычный уровень; ответ обрезан по длине
  replies.push({ body: { model: 'claude-opus-5-5', stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"a":' }] } });
  const j = ask(A, { json: true });
  assert.equal(j.truncated, true);
  assert.match(g.calls[1].body.system, /JSON only/); assert.deepEqual(g.calls[1].body.output_config, { effort: 'medium' });

  // отказ модели, перегрузка API (место в лимите возвращается), переписка должна заканчиваться вопросом
  replies.push({ body: { stop_reason: 'refusal', content: [] } });
  assert.equal(ask(D).code, 'refused');
  replies.push({ status: 529, body: { error: { message: 'Overloaded' } } });
  const busy = ask(D); assert.equal(busy.code, 'rate_limited'); assert.match(busy.error, /Overloaded/);
  replies.push({ status: 401, body: { error: { message: 'invalid x-api-key' } } });
  assert.equal(ask(D).code, 'ai_key');
  assert.equal(D({ action: 'ai', messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] }).code, 'bad');
  const u = JSON.parse(g.props.AI_USAGE);
  assert.equal(u.n['10427'], 2, 'учтены удачный запрос и отказ; сбои API — нет');
  assert.equal(u.tin, 120); assert.equal(u.tout, 30);
});

test('ИИ: дневной лимит на человека и другая модель из свойства AI_MODEL (без fallbacks у Haiku)', () => {
  const ok = { body: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] } };
  const { g, D, Z } = platform({ fetch: () => ok });
  Object.assign(g.props, { ANTHROPIC_API_KEY: 'sk-ant-test', AI_DAILY_LIMIT: '2', AI_MODEL: 'claude-haiku-5-5' });
  const ask = who => who({ action: 'ai', messages: [{ role: 'user', content: 'savol' }] });
  assert.equal(ask(D).ok, true); assert.equal(ask(D).ok, true);
  const third = ask(D); assert.equal(third.code, 'ai_limit'); assert.match(third.error, /\(2\)/);
  assert.equal(ask(Z).ok, true, 'у другого сотрудника свой лимит');
  assert.equal(g.calls[0].body.model, 'claude-haiku-5-5');
  assert.equal(g.calls[0].body.fallbacks, undefined); assert.equal(g.calls[0].opts.headers['anthropic-beta'], undefined);
});

test('пароли меняет только SOP-менеджер: свой — с текущим паролем, сотруднику — сброс или новый в карточке', () => {
  const { g, D, A, adm, login } = platform();
  assert.equal(D({ action: 'password', old: 'pw-dilnoza', password: 'new-pass-1' }).code, 'forbidden');
  const other = login(adm.login, adm.password);
  assert.equal(A({ action: 'password', old: 'wrong', password: 'new-pass-1' }).code, 'login');
  assert.equal(A({ action: 'password', old: adm.password, password: 'short' }).code, 'weak');
  assert.equal(A({ action: 'account', old: adm.password, password: 'new-pass-1' }).ok, true);
  assert.equal(A({ action: 'load' }).ok, true);
  assert.equal(other({ action: 'load' }).code, 'auth');                                         // другие входы закрыты
  login(adm.login, 'new-pass-1');
  assert.equal(D({ action: 'resetPassword', userId: 10391 }).code, 'forbidden');
  const r = A({ action: 'resetPassword', userId: 10427 });
  assert.match(r.password, /^[a-z2-9]{10}$/);
  assert.equal(D({ action: 'load' }).code, 'auth');
  login('d.karimova', r.password);
  // новый пароль сотруднику — в его карточке; в данных его нет
  assert.deepEqual(A({ action: 'patch', ops: [{ op: 'set', path: ['users', { id: 10391 }, 'password'], value: 'aziza-yangi-1' }] }).rejected, []);
  login('a.yusupova', 'aziza-yangi-1');
  assert.ok(!JSON.stringify(g.state()).includes(r.password) && !JSON.stringify(g.state()).includes('aziza-yangi-1'));
});

test('копия данных: SOP-менеджер скачивает данные и файлы; сотрудник — нет; текст идей с адресатом не уходит', () => {
  const { A, D } = platform();
  const pdf = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4 ' + 'x'.repeat(3000)).toString('base64');
  D({ action: 'patch', ops: [
    { op: 'set', path: ['users', { id: 10427 }, 'profile'], value: { passportFile: { name: 'pasport.pdf', type: 'application/pdf', data: pdf } } },
    { op: 'set', path: ['initiatives', { id: 'iz' }], value: { id: 'iz', uid: 10427, to: ['ceo'], type: 'idea', area: 'it', title: 'Maxfiy g‘oya', text: 'faqat CEO uchun', status: 'new', at: 1 } }] });
  assert.equal(D({ action: 'export' }).code, 'forbidden');
  const x = A({ action: 'export' });
  assert.equal(x.ok, true); assert.equal(x.app, 'buraq-lms');
  const ref = x.state.users.find(u => u.id === 10427).profile.passportFile.data;
  assert.match(ref, /^lmsfile:/);
  const f = x.files[ref.slice(8)];
  assert.equal(f.name, 'pasport.pdf'); assert.equal('data:application/pdf;base64,' + f.data, pdf);
  assert.ok(!JSON.stringify(x).includes('faqat CEO uchun'));
  assert.equal(x.state.course.sections.length, 2);
});

test('уровни доступа: CEO — всё и входы всем; SOP-менеджер — сотрудники; руководитель — только смотрит; старые CEO — в кабинет', () => {
  const pf = platform(), { g, A, D, login } = pf;
  // пока CEO нет, SOP-менеджер не создаёт ни PM, ни руководителя, ни второго SOP-менеджера
  const early = A({ action: 'patch', ops: [
    { op: 'set', path: ['users', { id: 10950 }], value: { id: 10950, role: 'leader', post: 'pm', login: 'pm0', password: 'pw-pm-0', name: 'PM' } },
    { op: 'set', path: ['users', { id: 10951 }], value: { id: 10951, role: 'admin', post: 'boss', login: 'boss0', password: 'pw-boss-0', name: 'Egasi' } },
    { op: 'set', path: ['users', { id: 10952 }], value: { id: 10952, role: 'admin', login: 'sop2', password: 'pw-sop-2', name: 'SOP 2' } }] });
  assert.equal(early.applied, 0); assert.match(early.rejected[0].reason, /создаёт CEO/);
  const { C, B } = chiefs(pf);
  // второго CEO SOP-менеджер уже не создаёт; карточки и пароли руководства не трогает; сотрудника не повышает
  const sno = A({ action: 'patch', ops: [
    { op: 'set', path: ['users', { id: 10960 }], value: { id: 10960, role: 'admin', post: 'ceo', login: 'ceo2', password: 'pw-ceo-2', name: 'CEO 2' } },
    { op: 'set', path: ['users', { id: 10901 }, 'password'], value: 'xakerlik-1' },
    { op: 'set', path: ['users', { id: 10903 }, 'name'], value: 'Boshqa' },
    { op: 'del', path: ['users', { id: 10901 }] },
    { op: 'set', path: ['users', { id: 10427 }, 'role'], value: 'admin' }] });
  assert.equal(sno.applied, 0); assert.ok(sno.rejected.every(x => /CEO/.test(x.reason)), JSON.stringify(sno.rejected));
  assert.ok(g.post({ action: 'login', login: 'ceo', password: 'pw-ceo-1' }).ok, 'пароль CEO не сменился');
  assert.equal(A({ action: 'resetPassword', userId: 10901 }).code, 'forbidden');
  assert.ok(A({ action: 'resetPassword', userId: 10427 }).password, 'сотруднику — можно');
  // своя карточка SOP-менеджера — имя да, роль нет
  const own = A({ action: 'load' }).me;
  assert.deepEqual(A({ action: 'patch', ops: [{ op: 'set', path: ['users', { id: own }, 'name'], value: 'SOP menejeri' }, { op: 'set', path: ['users', { id: own }, 'post'], value: 'ceo' }] }).rejected.map(x => x.i), [1]);
  // CEO — входы и пароли всем, включая SOP-менеджера
  assert.ok(C({ action: 'resetPassword', userId: own }).password);
  assert.deepEqual(C({ action: 'patch', ops: [{ op: 'set', path: ['users', { id: 10952 }], value: { id: 10952, role: 'admin', login: 'sop2', password: 'pw-sop-22', name: 'SOP 2' } }] }).rejected, []);
  assert.ok(login('sop2', 'pw-sop-22')({ action: 'load' }).ok);
  // руководитель: видит всё (курс, анкеты, зарплату), меняет только своё
  const bv = B({ action: 'load' }).state;
  assert.equal(bv.course.sections.length, 2); assert.ok(bv.users.find(u => u.id === 10427).passport, 'анкеты видит');
  const bno = B({ action: 'patch', ops: [
    { op: 'set', path: ['course', 'sections'], value: [] },
    { op: 'set', path: ['users', { id: 10427 }, 'position'], value: 'Boshliq' },
    { op: 'set', path: ['pay'], value: { schemes: [] } },
    { op: 'set', path: ['users', { id: 10970 }], value: { id: 10970, role: 'employee', login: 'yangi', name: 'Yangi' } },
    { op: 'set', path: ['users', { id: 10903 }, 'hints'], value: true }] });
  assert.deepEqual(bno.rejected.map(x => x.i), [0, 1, 2, 3], 'только своя карточка');
  assert.equal(B({ action: 'resetPassword', userId: 10427 }).code, 'forbidden');
  assert.ok(B({ action: 'export' }).ok, 'копию данных скачивает');
  // старые аккаунты: CEO и руководитель были адресатами идей (role leader) — теперь в своём кабинете
  const f = g.files[g.props.LMS_STATE], st = JSON.parse(f.content);
  st.users.push({ id: 10980, role: 'leader', post: 'boss', login: 'eski', name: 'Eski rahbar' }); f.content = JSON.stringify(st);
  assert.equal(C({ action: 'load' }).state.users.find(u => u.id === 10980).role, 'admin');
  void D;
});

test('«Kun hikmati»: цитаты SOP-менеджера видны без входа — только они; сотрудник список не правит', () => {
  assert.deepEqual(loadLms({ iter: 50 }).post({ action: 'wisdom' }), { ok: true, std: true, list: [] }, 'сервер ещё не настроен');
  const { g, A, D } = platform();
  assert.deepEqual(g.post({ action: 'wisdom' }), { ok: true, std: true, list: [] });
  const long = 'x'.repeat(500);
  assert.equal(A({ action: 'patch', ops: [{ op: 'set', path: ['settings', 'wisdom'], value: { std: false, list: [
    { id: 'w1', text: ' Birgalikda muvaffaqiyatga! ', by: 'CEO', at: 5 }, { id: 'w2', text: '   ' }, { id: 'w3', text: long, by: long }, 'buzuq'] } }] }).rejected.length, 0);
  const w = g.post({ action: 'wisdom' });
  assert.equal(w.ok, true); assert.equal(w.std, false);
  assert.deepEqual(w.list[0], { text: 'Birgalikda muvaffaqiyatga!', by: 'CEO' }, 'только текст и автор');
  assert.equal(w.list.length, 2, 'пустые и битые — нет');
  assert.equal(w.list[1].text.length, 240); assert.equal(w.list[1].by.length, 80);
  assert.ok(!JSON.stringify(w).includes('Dilnoza'), 'больше ничего из данных');
  assert.equal(D({ action: 'patch', ops: [{ op: 'set', path: ['settings', 'wisdom', 'list'], value: [] }] }).rejected.length, 1, 'сотрудник — нет');
});

test('зарплата: сотрудник видит только свои условия и расчёты, добавляет свой расчёт — сумму сервер пересчитывает', () => {
  const pf = platform(), { g, A, D, Z } = pf;
  const Pay = g_pay;
  // данные прошлой версии сервера — без раздела зарплаты
  const f = g.files[g.props.LMS_STATE], old = JSON.parse(f.content); delete old.pay; delete old.payCalcs; f.content = JSON.stringify(old);
  const { C, B } = chiefs(pf);
  const sk = { id: 'sk', title: 'Mijozlar', positions: ['Mijozlar menejeri'], fixed: 4000000, base: 2000000, kpis: [{ id: 'k1', name: 'Shartnoma', unit: 'ta', src: 'manual', type: 'plan', plan: 10, w: 100, min: 50, cap: 120 }] };
  const sl = { id: 'sl', title: 'Logistika', positions: ['Logistika menejeri'], fixed: 9000000, base: 3000000, kpis: [] };
  assert.match(A({ action: 'patch', ops: [{ op: 'set', path: ['pay'], value: { schemes: [sk] } }] }).rejected[0].reason, /ведёт CEO/, 'SOP-менеджер условий не задаёт');
  assert.equal(C({ action: 'patch', ops: [{ op: 'set', path: ['pay'], value: { schemes: [sk, sl], people: { 10427: { fixed: 4500000 }, 10288: { fixed: 9900000 } } } }] }).rejected.length, 0);
  const vd = D({ action: 'load' }).state;
  assert.deepEqual(vd.pay.schemes.map(x => x.id), ['sk'], 'только своя схема');
  assert.deepEqual(vd.pay.people, { 10427: { fixed: 4500000 } }, 'только своя фикса');
  assert.ok(!JSON.stringify(vd).includes('9900000') && !JSON.stringify(vd).includes('9000000'), 'чужих сумм нет');
  const snap = Pay.snapshot(sk), calc = (inputs, extra) => ({ id: 'c' + Math.random(), uid: 10427, at: 1, ym: '2026-10', scheme: snap, fixed: 4500000, inputs, ...Pay.calc(snap, 4500000, inputs), note: 'oktyabr', status: 'saved', ...extra });
  const c1 = calc({ k1: 9 });
  assert.equal(c1.total, 4500000 + 1800000);
  assert.deepEqual(D({ action: 'patch', ops: [{ op: 'set', path: ['payCalcs', { id: c1.id }], value: c1 }] }).rejected, []);
  const bad = (v, why) => assert.match(D({ action: 'patch', ops: [{ op: 'set', path: ['payCalcs', { id: v.id }], value: v }] }).rejected[0]?.reason || '', why);
  bad(calc({ k1: 9 }, { total: 99000000 }), /не сходится/);
  bad(calc({ k1: 9 }, { fixed: 9000000 }), /изменились/);
  bad(calc({ k1: 9 }, { uid: 10391 }), /только свой/);
  bad(calc({ k1: 9 }, { status: 'approved' }), /ставит CEO/);
  bad(calc({ k1: '9' }), /факты/);
  // «считал, но не сохранил»: черновик с попытками; каждая попытка пересчитывается
  const tries = [{ at: 1, inputs: { k1: 5 }, total: 4500000 + 1000000 }, { at: 2, inputs: { k1: 9 }, total: 4500000 + 1800000 }];
  assert.deepEqual(D({ action: 'patch', ops: [{ op: 'set', path: ['payCalcs', { id: 'd1' }], value: { ...calc({ k1: 9 }), id: 'd1', status: 'draft', tries } }] }).rejected, []);
  bad({ ...calc({ k1: 9 }), id: 'd2', status: 'draft', tries: [{ at: 1, inputs: { k1: 5 }, total: 99 }] }, /попытка/);
  bad({ ...calc({ k1: 9 }), id: 'd3', status: 'draft', tries: Array(41).fill(tries[0]) }, /попыток/);
  bad({ ...calc({ k1: 9 }), id: 'd4', status: 'nonsense' }, /ставит CEO/);
  assert.match(D({ action: 'patch', ops: [{ op: 'set', path: ['payCalcs', { id: c1.id }, 'total'], value: 1 }] }).rejected[0].reason, /не меняется/);
  assert.match(D({ action: 'patch', ops: [{ op: 'del', path: ['payCalcs', { id: c1.id }] }] }).rejected[0].reason, /не меняется/);
  assert.match(D({ action: 'patch', ops: [{ op: 'set', path: ['pay', 'people', '10427'], value: { fixed: 1e8 } }] }).rejected[0].reason, /задаёт CEO/);
  // без условий — нельзя; у коллеги не видно чужого расчёта
  assert.deepEqual(Z({ action: 'load' }).state.payCalcs, []);
  assert.deepEqual(Z({ action: 'load' }).state.pay.schemes, []);
  // SOP-менеджер видит всё и ставит итог
  assert.equal(C({ action: 'load' }).state.payCalcs.length, 2, 'CEO видит и отправленный, и неотправленный');
  assert.equal(B({ action: 'load' }).state.payCalcs.length, 2, 'руководитель тоже видит');
  assert.match(B({ action: 'patch', ops: [{ op: 'set', path: ['payCalcs', { id: c1.id }, 'status'], value: 'approved' }] }).rejected[0].reason, /нет прав/, 'руководитель только смотрит');
  const sv = A({ action: 'load' }).state;
  assert.deepEqual([sv.pay.schemes, sv.payCalcs], [[], []], 'SOP-менеджер зарплату не видит');
  assert.ok(!JSON.stringify(sv).includes('4500000') && !JSON.stringify(A({ action: 'export' })).includes('4500000'), 'и в копии данных её нет');
  assert.equal(C({ action: 'patch', ops: [{ op: 'set', path: ['payCalcs', { id: c1.id }, 'status'], value: 'approved' }] }).rejected.length, 0);
  assert.equal(D({ action: 'load' }).state.payCalcs.find(c => c.id === c1.id).status, 'approved');
  // не больше 20 расчётов за месяц
  for (let i = 0; i < 19; i++) D({ action: 'patch', ops: [{ op: 'set', path: ['payCalcs', { id: 'm' + i }], value: { ...calc({ k1: i }), id: 'm' + i } }] });
  bad({ ...calc({ k1: 1 }), id: 'm20' }, /не больше 20/);
  assert.deepEqual(D({ action: 'patch', ops: [{ op: 'set', path: ['payCalcs', { id: 'n1' }], value: { ...calc({ k1: 1 }), id: 'n1', ym: '2026-11' } }] }).rejected, [], 'новый месяц — можно');
});

test('занятый сервер отвечает «повторите», данные не портятся', () => {
  const { g, D } = platform();
  g.setLocked(true);
  const r = D({ action: 'patch', ops: [{ op: 'set', path: ['study', '10427', 'd'], value: 1 }] });
  assert.equal(r.code, 'busy');
  g.setLocked(false);
  assert.equal(g.state().study['10427'], undefined);
});

test('ночная копия: state-ГГГГ-ММ-ДД.json в папке backups, копии старше 30 дней удаляются', () => {
  const now = { value: Date.UTC(2026, 9, 1, 3) };
  const g = loadLms({ iter: 50, now });
  g.ctx.setup();
  g.ctx.backup();
  now.value += 31 * DAY;
  g.ctx.backup();
  const backups = Object.values(g.files).filter(f => f.name.startsWith('state-'));
  assert.deepEqual(backups.map(f => f.name), ['state-2026-11-01.json']);
  assert.equal(backups[0].content, g.files[g.props.LMS_STATE].content);
});

test('неизвестное действие и не-JSON — понятная ошибка', () => {
  const g = loadLms({ iter: 50 });
  assert.equal(JSON.parse(g.ctx.doPost({ postData: { contents: 'oops' } }).text).code, 'bad');
  assert.equal(g.post({ action: 'ping' }).ok, true);
  const adm = g.ctx.setup();
  const t = g.post({ action: 'login', login: adm.login, password: adm.password }).token;
  assert.match(g.post({ action: 'drop', token: t }).error, /Неизвестное действие/);
});

test('tools/lms-gs/Code.gs и lms-gs-script.js собраны из Server.gs и lms-sync.js (node tools/build-lms-gs.mjs)', () => {
  const src = buildLmsGs();
  assert.equal(readFileSync(new URL('../tools/lms-gs/Code.gs', import.meta.url), 'utf8'), src);
  assert.equal(readFileSync(new URL('../lms-gs-script.js', import.meta.url), 'utf8'), pageScript(src));
});

test('раздел для выбранных сотрудников (section.users): только им, без чужих номеров; ответы теста не уходят', () => {
  const { A, D, Z } = platform();
  const sec = { id: 'b2', title: '2-bob. Test', officialOnly: false, users: [10427], lessons: [{ id: 'b2-1', title: '2.1', html: '<p>x</p>', quiz }] };
  assert.deepEqual(A({ action: 'patch', ops: [{ op: 'set', path: ['course', 'sections', { id: 'b2' }], value: sec }] }).rejected, []);
  const mine = D({ action: 'load' }).state.course.sections.find(s => s.id === 'b2');
  assert.deepEqual(mine.users, [10427], 'назначенный сотрудник видит раздел');
  assert.equal(mine.lessons[0].quiz[0].answer, undefined, 'без правильных ответов');
  assert.equal(Z({ action: 'load' }).state.course.sections.some(s => s.id === 'b2'), false, 'остальным раздел не отдаётся');
  assert.deepEqual(A({ action: 'load' }).state.course.sections.find(s => s.id === 'b2').users, [10427], 'SOP-менеджер видит, кому назначен');
  // назначили ещё одного — второй видит в списке только себя
  A({ action: 'patch', ops: [{ op: 'set', path: ['course', 'sections', { id: 'b2' }, 'users'], value: [10427, 10391] }] });
  assert.deepEqual(Z({ action: 'load' }).state.course.sections.find(s => s.id === 'b2').users, [10391]);
});

test('кто проходит главу (section.aud): должность, отдел, имя или все — остальным глава не уходит', () => {
  const { A, D, Z, M } = platform();   // D — Mijozlar menejeri (Logistika bo‘limi), Z — Omborchi (Ombor (Yiwu)), M — Logistika menejeri (Logistika bo‘limi)
  const sec = aud => ({ id: 'b3', title: '3-bob. Test', officialOnly: false, aud, lessons: [{ id: 'b3-1', title: '3.1', html: '<p>x</p>', quiz }] });
  const sees = who => who({ action: 'load' }).state.course.sections.some(s => s.id === 'b3');
  const put = aud => assert.deepEqual(A({ action: 'patch', ops: [{ op: 'set', path: ['course', 'sections', { id: 'b3' }], value: sec(aud) }] }).rejected, []);
  put({ positions: ['Omborchi'] });
  assert.deepEqual([sees(D), sees(Z), sees(M)], [false, true, false], 'по должности');
  put({ depts: ['Logistika bo‘limi'] });
  assert.deepEqual([sees(D), sees(Z), sees(M)], [true, false, true], 'по отделу');
  put({ positions: ['Omborchi'], users: [10288] });
  assert.deepEqual([sees(D), sees(Z), sees(M)], [false, true, true], 'должность или имя');
  assert.deepEqual(Z({ action: 'load' }).state.course.sections.find(s => s.id === 'b3').aud.users, [], 'чужие имена не уходят');
  put({ all: true });
  assert.deepEqual([sees(D), sees(Z), sees(M)], [true, true, true], 'все');
  assert.equal(A({ action: 'load' }).state.course.sections.some(s => s.id === 'b3'), true);
});

test('приход/уход в программе: отметку ставит сотрудник, время — сервер (v13)', () => {
  const { A, D, Z } = platform();
  const r1 = D({ action: 'clock', kind: 'in' });
  assert.equal(r1.ok, true, JSON.stringify(r1));
  assert.match(r1.time, /^\d\d:\d\d$/);
  assert.match(r1.day, /^\d{4}-\d\d-\d\d$/);
  assert.equal(D({ action: 'clock', kind: 'in' }).code, 'done', 'повторный приход — ошибка');
  const r2 = D({ action: 'clock', kind: 'out' });
  assert.equal(r2.ok, true, JSON.stringify(r2));
  assert.equal(D({ action: 'clock', kind: 'out' }).code, 'done', 'повторный уход — ошибка');
  const rec = A({ action: 'load' }).state.attend['10427'][r1.day];
  assert.deepEqual({ src: rec.src, in: rec.in, out: rec.out }, { src: 'app', in: r1.time, out: r2.time });
  assert.equal(Z({ action: 'clock', kind: 'out' }).code, 'bad', 'уход без прихода — ошибка');
  assert.equal(A({ action: 'clock', kind: 'in' }).code, 'forbidden', 'не сотрудник — нельзя');
  assert.deepEqual(A({ action: 'patch', ops: [{ op: 'set', path: ['settings', 'selfClock'], value: { on: false } }] }).rejected, []);
  assert.equal(Z({ action: 'clock', kind: 'in' }).code, 'off', 'выключено в настройках');
});

test('v17: снимков при отметке прихода нет — поле photo сервер не читает, правка со снимком не проходит', () => {
  const { g, A, D } = platform();
  const img = 'data:image/jpeg;base64,' + 'A'.repeat(3000), n = Object.keys(g.files).length;
  const r = D({ action: 'clock', kind: 'in', photo: img });
  assert.equal(r.ok, true, JSON.stringify(r));                // страница, открытая до v17, всё равно отмечает приход
  assert.equal(D({ action: 'clock', kind: 'out', photo: img }).ok, true);
  const rec = g.state().attend['10427'][r.day];
  assert.deepEqual(Object.keys(rec).sort(), ['in', 'out', 'src'], 'в записи только время'); assert.equal(rec.in, r.time);
  assert.equal(Object.keys(g.files).length, n, 'файл снимка не создан');
  // запись прихода целиком со снимком (старая страница SOP-менеджера) — без снимка; поле снимка в пути — отказ
  const day = '2026-10-01';
  const p = A({ action: 'patch', ops: [
    { op: 'set', path: ['attend', '10427', day], value: { in: '09:00', src: 'manual', inPhoto: img, prev: { in: '09:05', src: 'app', inPhoto: 'lmsfile:file-0000000001' } } },
    { op: 'set', path: ['attend', '10427', r.day, 'inPhoto'], value: img },
    { op: 'set', path: ['users', { id: 10427 }, 'faceEnroll'], value: { photo: img } }] });
  assert.deepEqual(p.rejected.map(x => x.i), [1, 2]);
  assert.deepEqual(g.state().attend['10427'][day], { in: '09:00', src: 'manual', prev: { in: '09:05', src: 'app' } });
  assert.equal(D({ action: 'patch', ops: [{ op: 'set', path: ['users', { id: 10427 }, 'faceEnroll'], value: { photo: img } }] }).rejected.length, 1, 'сотрудник — тоже');
  assert.equal(Object.keys(g.files).length, n, 'и из правок файлов не прибавилось');
  assert.deepEqual({ ...g.ctx.purgeFaces() }, { purged: false, files: 0 }, 'новая установка — чистить нечего');
});

// данные до v17: снимки при отметке прихода (attend[uid][день].inPhoto / outPhoto, и в прежней версии записи prev)
function oldFaces(g) {
  const mk = (id) => { g.files[id] = { name: 'ishga-kelish', type: 'image/jpeg', bytes: [1, 2, 3], folder: 'x', created: 0 }; return 'lmsfile:' + id; };
  const st = g.state();
  delete st.settings.facePurgedV;
  st.attend = {
    '10427': { '2026-10-20': { in: '09:01', out: '18:00', src: 'app', inPhoto: mk('file-face-01'), outPhoto: mk('file-face-02') },
      '2026-10-21': { in: '09:30', src: 'manual', by: 1, prev: { in: '09:40', src: 'app', inPhoto: mk('file-face-03') } } },
    '10391': { '2026-10-20': { in: '08:55', src: 'turnstile' } } };
  st.users.find(u => u.id === 10391).faceEnroll = { photo: mk('file-face-04'), at: 1 };
  g.files[g.props.LMS_STATE].content = JSON.stringify(st);
  return ['file-face-01', 'file-face-02', 'file-face-03', 'file-face-04'];
}
const FACE_RE = /inPhoto|outPhoto|faceEnroll|file-face/;

test('v17: старые снимки — один раз из данных и в корзину Диска; до записи их уже не видно и файл не отдаётся', () => {
  const { g, A, D } = platform();
  const ids = oldFaces(g), rev = g.state().rev;
  // файл, на который ссылается ещё что-то (тот же номер в карточке), не удаляется
  const st0 = g.state(); st0.users.find(u => u.id === 10427).profile = { passportFile: { name: 'p.pdf', data: 'lmsfile:file-face-05' } };
  st0.attend['10427']['2026-10-22'] = { in: '09:00', src: 'app', inPhoto: 'lmsfile:file-face-05' };
  g.files['file-face-05'] = { name: 'p.pdf', type: 'application/pdf', bytes: [1], folder: 'x', created: 0 };
  g.files[g.props.LMS_STATE].content = JSON.stringify(st0);
  const v = A({ action: 'load' }).state;
  assert.doesNotMatch(JSON.stringify(v.attend) + JSON.stringify(v.users.map(u => u.faceEnroll)), FACE_RE, 'снимков не видно сразу');
  assert.equal(v.attend['10427']['2026-10-20'].in, '09:01', 'время прихода остаётся');
  assert.equal(A({ action: 'file', id: 'file-face-01' }).code, 'forbidden', 'файл снимка больше не отдаётся');
  assert.equal(D({ action: 'file', id: 'file-face-01' }).code, 'forbidden');
  assert.ok(ids.every(id => g.files[id]), 'до записи файлы на месте — данные на Диске ещё ссылаются на них');
  assert.deepEqual({ ...g.ctx.purgeFaces() }, { purged: true, files: 4 });
  const st = g.state();
  assert.equal(st.settings.facePurgedV, 2); assert.equal(st.rev, rev + 1);
  assert.doesNotMatch(JSON.stringify(st.attend) + JSON.stringify(st.users.map(u => u.faceEnroll || null)), /inPhoto|outPhoto|faceEnroll|file-face-0[1-4]/);
  assert.deepEqual(st.attend['10427']['2026-10-21'], { in: '09:30', src: 'manual', by: 1, prev: { in: '09:40', src: 'app' } });
  assert.deepEqual(st.attend['10391']['2026-10-20'], { in: '08:55', src: 'turnstile' });
  assert.ok(ids.every(id => !g.files[id]), 'снимки — в корзине');
  assert.ok(g.files['file-face-05'], 'файл, нужный в другом месте, остаётся');
  assert.deepEqual({ ...g.ctx.purgeFaces() }, { purged: false, files: 0 }, 'второй раз — ничего');
  assert.equal(g.state().rev, rev + 1);
});

test('v17: в Apps Script очистка записывается первой же правкой — без purgeFaces', () => {
  const { g, D } = platform();
  const ids = oldFaces(g);
  assert.equal(D({ action: 'clock', kind: 'in' }).ok, true);
  const st = g.state();
  assert.equal(st.settings.facePurgedV, 2);
  assert.doesNotMatch(JSON.stringify(st.attend) + JSON.stringify(st.users), FACE_RE);
  assert.ok(ids.every(id => !g.files[id]), 'снимки — в корзине');
});

test('v18: очистка снимков ещё раз (FACE_PURGE_V 2) — и файлы «ishga-kelish», на которые ссылок уже нет', () => {
  const { g, A } = platform();
  // папка files есть (в ней документ, на который ссылаются); снимки без ссылок остались после повторной отметки или правки
  const pdf = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4 ' + 'x'.repeat(3000)).toString('base64');
  assert.deepEqual(rejected(A({ action: 'patch', ops: [{ op: 'set', path: ['settings', 'welcome'], value: { introText: 'Matn', at: 1, docs: [{ id: 'd1', name: 'Qoidalar.pdf', data: pdf, at: 1 }] } }] })), []);
  const fid = g.props.LMS_FILES, doc = g.state().settings.welcome.docs[0].data.slice('lmsfile:'.length);
  assert.ok(fid && g.files[doc], 'папка files и документ');
  const face = (id, name) => { g.files[id] = { name, type: 'image/jpeg', bytes: [1, 2, 3], folder: fid, created: 0 }; };
  face('file-orphan-1', 'ishga-kelish'); face('file-orphan-2', 'ishga-kelish'); face('file-kept-1', 'ishga-kelish'); face('file-other-1', 'rasm.jpg');
  const st = g.state();
  st.settings.facePurgedV = 1;   // очистка v17 уже была
  st.users.find(u => u.id === 10427).profile = { photoFile: 'lmsfile:file-kept-1' };   // на этот файл ссылка есть — остаётся
  g.files[g.props.LMS_STATE].content = JSON.stringify(st);
  assert.deepEqual({ ...g.ctx.purgeFaces() }, { purged: true, files: 2 });
  assert.ok(!g.files['file-orphan-1'] && !g.files['file-orphan-2'], 'снимки без ссылок — в корзине');
  assert.ok(g.files['file-kept-1'] && g.files['file-other-1'] && g.files[doc], 'файл со ссылкой, другие файлы и документ — на месте');
  assert.equal(g.state().settings.facePurgedV, 2);
  face('file-orphan-3', 'ishga-kelish');
  assert.deepEqual({ ...g.ctx.purgeFaces() }, { purged: false, files: 0 }, 'второй раз — ничего');
  assert.ok(g.files['file-orphan-3']);
});

test('«Tanishuv»: документы (PDF, Word) — файлом на сервере, в данных ссылка; сотрудник их получает, правит только SOP/CEO', () => {
  const { A, D } = platform();
  const pdf = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4 ' + 'x'.repeat(3000)).toString('base64');
  const r = A({ action: 'patch', ops: [{ op: 'set', path: ['settings', 'welcome'], value: { introText: 'Matn', at: 1, docs: [{ id: 'd1', name: 'Qoidalar.pdf', size: 3009, type: 'application/pdf', data: pdf, at: 1 }] } }] });
  assert.deepEqual(rejected(r), []);
  const doc = A({ action: 'load' }).state.settings.welcome.docs[0];
  assert.match(doc.data, /^lmsfile:/, 'в данных ссылка, не сам файл');
  const own = D({ action: 'file', id: doc.data.slice('lmsfile:'.length) });
  assert.equal(own.ok, true, JSON.stringify(own));            // сотрудник открывает документ знакомства
  assert.equal(own.name, 'Qoidalar.pdf');
  assert.match(Buffer.from(own.data, 'base64').toString(), /^%PDF/);
  const bad = D({ action: 'patch', ops: [{ op: 'set', path: ['settings', 'welcome', 'docs'], value: [] }] });
  assert.equal(bad.rejected.length, 1, 'сотрудник документы не меняет');
});

test('«Savolnoma»: ответы — в своей карточке; коллеги их не видят, чужие ответы не записать, вопросы правят только SOP/CEO', () => {
  const { A, D, Z } = platform();
  const qs = { on: true, questions: [{ id: 'q1', text: 'Nega BURAQ?', type: 'long', options: [], req: true }] };
  assert.deepEqual(rejected(A({ action: 'patch', ops: [{ op: 'set', path: ['settings', 'questionnaire'], value: qs }] })), []);
  assert.equal(D({ action: 'load' }).state.settings.questionnaire.questions.length, 1, 'вопросы видны сотруднику');
  const own = D({ action: 'patch', ops: [{ op: 'set', path: ['users', { id: 10427 }, 'qa'], value: { answers: { q1: 'shaxsiy javob' }, at: 1 } }] });
  assert.deepEqual(rejected(own), []);
  assert.equal(A({ action: 'load' }).state.users.find(u => u.id === 10427).qa.answers.q1, 'shaxsiy javob', 'SOP-менеджер видит ответ');
  assert.equal(Z({ action: 'load' }).state.users.find(u => u.id === 10427).qa, undefined, 'коллега ответов не видит');
  assert.equal(Z({ action: 'patch', ops: [{ op: 'set', path: ['users', { id: 10427 }, 'qa'], value: { answers: {}, at: 2 } }] }).rejected.length, 1, 'чужие ответы не записать');
  assert.equal(D({ action: 'patch', ops: [{ op: 'set', path: ['settings', 'questionnaire'], value: { on: false } }] }).rejected.length, 1, 'сотрудник вопросы не меняет');
});

test('вывод по анкете (users[].qaReport, v14): пишут и видят CEO и SOP-менеджер; сотрудник — ни в своей карточке, ни записать', () => {
  const { A, D, Z } = platform();
  const rep = { at: 1, by: 'sop', data: { temperament: 'Sangvinik', summary: 'ochiq' } };
  // вывод ИИ хранится только с согласием на ИИ-анализ (v18)
  assert.deepEqual(rejected(D({ action: 'patch', ops: [{ op: 'set', path: ['users', { id: 10427 }, 'qa'], value: { at: 1, answers: {}, consent: { v: 1, at: 1, base: true, ai: true, special: false } } }] })), []);
  assert.deepEqual(rejected(A({ action: 'patch', ops: [{ op: 'set', path: ['users', { id: 10427 }, 'qaReport'], value: rep }] })), []);
  assert.equal(A({ action: 'load' }).state.users.find(u => u.id === 10427).qaReport.data.temperament, 'Sangvinik');
  assert.equal(D({ action: 'load' }).state.users.find(u => u.id === 10427).qaReport, undefined, 'сотрудник свой вывод не видит');
  assert.equal(Z({ action: 'load' }).state.users.find(u => u.id === 10427).qaReport, undefined, 'коллега — тоже');
  assert.equal(D({ action: 'patch', ops: [{ op: 'set', path: ['users', { id: 10427 }, 'qaReport'], value: { data: {} } }] }).rejected.length, 1, 'и не пишет его');
});

test('v18: без согласия на ИИ выводов ИИ нет — отозвал (той же правкой), не дал, анкета до согласий; анализ коллектива — отметкой', () => {
  const pl = platform(), { g, A, D } = pl, { C } = chiefs(pl);
  const cons = ai => ({ v: 1, at: 5, base: true, ai, special: false });
  const qa = (c) => Object.assign({ at: 10, answers: { q1: 'javob' } }, c ? { consent: c } : {});
  const rep = { at: 20, by: 10901, v: 2, data: { summary: 'qisqa' } };
  assert.deepEqual(rejected(A({ action: 'patch', ops: [
    { op: 'set', path: ['users', { id: 10427 }, 'qa'], value: qa(cons(true)) },
    { op: 'set', path: ['users', { id: 10391 }, 'qa'], value: qa(cons(true)) },
    { op: 'set', path: ['users', { id: 10288 }, 'qa'], value: qa(cons(true)) }] })), []);
  assert.deepEqual(rejected(A({ action: 'patch', ops: [10427, 10391, 10288].map(id => ({ op: 'set', path: ['users', { id }, 'qaReport'], value: rep })) })), []);
  const team = { at: 30, by: 10901, v: 2, lang: 'uz', ids: [10427, 10391], data: { summary: 'jamoa', people: [{ n: 1, note: 'Dilnoza haqida' }] } };
  assert.deepEqual(rejected(C({ action: 'patch', ops: [{ op: 'set', path: ['users', { id: 10901 }, 'qaTeam'], value: team }] })), [], 'анализ коллектива — в карточке CEO');
  const st0 = g.state();
  assert.ok(st0.users.every(u => [10427, 10391, 10288].indexOf(u.id) < 0 || u.qaReport), 'с согласием выводы хранятся');
  // сотрудник сам отзывает согласие на ИИ: его вывод и анализ коллектива с ним — прочь той же правкой (SOP-менеджеру не нужно заходить)
  assert.deepEqual(rejected(D({ action: 'patch', ops: [{ op: 'set', path: ['users', { id: 10427 }, 'qa', 'consent'], value: cons(false) }] })), []);
  let st = g.state(), by = id => st.users.find(u => u.id === id);
  assert.equal(by(10427).qaReport, undefined, 'вывод по нему удалён');
  assert.ok(by(10391).qaReport && by(10288).qaReport, 'у остальных — на месте');
  const ct = by(10901).qaTeam;
  assert.ok(!ct.data && !ct.ids && ct.gone > 0 && ct.at === 30 && ct.by === 10901 && ct.v === 2, 'анализ коллектива — отметка без текста: ' + JSON.stringify(ct));
  assert.doesNotMatch(JSON.stringify(st.users), /Dilnoza haqida|jamoa/, 'ни строки о нём, ни общего текста');
  // анкета без поля согласий (до шага согласий) — вывод не хранится
  assert.deepEqual(rejected(A({ action: 'patch', ops: [{ op: 'del', path: ['users', { id: 10391 }, 'qa', 'consent'] }] })), []);
  st = g.state();
  assert.equal(by(10391).qaReport, undefined, 'анкета до согласий — вывод удалён');
  assert.ok(by(10288).qaReport, 'с согласием — остаётся');
  // анализ коллектива, где все согласны, — не трогается
  assert.deepEqual(rejected(C({ action: 'patch', ops: [{ op: 'set', path: ['users', { id: 10901 }, 'qaTeam'], value: Object.assign({}, team, { ids: [10288] }) }] })), []);
  assert.equal(g.state().users.find(u => u.id === 10901).qaTeam.data.summary, 'jamoa');
});

test('должности и отделы (settings.positions / settings.depts, v15): меняет только CEO; SOP-менеджер и сотрудник — нет', () => {
  const pl = platform(), { A, D } = pl, { C, B } = chiefs(pl);
  const set = (who, k, v) => who({ action: 'patch', ops: [{ op: 'set', path: ['settings', k], value: v }] });
  assert.deepEqual(rejected(set(C, 'positions', ['Omborchi', 'Haydovchi'])), []);
  assert.deepEqual(rejected(set(C, 'depts', ['Logistika bo‘limi', 'Transport bo‘limi'])), []);
  assert.deepEqual(A({ action: 'load' }).state.settings.positions, ['Omborchi', 'Haydovchi'], 'список виден всем');
  assert.equal(set(A, 'positions', ['Boshqa']).rejected.length, 1, 'SOP-менеджер список не меняет');
  assert.equal(set(A, 'depts', []).rejected.length, 1);
  const whole = A({ action: 'load' }).state.settings;
  assert.deepEqual(rejected(A({ action: 'patch', ops: [{ op: 'set', path: ['settings'], value: Object.assign({}, whole, { passportScan: false }) }] })), [], 'другие настройки SOP-менеджер меняет как раньше');
  assert.equal(A({ action: 'patch', ops: [{ op: 'set', path: ['settings'], value: Object.assign({}, whole, { positions: [] }) }] }).rejected.length, 1);
  assert.equal(set(D, 'positions', ['x']).rejected.length, 1, 'сотрудник — нет');
  assert.equal(set(B, 'positions', ['x']).rejected.length, 1, 'руководитель только смотрит');
});

test('удаление сотрудника (v16): вход закрыт сразу, скан паспорта — с Диска; руководство так не удалить, владелец только смотрит', () => {
  const pl = platform(), { g, A, D, Z } = pl, { C, B } = chiefs(pl);
  const pdf = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4 ' + 'x'.repeat(3000)).toString('base64');
  assert.deepEqual(rejected(D({ action: 'patch', ops: [{ op: 'set', path: ['users', { id: 10427 }, 'profile'], value: { lastName: 'Karimova', passportFile: { name: 'pasport.pdf', type: 'application/pdf', data: pdf } } }] })), []);
  const id = g.state().users.find(u => u.id === 10427).profile.passportFile.data.slice(8);
  assert.ok(g.files[id] && g.props['cred:10427']);
  const del = who => who({ action: 'patch', ops: [{ op: 'del', path: ['users', { id: 10427 }] }, { op: 'del', path: ['notifications', { id: 2 }] }] });
  assert.equal(B({ action: 'patch', ops: [{ op: 'del', path: ['users', { id: 10427 }] }] }).rejected.length, 1, 'владелец только смотрит');
  assert.equal(A({ action: 'patch', ops: [{ op: 'del', path: ['users', { id: 10901 }] }] }).rejected.length, 1, 'вход CEO SOP-менеджер не удаляет');
  assert.deepEqual(rejected(del(A)), []);
  const st = g.state();
  assert.ok(!st.users.some(u => u.id === 10427) && !g.props['cred:10427'], 'карточки и учётной записи нет');
  assert.equal(D({ action: 'load' }).code, 'auth', 'открытый вход закрылся');
  assert.equal(g.post({ action: 'login', login: 'd.karimova', password: 'pw-dilnoza' }).code, 'login', 'по паролю не войти');
  assert.equal(g.files[id], undefined, 'скан паспорта удалён с Диска');
  assert.ok(st.xtasks.some(x => x.uid === 10427), 'история (задачи) остаётся');
  assert.equal(Z({ action: 'load' }).ok, true, 'остальные работают');
  assert.ok(C({ action: 'load' }).ok);
});

test('скан паспорта — 48 часов (v19): SOP-менеджеру «загружен», напоминание, «удалён»; сотрудник срок не продлит', () => {
  const now = { value: Date.UTC(2026, 10, 3, 6) };
  const pl = platform({ now }), { g, A, D } = pl;
  const pdf = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4 ' + 'x'.repeat(3000)).toString('base64');
  const sopId = g.state().users.find(u => u.role === 'admin').id;
  const pp = () => g.state().users.find(u => u.id === 10427).profile || {};
  const notes = k => g.state().notifications.filter(n => n.kind === k && n.pp && n.pp.uid === 10427);
  assert.deepEqual(rejected(D({ action: 'patch', ops: [{ op: 'set', path: ['users', { id: 10427 }, 'profile'], value: { lastName: 'Karimova', passportFile: { name: 'pasport.pdf', type: 'application/pdf', data: pdf } } }] })), []);
  const id = pp().passportFile.data.slice(8);
  assert.equal(pp().passportFile.at, now.value, 'время загрузки ставит сервер');
  assert.equal(notes('pp').length, 1); assert.equal(notes('pp')[0].userId, sopId, 'уведомление — SOP-менеджеру');
  assert.equal(notes('pp')[0].pp.until, now.value + 48 * 3600e3);
  // сотрудник пересохраняет профиль с подправленным временем — сервер возвращает своё
  now.value += 3600e3;
  const f0 = Object.assign({}, pp().passportFile, { at: now.value + 999e6, dlAt: 1 });
  assert.deepEqual(rejected(D({ action: 'patch', ops: [{ op: 'set', path: ['users', { id: 10427 }, 'profile'], value: { lastName: 'Karimova', passportFile: f0 } }] })), []);
  assert.equal(pp().passportFile.at, now.value - 3600e3, 'срок не продлить'); assert.equal(pp().passportFile.dlAt, undefined, 'отметку скачивания ставит только SOP / CEO');
  assert.equal(notes('pp').length, 1, 'тот же файл — второго уведомления нет');
  // 36 часов, не скачан — напоминание (при любой правке или ppSweep)
  now.value += 35 * 3600e3;
  assert.equal(g.ctx.ppSweep().changed, 1); assert.equal(notes('pp-warn').length, 1);
  assert.equal(g.ctx.ppSweep().changed, 0, 'напоминание — один раз');
  // SOP-менеджер отметил скачивание
  assert.deepEqual(rejected(A({ action: 'patch', ops: [{ op: 'set', path: ['users', { id: 10427 }, 'profile', 'passportFile', 'dlAt'], value: now.value }] })), []);
  assert.equal(pp().passportFile.dlAt, now.value);
  // 48 часов — файл удалён, в профиле отметка, SOP-менеджеру «удалён»
  now.value += 13 * 3600e3;
  assert.equal(g.ctx.ppSweep().changed, 1);
  assert.equal(pp().passportFile, undefined); assert.deepEqual(pp().passportGone, { at: now.value, name: 'pasport.pdf', dl: true });
  assert.equal(g.files[id], undefined, 'файл — в корзине');
  assert.equal(notes('pp-gone').length, 1); assert.equal(notes('pp-gone')[0].pp.dl, true);
  assert.equal(D({ action: 'file', id }).code !== undefined, true, 'файл больше не отдаётся');
});

test('защита правок (v20): id карточек, тест — одна попытка, балл заявки, статусы, имущество, ссылка на файл в пути', () => {
  const pf = platform(), { g, A, D } = pf, { C } = chiefs(pf);
  // SOP-менеджер не создаёт «новую» карточку с id CEO строкой и не меняет id; вход CEO остаётся его
  const take = A({ action: 'patch', ops: [
    { op: 'set', path: ['users', { id: '10901' }], value: { id: '10901', role: 'employee', login: 'ceo', password: 'x12345' } },
    { op: 'set', path: ['users', { id: 10427 }, 'id'], value: 10901 },
    { op: 'set', path: ['users', { id: 10391 }], value: { id: 10901, role: 'employee', name: 'Aziza' } }] });
  assert.deepEqual(take.rejected.map(x => x.i), [0, 1, 2]);
  // два устройства выдали новому сотруднику один и тот же номер: вторая «новая карточка» не заменяет первую
  const dup = A({ action: 'patch', ops: [{ op: 'set', path: ['users', { id: 10391 }], value: { id: 10391, role: 'employee', name: 'Boshqa odam', login: 'boshqa', password: 'pw-boshqa-1' }, after: 10288 }] });
  assert.deepEqual(rejected(dup), ['карточка с таким id уже есть']);
  assert.equal(g.state().users.find(u => u.id === 10391).name, 'Aziza Yusupova');
  assert.notEqual(g.post({ action: 'login', login: 'ceo', password: 'x12345' }).ok, true, 'чужой пароль к входу CEO не подходит');
  assert.equal(g.post({ action: 'login', login: 'ceo', password: 'pw-ceo-1' }).ok, true);
  assert.equal(C({ action: 'load' }).ok, true);
  // тест: после попытки балл не сбросить и статус не сменить, пока SOP-менеджер не поставил итог
  D({ action: 'patch', ops: [{ op: 'set', path: ['progress', '10427', 'b4-1'], value: { status: 'exam-ready', score: null } }] });
  assert.equal(D({ action: 'quiz', lessonId: 'b4-1', answers: [0, 1] }).score, 0);
  const again = D({ action: 'patch', ops: [
    { op: 'set', path: ['progress', '10427', 'b4-1', 'score'], value: null },
    { op: 'set', path: ['progress', '10427', 'b4-1'], value: { status: 'exam-ready' } },
    { op: 'set', path: ['progress', '10427', 'b4-1', 'status'], value: 'in-progress' },
    { op: 'set', path: ['progress', '10427'], value: {} }] });
  assert.deepEqual(again.rejected.map(x => x.i), [0, 1, 2, 3]);
  assert.equal(D({ action: 'quiz', lessonId: 'b4-1', answers: [1, 0] }).code, 'quiz', 'вторая попытка — нет');
  // балл в заявке на экзамен пишет только сервер; закрыть свою открытую заявку — можно
  const req = g.state().requests.find(r => r.userId === 10427);
  const forge = D({ action: 'patch', ops: [
    { op: 'set', path: ['requests', { id: 'q9' }], value: { id: 'q9', type: 'exam', userId: 10427, lessonId: 'b4-2', score: 100, state: 'open' } },
    ...(req ? [{ op: 'set', path: ['requests', { id: req.id }, 'score'], value: 100 }] : [])] });
  assert.equal(forge.rejected.length, req ? 2 : 1);
  // сверхзадачу «выполнено» целой записью не поставить
  assert.deepEqual(D({ action: 'patch', ops: [{ op: 'set', path: ['xtasks', { id: 'x1' }], value: Object.assign({}, g.state().xtasks[0], { status: 'done' }) }] }).rejected.map(x => x.i), [0]);
  // имущество: выданное — принять или «не совпадает» с пояснением; самодекларацию в «принято» не перевести
  A({ action: 'patch', ops: [
    { op: 'set', path: ['assets', { id: 'as1' }], value: { id: 'as1', uid: 10427, type: 'laptop', name: 'Noutbuk', status: 'issued' } },
    { op: 'set', path: ['assets', { id: 'as2' }], value: { id: 'as2', uid: 10427, type: 'phone', name: 'Telefon', status: 'issued' } }] });
  const as = D({ action: 'patch', ops: [
    { op: 'set', path: ['assets', { id: 'as1' }, 'status'], value: 'active' }, { op: 'set', path: ['assets', { id: 'as1' }, 'confirmedAt'], value: 7 },
    { op: 'set', path: ['assets', { id: 'as2' }, 'status'], value: 'mismatch' }, { op: 'set', path: ['assets', { id: 'as2' }, 'mismatch'], value: 'Seriya raqami boshqa' },
    { op: 'set', path: ['assets', { id: 'as3' }], value: { id: 'as3', uid: 10427, type: 'other', name: 'Stul', status: 'active' } },
    { op: 'set', path: ['assets', { id: 'as1' }, 'confirmedAt'], value: 8 }] });
  assert.deepEqual(as.rejected.map(x => x.i), [4, 5]);
  const A2 = g.state().assets;
  assert.equal(A2.find(a => a.id === 'as1').confirmedAt, 7); assert.equal(A2.find(a => a.id === 'as2').mismatch, 'Seriya raqami boshqa');
  // ссылка на чужой файл в самом пути (ключ) — не проходит
  const fileRef = 'lmsfile:' + 'x'.repeat(12);
  assert.deepEqual(rejected(D({ action: 'patch', ops: [{ op: 'set', path: ['users', { id: 10427 }, 'plan', fileRef], value: 1 }] })), ['чужой файл']);
});

test('уведомления (v20): одинаковые id разводятся, список целиком не меняется; заменённый скан паспорта — тоже в корзину', () => {
  const now = { value: Date.UTC(2026, 10, 3, 6) };
  const { g, A, D } = platform({ now });
  A({ action: 'patch', ops: [{ op: 'set', path: ['notifications', { id: 7 }], value: { id: 7, userId: 10427, text: 'a' } }] });
  const st = g.state(); st.notifications.push({ id: 7, userId: 10391, text: 'b' }); g.ctx.writeState_(st);
  assert.deepEqual(rejected(A({ action: 'patch', ops: [{ op: 'set', path: ['notifications'], value: [] }] })), ['список уведомлений целиком не меняется']);
  const ids = g.state().notifications.map(n => String(n.id));
  assert.equal(new Set(ids).size, ids.length, 'id уведомлений после правки — без повторов');
  const pdf = n => 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4 ' + n.repeat(3000)).toString('base64');
  const pp = () => g.state().users.find(u => u.id === 10427).profile.passportFile;
  D({ action: 'patch', ops: [{ op: 'set', path: ['users', { id: 10427 }, 'profile'], value: { passportFile: { name: 'a.pdf', type: 'application/pdf', data: pdf('a') } } }] });
  const first = pp().data.slice(8);
  D({ action: 'patch', ops: [{ op: 'set', path: ['users', { id: 10427 }, 'profile'], value: { passportFile: { name: 'b.pdf', type: 'application/pdf', data: pdf('b') } } }] });
  assert.notEqual(pp().data.slice(8), first);
  assert.equal(g.files[first], undefined, 'прежний скан — в корзине сразу');
});

test('цены (v21): объявленные и доступные — сотруднику; черновик и чужой отдел — нет; менять цены может только руководство', () => {
  const { A, D, Z } = platform();
  const pl = (id, status, access) => ({ op: 'set', path: ['prices', { id }], value: { id, status, title: 'Narx ' + id, access, items: [{ id: 'i1', name: 'Avia', unit: 'kg', price: '7', cur: 'USD' }] } });
  assert.deepEqual(rejected(A({ action: 'patch', ops: [pl('p1', 'published', { mode: 'all' }), pl('p2', 'draft', { mode: 'all' }), pl('p3', 'published', { mode: 'custom', depts: ['Ombor (Yiwu)'] })] })), []);
  assert.deepEqual(D({ action: 'load' }).state.prices.map(x => x.id), ['p1'], 'Dilnoza (Logistika): только объявленный для всех');
  assert.deepEqual(Z({ action: 'load' }).state.prices.map(x => x.id).sort(), ['p1', 'p3'], 'Aziza (Ombor Yiwu): и список своего отдела');
  assert.equal(A({ action: 'load' }).state.prices.length, 3, 'SOP-менеджер видит и черновик');
  const r = D({ action: 'patch', ops: [pl('p9', 'published', { mode: 'all' }), { op: 'set', path: ['prices', { id: 'p1' }, 'items', { id: 'i1' }, 'price'], value: '1' }] });
  assert.equal(r.rejected.length, 2, 'сотрудник цены не меняет');
});
