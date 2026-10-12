// Учебная платформа локально — с сервером, но без Google: сайт из репозитория, а запросы к /exec выполняет код
// tools/lms-gs/Code.gs на заглушках Apps Script (tests/lms-gs-mock.mjs, данные — в памяти, до перезапуска).
//   node tests/lms-dev-server.mjs [порт]   → http://localhost:8790/  (логин и пароль методиста — в консоли)
// Для тестов в браузере: import { startDevServer } from './lms-dev-server.mjs'.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLms } from './lms-gs-mock.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.md': 'text/plain; charset=utf-8' };

export async function startDevServer({ port = 0, iter = 1000, now } = {}) {
  const g = loadLms({ iter, now });
  const admin = g.ctx.setup();
  let offline = false;   // для теста «нет сети»: /exec не отвечает
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/exec') {
      if (offline) { req.socket.destroy(); return; }
      if (req.method !== 'POST') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(g.ctx.doGet().text); return; }
      let body = ''; for await (const c of req) body += c;
      const out = g.ctx.doPost({ postData: { contents: body } }).text;
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(out); return;
    }
    // адрес сервера для страницы — этот же /exec
    if (url.pathname === '/config.js') { res.writeHead(200, { 'content-type': TYPES['.js'] }); res.end("window.LMS_SERVER = '/exec';\n"); return; }
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT) || file.includes('.git')) { res.writeHead(403); res.end(); return; }
    try { const data = await readFile(file); res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }); res.end(data); }
    catch { res.writeHead(404); res.end('not found'); }
  });
  await new Promise(r => server.listen(port, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  return { base, url: base + '/', admin, g, setOffline: v => { offline = v; }, close: () => new Promise(r => server.close(r)) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = await startDevServer({ port: +process.argv[2] || 8790 });
  console.log('Учебная платформа с сервером (данные в памяти): ' + s.url.replace('127.0.0.1', 'localhost'));
  console.log('Методист — логин: ' + s.admin.login + ', пароль: ' + s.admin.password);
}
