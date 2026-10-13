#!/usr/bin/env node
// Надписи платформы — на вычитку носителям языка и обратно.
//   node tools/strings-review.mjs export [файл.csv]   → таблица: ключ; uz; ru; en; zh (то, что сейчас видно на сайте)
//   node tools/strings-review.mjs import файл.csv      → изменённые ячейки — в конец strings.js отдельным блоком
// Таблица открывается в Excel (UTF-8 с BOM, разделитель «;»). Править можно только тексты; {x}, {n} и т. п. — оставить.
import vm from 'node:vm';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FILE = fileURLToPath(new URL('../strings.js', import.meta.url));
const LANGS = ['uz', 'ru', 'en', 'zh'];
const MARK = '/* ---- правки носителей языка (tools/strings-review.mjs import) ---- */';

function load(src) { const ctx = { window: {} }; vm.createContext(ctx); vm.runInContext(src, ctx); return ctx.APP_T; }
const cell = v => { v = String(v == null ? '' : v); return /[;"\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
function parseCsv(txt) {
  txt = txt.replace(/^﻿/, '');
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (q) { if (c === '"') { if (txt[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ';') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && txt[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some(x => x !== '')) rows.push(row); row = []; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
const js = v => "'" + String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'";

const [cmd, arg] = process.argv.slice(2);
const src = readFileSync(FILE, 'utf8'), T = load(src);
if (cmd === 'export') {
  const keys = Object.keys(T.uz).filter(k => typeof T.uz[k] === 'string');
  const out = '﻿' + [['key'].concat(LANGS).map(cell).join(';')].concat(keys.map(k => [k].concat(LANGS.map(l => T[l][k])).map(cell).join(';'))).join('\r\n') + '\r\n';
  const file = arg || 'strings-review.csv';
  writeFileSync(file, out);
  console.log('Надписей: ' + keys.length + ' → ' + file);
} else if (cmd === 'import' && arg) {
  const rows = parseCsv(readFileSync(arg, 'utf8')), head = rows.shift().map(x => x.trim());
  const ki = head.indexOf('key'), idx = Object.fromEntries(LANGS.map(l => [l, head.indexOf(l)]));
  const base = src.indexOf(MARK) >= 0 ? src.slice(0, src.indexOf(MARK)).trimEnd() + '\n' : src;
  const B = load(base), prev = src.indexOf(MARK) >= 0 ? load(src) : B, fix = Object.fromEntries(LANGS.map(l => [l, {}]));
  let n = 0, bad = [];
  rows.forEach(r => {
    const k = (r[ki] || '').trim();
    if (!k || !(k in B.uz)) return;
    LANGS.forEach(l => {
      if (idx[l] < 0) return;
      const v = r[idx[l]];
      if (v == null || v === '' || v === B[l][k]) return;
      const need = (String(B[l][k] || B.uz[k]).match(/\{\w+\}/g) || []).sort().join(), got = (v.match(/\{\w+\}/g) || []).sort().join();
      if (need !== got) { bad.push(l + ':' + k + ' — нужны ' + (need || 'без {…}')); return; }
      fix[l][k] = v; if (v !== prev[l][k]) n++;
    });
  });
  const block = LANGS.filter(l => Object.keys(fix[l]).length).map(l => 'Object.assign(APP_T.' + l + ', { ' + Object.entries(fix[l]).map(([k, v]) => k + ': ' + js(v)).join(', ') + ' });').join('\n');
  writeFileSync(FILE, base + (block ? '\n' + MARK + '\n' + block + '\n' : ''));
  console.log('Изменено надписей: ' + n + (bad.length ? '\nПропущено (не те {…}):\n  ' + bad.join('\n  ') : ''));
} else {
  console.log('node tools/strings-review.mjs export [файл.csv] | import файл.csv');
  process.exit(1);
}
