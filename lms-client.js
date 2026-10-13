/* Учебная платформа: связь страницы с сервером (tools/lms-gs, адрес — config.js).
   Страница меняет данные как раньше — update(d => …); отсюда уходит только разница «было → стало» (lms-sync.js).
   - Вход: логин и пароль проверяет сервер, на устройстве — токен (lor-lms-token).
   - Данные: копия последнего ответа сервера (lor-lms-cache) — страница открывается и без сети.
   - Правки: очередь на устройстве (lor-lms-queue) → сервер пачками; без сети ждут и уходят сами.
     Пока правка не дошла, она наложена поверх данных сервера — на экране её видно сразу.
   - Раз в 30 секунд, при возврате на вкладку и при появлении сети — «что нового» (since).
   - Язык и вход — только на этом устройстве, на сервер не уходят. */
(function (root) {
  'use strict';
  var S = root.LmsSync;
  var SERVER_V = 6;                       // версия сервера (tools/lms-gs), под которую написана эта страница
  var URL_ = String(root.LMS_SERVER || '').trim();
  var DEMO = !URL_;                      // адреса нет — страница пишет «Server ulanmagan» (демо больше нет)
  var K = { token: 'lor-lms-token', cache: 'lor-lms-cache', queue: 'lor-lms-queue', lang: 'lor-lms-lang' };
  var LOCAL = ['lang', 'session'];
  var BATCH = 200, POLL_MS = 30000;

  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function put(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function getJ(k) { try { return JSON.parse(get(k) || 'null'); } catch (e) { return null; } }

  var token = get(K.token);
  var cache = token ? getJ(K.cache) : null;         // { rev, me, v, state }
  var queue = getJ(K.queue) || { me: null, ops: [] };
  var listeners = [], statusL = [];
  var status = { net: 'ok', error: null, rejected: null, v: cache ? cache.v : null, ai: !!(cache && cache.ai) };
  var inflight = null, flushT = null, retryMs = 0, epoch = 0;

  function saveQueue() { put(K.queue, queue.ops.length ? JSON.stringify(queue) : null); }
  function saveCache() { put(K.cache, cache ? JSON.stringify(cache) : null); }
  function lang() { return get(K.lang) || 'uz'; }

  function emptyDb() {
    return { v: 23, lang: lang(), session: null, seq: 100, course: { sections: [] }, levels: [], tracks: [], planTpl: [], settings: {},
      users: [], alumni: [], progress: {}, study: {}, requests: [], notifications: [], reminded: {}, audit: [], assets: [], errors: [], cases: [],
      journals: [], terms: [], drills: [], sopUpdates: [], initiatives: [], surveys: [], attend: {}, attendCover: {}, attendImports: [],
      attendAlias: {}, xtasks: [], monthly: {} };
  }
  /* данные для страницы: ответ сервера + ещё не отправленные правки + язык и вход этого устройства */
  function current() {
    if (!token || !cache) return emptyDb();
    var d = S.clone(cache.state);
    if (queue.me === cache.me && queue.ops.length) S.apply(d, queue.ops);
    d.lang = lang(); d.session = cache.me;
    return d;
  }
  function emit() { var d = current(); listeners.forEach(function (fn) { fn(d); }); }
  function setStatus(patch) { Object.assign(status, patch); statusL.forEach(function (fn) { fn(Object.assign({}, status, { pending: queue.ops.length })); }); }

  function fail(code, msg) { var e = new Error(msg || code); e.code = code; return e; }
  function call(action, body, signal) {
    var payload = JSON.stringify(Object.assign({ action: action, token: token }, body || {}));
    // text/plain — «простой» запрос: браузер не делает предварительный OPTIONS, Apps Script его не умеет
    return fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: payload, cache: 'no-store', redirect: 'follow', signal: signal })
      .then(function (r) { return r.text(); }, function (e) { throw fail(e && e.name === 'AbortError' ? 'cancelled' : 'net'); })
      .then(function (txt) {
        var x; try { x = JSON.parse(txt); } catch (e) { throw fail('html', 'Сервер ответил не JSON'); }
        if (!x || !x.ok) throw fail((x && x.code) || 'script', x && x.error);
        if (x.v) setStatus({ v: x.v });
        if (typeof x.ai === 'boolean' && x.ai !== status.ai) setStatus({ ai: x.ai });
        return x;
      })
      .catch(function (e) {
        if (e.code === 'auth' && action !== 'login') dropSession();
        throw e;
      });
  }
  function dropSession() { token = null; cache = null; put(K.token, null); saveCache(); emit(); }

  function take(x) { cache = { rev: x.rev, me: x.me, v: x.v, ai: !!x.ai, state: x.state }; saveCache(); emit(); }
  function load() { var ep = epoch; return call('load').then(function (x) { if (ep === epoch) take(x); else return sync(); }); }
  /* что нового на сервере; ответы, начатые до последней отправленной правки, устарели — спросить снова */
  function sync() {
    if (!token || !cache) return Promise.resolve();
    var ep = epoch;
    return call('since', { rev: cache.rev }).then(function (x) {
      setStatus({ net: 'ok' });
      if (ep !== epoch) return sync();
      if (!x.same) take(x);
    }, function (e) { if (e.code === 'net') setStatus({ net: 'off' }); else throw e; });
  }

  function schedule(ms) { clearTimeout(flushT); flushT = setTimeout(flush, ms); }
  /* отправить очередь; true — всё дошло, false — нет сети или сервер занят (повтор — по таймеру) */
  function flush() {
    if (inflight) return inflight;
    if (!token || !cache) return Promise.resolve(false);
    if (queue.me !== cache.me) { queue = { me: cache.me, ops: [] }; saveQueue(); }
    if (!queue.ops.length) return Promise.resolve(true);
    var batch = queue.ops.slice(0, BATCH), raw = JSON.stringify(batch);
    setStatus({ net: status.net === 'off' ? 'off' : 'saving' });
    inflight = call('patch', { ops: batch }).then(function (r) {
      inflight = null; retryMs = 0; epoch++;
      queue.ops.splice(0, batch.length); saveQueue();
      var serverTouched = raw.indexOf('"data:') >= 0 || raw.indexOf('"password"') >= 0;   // файл или пароль сервер переделал
      if (r.rejected.length) setStatus({ rejected: r.rejected.map(function (x) { return x.reason; }) });
      if (!r.rejected.length && !serverTouched && r.rev === cache.rev + 1) {
        S.apply(cache.state, batch); cache.rev = r.rev; saveCache();
      } else sync().catch(function () {});
      setStatus({ net: 'ok' });
      return queue.ops.length ? flush() : true;
    }, function (e) {
      inflight = null;
      if (e.code === 'net' || e.code === 'busy' || e.code === 'html') {
        retryMs = Math.min(60000, retryMs ? retryMs * 2 : 3000);
        setStatus({ net: e.code === 'net' ? 'off' : 'busy' });
        schedule(retryMs);
        return false;
      }
      if (e.code === 'auth') return false;
      // сервер отказал всей пачке — не повторять бесконечно: убрать её и взять данные сервера
      queue.ops.splice(0, batch.length); saveQueue();
      setStatus({ error: e.message || e.code });
      return load().then(function () { return false; }, function () { return false; });
    });
    return inflight;
  }
  /* всё отправлено — или ошибка «net» */
  function flushAll() { return flush().then(function (ok) { if (!ok) throw fail('net'); }); }

  var api = {
    demo: DEMO, url: URL_, SERVER_V: SERVER_V,
    initial: current,
    subscribe: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (x) { return x !== fn; }); }; },
    onStatus: function (fn) { statusL.push(fn); fn(Object.assign({}, status, { pending: queue.ops.length })); return function () { statusL = statusL.filter(function (x) { return x !== fn; }); }; },
    clearNotice: function () { setStatus({ rejected: null, error: null }); },
    /* правка страницы: язык — на устройстве, остальное — разница на сервер */
    change: function (prev, next) {
      if (next.lang && next.lang !== prev.lang) put(K.lang, next.lang);
      if (!token || !cache) return;
      var a = Object.assign({}, prev), b = Object.assign({}, next);
      LOCAL.forEach(function (k) { delete a[k]; delete b[k]; });
      var ops = S.diff(a, b);
      if (!ops.length) return;
      if (queue.me !== cache.me) queue = { me: cache.me, ops: [] };
      Array.prototype.push.apply(queue.ops, ops); saveQueue();
      setStatus({});
      schedule(600);
    },
    login: function (login, password) {
      return call('login', { login: login, password: password }).then(function (x) {
        token = x.token; put(K.token, token);
        if (queue.me !== x.me) { queue = { me: x.me, ops: [] }; saveQueue(); }   // чужие неотправленные правки — не от этого входа
        return load();
      });
    },
    logout: function () {
      var t = token;
      return flushAll().catch(function () {}).then(function () {
        if (t) call('logout').catch(function () {});
        queue = { me: null, ops: [] }; saveQueue(); dropSession();
      });
    },
    /* тест урока: сначала отправить «Готов к тесту», балл считает сервер */
    quiz: function (lessonId, answers) {
      return flushAll().then(function () { return call('quiz', { lessonId: lessonId, answers: answers }); })
        .then(function (r) { sync(); return r; });
    },
    /* повторная проверка после ошибки: балл считает сервер */
    retest: function (errorId, answers) {
      return flushAll().then(function () { return call('retest', { errorId: errorId, answers: answers }); })
        .then(function (r) { sync(); return r; });
    },
    file: function (id) { return call('file', { id: id }); },
    /* ИИ через сервер (ключ Claude API — только в свойствах скрипта): messages — [{ role, content }] */
    ai: function (messages, opts) {
      opts = opts || {};
      return call('ai', { messages: messages, tier: opts.tier, json: !!opts.json }, opts.signal);
    },
    resetPassword: function (userId) { return call('resetPassword', { userId: userId }); },
    changePassword: function (old, password) { return call('password', { old: old, password: password }); },
    /* свой логин и (у SOP-менеджера) пароль: { old, login?, password? } */
    account: function (o) { return call('account', o); },
    sync: function () { return sync().then(flush); },
    flushAll: flushAll
  };
  root.LmsClient = api;

  if (!DEMO) {
    setInterval(function () { if (token && document.visibilityState !== 'hidden') api.sync().catch(function () {}); }, POLL_MS);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && token) api.sync().catch(function () {}); });
    root.addEventListener('online', function () { retryMs = 0; if (token) api.sync().catch(function () {}); });
    // при открытии: правки, оставшиеся с прошлого раза, — на сервер; затем «что нового»
    if (token) setTimeout(function () { if (!cache) load().catch(function () {}); else { flush(); sync().catch(function () {}); } }, 0);
  }
})(window);
