/**
 * BURAQ o‘quv platformasi — сервер учебной платформы (https://buraqlogisticsuz.github.io/Buraqlearning/).
 * Хранит общее состояние платформы на Google Диске владельца скрипта, проверяет вход и каждую правку.
 * Отдельный проект Apps Script — не тот, что у таблицы отгрузок.
 *
 * 1) script.google.com → Новый проект → вставьте весь код из tools/lms-gs/Code.gs (собирается из этого файла
 *    и lms-sync.js: node tools/build-lms-gs.mjs) → Сохранить.
 * 2) Вверху выберите функцию setup → ▶ Выполнить → разрешите доступ (Диск, триггеры).
 *    В «Журнале выполнения» — логин и пароль SOP-менеджера: запишите, пароль показывается один раз.
 * 3) Развернуть → Новое развертывание → Тип: Веб-приложение. Выполнять как: Я. Доступ: Все. → Развернуть.
 *    Ссылка …/exec — адрес сервера для страницы платформы.
 * Забыли пароль SOP-менеджера — функция newAdmin: новый вход SOP-менеджера, логин и пароль — в журнале выполнения.
 * Копия данных — каждую ночь (функция backup, папка backups рядом с state.json), хранится 30 дней.
 * Файлы (сканы паспортов, вложения журналов и сверхзадач) — в папке files рядом с state.json: в данных остаётся
 * ссылка lmsfile:<id>, сам файл сервер отдаёт только тому, кому видна эта ссылка (действие file).
 * ИИ (наставник, кейсы, опросы, редактор курса) — Claude API через этот скрипт (действие ai): ⚙ Настройки проекта →
 * Свойства скрипта → ANTHROPIC_API_KEY = ключ с platform.claude.com. Ключ не уходит на страницу. Необязательно:
 * AI_MODEL (по умолчанию claude-opus-5-5), AI_DAILY_LIMIT / AI_DAILY_LIMIT_ADMIN (запросов в день на человека),
 * AI_MAX_TOKENS (длина ответа). Без ключа платформа работает, ИИ-кнопки пишут «ИИ не подключён».
 *
 * Запрос — POST с JSON { action, token, … }, ответ — JSON { ok, … } или { ok: false, code, error }.
 */
var LMS_VERSION = 8;           // 2: файлы — отдельно на Диске, действие file; 3: ИИ через Claude API (действие ai);
                               // 4: адресаты идей — CEO, Project Manager, руководитель компании (свой вход, role 'leader');
                               // 5: у идеи несколько адресатов (to — список), repliedBy — кто ответил;
                               // 6: свой профиль — имя и фото, смена логина и пароля (действие account);
                               // 7: копия данных у SOP-менеджера (действие export), уведомления в Telegram (server/)
                               // 8: «Kun hikmati» на странице входа — свои цитаты SOP-менеджера (действие wisdom, без входа)
var PBKDF2_ITER = 10000;          // пароль хранится только как PBKDF2-SHA256 с солью
var SESSION_DAYS = 30;            // вход на устройстве живёт 30 дней с последнего запроса
var FAIL_MAX = 5, FAIL_LOCK_MIN = 15;  // 5 неверных паролей подряд — логин закрыт на 15 минут
var MAX_SESSIONS = 10;            // входов одного человека (устройств) одновременно; старые закрываются
var BACKUP_KEEP_DAYS = 30;
var PASS_MARK = 80;
var MAX_OPS = 500;
var FILE_MIN = 2048;              // data:-строки короче (значки) остаются в данных, длиннее — файлом на Диске
var AVATAR_MAX = 16000;           // фото профиля (128×128 JPEG) — в данных, не файлом: его показывают везде, где имя
var LOGIN_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;   // логин: 3–32 символа, латиница, цифры, точка, дефис, подчёркивание
var AUDIT_KEEP = 500;             // журнал нарушений защиты урока — последние 500 записей
var AI_MODEL = 'claude-opus-5-5';  // свойство AI_MODEL меняет модель без правки кода
var AI_LIMIT = 30, AI_LIMIT_ADMIN = 200;  // запросов к ИИ в день на сотрудника / SOP-менеджера
var AI_MAX_TOKENS = 4096;         // ответ должен уложиться в минуту — столько Apps Script ждёт внешний запрос
var AI_MAX_CHARS = 200000;        // длина запроса (текст стандартов + переписка)
// модели, у которых Claude API сам повторяет отказанный запрос на запасной модели (fallbacks: "default")
var AI_FALLBACK = ['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5'];
var DAY_MS = 864e5;
var WISDOM_MAX = 60, WISDOM_TEXT = 240, WISDOM_BY = 80;   // «Kun hikmati»: цитат SOP-менеджера и их длина
// идею сотрудник отправляет одному или нескольким адресатам (to — список); у адресата свой вход (role 'leader',
// post — кто он) и только эти идеи; ответ общий, repliedBy — кто из адресатов ответил последним
var INI_TO = ['ceo', 'pm', 'boss'];
var INI_STATUS = ['new', 'review', 'accepted', 'done', 'declined'];
var INI_ANSWER = ['status', 'reply', 'repliedAt', 'acceptedAt', 'repliedBy'];   // ответ адресата на идею
function iniTo_(x) { return !x ? [] : Array.isArray(x.to) ? x.to : x.to ? [x.to] : []; }   // ранние идеи — одна строка

/* ---------------- вход в веб-приложение ---------------- */

function doGet() {
  return json_({ ok: true, app: 'buraq-lms', v: LMS_VERSION, ready: !!props_().getProperty('LMS_STATE') });
}

function doPost(e) {
  var req;
  try { req = JSON.parse((e && e.postData && e.postData.contents) || ''); } catch (x) { return json_({ ok: false, code: 'bad', error: 'Запрос — не JSON' }); }
  try { return json_(route_(req || {})); }
  catch (x) { return json_({ ok: false, code: x.code || 'script', error: String((x && x.message) || x) }); }
}

function route_(req) {
  var a = String(req.action || '');
  if (a === 'ping') return { ok: true, v: LMS_VERSION, ready: !!props_().getProperty('LMS_STATE') };
  if (a === 'login') return login_(req);
  if (a === 'wisdom') return wisdom_();
  var s = session_(req.token);
  if (a === 'logout') { props_().deleteProperty(s.key); return { ok: true }; }
  if (a === 'since') {
    var rev = +props_().getProperty('LMS_REV') || 0;
    if (+req.rev === rev) return { ok: true, v: LMS_VERSION, ai: !!aiKey_(), rev: rev, same: true };
    return load_(s);
  }
  if (a === 'load') return load_(s);
  if (a === 'patch') return patch_(s, req.ops);
  if (a === 'quiz') return quiz_(s, req);
  if (a === 'retest') return retest_(s, req);
  if (a === 'ai') return ai_(s, req);
  if (a === 'password') return password_(s, req);
  if (a === 'account') return account_(s, req);
  if (a === 'resetPassword') return resetPassword_(s, req);
  if (a === 'file') return file_(s, req);
  if (a === 'export') return export_(s);
  // Telegram — у сервера на Node (server/telegram.mjs перехватывает эти действия); в Apps Script его нет
  if (a === 'tgLink' || a === 'tgUnlink') throw err_('tg_off', 'Telegram подключается только на сервере Railway');
  throw err_('bad', 'Неизвестное действие «' + a + '»');
}

/* ---------------- служебное ---------------- */

function props_() { return PropertiesService.getScriptProperties(); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function err_(code, msg) { var e = new Error(msg); e.code = code; return e; }
function now_() { return Date.now(); }
function clone_(x) { return JSON.parse(JSON.stringify(x)); }
function hex_(bytes) { return bytes.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join(''); }
function sha_(s) { return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)); }
function rand_() { return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''); }
function normLogin_(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw err_('busy', 'Сервер занят другой записью — повторите через полминуты');
  try { return fn(); } finally { lock.releaseLock(); }
}

/* PBKDF2-HMAC-SHA256, один блок (32 байта) */
function pbkdf2_(password, salt, iter) {
  var P = Utilities.newBlob(String(password)).getBytes();
  var u = Utilities.computeHmacSha256Signature(Utilities.newBlob(String(salt)).getBytes().concat([0, 0, 0, 1]), P);
  var t = u.slice();
  for (var i = 1; i < iter; i++) {
    u = Utilities.computeHmacSha256Signature(u, P);
    for (var j = 0; j < t.length; j++) t[j] ^= u[j];
  }
  return hex_(t);
}
function makeCred_(uid, login, password) {
  var salt = rand_().slice(0, 32);
  return { uid: uid, login: normLogin_(login), salt: salt, iter: PBKDF2_ITER, hash: pbkdf2_(password, salt, PBKDF2_ITER) };
}
function genPassword_() {
  var c = 'abcdefghjkmnpqrstuvwxyz23456789', h = sha_(rand_()), s = '';
  for (var i = 0; i < 10; i++) s += c[parseInt(h.substr(i * 4, 4), 16) % c.length];
  return s;
}

/* учётные записи: свойство cred:<id> = { uid, login, salt, iter, hash } */
function creds_() {
  var all = props_().getProperties(), out = {};
  Object.keys(all).forEach(function (k) { if (k.indexOf('cred:') === 0) { var c = JSON.parse(all[k]); out[String(c.uid)] = c; } });
  return out;
}
function setCred_(c) { props_().setProperty('cred:' + c.uid, JSON.stringify(c)); }
function dropSessions_(uid, keepKey) {
  var P = props_(), all = P.getProperties();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('sess:') !== 0 || k === keepKey) return;
    var s = JSON.parse(all[k]);
    if (String(s.uid) === String(uid) || s.exp < now_()) P.deleteProperty(k);
  });
}

/* просроченные входы — прочь; у одного человека не больше MAX_SESSIONS, старые закрываются */
function trimSessions_(uid) {
  var P = props_(), all = P.getProperties(), mine = [];
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('sess:') !== 0) return;
    var s = JSON.parse(all[k]);
    if (s.exp < now_()) P.deleteProperty(k); else if (String(s.uid) === String(uid)) mine.push({ k: k, exp: s.exp });
  });
  mine.sort(function (a, b) { return b.exp - a.exp; }).slice(MAX_SESSIONS).forEach(function (x) { P.deleteProperty(x.k); });
}

/* ---------------- состояние на Диске ---------------- */

function readState_() {
  var id = props_().getProperty('LMS_STATE');
  if (!id) throw err_('setup', 'Сервер не настроен: в редакторе Apps Script запустите функцию setup');
  return JSON.parse(DriveApp.getFileById(id).getBlob().getDataAsString('UTF-8'));
}
function writeState_(st) {
  DriveApp.getFileById(props_().getProperty('LMS_STATE')).setContent(JSON.stringify(st));
  props_().setProperty('LMS_REV', String(st.rev));
  // сервер на Node (server/telegram.mjs): новые уведомления — в Telegram; в Apps Script этой функции нет
  if (typeof LMS_AFTER_WRITE === 'function') LMS_AFTER_WRITE(st);
}
/* «Kun hikmati» на странице входа — её видят и до входа, поэтому отдаётся только этот список:
   settings.wisdom = { std: показывать ли узбекские пословицы страницы, list: [{ text, by }] } — правит SOP-менеджер в «Kontent» */
function wisdom_() {
  if (!props_().getProperty('LMS_STATE')) return { ok: true, std: true, list: [] };
  var w = (readState_().settings || {}).wisdom || {};
  var list = (Array.isArray(w.list) ? w.list : []).filter(function (x) { return x && typeof x.text === 'string' && x.text.trim(); })
    .slice(0, WISDOM_MAX).map(function (x) { return { text: x.text.trim().slice(0, WISDOM_TEXT), by: String(x.by || '').trim().slice(0, WISDOM_BY) }; });
  return { ok: true, std: w.std !== false, list: list };
}
function userById_(st, uid) { return (st.users || []).filter(function (u) { return String(u.id) === String(uid); })[0] || null; }

function emptyState_() {
  return {
    v: 23, rev: 1, seq: 100,
    course: { sections: [] }, levels: [], tracks: [], planTpl: [],
    settings: { survey: { on: false, every: 3, round: 0 } },
    users: [], alumni: [], progress: {}, study: {}, requests: [], notifications: [], reminded: {}, audit: [],
    assets: [], errors: [], cases: [], journals: [], terms: [], drills: [], sopUpdates: [], initiatives: [], surveys: [],
    attend: {}, attendCover: {}, attendImports: [], attendAlias: {}, xtasks: [], monthly: {}
  };
}

/* ---------------- вход и сессии ---------------- */

function login_(req) {
  var login = normLogin_(req.login), pw = String(req.password == null ? '' : req.password);
  if (!login || !pw) throw err_('login', 'Введите логин и пароль');
  // без общей блокировки: хэш пароля считается около секунды, утром сотрудники входят одновременно.
  // Счётчик неверных паролей — в кэше: живёт 15 минут и не копится в свойствах скрипта (их объём ограничен)
  var P = props_(), C = CacheService.getScriptCache(), fk = 'fail:' + sha_(login), f = JSON.parse(C.get(fk) || 'null');
  if (f && f.until > now_()) throw err_('locked', 'Много неверных паролей — вход закрыт ещё на ' + Math.ceil((f.until - now_()) / 6e4) + ' мин.');
  var all = creds_(), cred = null;
  Object.keys(all).forEach(function (k) { if (all[k].login === login) cred = all[k]; });
  // без такого логина пароль всё равно считается: по времени ответа не узнать, есть ли логин
  var hash = pbkdf2_(pw, cred ? cred.salt : 'x', cred ? cred.iter : PBKDF2_ITER);
  var st = cred && hash === cred.hash ? readState_() : null, user = st ? userById_(st, cred.uid) : null;
  if (!user) {
    var n = (f && !f.until ? f.n : 0) + 1;
    C.put(fk, JSON.stringify(n >= FAIL_MAX ? { n: 0, until: now_() + FAIL_LOCK_MIN * 6e4 } : { n: n, until: 0 }), FAIL_LOCK_MIN * 60);
    throw err_('login', 'Неверный логин или пароль');
  }
  C.remove(fk);
  var token = rand_();
  P.setProperty('sess:' + sha_(token), JSON.stringify({ uid: user.id, exp: now_() + SESSION_DAYS * DAY_MS }));
  trimSessions_(user.id);
  return { ok: true, token: token, me: user.id, rev: st.rev };
}

function session_(token) {
  if (!token) throw err_('auth', 'Нужен вход');
  var P = props_(), k = 'sess:' + sha_(token), s = JSON.parse(P.getProperty(k) || 'null');
  if (!s || s.exp < now_()) { if (s) P.deleteProperty(k); throw err_('auth', 'Вход на этом устройстве закончился — войдите снова'); }
  if (s.exp - now_() < SESSION_DAYS * DAY_MS / 2) { s.exp = now_() + SESSION_DAYS * DAY_MS; P.setProperty(k, JSON.stringify(s)); }
  return { key: k, uid: s.uid };
}
function me_(st, s) {
  var u = userById_(st, s.uid);
  if (!u) { props_().deleteProperty(s.key); throw err_('auth', 'Учётной записи больше нет'); }
  return u;
}

function load_(s) {
  var st = readState_(), me = me_(st, s);
  return { ok: true, v: LMS_VERSION, ai: !!aiKey_(), rev: st.rev, me: me.id, state: viewFor_(st, me) };
}

/* смена своего пароля — только у SOP-менеджера (решение владельца 13.10.2026); сотрудникам пароль задаёт он */
function password_(s, req) { return account_(s, { old: req.old, password: String(req.password || '') }); }

/* фото профиля: data:-картинка до AVATAR_MAX символов (страница уменьшает её до 128×128) */
function avatarOk_(v) {
  return v == null || (typeof v === 'string' && v.length <= AVATAR_MAX && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/.test(v));
}

/* свой логин и (или) пароль: { old, login?, password? } — с текущим паролем. Логин меняет каждый сам, пароль —
   только SOP-менеджер (свой здесь, сотрудникам — в их карточке). Новый пароль закрывает другие входы */
function account_(s, req) {
  var old = String(req.old || ''), nl = req.login == null || req.login === '' ? null : normLogin_(req.login);
  var np = req.password == null || req.password === '' ? null : String(req.password);
  if (nl == null && np == null) throw err_('bad', 'Нечего менять');
  if (np != null && me_(readState_(), s).role !== 'admin') throw err_('forbidden', 'Пароль меняет SOP-менеджер');
  if (np != null && np.length < 8) throw err_('weak', 'Новый пароль — не короче 8 символов');
  if (nl != null && !LOGIN_RE.test(nl)) throw err_('login_format', 'Логин: 3–32 символа — латиница, цифры, точка, дефис, подчёркивание');
  return withLock_(function () {
    var c = creds_()[String(s.uid)];
    if (!c || pbkdf2_(old, c.salt, c.iter) !== c.hash) throw err_('login', 'Текущий пароль неверный');
    var st = readState_(), me = me_(st, s), all = creds_(), uid = String(s.uid);
    if (nl != null && nl !== c.login) {
      var taken = Object.keys(all).some(function (k) { return k !== uid && all[k].login === nl; })
        || (st.users || []).some(function (u) { return String(u.id) !== uid && normLogin_(u.login) === nl; });
      if (taken) throw err_('taken', 'Логин «' + nl + '» уже занят');
      c.login = nl; me.login = nl;
      st.rev = (+st.rev || 0) + 1;
      writeState_(st);
    }
    if (np != null) { setCred_(makeCred_(c.uid, c.login, np)); dropSessions_(c.uid, s.key); }
    else setCred_(c);
    return { ok: true, rev: st.rev, login: c.login };
  });
}

function resetPassword_(s, req) {
  return withLock_(function () {
    var st = readState_(), me = me_(st, s);
    if (me.role !== 'admin') throw err_('forbidden', 'Пароль сбрасывает SOP-менеджер');
    var u = userById_(st, req.userId);
    if (!u || !u.login) throw err_('bad', 'Нет такого сотрудника или у него нет логина');
    var pw = genPassword_();
    setCred_(makeCred_(u.id, u.login, pw));
    dropSessions_(u.id, String(u.id) === String(me.id) ? s.key : null);
    return { ok: true, password: pw };
  });
}

/* ---------------- что видит пользователь ---------------- */

var PUBLIC_USER = ['id', 'role', 'post', 'name', 'avatar', 'position', 'department', 'status', 'cohort', 'level', 'levelXpBase', 'levelAt', 'mentor', 'trackId', 'startedAt'];
function pick_(o, keys) { var r = {}; keys.forEach(function (k) { if (o[k] !== undefined) r[k] = o[k]; }); return r; }
function own_(list, field, uid) { return (list || []).filter(function (x) { return x && String(x[field]) === String(uid); }); }

/* кому видна запись журнала или термин — то же правило, что canSee на странице */
function canSee_(u, a) {
  if (!u) return false;
  if (u.role === 'admin') return true;
  a = a || { mode: 'all' };
  if (a.mode === 'all') return true;
  if (a.mode === 'official') return u.status === 'official';
  var hasD = (a.depts || []).length, hasP = (a.positions || []).length, hasL = (a.minLevel || 0) > 0, hasU = (a.users || []).length;
  if (hasU && a.users.indexOf(u.id) >= 0) return true;
  if (!hasD && !hasP && !hasL) return false;
  if (hasD && a.depts.indexOf(u.department) < 0) return false;
  if (hasP && a.positions.indexOf(u.position) < 0) return false;
  if (hasL && (u.level || 0) < a.minLevel) return false;
  return true;
}

function viewFor_(st, me) {
  if (me.role === 'leader') return leaderView_(st, me);
  var v = clone_(st);
  delete v.rev;
  if (me.role === 'admin') { hideAddressed_(v); return v; }
  var uid = String(me.id), official = me.status === 'official';
  // уроки: правильные ответы тестов не уходят никому, кроме SOP-менеджера; закрытые разделы — только названия
  ((v.course || {}).sections || []).forEach(function (s) {
    s.lessons = (s.lessons || []).map(function (l) {
      if (s.officialOnly && !official) return pick_(l, ['id', 'title', 'n', 'source']);
      (l.quiz || []).forEach(function (q) { delete q.answer; });
      return l;
    });
  });
  v.users = (st.users || []).map(function (u) {
    if (String(u.id) === uid) return clone_(u);
    var p = pick_(u, PUBLIC_USER);
    if (u.pulse) p.pulse = { n: u.pulse.n || 0 };   // для рейтинга — только число опросов
    return p;
  });
  // прогресс коллег — только статус и балл (рейтинг); комментарии SOP-менеджера — только свои
  v.progress = {};
  Object.keys(st.progress || {}).forEach(function (k) {
    if (k === uid) { v.progress[k] = clone_(st.progress[k]); return; }
    v.progress[k] = {};
    Object.keys(st.progress[k] || {}).forEach(function (lid) { v.progress[k][lid] = pick_(st.progress[k][lid] || {}, ['status', 'score']); });
  });
  v.requests = own_(st.requests, 'userId', uid);
  v.notifications = own_(st.notifications, 'userId', uid);
  v.assets = own_(st.assets, 'uid', uid);
  v.surveys = own_(st.surveys, 'uid', uid);
  v.audit = [];
  v.errors = (st.errors || []).filter(function (x) { return String(x.uid) === uid || (me.mentor && String(x.by) === uid); });
  // чужие идеи, тренировки и сверхзадачи — только то, из чего считается рейтинг
  v.initiatives = (st.initiatives || []).map(function (x) { return String(x.uid) === uid ? x : pick_(x, ['id', 'uid', 'status']); });
  v.drills = (st.drills || []).map(function (x) { return String(x.uid) === uid ? x : pick_(x, ['id', 'uid', 'lessonId', 'score']); });
  v.xtasks = (st.xtasks || []).filter(function (x) { return x.status !== 'cancel'; }).map(function (x) { return String(x.uid) === uid ? x : pick_(x, ['id', 'uid', 'status', 'xp']); });
  v.cases = (st.cases || []).filter(function (c) { return c.status === 'published'; });
  v.journals = (st.journals || []).filter(function (j) { return j.status === 'published' && canSee_(me, j.access); });
  v.terms = (st.terms || []).filter(function (x) { return x.status === 'published' && canSee_(me, x.access); });
  v.attend = {}; if (st.attend && st.attend[uid]) v.attend[uid] = st.attend[uid];
  v.attendImports = []; v.attendAlias = {};
  v.reminded = {}; if (st.reminded && st.reminded[uid] !== undefined) v.reminded[uid] = st.reminded[uid];
  return clone_(v);
}

/* идеи, адресованные CEO, Project Manager или руководителю, SOP-менеджер не читает: остаётся то, из чего считаются
   XP и уровни сотрудника (статус, даты). В уведомлениях автору об ответе — без названия и текста ответа */
function hideAddressed_(v) {
  v.initiatives = (v.initiatives || []).map(function (x) { return iniTo_(x).length ? pick_(x, ['id', 'uid', 'to', 'status', 'at', 'acceptedAt', 'repliedAt']) : x; });
  v.notifications = (v.notifications || []).map(function (n) {
    return n && n.kind === 'ini' && n.ini && iniTo_(n.ini).length ? Object.assign({}, n, { ini: pick_(n.ini, ['s', 'xp', 'to']) }) : n;
  });
}

/* адресат идей видит только идеи, адресованные его должности, кто их прислал и свои уведомления */
function leaderView_(st, me) {
  var uid = String(me.id), v = emptyState_();
  delete v.rev;
  v.v = st.v; v.seq = st.seq;
  v.levels = clone_(st.levels || []); v.settings = clone_(st.settings || {});
  v.users = (st.users || []).map(function (u) { return String(u.id) === uid ? clone_(u) : pick_(u, PUBLIC_USER); });
  v.initiatives = (st.initiatives || []).filter(function (x) { return iniTo_(x).indexOf(me.post) >= 0; }).map(clone_);
  v.notifications = own_(st.notifications, 'userId', uid).map(clone_);
  return v;
}

/* ---------------- правки ---------------- */

// поля своей карточки, которые сотрудник не меняет сам (их ставит SOP-менеджер)
var LOCKED_USER = ['id', 'role', 'post', 'login', 'password', 'tg', 'status', 'position', 'department', 'cohort', 'trackId', 'mentor', 'level', 'levelXpBase', 'levelAt', 'levelTasks', 'startedAt'];
// списки «своих» записей: поле владельца
var OWN = { requests: 'userId', notifications: 'userId', assets: 'uid', surveys: 'uid', initiatives: 'uid', drills: 'uid', audit: 'userId', errors: 'uid', xtasks: 'uid' };
// поля своих записей, которые ставит SOP-менеджер или наставник
var LOCKED_ITEM = {
  requests: ['verdict', 'reply', 'repliedAt'],
  initiatives: ['status', 'reply', 'repliedAt', 'acceptedAt', 'to'],   // ответ ставит адресат, адресата не сменить
  xtasks: ['title', 'desc', 'due', 'xp', 'scale', 'li', 'by', 'at', 'review', 'doneAt'],
  errors: ['by', 'at', 'lessonId', 'cat', 'sev', 'text', 'impact', 'closedAt'],
  assets: ['confirmedAt', 'resolved', 'mismatch', 'returnedAt'],   // о проблеме (issue) сотрудник сообщает сам
  audit: [], notifications: [], surveys: [], drills: []
};
var EMP_LESSON_STATUS = ['in-progress', 'question', 'exam-ready'];
// не общие данные: номер версии ведёт сервер, вход и язык — у каждого устройства свои
var DEVICE_KEYS = ['rev', 'session', 'lang'];

function isId_(s) { return LmsSync.isIdSeg(s); }

/* правка сотрудника: null — можно, иначе причина отказа */
function checkEmployee_(st, me, op) {
  var p = op.path || [], top = p[0], uid = String(me.id);
  if (!Array.isArray(p) || !p.length) return 'пустой путь';
  // адресат идей: своя карточка и уведомления — как у сотрудника, остальное — только ответ на свои идеи
  if (me.role === 'leader' && ['users', 'notifications', 'study', 'reminded'].indexOf(top) < 0) return checkLeader_(st, me, op);

  if (top === 'users') {
    if (!isId_(p[1]) || String(p[1].id) !== uid) return 'чужая карточка';
    if (p.length < 3) return 'карточку целиком меняет SOP-менеджер';
    // своё имя и фото — сам; логин и пароль — действие account (с текущим паролем)
    if (p[2] === 'name') return p.length === 3 && op.op === 'set' && typeof op.value === 'string' && op.value.trim().length >= 2 && op.value.length <= 60 ? null : 'имя — от 2 до 60 символов';
    if (p[2] === 'avatar') return p.length === 3 && (op.op === 'del' || avatarOk_(op.value)) ? null : 'фото — картинка JPG, PNG или WebP до 12 КБ';
    if (LOCKED_USER.indexOf(p[2]) >= 0) return 'поле «' + p[2] + '» меняет SOP-менеджер';
    return null;
  }

  if (top === 'progress') {
    if (p[1] !== uid) return 'чужой прогресс';
    if (op.op === 'del') return 'прогресс не удаляется';
    var cur = (st.progress || {})[uid] || {};
    if (p.length === 2) {
      if (!op.value || typeof op.value !== 'object') return 'неверный прогресс';
      return Object.keys(op.value).map(function (lid) { return checkLesson_(cur[lid], op.value[lid]); }).filter(Boolean)[0] || null;
    }
    if (p.length === 3) return checkLesson_(cur[p[2]], op.value);
    var patch = {}; patch[p[3]] = op.value;
    return p.length === 4 ? checkLesson_(cur[p[2]], Object.assign({}, cur[p[2]] || {}, patch)) : 'неверный путь прогресса';
  }

  if (top === 'study' || top === 'reminded') return p[1] === uid ? null : 'чужие данные';

  if (top === 'sopUpdates') {
    // «ознакомлен» с новой редакцией стандарта — только своя отметка
    if (!isId_(p[1]) || p[2] !== 'acks' || op.op !== 'set') return 'новые редакции стандартов публикует SOP-менеджер';
    var up = LmsSync.get(st, p.slice(0, 2));
    if (!up || (up.required || []).map(String).indexOf(uid) < 0) return 'эта редакция вам не назначена';
    if (p.length === 4) return p[3] === uid && typeof op.value === 'number' ? null : 'чужая отметка';
    if (p.length === 3) { var ks = Object.keys(op.value || {}); return !up.acks && ks.length === 1 && ks[0] === uid ? null : 'чужая отметка'; }
    return 'неверный путь';
  }

  if (top === 'journals') {
    // строка в журнал, куда SOP-менеджер разрешил добавлять
    if (!isId_(p[1]) || p[2] !== 'rows' || !isId_(p[3]) || p.length !== 4 || op.op !== 'set') return 'журналы ведёт SOP-менеджер';
    var j = LmsSync.get(st, p.slice(0, 2));
    if (!j || j.status !== 'published' || (j.access || {}).canAdd !== 'viewers' || !canSee_(me, j.access)) return 'в этот журнал добавлять нельзя';
    if (LmsSync.get(st, p)) return 'строку меняет SOP-менеджер';
    return op.value && String(op.value.by) === uid ? null : 'строка — только от своего имени';
  }

  if (OWN[top]) {
    var f = OWN[top];
    if (!isId_(p[1])) return 'список целиком меняет SOP-менеджер';
    var item = LmsSync.get(st, p.slice(0, 2));
    if (!item) {
      if (p.length !== 2 || op.op !== 'set') return 'такой записи уже нет';
      return checkNew_(top, me, op.value);
    }
    var mine = String(item[f]) === uid, mentorOwn = top === 'errors' && me.mentor && String(item.by) === uid;
    if (!mine && !mentorOwn) return 'чужая запись';
    if (top === 'audit') return 'журнал нарушений не правится';
    if (op.op === 'del') return ['assets', 'notifications'].indexOf(top) >= 0 && mine ? null : 'запись удаляет SOP-менеджер';
    if (mentorOwn) return null;
    var locked = (LOCKED_ITEM[top] || []).concat([f, 'id']), who = top === 'initiatives' ? 'адресат идеи' : 'SOP-менеджер';
    if (p.length === 2) {
      var bad = locked.filter(function (k) { return !LmsSync.equal(item[k], (op.value || {})[k]); })[0];
      return bad ? 'поле «' + bad + '» меняет ' + who : null;
    }
    if (locked.indexOf(p[2]) >= 0) return 'поле «' + p[2] + '» меняет ' + who;
    if (top === 'xtasks' && p[2] === 'status' && ['review', 'open'].indexOf(op.value) < 0) return 'итог сверхзадачи ставит SOP-менеджер';
    if (top === 'errors' && p[2] === 'status' && op.value === 'closed') return 'ошибку закрывает наставник';
    return null;
  }

  return 'нет прав на «' + top + '»';
}

/* правка адресата идей: ответ (статус, текст, даты, кто ответил) на идею, где он среди адресатов; саму идею меняет автор */
function checkLeader_(st, me, op) {
  var p = op.path, top = p[0];
  if (top !== 'initiatives') return 'нет прав на «' + top + '»';
  if (!isId_(p[1])) return 'список идей целиком не меняется';
  var item = LmsSync.get(st, p.slice(0, 2));
  if (!item || iniTo_(item).indexOf(me.post) < 0) return 'эта идея адресована не вам';
  if (op.op !== 'set') return 'идею удалить нельзя';
  if (p.length === 2) {
    var nv = op.value || {}, keys = Object.keys(item).concat(Object.keys(nv));
    var bad = keys.filter(function (k) { return INI_ANSWER.indexOf(k) < 0 && !LmsSync.equal(item[k], nv[k]); })[0];
    if (bad) return 'поле «' + bad + '» меняет автор идеи';
    if (nv.repliedBy !== item.repliedBy && nv.repliedBy !== me.post) return 'ответ — только от своего имени';
    return INI_STATUS.indexOf(nv.status) < 0 ? 'неверный статус идеи' : null;
  }
  if (p.length !== 3 || INI_ANSWER.indexOf(p[2]) < 0) return 'поле «' + p[2] + '» меняет автор идеи';
  if (p[2] === 'repliedBy' && op.value !== me.post) return 'ответ — только от своего имени';
  return p[2] === 'status' && INI_STATUS.indexOf(op.value) < 0 ? 'неверный статус идеи' : null;
}

/* правка SOP-менеджера: идею с адресатом он не видит — менять её нельзя, удалить (вместе с сотрудником) можно */
function checkAdmin_(st, op) {
  var p = op.path;
  if (p[0] !== 'initiatives') return null;
  if (p.length === 1) return op.op === 'set' && (st.initiatives || []).some(function (x) { return iniTo_(x).length; }) ? 'список идей целиком не меняется' : null;
  var item = isId_(p[1]) ? LmsSync.get(st, p.slice(0, 2)) : null;
  return item && iniTo_(item).length && op.op !== 'del' ? 'на эту идею отвечает её адресат' : null;
}

/* новый урок в прогрессе или изменённый: сотрудник ставит только «читаю / вопрос / готов к тесту» */
function checkLesson_(cur, next) {
  cur = cur || {};
  if (!next || typeof next !== 'object') return 'неверная запись урока';
  if (cur.status === 'passed' && next.status !== 'passed') return 'урок уже сдан';
  if (next.status !== cur.status && EMP_LESSON_STATUS.indexOf(next.status) < 0) return 'итог урока ставит SOP-менеджер';
  var bad = Object.keys(next).filter(function (k) {
    if (k === 'status' || k === 'at') return false;
    if (k === 'score' || k === 'comment') return !(next[k] === null || LmsSync.equal(next[k], cur[k]));
    return !LmsSync.equal(next[k], cur[k]);
  })[0];
  if (bad === 'score') return 'балл ставит сервер по ответам теста';
  return bad ? 'поле «' + bad + '» меняет SOP-менеджер' : null;
}

function checkNew_(top, me, value) {
  var uid = String(me.id);
  if (!value || typeof value !== 'object') return 'пустая запись';
  // уведомить SOP-менеджера или наставника о своём действии; поздравление с уровнем (экран с салютом) — только себе
  if (top === 'notifications') return value.promo && String(value.userId) !== uid ? 'поздравление с уровнем отправляет SOP-менеджер' : null;
  if (top === 'errors') return me.mentor && String(value.by) === uid ? null : 'ошибку записывает наставник';
  if (top === 'xtasks') return 'сверхзадачу выдаёт SOP-менеджер';
  if (String(value[OWN[top]]) !== uid) return 'запись — только от своего имени';
  if (top === 'initiatives' && value.status && value.status !== 'new') return 'статус идеи ставит её адресат';
  if (top === 'initiatives') {
    var to = iniTo_(value);
    if (!to.length || to.some(function (k, i) { return INI_TO.indexOf(k) < 0 || to.indexOf(k) !== i; })) return 'выберите, кому отправить идею: CEO, Project Manager и (или) руководителю компании';
    if (['reply', 'repliedAt', 'acceptedAt', 'repliedBy'].some(function (k) { return value[k] != null; })) return 'ответ на идею даёт её адресат';
  }
  return null;
}

function patch_(s, ops) {
  if (!Array.isArray(ops)) throw err_('bad', 'Нет правок');
  if (ops.length > MAX_OPS) throw err_('bad', 'Слишком много правок за раз (больше ' + MAX_OPS + ')');
  return withLock_(function () {
    var st = readState_(), me = me_(st, s), admin = me.role === 'admin', rejected = [], applied = 0;
    var before = admin ? clone_(st.users || []) : null, seen = null;
    /* ссылка на файл в правке сотрудника — только на файл, который ему и так виден (иначе вписал бы чужой и скачал) */
    function foreignFile(op) {
      var refs = JSON.stringify(op.value === undefined ? null : op.value).match(/"lmsfile:[\w-]+"/g);
      if (!refs) return false;
      if (seen === null) seen = JSON.stringify(viewFor_(st, me));
      return refs.some(function (r) { return seen.indexOf(r) < 0; });
    }
    ops.forEach(function (op, i) {
      var top = op && Array.isArray(op.path) ? op.path[0] : '';
      var why = !top ? 'неверная правка' : DEVICE_KEYS.indexOf(top) >= 0 ? '«' + top + '» хранится только на устройстве' : admin ? checkAdmin_(st, op) : checkEmployee_(st, me, op) || (foreignFile(op) ? 'чужой файл' : null);
      if (!why && !admin && top === 'notifications' && op.path.length === 2 && op.op === 'set' && !LmsSync.get(st, op.path)) op = Object.assign({}, op, { value: Object.assign({}, op.value, { from: me.id }) });
      if (why) { rejected.push({ i: i, reason: why }); return; }
      try {
        if (op.op === 'set' && !(op.path[op.path.length - 1] === 'avatar' && avatarOk_(op.value))) op = Object.assign({}, op, { value: storeFiles_(op.value, me.id) });
        if (LmsSync.applyOne(st, op)) applied++;
      } catch (e) { rejected.push({ i: i, reason: e.message }); }
    });
    if (admin) syncCreds_(st, before, me, s, rejected);
    if ((st.audit || []).length > AUDIT_KEEP) st.audit = st.audit.slice(0, AUDIT_KEEP);
    if (applied) { st.rev = (+st.rev || 0) + 1; writeState_(st); }
    return { ok: true, rev: st.rev, applied: applied, rejected: rejected };
  });
}

/* после правок SOP-менеджера: пароли из карточек — в учётные записи (в состоянии их не храним), смена логина,
   удалённые сотрудники теряют вход */
function syncCreds_(st, before, me, s, rejected) {
  var cr = creds_(), taken = {}, prev = {};
  Object.keys(cr).forEach(function (k) { taken[cr[k].login] = k; });
  before.forEach(function (u) { prev[String(u.id)] = u; });
  (st.users || []).forEach(function (u) {
    var k = String(u.id), c = cr[k], pw = u.password, login = normLogin_(u.login);
    delete u.password;
    if (!login) return;
    if (taken[login] && taken[login] !== k) {
      rejected.push({ i: -1, reason: 'логин «' + login + '» уже занят — у ' + (u.name || k) + ' оставлен прежний' });
      if (prev[k] && prev[k].login !== undefined) u.login = prev[k].login; else delete u.login;
      return;
    }
    if (pw) { if (c) delete taken[c.login]; c = makeCred_(u.id, login, String(pw)); setCred_(c); taken[login] = k; dropSessions_(u.id, k === String(me.id) ? s.key : null); }
    else if (c && c.login !== login) { delete taken[c.login]; c.login = login; setCred_(c); taken[login] = k; }
  });
  var alive = {};
  (st.users || []).forEach(function (u) { alive[String(u.id)] = 1; });
  Object.keys(cr).forEach(function (k) { if (!alive[k]) { props_().deleteProperty('cred:' + k); dropSessions_(k); } });
}

/* ---------------- файлы: на Диске, в данных — ссылка ---------------- */

function filesFolder_() {
  var P = props_(), id = P.getProperty('LMS_FILES');
  if (id) return DriveApp.getFolderById(id);
  var f = DriveApp.getFolderById(P.getProperty('LMS_FOLDER')).createFolder('files');
  P.setProperty('LMS_FILES', f.getId());
  return f;
}
/* data:-строки внутри значения правки → файлы на Диске; { name, data } — имя файла из name */
function storeFiles_(v, uid, name) {
  if (typeof v === 'string') {
    var m = /^data:([^;,]*)((?:;[^;,]*)*?)(;base64)?,/.exec(v);
    if (!m || v.length < FILE_MIN) return v;
    var body = v.slice(m[0].length);
    var bytes = m[3] ? Utilities.base64Decode(body) : Utilities.newBlob(decodeURIComponent(body)).getBytes();
    var f = filesFolder_().createFile(Utilities.newBlob(bytes, m[1] || 'application/octet-stream', String(name || 'fayl')));
    f.setDescription('BURAQ o‘quv: загрузил ' + uid);
    return 'lmsfile:' + f.getId();
  }
  if (Array.isArray(v)) return v.map(function (x) { return storeFiles_(x, uid); });
  if (v && typeof v === 'object') {
    var o = {};
    Object.keys(v).forEach(function (k) { o[k] = k === 'avatar' && avatarOk_(v[k]) ? v[k] : storeFiles_(v[k], uid, k === 'data' ? v.name : null); });
    return o;
  }
  return v;
}
/* файл отдаётся, только если ссылка на него есть в том, что видит этот человек */
function file_(s, req) {
  var id = String(req.id || '');
  if (!/^[\w-]{8,}$/.test(id)) throw err_('bad', 'Неверный номер файла');
  var st = readState_(), me = me_(st, s);
  if (JSON.stringify(viewFor_(st, me)).indexOf('"lmsfile:' + id + '"') < 0) throw err_('forbidden', 'Этот файл вам недоступен');
  var b = DriveApp.getFileById(id).getBlob();
  return { ok: true, name: b.getName(), type: b.getContentType(), data: Utilities.base64Encode(b.getBytes()) };
}

/* копия данных вне сервера: SOP-менеджер скачивает то, что ему видно (идеи с адресатом — без текста), и все файлы */
function export_(s) {
  var st = readState_(), me = me_(st, s);
  if (me.role !== 'admin') throw err_('forbidden', 'Данные скачивает SOP-менеджер');
  var v = viewFor_(st, me), files = {};
  (JSON.stringify(v).match(/"lmsfile:[\w-]+"/g) || []).forEach(function (r) {
    var id = r.slice(9, -1);
    if (files[id]) return;
    try { var b = DriveApp.getFileById(id).getBlob(); files[id] = { name: b.getName(), type: b.getContentType(), data: Utilities.base64Encode(b.getBytes()) }; }
    catch (e) { files[id] = { missing: true }; }
  });
  return { ok: true, app: 'buraq-lms', v: LMS_VERSION, at: now_(), state: v, files: files };
}

/* ---------------- тест урока: балл считает сервер ---------------- */

function quiz_(s, req) {
  return withLock_(function () {
    var st = readState_(), me = me_(st, s), uid = String(me.id), sec = null, l = null;
    (st.course.sections || []).forEach(function (x) { (x.lessons || []).forEach(function (y) { if (y.id === req.lessonId) { sec = x; l = y; } }); });
    if (!l) throw err_('bad', 'Нет такого урока');
    if (sec.officialOnly && me.status !== 'official' && me.role !== 'admin') throw err_('forbidden', 'Раздел откроется после испытательного срока');
    var qs = l.quiz || [], ans = req.answers;
    if (!qs.length) throw err_('bad', 'У урока нет теста');
    if (!Array.isArray(ans) || ans.length !== qs.length) throw err_('bad', 'Ответьте на все вопросы');
    st.progress = st.progress || {}; st.progress[uid] = st.progress[uid] || {};
    var pr = st.progress[uid][l.id] || {};
    if (pr.status !== 'exam-ready' || pr.score != null) throw err_('quiz', 'Тест можно пройти один раз после «Готов к тесту»');
    var ok = qs.filter(function (q, i) { return ans[i] === q.answer; }).length, sc = Math.round(ok * 100 / qs.length), t = now_();
    st.progress[uid][l.id] = Object.assign({}, pr, { score: sc, at: t });
    (st.requests || []).forEach(function (r) {
      if (r.type === 'exam' && String(r.userId) === uid && r.lessonId === l.id && r.state === 'open') { r.score = sc; r.unread = true; r.at = t; }
    });
    st.rev = (+st.rev || 0) + 1;
    writeState_(st);
    return { ok: true, rev: st.rev, score: sc, passMark: PASS_MARK, answers: qs.map(function (q) { return q.answer; }) };
  });
}

/* повторная проверка после ошибки: три первых вопроса урока, балл считает сервер; сдал — ошибка закрыта, наставнику уведомление */
function retest_(s, req) {
  return withLock_(function () {
    var st = readState_(), me = me_(st, s), uid = String(me.id);
    var x = (st.errors || []).filter(function (e) { return String(e.id) === String(req.errorId); })[0];
    if (!x || String(x.uid) !== uid) throw err_('forbidden', 'Это не ваша запись об ошибке');
    if (x.status !== 'assigned') throw err_('quiz', 'Повторная проверка уже сдана или не назначена');
    var l = null;
    (st.course.sections || []).forEach(function (sec) { (sec.lessons || []).forEach(function (y) { if (y.id === x.lessonId) l = y; }); });
    var qs = ((l && l.quiz) || []).slice(0, 3), ans = req.answers;
    if (!qs.length) throw err_('bad', 'У урока нет теста');
    if (!Array.isArray(ans) || ans.length !== qs.length) throw err_('bad', 'Ответьте на все вопросы');
    var sc = Math.round(qs.filter(function (q, i) { return ans[i] === q.answer; }).length * 100 / qs.length), t = now_();
    if (sc >= PASS_MARK) {
      x.status = 'done'; x.retest = { score: sc, at: t };
      st.notifications = st.notifications || [];
      st.notifications.unshift({ id: t * 100 + Math.floor(Math.random() * 100), userId: x.by, kind: 'errfix', text: '', route: 'quality', at: t, read: false, err: { name: me.name, ttl: l.title, score: sc } });
      st.rev = (+st.rev || 0) + 1;
      writeState_(st);
    }
    return { ok: true, rev: st.rev, score: sc, passMark: PASS_MARK };
  });
}

/* ---------------- ИИ: Claude API через сервер ---------------- */

function aiProp_(k, d) { var v = String(props_().getProperty(k) || '').trim(); return v || d; }
function aiKey_() { return aiProp_('ANTHROPIC_API_KEY', ''); }

/* сколько запросов к ИИ сегодня сделал каждый: одно свойство AI_USAGE на день (Ташкент) */
function aiUsage_(change) {
  return withLock_(function () {
    var day = Utilities.formatDate(new Date(), 'Asia/Tashkent', 'yyyy-MM-dd');
    var u = JSON.parse(props_().getProperty('AI_USAGE') || 'null');
    if (!u || u.day !== day) u = { day: day, n: {}, tin: 0, tout: 0 };
    var r = change(u);
    props_().setProperty('AI_USAGE', JSON.stringify(u));
    return r;
  });
}

/* запрос к ИИ: { messages: [{role, content}], tier: 'quick' | 'default', json } → { text, truncated }.
   Две половины — aiRequest_ (проверки, лимит, тело запроса) и aiResult_ (ответ Claude API): сервер на Node
   (server/, Railway) вызывает между ними fetch, не останавливая остальные запросы. */
function ai_(s, req) {
  var r = aiRequest_(s, req), res;
  try { res = UrlFetchApp.fetch(r.url, r.opts); } catch (e) { return aiResult_(r, 0, '', e); }
  return aiResult_(r, res.getResponseCode(), res.getContentText());
}
function aiRequest_(s, req) {
  var key = aiKey_();
  if (!key) throw err_('ai_off', 'ИИ не подключён: задайте ANTHROPIC_API_KEY в свойствах скрипта');
  var st = readState_(), me = me_(st, s), uid = String(me.id), chars = 0;
  var msgs = (Array.isArray(req.messages) ? req.messages : []).slice(-40).map(function (m) {
    var c = String((m && m.content) || ''); chars += c.length;
    return { role: m && m.role === 'assistant' ? 'assistant' : 'user', content: c };
  }).filter(function (m) { return m.content; });
  if (!msgs.length || msgs[0].role !== 'user' || msgs[msgs.length - 1].role !== 'user') throw err_('bad', 'Переписка с ИИ должна начинаться и заканчиваться вопросом');
  if (chars > AI_MAX_CHARS) throw err_('bad', 'Слишком длинный запрос к ИИ');
  var limit = +aiProp_(me.role === 'admin' ? 'AI_DAILY_LIMIT_ADMIN' : 'AI_DAILY_LIMIT', me.role === 'admin' ? AI_LIMIT_ADMIN : AI_LIMIT);
  // место в дневном лимите занимается до запроса (два запроса сразу не обойдут лимит) и возвращается при сбое
  aiUsage_(function (u) { if ((u.n[uid] || 0) >= limit) throw err_('ai_limit', 'Лимит запросов к ИИ на сегодня исчерпан (' + limit + ')'); u.n[uid] = (u.n[uid] || 0) + 1; });

  var model = aiProp_('AI_MODEL', AI_MODEL);
  var body = { model: model, max_tokens: +aiProp_('AI_MAX_TOKENS', AI_MAX_TOKENS), messages: msgs,
    output_config: { effort: req.tier === 'quick' ? 'low' : 'medium' } };
  if (req.json) body.system = 'Reply with valid JSON only: no markdown code fences, no commentary before or after it.';
  var headers = { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
  if (AI_FALLBACK.indexOf(model) >= 0) { body.fallbacks = 'default'; headers['anthropic-beta'] = 'server-side-fallback-2026-07-01'; }
  return { uid: uid, url: 'https://api.anthropic.com/v1/messages',
    opts: { method: 'post', contentType: 'application/json', headers: headers, payload: JSON.stringify(body), muteHttpExceptions: true } };
}
/* ответ Claude API (code, text) или сбой связи (fail) → ответ странице; при сбое место в лимите возвращается */
function aiResult_(r, code, text, fail) {
  var uid = r.uid, refund = function () { aiUsage_(function (u) { u.n[uid] = Math.max(0, (u.n[uid] || 1) - 1); }); };
  if (fail) { refund(); throw err_('ai_err', 'Нет связи с Claude API: ' + ((fail && fail.message) || fail)); }
  var x = null;
  try { x = JSON.parse(text); } catch (e) {}
  if (code !== 200 || !x) {
    refund();
    var msg = (x && x.error && x.error.message) || ('HTTP ' + code);
    throw err_(code === 429 || code === 529 ? 'rate_limited' : code === 401 || code === 403 ? 'ai_key' : 'ai_err', 'Claude API: ' + msg);
  }
  aiUsage_(function (u) { u.tin += (x.usage && x.usage.input_tokens) || 0; u.tout += (x.usage && x.usage.output_tokens) || 0; });
  if (x.stop_reason === 'refusal') throw err_('refused', 'Claude не стал отвечать на этот запрос');
  var out = (x.content || []).filter(function (b) { return b && b.type === 'text'; }).map(function (b) { return b.text; }).join('');
  return { ok: true, text: out, truncated: x.stop_reason === 'max_tokens', model: x.model };
}

/* ---------------- запуск, вход SOP-менеджера, копии ---------------- */

function setup() {
  var P = props_();
  if (P.getProperty('LMS_STATE')) throw new Error('Платформа уже настроена. Новый вход SOP-менеджера — функция newAdmin.');
  var folder = DriveApp.createFolder('BURAQ o‘quv platformasi — ma’lumotlar');
  var st = emptyState_();
  var file = folder.createFile('state.json', JSON.stringify(st), 'application/json');
  P.setProperty('LMS_FOLDER', folder.getId());
  P.setProperty('LMS_STATE', file.getId());
  P.setProperty('LMS_REV', String(st.rev));
  installTriggers();
  return newAdmin();
}

function newAdmin() {
  return withLock_(function () {
    var st = readState_(), cr = creds_(), used = {}, login = 'metodist', n = 1;
    Object.keys(cr).forEach(function (k) { used[cr[k].login] = 1; });
    (st.users || []).forEach(function (u) { if (u.login) used[normLogin_(u.login)] = 1; });
    while (used[login]) login = 'metodist' + (++n);
    var id = 10001;
    (st.users || []).forEach(function (u) { if (+u.id >= id) id = +u.id + 1; });
    var pw = genPassword_();
    st.users.push({ id: id, role: 'admin', login: login, name: 'SOP menejeri', position: 'SOP menejeri', department: 'HR va o‘qitish', status: 'official', profileComplete: true });
    setCred_(makeCred_(id, login, pw));
    st.rev = (+st.rev || 0) + 1;
    writeState_(st);
    Logger.log('Вход SOP-менеджера — логин: ' + login + ', пароль: ' + pw + '. Запишите: пароль больше нигде не показывается.');
    return { login: login, password: pw };
  });
}

function backup() {
  var P = props_(), folder = DriveApp.getFolderById(P.getProperty('LMS_FOLDER'));
  var it = folder.getFoldersByName('backups'), bf = it.hasNext() ? it.next() : folder.createFolder('backups');
  var day = Utilities.formatDate(new Date(), 'Asia/Tashkent', 'yyyy-MM-dd');
  DriveApp.getFileById(P.getProperty('LMS_STATE')).makeCopy('state-' + day + '.json', bf);
  var old = now_() - BACKUP_KEEP_DAYS * DAY_MS, files = bf.getFiles();
  while (files.hasNext()) { var f = files.next(); if (f.getDateCreated().getTime() < old) f.setTrashed(true); }
}

function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'backup') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('backup').timeBased().atHour(3).everyDays(1).inTimezone('Asia/Tashkent').create();
}

/* ---------------- lms-sync.js (собрано tools/build-lms-gs.mjs — правьте исходники) ---------------- */
/* Учебная платформа: синхронизация данных. Правка на странице — это разница двух состояний («было → стало»),
   сервер применяет её к общему состоянию. Один файл работает на странице (window.LmsSync), в тестах Node
   (module.exports) и в Google Apps Script (сборка tools/build-lms-gs.mjs кладёт его в один файл со скриптом).

   Правка (op):
     { op: 'set', path: [...], value: X }               — записать значение
     { op: 'set', path: [..., { id: 7 }], value: {…}, after: 6 | null }
                                                         — новый элемент списка: после элемента с id 6, null — в начало,
                                                           без after — в конец
     { op: 'del', path: [...] }                          — удалить
   Путь: строка — поле объекта, { id: X } — элемент списка объектов по его id (номерам элементов не верим:
   у двух устройств они разъезжаются). Список, где у элементов нет id или их порядок поменялся, пишется целиком. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.LmsSync = api;
})(this, function () {
  'use strict';

  var BAD_KEYS = ['__proto__', 'constructor', 'prototype'];
  var has = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  function isObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
  function isIdSeg(s) { return isObj(s) && has(s, 'id') && (typeof s.id === 'number' || typeof s.id === 'string'); }
  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }

  function equal(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
      if (a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) if (!equal(a[i], b[i])) return false;
      return true;
    }
    var ka = Object.keys(a).filter(function (k) { return a[k] !== undefined; }), kb = Object.keys(b).filter(function (k) { return b[k] !== undefined; });
    if (ka.length !== kb.length) return false;
    for (var j = 0; j < ka.length; j++) if (!has(b, ka[j]) || !equal(a[ka[j]], b[ka[j]])) return false;
    return true;
  }

  /* id элементов списка — или null, если это не список объектов с разными id */
  function key(id) { return typeof id + ':' + id; }
  function idsOf(arr) {
    var out = [], seen = {};
    for (var i = 0; i < arr.length; i++) {
      var x = arr[i];
      if (!isObj(x) || (typeof x.id !== 'number' && typeof x.id !== 'string') || seen[key(x.id)]) return null;
      seen[key(x.id)] = 1; out.push(x.id);
    }
    return out;
  }
  /* общие id идут в одном порядке в обоих списках */
  function sameOrder(ia, ib) {
    var inB = {}, inA = {};
    ib.forEach(function (id) { inB[key(id)] = 1; });
    ia.forEach(function (id) { inA[key(id)] = 1; });
    var ca = ia.filter(function (id) { return inB[key(id)]; }), cb = ib.filter(function (id) { return inA[key(id)]; });
    for (var i = 0; i < ca.length; i++) if (key(ca[i]) !== key(cb[i])) return false;
    return true;
  }

  function diff(a, b, path, out) {
    out = out || []; path = path || [];
    if (equal(a, b)) return out;
    if (isObj(a) && isObj(b)) {
      Object.keys(b).forEach(function (k) {
        if (b[k] === undefined) { if (has(a, k) && a[k] !== undefined) out.push({ op: 'del', path: path.concat(k) }); return; }
        if (!has(a, k) || a[k] === undefined) out.push({ op: 'set', path: path.concat(k), value: clone(b[k]) });
        else diff(a[k], b[k], path.concat(k), out);
      });
      Object.keys(a).forEach(function (k) { if (a[k] !== undefined && (!has(b, k))) out.push({ op: 'del', path: path.concat(k) }); });
      return out;
    }
    if (Array.isArray(a) && Array.isArray(b) && path.length) {
      var ia = idsOf(a), ib = idsOf(b);
      if (ia && ib && sameOrder(ia, ib)) {
        var at = {}, inB = {};
        ia.forEach(function (id, i) { at[key(id)] = i; });
        ib.forEach(function (id) { inB[key(id)] = 1; });
        ia.forEach(function (id) { if (!inB[key(id)]) out.push({ op: 'del', path: path.concat([{ id: id }]) }); });
        ib.forEach(function (id, j) {
          var p = path.concat([{ id: id }]);
          if (has(at, key(id))) diff(a[at[key(id)]], b[j], p, out);
          else out.push({ op: 'set', path: p, value: clone(b[j]), after: j ? ib[j - 1] : null });
        });
        return out;
      }
    }
    out.push({ op: 'set', path: path, value: clone(b) });
    return out;
  }

  function fail(reason) { var e = new Error(reason); e.code = 'path'; return e; }
  function checkSeg(s) {
    if (typeof s === 'string') { if (BAD_KEYS.indexOf(s) >= 0 || !s.length) throw fail('недопустимое поле «' + s + '»'); return; }
    if (!isIdSeg(s)) throw fail('недопустимый шаг пути');
  }
  function indexById(arr, id) { for (var i = 0; i < arr.length; i++) if (isObj(arr[i]) && arr[i].id === id) return i; return -1; }
  function child(parent, s) {
    if (typeof s === 'string') { if (!isObj(parent)) throw fail('поле «' + s + '» — не у объекта'); return has(parent, s) ? parent[s] : undefined; }
    if (!Array.isArray(parent)) throw fail('id ' + s.id + ' — не в списке');
    var i = indexById(parent, s.id); return i < 0 ? undefined : parent[i];
  }

  /* одна правка; изменяет root. Возвращает true — применена, false — нечего удалять */
  function applyOne(root, op) {
    if (!op || (op.op !== 'set' && op.op !== 'del')) throw fail('неизвестная правка');
    var path = op.path;
    if (!Array.isArray(path) || !path.length) throw fail('пустой путь');
    path.forEach(checkSeg);
    var parent = root;
    for (var i = 0; i < path.length - 1; i++) {
      var next = child(parent, path[i]);
      if (next === undefined || next === null) {
        if (op.op === 'del') return false;
        if (isIdSeg(path[i])) throw fail('элемента ' + path[i].id + ' уже нет');
        next = isIdSeg(path[i + 1]) ? [] : {};
        parent[path[i]] = next;
      }
      parent = next;
    }
    var last = path[path.length - 1];
    if (op.op === 'del') {
      if (typeof last === 'string') { if (!isObj(parent)) throw fail('поле «' + last + '» — не у объекта'); if (!has(parent, last)) return false; delete parent[last]; return true; }
      if (!Array.isArray(parent)) throw fail('id ' + last.id + ' — не в списке');
      var di = indexById(parent, last.id); if (di < 0) return false; parent.splice(di, 1); return true;
    }
    var value = clone(op.value);
    if (value === undefined) throw fail('нет значения');
    if (typeof last === 'string') { if (!isObj(parent)) throw fail('поле «' + last + '» — не у объекта'); parent[last] = value; return true; }
    if (!Array.isArray(parent)) throw fail('id ' + last.id + ' — не в списке');
    if (!isObj(value) || value.id !== last.id) throw fail('id элемента не совпадает с путём');
    var k = indexById(parent, last.id);
    if (k >= 0) { parent[k] = value; return true; }
    if (op.after === null) parent.unshift(value);
    else {
      var ai = op.after === undefined ? -1 : indexById(parent, op.after);
      if (ai < 0) parent.push(value); else parent.splice(ai + 1, 0, value);
    }
    return true;
  }

  /* все правки по порядку; неудачные пропускаются и возвращаются с причиной */
  function apply(root, ops) {
    var failed = [], applied = 0;
    (ops || []).forEach(function (op, i) {
      try { if (applyOne(root, op)) applied++; } catch (e) { failed.push({ i: i, reason: e.message }); }
    });
    return { applied: applied, failed: failed };
  }

  /* значение по пути (undefined — нет) */
  function get(root, path) {
    var cur = root;
    for (var i = 0; i < path.length; i++) {
      if (cur === undefined || cur === null) return undefined;
      checkSeg(path[i]);
      cur = child(cur, path[i]);
    }
    return cur;
  }

  return { diff: diff, apply: apply, applyOne: applyOne, get: get, equal: equal, clone: clone, isIdSeg: isIdSeg };
});
