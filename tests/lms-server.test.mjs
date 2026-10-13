// Сервер учебной платформы (tools/lms-gs/Server.gs) на заглушках Apps Script: запуск, вход, что видит сотрудник,
// какие правки он может делать, тест урока, пароли, копии. Запуск: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pbkdf2Sync } from 'node:crypto';
import { loadLms } from './lms-gs-mock.mjs';
import { buildLmsGs, pageScript } from '../tools/build-lms-gs.mjs';

const DAY = 864e5;
const quiz = [{ q: 'Q1', options: ['a', 'b'], answer: 1 }, { q: 'Q2', options: ['a', 'b'], answer: 0 }];
const course = { sections: [
  { id: 's1', title: 'Ombor', officialOnly: false, lessons: [{ id: 'b4-1', title: '4.1', html: '<p>matn</p>', quiz }, { id: 'b4-2', title: '4.2', html: '<p>ikki</p>', quiz }] },
  { id: 's2', title: 'Bojxona', officialOnly: true, lessons: [{ id: 'b4-9', title: '4.9', html: '<p>yopiq</p>', quiz, intro: 'x' }] }] };

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
  assert.match(g.logs[0], new RegExp('логин: metodist, пароль: ' + adm.password));
  assert.equal(g.get().ready, true);
  const st = g.state();
  assert.equal(st.users.length, 1); assert.equal(st.users[0].role, 'admin'); assert.equal(st.users[0].password, undefined);
  assert.ok(!JSON.stringify(st).includes(adm.password));
  assert.deepEqual(g.triggers.map(t => [t.getHandlerFunction(), t.hour]), [['backup', 3]]);
  assert.throws(() => g.ctx.setup(), /уже настроена/);
  const second = g.ctx.newAdmin();
  assert.equal(second.login, 'metodist2');
  assert.equal(g.post({ action: 'login', login: 'METODIST2 ', password: second.password }).ok, true);
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
  const { g, D } = platform();
  const r = D({ action: 'patch', ops: [
    /* 0 */ { op: 'set', path: ['progress', '10427'], value: { 'b4-1': { status: 'in-progress', at: 5 } } },
    /* 1 */ { op: 'set', path: ['users', { id: 10427 }, 'reminderTime'], value: '20:00' },
    /* 2 */ { op: 'set', path: ['users', { id: 10427 }, 'plan', 'p1'], value: { at: 6, by: 10427 } },
    /* 3 */ { op: 'set', path: ['study', '10427', '2026-10-10'], value: 40 },
    /* 4 */ { op: 'set', path: ['notifications', { id: 2 }, 'read'], value: true },
    /* 5 */ { op: 'set', path: ['requests', { id: 'q1' }], value: { id: 'q1', type: 'question', userId: 10427, lessonId: 'b4-1', text: 'savol', state: 'open' }, after: null },
    /* 6 */ { op: 'set', path: ['notifications', { id: 3 }], value: { id: 3, userId: 10001, text: 'savol bor' }, after: null },
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
    /* 29 */ { op: 'set', path: ['notifications', { id: 4 }], value: { id: 4, userId: 10391, promo: { li: 5 } } }] });
  assert.deepEqual(r.rejected.map(x => x.i), [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29]);
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
  const { g, A, D, Z, login } = platform();
  const add = A({ action: 'patch', ops: [
    { op: 'set', path: ['users', { id: 10901 }], value: { id: 10901, role: 'leader', post: 'ceo', login: 'ceo', password: 'pw-ceo-1', name: 'Bosh direktor', position: 'CEO' } },
    { op: 'set', path: ['users', { id: 10902 }], value: { id: 10902, role: 'leader', post: 'pm', login: 'pm', password: 'pw-pm-1', name: 'Loyiha rahbari', position: 'Project Manager' } }] });
  assert.deepEqual(add.rejected, []);
  const idea = (id, to, extra) => ({ op: 'set', path: ['initiatives', { id }], value: { id, uid: 10427, to, type: 'idea', area: 'it', title: 'G‘oya ' + id, text: 'Batafsil matn ' + id, status: 'new', at: 5, ...extra } });
  const sent = D({ action: 'patch', ops: [
    idea('i5', 'ceo'), idea('i6', 'pm'),
    /* 2 */ idea('i7', undefined), /* 3 */ idea('i8', 'hr'), /* 4 */ idea('i9', 'ceo', { reply: 'o‘zim javob berdim' }),
    { op: 'set', path: ['notifications', { id: 50 }], value: { id: 50, userId: 10901, kind: 'ini_in', ini: { to: 'ceo' }, at: 5, read: false } },
    // несколько адресатов: список без повторов, только CEO, Project Manager, руководитель
    /* 6 */ idea('i10', ['ceo', 'pm']), /* 7 */ idea('i11', []), /* 8 */ idea('i12', ['ceo', 'ceo']), /* 9 */ idea('i13', ['pm', 'hr'])] });
  assert.deepEqual(sent.rejected.map(x => x.i), [2, 3, 4, 7, 8, 9]);
  assert.match(sent.rejected[0].reason, /кому отправить идею/); assert.match(sent.rejected[2].reason, /даёт её адресат/);

  // адресат видит только свои идеи и почти ничего больше
  const C = login('ceo', 'pw-ceo-1'), cv = C({ action: 'load' }).state;
  assert.deepEqual(cv.initiatives.map(x => x.id).sort(), ['i10', 'i5']);
  assert.equal(cv.initiatives[0].text, 'Batafsil matn i5');
  assert.deepEqual(cv.course.sections, []); assert.deepEqual(cv.progress, {}); assert.deepEqual(cv.journals, []); assert.deepEqual(cv.errors, []);
  assert.deepEqual(cv.notifications.map(n => n.id), [50]);
  const author = cv.users.find(u => u.id === 10427);
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
    /* 7 */ { op: 'set', path: ['initiatives', { id: 'i5' }, 'status'], value: 'zo‘r' },
    /* 8 */ { op: 'del', path: ['initiatives', { id: 'i5' }] },
    /* 9 */ { op: 'set', path: ['course', 'sections'], value: [] },
    /* 10 */ { op: 'set', path: ['users', { id: 10901 }, 'post'], value: 'boss' },
    /* 11 */ { op: 'set', path: ['initiatives', { id: 'i1' }, 'status'], value: 'done' }] });
  assert.deepEqual(ans.rejected.map(x => x.i), [5, 6, 7, 8, 9, 10, 11]);
  assert.match(ans.rejected[0].reason, /адресована не вам/); assert.match(ans.rejected[1].reason, /меняет автор идеи/);
  const i5 = g.state().initiatives.find(x => x.id === 'i5');
  assert.equal(i5.status, 'accepted'); assert.equal(i5.reply, 'Zo‘r, qilamiz'); assert.equal(i5.title, 'G‘oya i5');

  // идея нескольким адресатам: видят оба, отвечает любой — только от своего имени
  const P = login('pm', 'pw-pm-1');
  assert.deepEqual(P({ action: 'load' }).state.initiatives.map(x => x.id).sort(), ['i10', 'i6']);
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
  const fix = D({ action: 'patch', ops: [{ op: 'set', path: ['errors', { id: 'e1' }, 'text'], value: 'yo‘q edi' }, { op: 'set', path: ['errors', { id: 'e1' }, 'retest'], value: { score: 90 } }] });
  assert.deepEqual(fix.rejected.map(x => x.i), [0]);
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
  assert.deepEqual(D({ action: 'since', rev: v.rev }), { ok: true, v: 6, ai: false, rev: v.rev, same: true });
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
