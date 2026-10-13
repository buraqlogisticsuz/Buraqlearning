// Учебная платформа на своём сервере (Railway или любой хостинг с Node 20+): страница и сервер по одному адресу.
//   /           — сайт (те же файлы, что на GitHub Pages)
//   /api        — сервер платформы: код tools/lms-gs/Server.gs на server/gas-node.mjs, запросы как к …/exec Apps Script
//   /config.js  — адрес сервера для страницы: этот же /api
//   /healthz    — проверка для Railway
// Данные — в папке DATA_DIR (на Railway — том, Volume; путь берётся сам из RAILWAY_VOLUME_MOUNT_PATH).
// Первый запуск — в журнале (Railway → Deployments → View logs) логин и пароль SOP-менеджера.
// Переменные окружения: PORT, DATA_DIR, ANTHROPIC_API_KEY и AI_* (см. README, «ИИ»), NEW_ADMIN — новый вход SOP-менеджера,
// SITE_HOST — свой домен (buraqbilim.com): с других адресов страницы перекидываются на него.
// TELEGRAM_BOT_TOKEN — бот для уведомлений (server/telegram.mjs).
//   node server/index.mjs
import http from 'node:http';
import { gzipSync } from 'node:zlib';
import { readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadServer } from './gas-node.mjs';
import { startTelegram, loadStrings } from './telegram.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MAX_BODY = 40 * 1024 * 1024;        // правка со сканом паспорта — несколько МБ в base64
const AI_TIMEOUT = 180000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json' };
const ZIP = /^(text\/|application\/json|image\/svg|application\/manifest)/;
// что отдаётся как сайт — то же, что выкладывает .github/workflows/pages.yml; остальное (tests, tools, данные) — нет
const FILES = ['index.html', 'lms-sync.js', 'lms-client.js', 'lms-gs-script.js', 'lor.css', 'lor-ds.js', 'templates.js', 'strings.js', 'app.js'];
const DIRS = ['js/', 'fonts/', 'icons/', 'buraq-brand/logo/'];

/* папка данных: DATA_DIR, том Railway или ./data. На Railway без тома данные пропадали бы при каждом обновлении — не запускаемся */
export function dataDir(env = process.env) {
  if (env.DATA_DIR) return env.DATA_DIR;
  if (env.RAILWAY_VOLUME_MOUNT_PATH) return env.RAILWAY_VOLUME_MOUNT_PATH;
  if (env.RAILWAY_PROJECT_ID || env.RAILWAY_ENVIRONMENT_ID) return null;
  return join(ROOT, 'data');
}

/* следующие 03:00 по Ташкенту (UTC+5, без перехода на летнее время) */
export function nextBackup(now = Date.now()) {
  const d = new Date(now); d.setUTCHours(22, 0, 0, 0);
  if (d.getTime() <= now) d.setUTCDate(d.getUTCDate() + 1);
  return d.getTime();
}

export async function startServer({ port = 8080, host = '0.0.0.0', dir, env = process.env, iter, log = console.log, fetch = globalThis.fetch, tgPoll = true } = {}) {
  const g = loadServer({ dir, env, iter, log });
  const C = g.ctx;
  if (!g.ready()) {
    C.setup();   // вход SOP-менеджера — в журнале (Logger.log)
    log('Платформа запущена впервые. Данные: ' + dir);
  }
  // NEW_ADMIN=<любое новое значение> — ещё один вход SOP-менеджера (если пароль потерян); одно значение — один раз
  const na = String(env.NEW_ADMIN || '').trim();
  if (na && g.props.NEW_ADMIN_DONE !== na) { C.newAdmin(); C.PropertiesService.getScriptProperties().setProperty('NEW_ADMIN_DONE', na); }

  // версия сайта: коммит, из которого Railway собрал сервис (иначе — время запуска)
  const BUILD = String(env.RAILWAY_GIT_COMMIT_SHA || '').slice(0, 7) || Date.now().toString(36);
  const errJson = x => ({ ok: false, code: (x && x.code) || 'script', error: String((x && x.message) || x) });
  // Telegram: бот из TELEGRAM_BOT_TOKEN; новые уведомления уходят после каждой записи данных
  const site = env.SITE_HOST ? 'https://' + String(env.SITE_HOST).trim() : env.RAILWAY_PUBLIC_DOMAIN ? 'https://' + env.RAILWAY_PUBLIC_DOMAIN : '';
  const tg = String(env.TELEGRAM_BOT_TOKEN || '').trim()
    ? startTelegram({ token: String(env.TELEGRAM_BOT_TOKEN).trim(), C, strings: loadStrings(ROOT), fetch, log, siteUrl: site, poll: tgPoll }) : null;
  if (tg) C.LMS_AFTER_WRITE = st => { try { tg.onState(st); } catch (e) { log('Telegram: ' + e.message); } };
  function tgAction(req) {
    try {
      const s = C.session_(req.token), me = C.me_(C.readState_(), s);
      if (!tg) return { ok: false, code: 'tg_off', error: 'Telegram не подключён: TELEGRAM_BOT_TOKEN' };
      if (req.action === 'tgUnlink') { tg.unlinkUser(String(me.id)); return { ok: true }; }
      const url = tg.linkUrl(me.id);
      return url ? { ok: true, url } : { ok: false, code: 'tg_off', error: 'Бот ещё не готов — повторите через минуту' };
    } catch (x) { return errJson(x); }
  }
  const post = text => C.doPost({ postData: { contents: text } }).text;
  // ИИ: проверки и лимит — в коде сервера (aiRequest_), запрос к Claude API — не останавливая остальные запросы
  async function ai(req) {
    let r;
    try { r = C.aiRequest_(C.session_(req.token), req); } catch (x) { return errJson(x); }
    let code = 0, text = '', fail = null;
    try {
      const res = await fetch(r.url, { method: 'POST', headers: { ...r.opts.headers, 'content-type': 'application/json' },
        body: r.opts.payload, signal: AbortSignal.timeout(AI_TIMEOUT) });
      code = res.status; text = await res.text();
    } catch (e) { fail = e; }
    try { return C.aiResult_(r, code, text, fail); } catch (x) { return errJson(x); }
  }

  const gz = new Map();
  function sendFile(req, res, rel) {
    const file = normalize(join(ROOT, rel));
    if (!file.startsWith(ROOT) || rel.split(/[\\/]/).some(x => x.startsWith('.'))) return false;
    let st; try { st = statSync(file); } catch { return false; }
    if (!st.isFile()) return false;
    const type = TYPES[extname(file)] || 'application/octet-stream', tag = 'W/"' + st.size + '-' + st.mtimeMs + '"';
    const head = { 'content-type': type, 'cache-control': 'no-cache', etag: tag, 'x-content-type-options': 'nosniff' };
    if (req.headers['if-none-match'] === tag) { res.writeHead(304, head); res.end(); return true; }
    let body = readFileSync(file);
    if (ZIP.test(type) && /\bgzip\b/.test(req.headers['accept-encoding'] || '') && body.length > 1024) {
      let z = gz.get(file); if (!z || z.tag !== tag) { z = { tag, body: gzipSync(body) }; gz.set(file, z); }
      body = z.body; head['content-encoding'] = 'gzip'; head.vary = 'Accept-Encoding';
    }
    head['content-length'] = body.length;
    res.writeHead(200, head); res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  }
  const json = (res, status, text) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
    res.end(text);
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x'), p = url.pathname;
      if (p === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); return; }
      // свой домен (SITE_HOST, например buraqbilim.com): страницы с других адресов (…up.railway.app) — туда.
      // /api не перекидывается: POST после перенаправления превратился бы в GET
      const want = String(env.SITE_HOST || '').trim().toLowerCase(), got = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
      if (want && got && got !== want && (req.method === 'GET' || req.method === 'HEAD') && p !== '/api' && p !== '/exec') {
        res.writeHead(301, { location: 'https://' + want + req.url, 'cache-control': 'no-cache' }); res.end(); return;
      }
      if (p === '/api' || p === '/exec') {
        // страница с другого адреса (GitHub Pages) тоже может работать с этим сервером
        if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' }); res.end(); return; }
        if (req.method !== 'POST') { json(res, 200, JSON.stringify(Object.assign(JSON.parse(C.doGet().text), { build: BUILD }))); return; }
        const chunks = []; let n = 0;
        for await (const c of req) { n += c.length; if (n > MAX_BODY) { json(res, 413, JSON.stringify({ ok: false, code: 'bad', error: 'Слишком большой запрос (файл больше 25 МБ?)' })); req.destroy(); return; } chunks.push(c); }
        const text = Buffer.concat(chunks).toString('utf8');
        let body = null; try { body = JSON.parse(text); } catch {}
        json(res, 200, body && body.action === 'ai' ? JSON.stringify(await ai(body))
          : body && (body.action === 'tgLink' || body.action === 'tgUnlink') ? JSON.stringify(tgAction(body)) : post(text));
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
      if (p === '/config.js') {
        res.writeHead(200, { 'content-type': TYPES['.js'], 'cache-control': 'no-cache' });
        res.end("/* адрес сервера — этот же сайт (server/index.mjs); версия сайта — чтобы открытая вкладка узнала о новой */\nwindow.LMS_SERVER = '/api';\nwindow.LMS_BUILD = '" + BUILD + "';\n"); return;
      }
      let rel; try { rel = decodeURIComponent(p).replace(/^\/+/, ''); } catch { rel = null; }
      if (rel === '') rel = 'index.html';
      if (rel != null && (FILES.includes(rel) || DIRS.some(d => rel.startsWith(d))) && sendFile(req, res, rel)) return;
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Topilmadi');
    } catch (e) {
      log('Ошибка: ' + ((e && e.stack) || e));
      if (!res.headersSent) json(res, 500, JSON.stringify(errJson(e))); else res.end();
    }
  });
  server.requestTimeout = 0;   // ответ ИИ может идти дольше 5 минут по умолчанию
  await new Promise(r => server.listen(port, host, r));

  // ночная копия state.json (папка backups, 30 дней) — как триггер backup в Apps Script
  let timer = null;
  const plan = () => { timer = setTimeout(() => { try { C.backup(); log('Ночная копия данных сохранена'); } catch (e) { log('Копия не удалась: ' + e.message); } plan(); }, nextBackup() - Date.now()); };
  plan();

  return { server, g, tg, url: 'http://127.0.0.1:' + server.address().port + '/',
    close: () => new Promise(r => { clearTimeout(timer); if (tg) tg.stop(); server.close(r); server.closeAllConnections(); }) };
}

/* на Railway без тома платформа не запускается (данные пропадали бы при каждом обновлении), но и не падает:
   сайт показывает, что сделать, /api отвечает кодом setup, проверка /healthz проходит */
const NO_VOLUME = 'Нет тома для данных. Railway → этот сервис → правой кнопкой «Attach Volume» (или Ctrl+K → Volume) → '
  + 'Mount path: /data → Deploy. Без тома данные пропадали бы при каждом обновлении сайта.';
const NO_VOLUME_PAGE = `<!doctype html>
<html lang="uz"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BURAQ o‘quv platformasi</title>
<style>
:root { --navy: #0E2E54; --white: #FFFFFF; --red: #DE0441; --gray: #BFBFBF; }
body { margin: 0; min-height: 100vh; background: var(--navy); color: var(--white); font: 16px/1.55 "Neue Montreal", Inter, Arial, sans-serif; }
main { max-width: 720px; margin: 0 auto; padding: 32px 16px; }
img { width: 140px; height: auto; margin: 0 0 24px; }
hr { border: 0; border-top: 1px solid var(--red); margin: 0 0 32px; }
h1 { font-weight: 400; text-transform: uppercase; font-size: 32px; line-height: 1.15; margin: 0 0 16px; }
p { margin: 0 0 12px; } code { background: rgba(255,255,255,.12); padding: 1px 6px; border-radius: 4px; }
.ru { color: var(--gray); margin-top: 28px; }
</style></head>
<body><main>
<img src="/buraq-brand/logo/buraq-logo-white.svg" alt="BURAQ logistics" width="140" height="48"><hr>
<h1>Server sozlanmagan</h1>
<p>Ma’lumotlar uchun disk (Volume) ulanmagan — platforma ishga tushmadi.</p>
<p>Railway → servis → o‘ng tugma <b>«Attach Volume»</b> → Mount path: <code>/data</code> → <b>Deploy</b>. Bir daqiqadan keyin sahifani yangilang.</p>
<div class="ru"><p><b>Сервер не настроен.</b> Не подключён диск для данных (Volume), поэтому платформа не запущена.</p>
<p>Railway → сервис → правой кнопкой <b>«Attach Volume»</b> → Mount path: <code>/data</code> → <b>Deploy</b>. Через минуту обновите страницу.</p></div>
</main></body></html>`;
export async function startNoVolume({ port = 8080, host = '0.0.0.0', log = console.error } = {}) {
  const server = http.createServer((req, res) => {
    const p = new URL(req.url, 'http://x').pathname;
    if (p === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); return; }
    if (p === '/buraq-brand/logo/buraq-logo-white.svg') { res.writeHead(200, { 'content-type': TYPES['.svg'] }); res.end(readFileSync(join(ROOT, p))); return; }
    if (p === '/api' || p === '/exec') {
      res.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify({ ok: false, code: 'setup', error: NO_VOLUME })); return;
    }
    res.writeHead(503, { 'content-type': TYPES['.html'], 'cache-control': 'no-store', 'retry-after': '60' }); res.end(NO_VOLUME_PAGE);
  });
  await new Promise(r => server.listen(port, host, r));
  log(NO_VOLUME);
  return { server, url: 'http://127.0.0.1:' + server.address().port + '/', close: () => new Promise(r => server.close(r)) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = dataDir(), port = +process.env.PORT || 8080;
  const s = dir ? await startServer({ port, dir }) : await startNoVolume({ port });
  if (dir) console.log('BURAQ o‘quv platformasi: порт ' + s.server.address().port + ', данные: ' + dir);
  const stop = () => { s.close().then(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
