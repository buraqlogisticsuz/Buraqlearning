// Сервер платформы на Node (server/, для Railway): сайт и /api по одному адресу, данные на диске переживают перезапуск,
// файлы, ИИ без остановки других запросов, ночная копия, запуск без тома на Railway. Запуск: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer, startNoVolume, dataDir, nextBackup } from '../server/index.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'lms-node-'));
async function start(dir, opts = {}) {
  const logs = [];
  const s = await startServer({ port: 0, host: '127.0.0.1', dir, iter: 50, env: {}, log: m => logs.push(m), ...opts });
  const api = async (body, raw) => {
    const r = await fetch(s.url + 'api', { method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: raw ?? JSON.stringify(body) });
    return r.json();
  };
  return { ...s, logs, api };
}
const adminFrom = logs => { const m = logs.join('\n').match(/логин: (\S+), пароль: (\S+?)\./); return m && { login: m[1], password: m[2] }; };

test('сайт: страница, адрес сервера, только файлы сайта — без тестов, инструментов и данных', async () => {
  const dir = tmp(), s = await start(dir);
  try {
    const page = await fetch(s.url);
    assert.equal(page.status, 200); assert.match(page.headers.get('content-type'), /text\/html/);
    assert.match(await page.text(), /<script src="app.js">|app\.js/);
    assert.equal(await (await fetch(s.url + 'config.js')).text().then(t => /window\.LMS_SERVER = '\/api'/.test(t)), true);
    const js = await fetch(s.url + 'app.js', { headers: { 'accept-encoding': 'gzip' } });
    assert.equal(js.status, 200); assert.ok((await js.text()).length > 100000);
    const tag = js.headers.get('etag');
    assert.equal((await fetch(s.url + 'app.js', { headers: { 'if-none-match': tag } })).status, 304);
    assert.equal((await fetch(s.url + 'buraq-brand/logo/buraq-logo.svg')).status, 200);
    assert.equal((await fetch(s.url + 'healthz')).status, 200);
    for (const p of ['tests/lms-node-server.test.mjs', 'tools/lms-gs/Server.gs', 'server/index.mjs', 'README.md', 'package.json',
      'data/props.json', '.git/config', 'js/../tools/lms-gs/Server.gs', 'js/%2e%2e/tools/lms-gs/Code.gs', 'js/.hidden'])
      assert.equal((await fetch(s.url + p)).status, 404, p);
    // путь как есть, без нормализации браузером: «..» в закодированном виде
    for (const p of ['/js/..%2ftools/lms-gs/Code.gs', '/js/..%2f..%2fetc/passwd', '/fonts/%2e%2e/README.md'])
      assert.equal(await new Promise(r => http.get(s.url.slice(0, -1) + p, res => { res.resume(); r(res.statusCode); })), 404, p);
    const ping = await (await fetch(s.url + 'api')).json();
    assert.equal(ping.ok, true); assert.equal(ping.ready, true); assert.equal(ping.v, 7);
    assert.equal((await s.api(null, 'не json')).code, 'bad');
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('данные на диске: вход SOP-менеджера в журнале при первом запуске, после перезапуска — те же данные и пароли, файлы', async () => {
  const dir = tmp();
  let s = await start(dir), adm = adminFrom(s.logs), pdf, ref;
  try {
    assert.ok(adm, s.logs.join('\n'));
    const a = await s.api({ action: 'login', ...adm });
    assert.equal(a.ok, true, JSON.stringify(a));
    pdf = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4 ' + 'x'.repeat(5000)).toString('base64');
    const r = await s.api({ action: 'patch', token: a.token, ops: [
      { op: 'set', path: ['users', { id: 10427 }], value: { id: 10427, role: 'employee', login: 'd.karimova', password: 'pw-dilnoza', name: 'Dilnoza', status: 'probation' } },
      { op: 'set', path: ['users', { id: 10427 }, 'profile'], value: { passportFile: { name: 'pasport.pdf', type: 'application/pdf', data: pdf } } }] });
    assert.deepEqual(r.rejected, [], JSON.stringify(r));
    const st = JSON.parse(readFileSync(join(dir, 'BURAQ o‘quv platformasi — ma’lumotlar', 'state.json'), 'utf8'));
    ref = st.users.find(u => u.id === 10427).profile.passportFile.data;
    assert.match(ref, /^lmsfile:[\w-]{8,}$/);
    assert.ok(!JSON.stringify(st).includes('pw-dilnoza'));                       // пароль — только хэш в props.json
    assert.ok(readdirSync(join(dir, 'BURAQ o‘quv platformasi — ma’lumotlar', 'files')).some(f => f.endsWith('pasport.pdf')));
  } finally { await s.close(); }

  s = await start(dir);
  try {
    assert.equal(adminFrom(s.logs), null);                                      // второй SOP-менеджер не создаётся
    const d = await s.api({ action: 'login', login: 'd.karimova', password: 'pw-dilnoza' });
    assert.equal(d.ok, true, JSON.stringify(d));
    const me = (await s.api({ action: 'load', token: d.token })).state.users.find(u => u.id === 10427);
    assert.equal(me.profile.passportFile.data, ref);
    const f = await s.api({ action: 'file', token: d.token, id: ref.slice(8) });
    assert.equal(f.ok, true); assert.equal(f.name, 'pasport.pdf'); assert.equal('data:application/pdf;base64,' + f.data, pdf);
    const a = await s.api({ action: 'login', ...adm });
    assert.equal(a.ok, true);
    s.g.ctx.backup();
    const b = readdirSync(join(dir, 'BURAQ o‘quv platformasi — ma’lumotlar', 'backups'));
    assert.equal(b.length, 1); assert.match(b[0], /^state-\d{4}-\d\d-\d\d\.json$/);
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('ИИ: ключ из переменных окружения, пока Claude отвечает — остальные запросы идут; сбой связи возвращает место в лимите', async () => {
  const dir = tmp(), calls = [];
  let release, mode = 'ok';
  const fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    if (mode === 'down') throw new Error('ECONNRESET');
    await new Promise(r => { release = r; });
    return { status: 200, text: async () => JSON.stringify({ model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 3 }, content: [{ type: 'text', text: 'Javob' }] }) };
  };
  const off = await start(dir);
  const adm = adminFrom(off.logs);
  try {
    const a = await off.api({ action: 'login', ...adm });
    assert.equal((await off.api({ action: 'since', token: a.token, rev: -1 })).ai, false);
    assert.equal((await off.api({ action: 'ai', token: a.token, messages: [{ role: 'user', content: 'salom' }] })).code, 'ai_off');
  } finally { await off.close(); }

  const s = await start(dir, { env: { ANTHROPIC_API_KEY: 'sk-ant-test', AI_DAILY_LIMIT_ADMIN: '5' }, fetch });
  try {
    const a = await s.api({ action: 'login', ...adm });
    assert.equal((await s.api({ action: 'since', token: a.token, rev: -1 })).ai, true);
    assert.equal((await s.api({ action: 'ai', token: 'x', messages: [{ role: 'user', content: 'salom' }] })).code, 'auth');
    const pending = s.api({ action: 'ai', token: a.token, tier: 'quick', messages: [{ role: 'user', content: 'Packing list nima?' }] });
    while (!release) await new Promise(r => setTimeout(r, 5));
    const ping = await s.api({ action: 'load', token: a.token });                 // сервер не ждёт Claude
    assert.equal(ping.ok, true);
    release();
    const r = await pending;
    assert.deepEqual(r, { ok: true, text: 'Javob', truncated: false, model: 'claude-opus-5-5' });
    assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
    assert.equal(calls[0].init.headers['x-api-key'], 'sk-ant-test');
    assert.equal(calls[0].body.output_config.effort, 'low');
    assert.ok(!readFileSync(join(dir, 'props.json'), 'utf8').includes('sk-ant-test'));   // ключ не пишется на диск
    let u = JSON.parse(s.g.props.AI_USAGE);
    assert.equal(u.n[String(a.me)], 1); assert.equal(u.tin, 10); assert.equal(u.tout, 3);
    mode = 'down';
    assert.equal((await s.api({ action: 'ai', token: a.token, messages: [{ role: 'user', content: 'yana' }] })).code, 'ai_err');
    u = JSON.parse(s.g.props.AI_USAGE);
    assert.equal(u.n[String(a.me)], 1);
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('NEW_ADMIN — новый вход SOP-менеджера один раз на значение; большой запрос — понятная ошибка', async () => {
  const dir = tmp();
  let s = await start(dir); await s.close();
  s = await start(dir, { env: { NEW_ADMIN: '1' } });
  const n2 = adminFrom(s.logs);
  try {
    assert.equal(n2.login, 'metodist2');
    assert.equal((await s.api({ action: 'login', ...n2 })).ok, true);
    const big = await fetch(s.url + 'api', { method: 'POST', body: 'x'.repeat(41 * 1024 * 1024) }).then(r => r.json(), () => ({ code: 'bad' }));
    assert.equal(big.code, 'bad');
  } finally { await s.close(); }
  s = await start(dir, { env: { NEW_ADMIN: '1' } });
  try { assert.equal(adminFrom(s.logs), null); } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('папка данных: DATA_DIR, том Railway; на Railway без тома — не запускаемся; копия в 03:00 по Ташкенту', () => {
  assert.equal(dataDir({ DATA_DIR: '/x' }), '/x');
  assert.equal(dataDir({ RAILWAY_PROJECT_ID: 'p', RAILWAY_VOLUME_MOUNT_PATH: '/data' }), '/data');
  assert.equal(dataDir({ RAILWAY_PROJECT_ID: 'p' }), null);
  assert.match(dataDir({}), /data$/);
  assert.equal(new Date(nextBackup(Date.UTC(2026, 9, 12, 10))).toISOString(), '2026-10-12T22:00:00.000Z');
  assert.equal(new Date(nextBackup(Date.UTC(2026, 9, 12, 23))).toISOString(), '2026-10-13T22:00:00.000Z');
});

test('на Railway без тома: сервер не падает — сайт объясняет, что подключить, /api отвечает кодом setup', async () => {
  const logs = [], s = await startNoVolume({ port: 0, host: '127.0.0.1', log: m => logs.push(m) });
  try {
    assert.equal((await fetch(s.url + 'healthz')).status, 200);
    const page = await fetch(s.url);
    assert.equal(page.status, 503);
    const html = await page.text();
    assert.match(html, /Attach Volume/); assert.match(html, /\/data/); assert.match(html, /Server sozlanmagan/);
    assert.equal((await fetch(s.url + 'buraq-brand/logo/buraq-logo-white.svg')).status, 200);
    const api = await fetch(s.url + 'api', { method: 'POST', body: '{"action":"ping"}' });
    assert.equal(api.status, 503); assert.equal((await api.json()).code, 'setup');
    assert.match(logs.join(' '), /Нет тома для данных/);
  } finally { await s.close(); }
});

test('свой домен (SITE_HOST): страницы со старого адреса — туда, /api и /healthz — без перенаправления', async () => {
  const dir = tmp(), s = await start(dir, { env: { SITE_HOST: 'buraqbilim.com' } });
  const get = (path, host, method = 'GET', body) => new Promise((ok, no) => {
    const r = http.request(s.url.slice(0, -1) + path, { method, headers: { host } }, res => { let b = ''; res.on('data', c => b += c); res.on('end', () => ok({ status: res.statusCode, location: res.headers.location, body: b })); });
    r.on('error', no); r.end(body);
  });
  try {
    const old = await get('/?x=1#y', 'buraqlearning-production.up.railway.app');
    assert.equal(old.status, 301); assert.equal(old.location, 'https://buraqbilim.com/?x=1');
    assert.equal((await get('/', 'buraqbilim.com')).status, 200);
    assert.equal((await get('/', 'BuraqBilim.com:443')).status, 200);
    assert.equal((await get('/healthz', 'healthcheck.railway.app')).status, 200);
    const api = await get('/api', 'buraqlearning-production.up.railway.app', 'POST', '{"action":"ping"}');
    assert.equal(api.status, 200); assert.equal(JSON.parse(api.body).ok, true);
  } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
});
