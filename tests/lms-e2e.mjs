// Учебная платформа в браузере, с сервером на заглушке (tests/lms-dev-server.mjs): SOP-менеджер и сотрудник на двух
// «устройствах». Нужен Playwright (в облачной сессии Claude он есть):  node tests/lms-e2e.mjs [папка для снимков]
// Проверяет: вход, шаблоны, загрузку курса из файла прототипа, создание сотрудника, первые шаги сотрудника
// (условия, анкета со сканом паспорта, мол-мулк), урок → «готов к тесту» → тест (балл считает сервер) → итог SOP-менеджера,
// правку без сети, и что сервер не отклонил ни одной обычной правки.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { crc32, inflateRawSync } from 'node:zlib';
import { startDevServer } from './lms-dev-server.mjs';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(execSync('npm root -g').toString().trim() + '/playwright'); }

const shots = process.argv[2] || '';
if (shots) mkdirSync(shots, { recursive: true });
const shot = async (p, name) => { if (shots) await p.screenshot({ path: shots + '/' + name + '.png' }); };
const step = (s) => console.log('· ' + s);

// Claude API на заглушке: ИИ-наставник отвечает по последнему вопросу
const aiCalls = [];
const srv = await startDevServer({ fetch: (url, body) => { aiCalls.push(body); const q = body.messages[body.messages.length - 1].content;
  // вывод по анкете (HR-psixolog) и анализ коллектива (HR-tahlilchi) — JSON, как просит страница: у пунктов — evidence;
  // пункт без неё («Hammaga yoqadi») страница отбрасывает
  const text = /HR-tahlilchi/.test(q) ? JSON.stringify({ summary: 'Ko‘pchilik o‘zini puxta deb tasvirlaydi', composition: 'Flegmatiklar ko‘p', strengths: ['Puxtalik'], gaps: ['Savdo tajribasi kam — muhokama uchun'], people: [{ n: 1, note: 'Hujjatlar bilan ishlashda tekshirish mumkin' }], risks: ['Sekin qaror'], actions: ['Savdo ko‘nikmasini muhokama qiling'], hiring: 'Faol savdo menejeri' })
    : /HR-psixolog/.test(q) ? JSON.stringify({ profile: 'Ko‘proq flegmatik uslubi (o‘z-o‘zini baholash)', summary: 'Puxta, barqaror xodim', strengths: [{ text: 'Barqarorlik', evidence: 'Neyrotizm: 4,0 / 5' }, { text: 'Hammaga yoqadi', evidence: '' }], growth: [{ text: 'Tezlik', evidence: '«Qaysi ish formati»: Masofadan' }], motivation: 'Aniq maqsad', communication: 'Xotirjam', management: [{ text: 'Vaqt bering', evidence: '«Tajriba»: 4 / 5' }], roles: 'Hujjatlar bilan ishlash', verify: ['Tig‘iz kunlarda qanday ishlaydi'], plan: ['Murabbiy biriktiring'] }) : 'Javob: ' + q;
  return { body: { model: body.model, stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: 'text', text }] } }; } });
const browser = await pw.chromium.launch();
const errors = [];
let offline = false;   // ошибки сети, пока /exec выключен нарочно, — ожидаемые
async function device(tag, path = '') {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  // без сети нарочно — ошибки сети ожидаемы; YouTube из тестовой среды может быть недоступен
  p.on('console', m => { if (m.type() === 'error' && !(offline && /ERR_EMPTY_RESPONSE|Failed to fetch/.test(m.text())) && !/youtube/i.test(m.location().url || '')) errors.push(tag + ': ' + m.text()); });
  p.on('pageerror', e => errors.push(tag + ': ' + e.message));
  await p.goto(srv.url + path, { waitUntil: 'networkidle' });
  return p;
}
// всё, что сервер отклонил или не принял, собирается на странице
const watchSync = p => p.evaluate(() => { window.__rej = []; LmsClient.onStatus(s => { if (s.rejected) window.__rej.push.apply(window.__rej, s.rejected); if (s.error) window.__rej.push('ERROR ' + s.error); }); });
const rejected = p => p.evaluate(() => window.__rej || []);
const settle = async p => { await p.waitForTimeout(200); await p.evaluate(() => LmsClient.flushAll().catch(() => {})); await p.waitForTimeout(300); };
async function signIn(p, login, password) {
  await p.fill('#f-login', login); await p.fill('#f-password', password);
  await p.click('button[type="submit"]');
  await p.waitForFunction(() => !document.querySelector('#f-password'), null, { timeout: 15000 });
  await watchSync(p);
}
const click = async (p, name, opts = {}) => { await p.getByRole('button', { name, exact: !!opts.exact }).first().click(); await p.waitForTimeout(opts.wait || 400); };
// карточка «Savolnoma»: согласия плашками — «✓ короткая подпись | полный текст (подсказка)»
const consChips = p => p.locator('.qn-ans .qn-cons-c').evaluateAll(els => els.map(e => (e.classList.contains('is-ok') ? '✓ ' : '✕ ') + e.querySelector('.qn-cons-k').textContent + ' | ' + e.title));
const nav = async (p, hash) => { await p.locator('a[href="#' + hash + '"]:visible').first().click(); await p.waitForTimeout(600); };
// шапка кабинета на разной ширине: «O‘quv platformasi» — под логотипом, по его левому краю, без черты-разделителя;
// логотип не искажён; меню 16 px; ни один пункт не обрезан — в строке шапки только целиком, иначе меню своей строкой
// (на компьютере переносится, на телефоне прокручивается, открытый пункт виден целиком); красная черта открытого
// пункта — на нижнем краю его строки; --hdr-h — настоящая высота шапки; страница вбок не прокручивается
async function checkHeader(p, tag) {
  const vp = p.viewportSize();
  for (const w of [1600, 1280, 1024, 390]) {
    await p.setViewportSize({ width: w, height: 800 }); await p.waitForTimeout(300);
    const r = await p.evaluate(() => {
      const hd = document.querySelector('.app-header'), box = e => e.getBoundingClientRect();
      const vis = e => !!e && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden';
      const logo = hd.querySelector('.lor-header-logo'), cap = hd.querySelector('.lor-header-app'), inl = hd.querySelector('.lor-header-nav'), sub = hd.querySelector('.app-subnav');
      const nv = vis(inl) ? inl : sub, N = box(nv), links = [...nv.querySelectorAll('a')], on = nv.querySelector('a.is-on'), L = box(logo), C = box(cap);
      const rows = new Set(links.map(a => Math.round(box(a).top))).size, scrolls = getComputedStyle(nv).overflowX === 'auto';
      return { inline: vis(inl), sub: vis(sub), capVis: vis(cap), capGap: C.top - L.bottom, capLeft: Math.abs(C.left - L.left), divider: getComputedStyle(cap).borderLeftWidth,
        ratio: L.width / L.height, font: Math.min(...links.map(a => parseFloat(getComputedStyle(a).fontSize))), rows, scrolls,
        cut: scrolls ? [] : links.filter(a => box(a).right > N.right + .5 || box(a).left < N.left - .5).map(a => a.textContent),
        onSeen: !on || (box(on).left >= N.left - .5 && box(on).right <= N.right + .5),
        line: on && rows === 1 ? Math.abs(box(on).bottom - N.bottom) : 0,
        hdrH: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hdr-h')), hdH: box(hd).height, docW: document.documentElement.scrollWidth };
    });
    const at = tag + ' ' + w + 'px: ' + JSON.stringify(r);
    assert.ok(r.inline !== r.sub, 'меню — либо в строке шапки, либо своей строкой: ' + at);
    assert.ok(Math.abs(r.ratio - 526 / 181.15) < .05, 'логотип не искажён: ' + at);
    if (w >= 1024) assert.ok(r.capVis, 'подпись видна: ' + at);
    if (r.capVis) assert.ok(r.capGap >= 6 && r.capLeft < 1 && r.divider === '0px', 'подпись под логотипом, по левому краю, без черты: ' + at);
    assert.ok(r.font >= 16, 'меню крупное: ' + at);
    assert.deepEqual(r.cut, [], 'ни один пункт меню не обрезан: ' + at);
    assert.ok(r.onSeen && r.line < 1, 'открытый пункт виден целиком, черта — на краю строки: ' + at);
    assert.ok(Math.abs(r.hdrH - r.hdH) < 1 && r.docW <= w, '--hdr-h = высота шапки, страница вбок не едет: ' + at);
    if (w === 390) assert.ok(r.sub && (r.scrolls || r.rows === 1), 'на телефоне меню своей строкой: ' + at);
  }
  await p.setViewportSize(vp); await p.waitForTimeout(300);
}
// .xlsx в тесте — zip: прочитать (как есть или deflate) и собрать заново без сжатия, как сохраняет Excel или Google Sheets
function unzip(buf) {
  const out = {};
  for (let o = 0; buf.readUInt32LE(o) === 0x04034b50;) {
    const m = buf.readUInt16LE(o + 8), cs = buf.readUInt32LE(o + 18), nl = buf.readUInt16LE(o + 26), xl = buf.readUInt16LE(o + 28);
    const d = buf.subarray(o + 30 + nl + xl, o + 30 + nl + xl + cs);
    out[buf.toString('utf8', o + 30, o + 30 + nl)] = m ? inflateRawSync(d) : d;
    o += 30 + nl + xl + cs;
  }
  return out;
}
function zip(files) {
  const parts = [], cen = []; let off = 0;
  for (const [name, data] of Object.entries(files)) {
    const n = Buffer.from(name), d = Buffer.from(data), c = crc32(d), lh = Buffer.alloc(30), ch = Buffer.alloc(46);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(c, 14); lh.writeUInt32LE(d.length, 18); lh.writeUInt32LE(d.length, 22); lh.writeUInt16LE(n.length, 26);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(c, 16); ch.writeUInt32LE(d.length, 20); ch.writeUInt32LE(d.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42);
    parts.push(lh, n, d); cen.push(ch, n); off += 30 + n.length + d.length;
  }
  const cs = Buffer.concat(cen), end = Buffer.alloc(22), k = Object.keys(files).length;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(k, 8); end.writeUInt16LE(k, 10); end.writeUInt32LE(cs.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cs, end]);
}
const unxml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// лист → строки (ячейки числом или текстом) и обратно — с общими строками (sharedStrings), как у Excel
const sheetRows = x => [...x.matchAll(/<row [^>]*>(.*?)<\/row>/g)].map(m => {
  const r = [];
  for (const c of m[1].matchAll(/<c r="([A-Z])\d+"[^>]*>(?:<v>([^<]*)<\/v>|<is><t[^>]*>([^<]*)<\/t><\/is>)<\/c>/g)) r[c[1].charCodeAt(0) - 65] = c[2] != null ? c[2] : unxml(c[3]);
  return r;
});
function sheetXml(rows) {
  const ss = [], si = v => { let i = ss.indexOf(v); if (i < 0) { i = ss.length; ss.push(v); } return i; };
  const body = rows.map((r, ri) => '<row r="' + (ri + 1) + '">' + Array.from(r, (v, ci) => v == null || v === '' ? ''
    : '<c r="' + String.fromCharCode(65 + ci) + (ri + 1) + '"' + (/^\d+$/.test(v) ? '><v>' + v : ' t="s"><v>' + si(String(v))) + '</v></c>').join('') + '</row>').join('');
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  return { sheet: '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="' + NS + '"><sheetData>' + body + '</sheetData></worksheet>',
    shared: '<?xml version="1.0" encoding="UTF-8"?><sst xmlns="' + NS + '" count="' + ss.length + '">' + ss.map(v => '<si><t>' + xml(v) + '</t></si>').join('') + '</sst>' };
}
// текст на странице; узкие неразрывные пробелы в суммах (4 000 000) — обычные
const txt = async (p, sel) => (await p.innerText(sel)).replace(/[\u202f\u00a0]/g, ' ');
const skipTour = async p => { const s = p.getByRole('button', { name: 'O‘tkazib yuborish' }); if (await s.count()) { await s.first().click(); await p.waitForTimeout(300); } };

try {
  // ---------- SOP-менеджер ----------
  const A = await device('SOP-менеджер');
  assert.equal(await A.locator('.demo-box').count(), 0, 'с сервером демо-входов на экране нет');
  await signIn(A, srv.admin.login, srv.admin.password);
  await skipTour(A);
  await settle(A);
  step('SOP-менеджер вошёл, шаблоны уровней и программ на сервере');
  assert.ok(srv.g.state().levels.length > 0 && srv.g.state().tracks.length > 0);
  // отметка прихода в программе по умолчанию включена; в основных сценариях выключаем, чтобы окно не мешало (отдельный шаг ниже)
  const setClock = on => { const tk = srv.g.post({ action: 'login', login: srv.admin.login, password: srv.admin.password }).token; srv.g.post({ token: tk, action: 'patch', ops: [{ op: 'set', path: ['settings', 'selfClock'], value: { on: on } }] }); };
  setClock(false);

  // файл «прототипа» с тестовыми уроками (настоящие тексты 4-bob в репозиторий не кладём)
  const quiz = [{ q: 'Savol 1', options: ['A', 'B', 'C'], answer: 1 }, { q: 'Savol 2', options: ['A', 'B'], answer: 0 }];
  const ch4 = Array.from({ length: 10 }, (_, i) => ({ id: 'b4-' + (i + 1), n: '4.' + (i + 1), title: '4.' + (i + 1) + '. Test standarti', html: '<p>Test matni ' + (i + 1) + '</p>', quiz, video: { title: 'Video', duration: '01:00' } }));
  const proto = (shots || '/tmp') + '/prototip.html';
  writeFileSync(proto, '<!doctype html><script>\nvar CH4 = ' + JSON.stringify(ch4) + ';\n</script>\n');
  await nav(A, 'cms');
  await A.setInputFiles('#cms-import', proto);
  await settle(A);
  assert.deepEqual(srv.g.state().course.sections.map(s => s.id + ':' + s.lessons.length), ['s2:8', 's3:2']);
  assert.equal(srv.g.state().course.sections[0].lessons[0].quiz[0].answer, 1);
  step('курс загружен из файла прототипа');
  await shot(A, '1-cms');

  await nav(A, 'staff');
  await A.fill('#f-n-name', 'Dilnoza Karimova'); await A.selectOption('#f-n-pos', 'Omborchi');
  await A.fill('#f-n-login', 'd.karimova'); await A.fill('#f-n-pw', 'parol-12345');
  await click(A, 'Yaratish');
  await settle(A);
  const emp = srv.g.state().users.find(u => u.login === 'd.karimova');
  assert.ok(emp && !('password' in emp) && srv.g.props['cred:' + emp.id], 'сотрудник на сервере, пароль — только в учётной записи');
  step('SOP-менеджер создал сотрудника');

  // ---------- сотрудник ----------
  const E = await device('сотрудник');
  await signIn(E, 'd.karimova', 'parol-12345');
  await shot(E, '2-welcome');
  for (let i = 0; i < 3; i++) await click(E, 'Keyingi');
  await E.check('#agree1'); await E.check('#agree2');
  await click(E, 'Qabul qilaman va boshlash', { wait: 800 });
  await settle(E);
  assert.ok(srv.g.state().users.find(u => u.id === emp.id).termsAcceptedAt, 'согласие с условиями — на сервере');
  step('сотрудник принял условия');
  await shot(E, '3-after-terms');

  // анкета: личные данные со сканом паспорта → контакты → опыт → мол-мулк
  await E.fill('#f-lastName', 'Karimova'); await E.fill('#f-firstName', 'Dilnoza'); await E.fill('#f-birth', '1998-04-12');
  await E.fill('#f-passport', 'AA 1234567'); await E.fill('#f-address', 'Toshkent sh., Chilonzor');
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(6000, 65)]);
  await E.setInputFiles('#f-pp', { name: 'pasport.pdf', mimeType: 'application/pdf', buffer: pdf });
  await click(E, 'Saqlash va davom etish');
  await E.fill('#f-phone', '+998 90 123 45 67'); await E.fill('#f-telegram', '@dilnoza'); await E.fill('#f-emgName', 'Ona'); await E.fill('#f-emgPhone', '+998 90 765 43 21');
  await click(E, 'Saqlash va davom etish');
  await E.selectOption('#f-education', 'Oliy (bakalavr)'); await E.fill('#f-years', '2');
  await click(E, 'Saqlash va davom etish', { wait: 300 });            // «Tillar» обязателен
  assert.equal(await E.locator('.ac-chip').count(), 5, 'Tillar: O‘zbek, Rus, Xitoy, Turk, Boshqa');
  await E.locator('.ac-chip', { hasText: 'Rus' }).click(); await E.locator('.ac-chip', { hasText: 'O‘zbek' }).click();
  await E.locator('.ac-chip', { hasText: 'Boshqa' }).click(); await E.fill('#f-languages-other', 'ingliz');
  await shot(E, '3-langs');
  await click(E, 'Saqlash va davom etish');
  await shot(E, '4-assets');
  await E.getByText('Menga hozircha kompaniya mol-mulki berilmagan').click();
  await E.getByText('Moddiy javobgarlik.', { exact: false }).click();
  await click(E, 'Anketani yakunlash', { wait: 800 });
  await settle(E);
  const me1 = srv.g.state().users.find(u => u.id === emp.id);
  assert.equal(me1.profileComplete, true, 'анкета заполнена — на сервере');
  assert.equal(me1.profile.languages, 'O‘zbek, Rus, ingliz', 'языки — по порядку вариантов, свой — в конце');
  const pp = me1.profile.passportFile;
  assert.match(pp.data, /^lmsfile:/, 'скан паспорта — файлом на Диске, в данных ссылка');
  assert.ok(!srv.g.files[srv.g.props.LMS_STATE].content.includes('%PDF'));
  step('анкета со сканом паспорта: скан на Диске сервера');
  await shot(E, '5-home');
  await skipTour(E);
  // ---- приход в программе: модальное окно, время ставит сервер; камеры и снимков нет (v17, «delete face control») ----
  setClock(true);
  // камера не должна понадобиться: getUserMedia только считает вызовы
  await E.addInitScript(() => { window.__cam = 0; if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = () => { window.__cam++; return Promise.reject(new Error('cam')); }; });
  await E.reload({ waitUntil: 'networkidle' }); await watchSync(E);
  await E.locator('.clock-banner, .clock-modal').first().waitFor({ timeout: 8000 });   // плашка или само окно
  if (!(await E.locator('.clock-modal').count())) await E.locator('.clock-banner button').click();
  await E.locator('.clock-modal').waitFor({ timeout: 5000 });
  await shot(E, '5b-clock-gate');
  assert.equal(await E.locator('.clock-modal video, .clock-modal canvas, .clock-modal img').count(), 0, 'в окне нет камеры и снимков');
  assert.match(await E.locator('.clock-modal').innerText(), /server belgilaydi/, 'окно говорит, что время ставит сервер');
  await E.locator('.clock-modal .lor-btn-primary, .clock-modal button:has-text("Ishni boshlash")').first().click();
  await E.waitForTimeout(800);
  assert.equal(await E.locator('.clock-modal').count(), 0, 'после отметки окно закрылось');
  assert.equal(await E.evaluate(() => window.__cam), 0, 'камера не запрашивалась');
  { const rec = Object.values(srv.g.state().attend[String(emp.id)] || {})[0];
    assert.ok(rec && rec.in && rec.src === 'app', 'приход отмечен сервером');
    assert.deepEqual(Object.keys(rec).sort(), ['in', 'src'], 'в записи только время — без снимка'); }
  assert.equal(await E.locator('.at-home button[aria-label*="surat"], .at-home img').count(), 0, 'на карточке «Ishga kelish» снимка нет');
  step('приход отмечен через модальное окно — без камеры и снимка');
  setClock(false);
  await E.reload({ waitUntil: 'networkidle' }); await watchSync(E); await skipTour(E);
  // урок 4.1 → «Mavzuni yakunlash» → «B: tushundim, testga tayyorman» → тест
  await E.getByText('4.1. Test standarti').first().click(); await E.waitForTimeout(600);
  assert.ok((await E.innerText('main')).includes('Test matni 1'), 'текст урока пришёл с сервера');
  // короткий урок виден целиком — окно «всё понятно?» открывается само, иначе — кнопкой внизу
  if (!(await E.locator('.lor-choice-b').count())) await click(E, 'Mavzuni yakunlash');
  await E.locator('.lor-choice-b').click(); await E.waitForTimeout(300);
  await E.locator('.lor-modal-actions button').last().click(); await E.waitForTimeout(400);
  await shot(E, '6-exam-asked');
  await E.keyboard.press('Escape'); await E.waitForTimeout(300);
  await settle(E);
  assert.equal(srv.g.state().progress[String(emp.id)]['b4-1'].status, 'exam-ready');
  assert.equal(srv.g.state().requests.filter(r => r.type === 'exam' && r.userId === emp.id).length, 1);
  step('сотрудник прочитал урок и готов к тесту');
  const view = await E.evaluate(() => LmsClient.initial().course.sections[0].lessons[0].quiz);
  assert.ok(view.every(q => !('answer' in q)), 'правильных ответов у сотрудника нет');
  await click(E, 'Testni boshlash', { wait: 600 });
  await E.locator('.quiz-q').nth(0).locator('.lor-opt').nth(1).click();
  await E.locator('.quiz-q').nth(1).locator('.lor-opt').nth(1).click();
  await click(E, 'Javoblarni yuborish', { wait: 1500 });
  await shot(E, '7-quiz');
  assert.ok((await E.innerText('main')).includes('50%'), 'балл 50% от сервера на экране');
  assert.equal(await E.locator('.lor-opt.is-right').count(), 2, 'после сдачи видно правильные ответы');
  assert.equal(srv.g.state().progress[String(emp.id)]['b4-1'].score, 50);
  step('тест: балл 50% посчитал сервер');

  // ---------- SOP-менеджер ставит итог устного экзамена ----------
  await A.evaluate(() => LmsClient.sync());
  await nav(A, 'inbox'); await A.waitForTimeout(400);
  await A.getByRole('tab', { name: /Imtihon/ }).first().click().catch(() => {});
  await A.waitForTimeout(300);
  assert.ok((await A.innerText('main')).includes('50%'), 'SOP-менеджер видит балл теста');
  await A.locator('.lor-verdict button').first().click();
  await A.locator('textarea[name^="cm"]').first().fill('Yaxshi, lekin 2-savolni takrorlang');
  await A.locator('.lor-req-act button').first().click(); await A.waitForTimeout(300);
  await settle(A);
  assert.equal(srv.g.state().progress[String(emp.id)]['b4-1'].status, 'passed');
  step('SOP-менеджер поставил итог: сдано');
  await shot(A, '8-inbox');

  await E.evaluate(() => LmsClient.sync()); await E.waitForTimeout(500);
  await click(E, 'Darsga qaytish', { wait: 600 });
  assert.ok((await E.innerText('main')).includes('Yaxshi, lekin 2-savolni takrorlang'), 'сотрудник видит итог и комментарий');
  step('сотрудник видит итог и комментарий SOP-менеджера');

  // ---------- без сети: правка ждёт на устройстве и уходит сама ----------
  srv.setOffline(true); offline = true;
  await E.getByText('4.2. Test standarti').first().click(); await E.waitForTimeout(1500);
  await E.keyboard.press('Escape');
  assert.equal((srv.g.state().progress[String(emp.id)]['b4-2'] || {}).status, undefined, 'без сети на сервер ничего не ушло');
  await E.waitForSelector('.sync-chip', { timeout: 10000 });
  await shot(E, '9-offline');
  assert.ok((await E.innerText('.sync-chip')).includes('Internet yo‘q'));
  srv.setOffline(false); offline = false;
  await E.evaluate(() => window.dispatchEvent(new Event('online')));
  await E.waitForFunction(() => !document.querySelector('.sync-chip'), null, { timeout: 15000 });
  await settle(E);
  assert.equal(srv.g.state().progress[String(emp.id)]['b4-2'].status, 'in-progress', 'после сети правка дошла');
  step('без сети правка подождала на устройстве и дошла');

  // ---------- скан паспорта: SOP-менеджер скачивает с сервера ----------
  await nav(A, 'staff');
  const [dl] = await Promise.all([A.waitForEvent('download', { timeout: 10000 }), A.locator('a.pp-link').first().click()]);
  assert.equal(dl.suggestedFilename(), 'pasport.pdf');
  step('SOP-менеджер скачал скан паспорта с сервера');

  // ---------- вход на другом устройстве и выход ----------
  const E2 = await device('сотрудник-2');
  await signIn(E2, 'd.karimova', 'parol-12345');
  assert.ok((await E2.innerText('body')).includes('Dilnoza'), 'на втором устройстве — те же данные');
  await E2.locator('.user-menu, .app-user, [aria-haspopup]').first().click().catch(() => {});
  await E2.evaluate(() => LmsClient.logout()); await E2.waitForTimeout(500);
  assert.equal(await E2.locator('#f-password').count(), 1, 'после выхода — экран входа');
  step('второе устройство: вход и выход');

  // ---------- сверхзадача от SOP-менеджера → сотрудник сдаёт ----------
  await A.locator('.xt-staff-b').first().click(); await A.waitForTimeout(500);
  await click(A, 'Yangi qo‘shimcha vazifa');
  await A.fill('#f-xt-t' + emp.id, 'Ombor uchun qo‘llanma');
  await A.getByRole('button', { name: /Vazifani berish|ga berish/ }).first().click(); await A.waitForTimeout(300);
  await settle(A);
  assert.equal(srv.g.state().xtasks.filter(x => x.uid === emp.id).length, 1, 'сверхзадача на сервере');
  await E.evaluate(() => LmsClient.sync()); await E.waitForTimeout(400);
  await nav(E, 'tasks');
  await shot(E, '10-tasks');
  await click(E, 'Topshirish');                                  // открыть форму сдачи
  await E.locator('main textarea').first().fill('Qo‘llanma tayyor, 3 sahifa');
  await E.getByRole('button', { name: 'Topshirish' }).last().click(); await E.waitForTimeout(500);
  await settle(E);
  assert.equal(srv.g.state().xtasks.find(x => x.uid === emp.id).status, 'review', 'сверхзадача сдана на проверку');
  step('сверхзадача: SOP-менеджер выдал, сотрудник сдал');

  // ---------- первый вход CEO: создаёт SOP-менеджер, пока CEO нет; зарплаты у SOP-менеджера нет ----------
  assert.equal(await A.locator('a[href="#pay"]').count(), 0, 'у SOP-менеджера нет «Maosh»');
  await nav(A, 'staff');
  assert.match(await A.innerText('.ld-box'), /Platformada hali CEO yo‘q/);
  await A.fill('#f-ld-name', 'Sherzod Aliyev'); await A.fill('#f-ld-login', 'ceo'); await A.fill('#f-ld-pw', 'ceo-parol-1');
  await click(A, 'CEO kirishini yaratish');
  await settle(A);
  const ceo = srv.g.state().users.find(u => u.login === 'ceo');
  assert.ok(ceo && ceo.role === 'admin' && ceo.post === 'ceo' && !('password' in ceo) && srv.g.props['cred:' + ceo.id], 'вход CEO на сервере');
  assert.equal(await A.locator('.ld-box').count(), 0, 'дальше входы руководства — у CEO');
  step('SOP-менеджер создал первый вход CEO; «Maosh» у него нет');

  // ---------- идея (tashabbus) → CEO, уведомления, план адаптации ----------
  await E.reload({ waitUntil: 'networkidle' }); await watchSync(E); await skipTour(E);   // свежие данные: вход CEO уже есть
  await E.waitForFunction(() => LmsClient.initial().users.some(u => u.post === 'ceo'), null, { timeout: 15000 });
  await click(E, 'Tashabbus', { wait: 500 });
  await click(E, 'Yuborish', { wait: 300 });                   // без адресата не уходит
  assert.ok((await E.innerText('.ini-modal')).includes('Kamida bitta rahbarni tanlang'), 'нужно выбрать, кому');
  await E.locator('.ini-to-card').nth(0).click(); await E.locator('.ini-to-card').nth(1).click();   // сразу двум
  try { await E.locator('.ini-to-card').nth(0).filter({ hasText: 'Sherzod Aliyev' }).waitFor({ timeout: 10000 }); }   // в карточке — имя CEO (после перерисовки)
  catch (e) { console.log('карточка CEO:', await E.innerText('.ini-to-card >> nth=0'), await E.evaluate(() => JSON.stringify(LmsClient.initial().users.filter(u => u.post)))); throw e; }
  assert.equal(await E.locator('.ini-to-card[aria-checked="true"]').count(), 2, 'выбраны оба');
  await E.locator('.ini-types:not(.ini-to) .ini-type-card').first().click();
  await E.fill('#f-ini-title', 'Yorliqlarni oldindan chop etish'); await E.fill('#f-ini-text', 'Ertalab navbat kamayadi');
  await E.selectOption('#f-ini-area', { label: 'Ombor' });
  await click(E, 'Yuborish', { wait: 500 });
  await shot(E, '11-ini-sent');
  await E.keyboard.press('Escape');
  await settle(E);
  const idea = srv.g.state().initiatives.find(x => x.uid === emp.id);
  assert.deepEqual(idea && idea.to, ['ceo', 'pm'], 'идея на сервере, адресаты — CEO и Project Manager');
  assert.ok(srv.g.state().notifications.some(n => n.userId === ceo.id && n.kind === 'ini_in'), 'CEO получил уведомление');

  const C = await device('CEO');
  await signIn(C, 'ceo', 'ceo-parol-1'); await skipTour(C);
  assert.ok(await C.evaluate(() => LmsClient.initial().course.sections.length) > 0, 'CEO видит всю платформу');
  await nav(C, 'feedback');
  assert.ok((await C.innerText('main')).includes('Yorliqlarni oldindan chop etish'), 'CEO видит идею, адресованную ему');
  await C.selectOption('#f-is-' + idea.id, 'accepted');
  await C.fill('#f-ir-' + idea.id, 'Zo‘r, keyingi haftadan boshlaymiz');
  await click(C, 'Saqlash va xabar berish');
  await settle(C);
  await shot(C, '11b-ceo');
  const ans = srv.g.state().initiatives.find(x => x.id === idea.id);
  assert.equal(ans.status, 'accepted'); assert.equal(ans.reply, 'Zo‘r, keyingi haftadan boshlaymiz'); assert.equal(ans.repliedBy, 'ceo');
  assert.deepEqual(await rejected(C), [], 'сервер не отклонил ответ CEO');
  await A.reload({ waitUntil: 'networkidle' }); await watchSync(A);
  const seen = await A.evaluate(id => LmsClient.initial().initiatives.find(x => x.id === id), idea.id);
  assert.ok(seen && seen.status === 'accepted' && !seen.title && !seen.reply, 'SOP-менеджер видит только статус идеи');
  step('идея ушла CEO, CEO ответил в своём кабинете; SOP-менеджер текста не видит');
  await E.reload({ waitUntil: 'networkidle' }); await watchSync(E); await skipTour(E);
  await E.locator('.bell-wrap button').first().click(); await E.waitForTimeout(300);
  await E.locator('.notif-pop-h button').first().click(); await E.waitForTimeout(300);
  await E.keyboard.press('Escape');
  await nav(E, 'path');
  await E.locator('.plan-item input').first().check(); await E.waitForTimeout(300);
  await settle(E);
  const st2 = srv.g.state();
  assert.ok(st2.notifications.filter(n => n.userId === emp.id).every(n => n.read), 'все уведомления прочитаны');
  assert.equal(Object.keys(st2.users.find(u => u.id === emp.id).plan || {}).length, 1, 'пункт плана отмечен');
  step('идея, уведомления, план адаптации — на сервере');
  await checkHeader(E, 'сотрудник'); await checkHeader(C, 'CEO'); await checkHeader(A, 'SOP-менеджер');
  await shot(E, 'shapka-xodim');
  step('шапка: подпись под логотипом, меню 16 px без обрезанных слов — у сотрудника, CEO и SOP-менеджера, 1600–390 px');

  // ---------- видео урока: ссылка YouTube «по ссылке» ----------
  await nav(A, 'cms');
  await A.fill('#f-vs', 'https://youtu.be/dQw4w9WgXcQ?si=test');
  await click(A, 'Saqlash', { exact: true, wait: 400 });
  await settle(A);
  assert.equal(srv.g.state().course.sections[0].lessons[0].video.src, 'https://youtu.be/dQw4w9WgXcQ?si=test');
  await E.evaluate(() => LmsClient.sync()); await E.waitForTimeout(400);
  await E.getByText('4.1. Test standarti').first().click(); await E.waitForTimeout(600);
  assert.match(await E.locator('.lor-video-frame iframe').getAttribute('src'), /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/);
  await E.locator('.lor-video-frame iframe').focus(); await E.waitForTimeout(200);
  assert.equal(await E.locator('.lor-shield').count(), 0, 'клик в видео не прячет урок');
  await E.keyboard.press('Escape');
  step('видео урока: ссылка YouTube встраивается, защита урока её не прячет');

  // ---------- ИИ-наставник через сервер ----------
  await E.locator('#ai-input').count().then(n => n ? null : E.getByRole('button', { name: 'AI-mentor' }).first().click());
  await E.waitForTimeout(300);
  assert.ok((await E.innerText('body')).includes('AI hali ulanmagan'), 'без ключа — «ИИ не подключён»');
  srv.g.props.ANTHROPIC_API_KEY = 'sk-ant-test';
  await E.evaluate(() => LmsClient.sync()); await E.waitForTimeout(400);
  await E.fill('#ai-input', 'Packing list nima?');
  await E.locator('.ai-form button[type="submit"]').click();
  await E.waitForFunction(() => document.body.innerText.includes('Javob: Packing list nima?'), null, { timeout: 10000 });
  assert.equal(aiCalls.length, 1); assert.equal(aiCalls[0].model, 'claude-opus-5-5');
  assert.ok(!(await E.evaluate(() => JSON.stringify(localStorage))).includes('sk-ant-test'), 'ключ не попадает на устройство');
  await shot(E, '12-ai');
  await E.keyboard.press('Escape');
  step('ИИ-наставник: без ключа — «не подключён», с ключом отвечает через сервер');

  assert.deepEqual(await rejected(E), [], 'сервер не отклонил ни одной правки сотрудника');
  assert.deepEqual(await rejected(A), [], 'сервер не отклонил ни одной правки SOP-менеджера');
  step('сервер не отклонил ни одной правки');

  // ---------- профиль: сотрудник — фото, имя, логин; пароль — только SOP-менеджер ----------
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mNkYPhfz8DAwMDEwMDAAAAhJAKBc6tHfgAAAABJRU5ErkJggg==', 'base64');
  await E.reload({ waitUntil: 'networkidle' }); await skipTour(E);   // без открытых панелей (ИИ-наставник)
  await E.locator('.user-btn').first().click(); await E.locator('.user-pop-links .profile').click(); await E.waitForTimeout(300);
  assert.equal(await E.locator('#f-pf-pw1').count(), 0, 'сотрудник пароль не меняет');
  await E.setInputFiles('#pf-photo', { name: 'men.png', mimeType: 'image/png', buffer: PNG }); await E.waitForTimeout(500);
  await E.fill('#f-pf-name', 'Dilnoza Karimova-Aliyeva');
  await E.getByRole('button', { name: 'Saqlash', exact: true }).click(); await E.waitForTimeout(300);
  await E.fill('#f-pf-login', 'dilnoza.k'); await E.fill('#f-pf-cur', 'parol-12345');
  await click(E, 'Kirish ma’lumotlarini saqlash', { wait: 800 });
  await shot(E, '13-profile');
  await E.keyboard.press('Escape');
  await settle(E);
  let me2 = srv.g.state().users.find(u => u.id === emp.id);
  assert.equal(me2.name, 'Dilnoza Karimova-Aliyeva'); assert.match(me2.avatar, /^data:image\/jpeg;base64,/); assert.equal(me2.login, 'dilnoza.k');
  assert.ok(srv.g.post({ action: 'login', login: 'dilnoza.k', password: 'parol-12345' }).ok, 'новый логин работает');
  await nav(A, 'staff');
  await A.locator('tr', { hasText: 'Dilnoza Karimova-Aliyeva' }).getByRole('button', { name: 'Tahrirlash' }).click(); await A.waitForTimeout(300);
  await A.selectOption('#f-ue-pos', 'Ombor mudiri'); await A.fill('#f-ue-pw', 'yangi-parol-77');
  await A.locator('.pf-modal').getByRole('button', { name: 'Saqlash' }).click();
  await settle(A);
  me2 = srv.g.state().users.find(u => u.id === emp.id);
  assert.equal(me2.position, 'Ombor mudiri'); assert.ok(!('password' in me2), 'пароль — не в данных');
  assert.ok(srv.g.post({ action: 'login', login: 'dilnoza.k', password: 'yangi-parol-77' }).ok, 'пароль от SOP-менеджера работает');
  step('профиль: сотрудник сменил фото, имя и логин; пароль задал SOP-менеджер');


  // ---------- сотрудники из Excel (CSV): заголовки по-русски, кириллица → логин латиницей, занятый логин — отказ ----------
  await nav(A, 'staff');
  const csv = '﻿ФИО;Должность;Отдел;Логин;Пароль\r\nШерзод Алиев;Omborchi;Ombor (Yiwu);;\r\nMalika Ergasheva;Mijozlar menejeri;Savdo bo‘limi;m.ergasheva;malika-123\r\nIkkinchi Dilnoza;Omborchi;;dilnoza.k;\r\n';
  await A.setInputFiles('#staff-import', { name: 'xodimlar.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  await A.waitForSelector('.imp-table');
  assert.equal(await A.locator('.imp-table tbody tr').count(), 3);
  assert.equal(await A.locator('.imp-table tr.imp-bad').count(), 1, 'занятый логин — отказ');
  await shot(A, '14-import');
  await click(A, 'Saqlash: 2 ta yangi, 0 ta yangilanadi', { wait: 400 });
  await settle(A);
  const sher = srv.g.state().users.find(u => u.name === 'Шерзод Алиев'), mal = srv.g.state().users.find(u => u.login === 'm.ergasheva');
  assert.ok(sher && sher.login === 's.aliev' && sher.department === 'Ombor (Yiwu)' && srv.g.props['cred:' + sher.id], 'логин из кириллицы, вход на сервере');
  assert.ok(mal && !('password' in mal) && srv.g.post({ action: 'login', login: 'm.ergasheva', password: 'malika-123' }).ok, 'пароль из файла работает');
  assert.ok(await A.locator('.imp-done').count(), 'можно скачать логины и пароли');
  assert.deepEqual(await rejected(A), [], 'сервер не отклонил импорт');
  step('сотрудники из Excel: 2 добавлены, занятый логин отклонён, логины из кириллицы');

  // ---------- Excel туда и обратно: скачать таблицу, поправить (как в Excel / Google Sheets), загрузить — по ID обновление ----------
  const [xdl] = await Promise.all([A.waitForEvent('download'), click(A, 'Excelga yuklab olish')]);
  assert.match(xdl.suggestedFilename(), /^buraq-xodimlar-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const xbuf = readFileSync(await xdl.path()), xf = unzip(xbuf);
  if (shots) writeFileSync(shots + '/15-xodimlar.xlsx', xbuf);
  assert.match(xf['xl/workbook.xml'].toString(), /name="Xodimlar".*name="Natijalar".*name="Rahbarlar"/, 'три листа');
  const xr = sheetRows(xf['xl/worksheets/sheet1.xml'].toString('utf8'));
  assert.deepEqual(xr[0].slice(0, 7), ['ID', 'F.I.Sh.', 'Login', 'Lavozim', 'Bo‘lim', 'Telefon', 'Telegram']);
  const nEmp = srv.g.state().users.filter(u => u.role === 'employee').length;
  assert.equal(xr.length, nEmp + 1, 'в листе — все сотрудники');
  const rowOf = id => xr.find(r => r[0] === String(id));
  assert.equal(rowOf(sher.id)[1], 'Шерзод Алиев');
  assert.equal(rowOf(emp.id)[6], srv.g.state().users.find(u => u.id === emp.id).profile.telegram, 'анкета — в таблице');
  assert.ok(sheetRows(xf['xl/worksheets/sheet2.xml'].toString('utf8')).some(r => r[0] === String(emp.id) && r[3] === 'O‘tdi'), 'итоги уроков — на листе «Natijalar»');
  rowOf(sher.id)[3] = 'Ombor mudiri'; rowOf(sher.id)[5] = '+998 90 111 22 33';
  rowOf(emp.id)[2] = 'm.ergasheva';                                  // чужой логин — отказ в этой строке
  xr.push(['', 'Bekzod Yusupov', '', 'Omborchi', 'Ombor (Yiwu)']);   // без ID — новый сотрудник
  const xs = sheetXml(xr);
  const xback = zip({ ...Object.fromEntries(Object.entries(xf).filter(([k]) => k !== 'xl/worksheets/sheet1.xml')), 'xl/worksheets/sheet1.xml': xs.sheet, 'xl/sharedStrings.xml': xs.shared });
  await A.setInputFiles('#staff-import', { name: 'buraq-xodimlar.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: xback });
  await A.waitForSelector('.imp-table');
  assert.equal(await A.locator('.imp-table tbody tr').count(), nEmp + 1);
  assert.equal(await A.locator('.imp-table tr.imp-bad').count(), 1, 'занятый логин — отказ');
  assert.ok(await A.locator('.imp-table tr', { hasText: 'Шерзод Алиев' }).filter({ hasText: '2 ta o‘zgarish' }).count(), 'видно, что изменится');
  await shot(A, '15-import-update');
  await click(A, 'Saqlash: 1 ta yangi, 1 ta yangilanadi', { wait: 400 });
  await settle(A);
  const sher2 = srv.g.state().users.find(u => u.id === sher.id), jas = srv.g.state().users.find(u => u.name === 'Bekzod Yusupov');
  assert.equal(sher2.position, 'Ombor mudiri'); assert.equal(sher2.profile.phone, '+998 90 111 22 33');
  assert.equal(sher2.login, 's.aliev', 'пустой пароль и тот же логин — вход как был');
  assert.equal(srv.g.state().users.find(u => u.id === emp.id).login, 'dilnoza.k', 'строка с отказом не применилась');
  assert.ok(jas && jas.department === 'Ombor (Yiwu)' && srv.g.props['cred:' + jas.id], 'новый — с входом');
  assert.equal(srv.g.state().users.filter(u => u.role === 'employee').length, nEmp + 1);
  assert.deepEqual(await rejected(A), [], 'сервер не отклонил обновление');
  step('Excel туда и обратно: таблица скачана, по ID обновлён 1, добавлен 1, занятый логин отклонён');

  // ---------- зарплата: CEO задаёт условия, сотрудник считает и сохраняет, CEO видит историю и подтверждает ----------
  await nav(C, 'pay');
  await C.getByRole('tab', { name: /Shartlar/ }).click(); await C.waitForTimeout(200);
  await click(C, 'Yangi shart');
  await C.fill('#f-pay-title', 'Ombor mudiri'); await C.fill('#f-pay-fixed', '4000000'); await C.fill('#f-pay-base', '2000000');
  await C.locator('.pay-editor .ac-chip', { hasText: /^Ombor mudiri$/ }).click();
  await C.fill('#f-pk-0-name', 'Shartnomalar'); await C.fill('#f-pk-0-unit', 'ta'); await C.fill('#f-pk-0-plan', '10'); await C.fill('#f-pk-0-w', '60');
  await C.fill('#f-pk-0-min', '50'); await C.fill('#f-pk-0-cap', '120');
  await click(C, '+ KPI qo‘shish');
  await C.fill('#f-pk-1-name', 'Kechikishlar'); await C.selectOption('#f-pk-1-src', 'att_late'); await C.fill('#f-pk-1-plan', '2'); await C.fill('#f-pk-1-w', '40');
  await C.locator('.pay-ed-kpi').nth(1).locator('label.check input').check();
  await click(C, '+ KPI qo‘shish');
  await C.fill('#f-pk-2-name', 'O‘qish soatlari'); await C.selectOption('#f-pk-2-src', 'study_h'); await C.selectOption('#f-pk-2-type', 'unit'); await C.fill('#f-pk-2-rate', '10000');
  assert.match(await C.innerText('.pay-editor'), /Vaznlar yig‘indisi: 100% ✓/);
  assert.match(await txt(C, '.pay-example'), /6 000 000 so‘m/, 'пример: все планы на 100 % — фикса + весь KPI-бонус');
  await shot(C, '18-pay-scheme');
  await C.locator('.pay-editor').getByRole('button', { name: 'Saqlash' }).click();
  await settle(C);
  const sch = srv.g.state().pay.schemes[0];
  assert.equal(sch.title, 'Ombor mudiri'); assert.equal(sch.kpis.length, 3); assert.equal(sch.kpis[1].less, true);
  // сотрудник: «Maosh» в меню, своя схема, факт — и итог считается сразу
  // пароль сотруднику сменил SOP-менеджер (шаг профиля): если вход на устройстве закрыт — входит заново
  const eTok = await E.evaluate(() => localStorage.getItem('lor-lms-token'));
  await E.reload({ waitUntil: 'networkidle' });
  if (!eTok || srv.g.post({ action: 'since', token: eTok, rev: 0 }).code === 'auth') { await E.waitForSelector('#f-login'); await signIn(E, 'dilnoza.k', 'yangi-parol-77'); }
  else await watchSync(E);
  await skipTour(E);
  await nav(E, 'pay');
  await E.locator('.pay-input input').first().fill('9');
  await E.waitForTimeout(700);
  assert.match(await txt(E, '.pay-kpis'), /\+1 080 000 so‘m/, '9 из 10 = 90 % × 60 % × 2 000 000');
  await E.fill('#f-pay-note', 'Oktyabr, 9 ta shartnoma');
  await shot(E, '19-pay-calc');
  await click(E, 'Hisobni saqlash', { wait: 300 });
  await settle(E);
  const pc = srv.g.state().payCalcs;
  assert.equal(pc.length, 1); assert.equal(pc[0].uid, emp.id); assert.equal(pc[0].lines[0].a, 1080000); assert.equal(pc[0].status, 'saved');
  assert.equal(pc[0].total, 4000000 + pc[0].kpi, 'итог — фикса + KPI'); assert.equal(pc[0].note, 'Oktyabr, 9 ta shartnoma');
  assert.ok(await E.locator('.pay-hist .pay-st', { hasText: 'Tekshiruvda' }).count(), 'в своей истории — «на проверке»');
  assert.deepEqual(await rejected(E), [], 'сервер принял расчёт');
  // посчитал и ушёл, не отправив: попытки всё равно в истории — «Yuborilmagan»
  await E.locator('.pay-input input').first().fill('12'); await E.waitForTimeout(1800);
  await E.locator('.pay-input input').first().fill('7'); await E.waitForTimeout(1800);
  await nav(E, 'home'); await settle(E);
  const dr = srv.g.state().payCalcs.find(c => c.status === 'draft');
  assert.ok(dr, 'несохранённый расчёт записан'); assert.deepEqual(dr.tries.map(y => y.inputs[sch.kpis[0].id]), [12, 7], 'обе попытки');
  assert.equal(dr.inputs[sch.kpis[0].id], 7, 'итог — последняя попытка');
  assert.deepEqual(await rejected(E), [], 'сервер принял несохранённый расчёт');
  // CEO: история — кто, когда, как посчитал; подтверждает с комментарием
  await C.reload({ waitUntil: 'networkidle' }); await watchSync(C);
  await nav(C, 'pay');
  assert.match(await txt(C, '.pay-who'), /Dilnoza Karimova-Aliyeva\s+Ombor mudiri\s+3\s+1\b/, 'кто сколько считал: 3 расчёта (9 — отправлен, 12 и 7 — нет), отправлен 1');
  assert.ok(await C.locator('.pay-tlrow', { hasText: 'Yuborilmagan' }).count(), 'несохранённый — в истории');
  await C.locator('.pay-tlrow', { hasText: 'Tekshiruvda' }).click(); await C.waitForTimeout(300);
  assert.match(await txt(C, '.pay-hbody'), /9 \/ 10 ta → 90% × 60% × 2 000 000 so‘m = 1 080 000 so‘m/, 'видно, как посчитано');
  await C.fill('#f-pay-rep', 'Hammasi to‘g‘ri');
  await shot(C, '20-pay-history');
  await C.locator('.pay-decide').getByRole('button', { name: 'Tasdiqlash' }).click();
  await settle(C);
  const sent = srv.g.state().payCalcs.find(c => c.id === pc[0].id);
  assert.equal(sent.status, 'approved'); assert.equal(sent.reply, 'Hammasi to‘g‘ri');
  assert.ok(srv.g.state().notifications.some(n => n.kind === 'pay' && n.userId === emp.id && n.pay.s === 'approved'), 'сотруднику — уведомление');
  await E.reload({ waitUntil: 'networkidle' }); await watchSync(E);
  await nav(E, 'pay');
  assert.ok(await E.locator('.pay-hist .pay-st', { hasText: 'Tasdiqlandi' }).count(), 'сотрудник видит «Tasdiqlandi»');
  assert.deepEqual(await rejected(C), [], 'сервер принял условия и решение');
  assert.deepEqual(await A.evaluate(() => [LmsClient.initial().payCalcs, LmsClient.initial().pay.schemes]), [[], []], 'SOP-менеджер зарплату не видит');
  step('зарплата: условия CEO, расчёт сотрудника с историей, проверка и подтверждение CEO; SOP-менеджер её не видит');

  // ---------- руководитель (владелец): вход создаёт CEO; видит всё и зарплату, ничего не меняет ----------
  await nav(C, 'staff');
  await C.selectOption('#f-ld-post', 'boss'); await C.fill('#f-ld-name', 'Kompaniya egasi'); await C.fill('#f-ld-login', 'egasi'); await C.fill('#f-ld-pw', 'egasi-parol-1');
  await click(C, 'Kirish yaratish'); await settle(C);
  const boss = srv.g.state().users.find(u => u.login === 'egasi');
  assert.ok(boss && boss.role === 'admin' && boss.post === 'boss', 'вход руководителя на сервере');
  const B = await device('руководитель');
  await signIn(B, 'egasi', 'egasi-parol-1'); await skipTour(B);
  assert.match(await txt(B, '.ro-bar'), /Ko‘rish rejimi/);
  await nav(B, 'pay');
  assert.ok(await B.locator('.pay-tlrow').count(), 'видит историю зарплат');
  await B.locator('.pay-tlrow').first().click(); await B.waitForTimeout(300);
  assert.equal(await B.locator('.pay-decide').count(), 0, 'подтверждать не может');
  await B.getByRole('tab', { name: /Shartlar/ }).click(); await B.waitForTimeout(200);
  assert.equal(await B.getByRole('button', { name: 'Yangi shart' }).count(), 0, 'условий не задаёт');
  await nav(B, 'staff');
  assert.equal(await B.locator('#f-n-name').count(), 0, 'сотрудников не создаёт');
  const st0 = srv.g.state().users.find(u => u.id === emp.id).status, rev0 = srv.g.state().rev;
  await B.locator('tr', { hasText: 'Dilnoza Karimova-Aliyeva' }).locator('select').last().selectOption(st0 === 'official' ? 'probation' : 'official');
  await B.waitForFunction(() => document.body.innerText.includes('Faqat ko‘rish'), null, { timeout: 5000 });
  await settle(B);
  assert.equal(srv.g.state().users.find(u => u.id === emp.id).status, st0, 'правка не ушла');
  assert.equal(srv.g.state().rev, rev0, 'на сервере ничего не изменилось');
  await shot(B, '22-owner');
  assert.deepEqual(await rejected(B), [], 'сервер ничего не отклонял — страница не отправляла');
  step('руководитель: вход от CEO; видит всё и зарплату, любая правка — «только просмотр»');

  // ---------- подсказки «Tugmalar bo‘yicha izohlar» у новых кнопок: зарплата, Excel, меню ----------
  await C.click('.help-btn'); await C.waitForTimeout(500); await C.locator('.hint-sw').first().click(); await settle(C);
  await A.click('.help-btn'); await A.waitForTimeout(500); await A.locator('.hint-sw').first().click(); await settle(A);
  // прокрутка закрывает подсказку — сначала прокрутить к кнопке, потом навести
  const hintOf = async (p, sel) => { await p.mouse.move(0, 0); await p.locator(sel).first().scrollIntoViewIfNeeded(); await p.waitForTimeout(300); await p.locator(sel).first().hover(); await p.waitForSelector('.hint-pop', { timeout: 3000 }); return txt(p, '.hint-pop'); };
  await nav(C, 'pay');
  assert.match(await hintOf(C, '.pay-who'), /Kim qancha hisobladi/);
  assert.match(await hintOf(C, '.pay-filters .lor-btn-secondary'), /Qo‘shimcha amal/, 'синяя кнопка — общая подсказка');
  assert.match(await hintOf(C, 'a[href="#pay"]:visible'), /Belgilangan maosh \+ KPI/);
  await nav(A, 'staff');
  assert.match(await hintOf(A, '.imp-act .lor-btn-secondary'), /Xodimlar, natijalar va rahbarlar/);
  assert.match(await hintOf(A, '.pp-ask'), /pasport fayli/);
  await shot(A, '21-hint');
  await A.click('.help-btn'); await A.waitForTimeout(500); await A.locator('.hint-sw').first().click(); await settle(A);
  await C.click('.help-btn'); await C.waitForTimeout(500); await C.locator('.hint-sw').first().click(); await settle(C);
  step('подсказки у новых кнопок: зарплата, Excel, скан паспорта, синие кнопки');

  // ---------- страница входа: маршрут, приветствие, «Kun hikmati»; свои цитаты SOP-менеджера — из «Kontent» ----------
  const R = await device('вход по-русски');
  assert.match(await R.innerText('.ir-pt.is-from'), /^(YIWU|ZHONGSHAN|ISTANBUL|MOSKVA)$/, 'маршрут — из списка городов');
  assert.match(await R.innerText('.hello'), /^Xayrli (tong|kun|kech)!$/);
  await R.waitForSelector('.wz blockquote');
  assert.equal(await R.locator('.wz-tr').count(), 0, 'по-узбекски — без перевода');
  await R.getByRole('button', { name: 'RU', exact: true }).first().click(); await R.waitForTimeout(300);
  assert.ok((await R.innerText('.wz-tr')).length > 5, 'по-русски под пословицей — её смысл');
  assert.match(await R.innerText('.hello'), /^(Доброе утро|Добрый день|Добрый вечер)!$/);
  await R.click('.wz-next'); await R.waitForTimeout(300);
  assert.ok(await R.locator('.wz blockquote').count(), 'стрелка — следующая');
  await R.context().close();
  await nav(A, 'cms');
  await A.getByRole('tab', { name: /Kun hikmati/ }).click(); await A.waitForTimeout(300);
  await A.fill('#f-wz-text', 'Birgalikda har qanday yukni yetkazamiz.'); await A.fill('#f-wz-by', 'Kompaniya rahbari');
  await click(A, 'Hikmat qo‘shish');
  await A.locator('.wz-admin label.check input').uncheck(); await settle(A);
  await shot(A, '16-wisdom-admin');
  const wz = srv.g.state().settings.wisdom;
  assert.equal(wz.std, false); assert.equal(wz.list[0].text, 'Birgalikda har qanday yukni yetkazamiz.');
  const W = await device('вход: своя цитата');
  await W.waitForSelector('.wz blockquote');
  assert.equal(await W.innerText('.wz blockquote'), 'Birgalikda har qanday yukni yetkazamiz.', 'без стандартных — только своя');
  assert.equal(await W.innerText('.wz figcaption'), 'Kompaniya rahbari');
  assert.equal(await W.locator('.wz-next').count(), 0, 'одна цитата — без стрелки');
  await W.waitForTimeout(5200); await shot(W, '17-login-intro');
  await W.context().close();
  assert.deepEqual(await rejected(A), [], 'сервер принял «Kun hikmati»');
  step('страница входа: маршрут, приветствие, «Kun hikmati» с переводом; своя цитата SOP-менеджера видна до входа');

  // ---------- раздел курса из файла (.json): встаёт по номеру главы, попадает в программы, лишние теги и ответы — нет ----------
  // в репозитории — выдуманный раздел; настоящие главы стандартов загружаются только на сервер
  const chap = (sec, tracks) => ({ name: 'bob.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ app: 'buraq-lms-chapter', v: 1, tracks, section: sec })) });
  const b2 = { id: 'b2', title: '2-bob. Test bo‘limi', lessons: [
    { id: 'b2-1', title: '2.1. Test darsi', html: '<h3>Maqsad</h3><p onclick="x()">Matn</p><script>alert(1)</script><div class="ilova"><b>ILOVA-2.1</b><span>Menyu</span></div>', quiz: [{ q: 'Savol?', options: ['A', 'B', 'C'], answer: 2 }, { q: 'Yomon', options: ['A'], answer: 0 }] },
    { id: 'b2-2', title: '2.2. Ikkinchi dars', html: '<p>Matn 2</p>', quiz: [] }] };
  await nav(A, 'cms'); await A.locator('main .lor-tabs [role="tab"]').first().click(); await A.waitForTimeout(300);   // вкладка уроков
  const upload = async (file, opts = {}) => {
    await A.setInputFiles('#cms-import', file); await A.waitForSelector('.imp-dlg');
    if (opts.check) await opts.check();
    await A.locator('.imp-dlg').getByRole('button', { name: 'Yuklash' }).click(); await settle(A);
  };
  await upload(chap(b2, ['tr_mgr']), { check: async () => {
    assert.match(await txt(A, '.imp-dlg'), /2-bob\. Test bo‘limi\s+2 ta dars · 1 ta test savoli/);
    assert.ok(await A.locator('.imp-dlg input[name="imp-where"]').first().isChecked(), 'новый раздел — по умолчанию');
    assert.ok(await A.locator('.imp-dlg .ac-chip.is-on', { hasText: 'Logistika menejeri' }).count(), 'должности программы из файла отмечены');
    await shot(A, '23-import-dialog');
  } });
  let secs = srv.g.state().course.sections;
  const bi = secs.findIndex(x => x.id === 'b2');
  assert.ok(bi >= 0 && bi < secs.findIndex(x => x.id === 's2'), '2-bob — перед 4-bob');
  assert.equal(secs[bi].lessons[0].html.includes('script') || secs[bi].lessons[0].html.includes('onclick'), false, 'лишнее из HTML убрано');
  assert.ok(secs[bi].lessons[0].html.includes('class="ilova"'));
  assert.deepEqual(secs[bi].lessons[0].quiz, [{ q: 'Savol?', options: ['A', 'B', 'C'], answer: 2 }], 'неверный вопрос отброшен');
  assert.deepEqual(secs[bi].aud, { positions: ['Mijozlar menejeri', 'Logistika menejeri'], depts: [], users: [] }, 'глава — должностям программы из файла');
  assert.match(await txt(A, 'body'), /«2-bob\. Test bo‘limi» yuklandi: 2 ta dars, 1 ta test savoli · Mijozlar menejeri, Logistika menejeri/);
  await E.evaluate(() => LmsClient.sync()); await E.waitForTimeout(400);
  const eq = await E.evaluate(() => (LmsClient.initial().course.sections.find(x => x.id === 'b2') || { lessons: [{ quiz: [] }] }).lessons[0].quiz);
  assert.ok(eq.every(q => q.answer === undefined), 'сотруднику ответы теста не приходят');
  // тот же раздел ещё раз — по умолчанию «заменить», на том же месте
  await upload(chap(Object.assign({}, b2, { title: '2-bob. Yangi nom' }), 'all'), { check: async () => {
    assert.ok(await A.locator('.imp-dlg input[name="imp-where"]').nth(1).isChecked(), 'такой раздел есть — «заменить»');
    assert.ok(await A.locator('.imp-dlg input[name="imp-where"]').first().isDisabled());
  } });
  secs = srv.g.state().course.sections;
  assert.equal(secs.filter(x => x.id === 'b2').length, 1); assert.equal(secs.findIndex(x => x.id === 'b2'), bi);
  assert.equal(secs[bi].title, '2-bob. Yangi nom');
  // номера уроков из чужого раздела — отказ, окно остаётся
  const rev1 = srv.g.state().rev;
  await A.setInputFiles('#cms-import', chap({ id: 'bx', title: '3-bob. X', lessons: [{ id: 'b4-1', title: 'X', html: '<p>x</p>' }] }, 'all'));
  await A.waitForSelector('.imp-dlg'); await A.locator('.imp-dlg').getByRole('button', { name: 'Yuklash' }).click();
  await A.waitForFunction(() => document.body.innerText.includes('boshqa bobda band'), null, { timeout: 5000 });
  await A.locator('.imp-dlg').getByRole('button', { name: 'Bekor qilish' }).click(); await settle(A);
  assert.equal(srv.g.state().rev, rev1, 'при совпадении номеров уроков ничего не меняется');
  // «Kimlar o‘qiydi» у главы: только выбранный по имени сотрудник — остальным сервер главу не отдаёт
  await A.locator('.cms-aud').nth(bi).click(); await A.waitForSelector('.aud-modal');
  for (const x of ['Mijozlar menejeri', 'Logistika menejeri']) await A.locator('.aud-modal .ac-chip.is-on', { hasText: x }).click();
  assert.match(await txt(A, '.aud-modal .aud-sum'), /Kimlar o‘qishini tanlang/, 'никого не выбрано — подсказка');
  await A.fill('#aud-sec-q', 'Dilnoza'); await A.locator('.aud-modal .aud-users input').first().check();
  await shot(A, '24-audience');
  await A.locator('.aud-modal').getByRole('button', { name: 'Saqlash' }).click(); await settle(A);
  const b2s = srv.g.state().course.sections.find(x => x.id === 'b2');
  assert.deepEqual(b2s.aud, { positions: [], depts: [], users: [emp.id] });
  assert.match(await txt(A, '.cms-tree'), /Kimlar o‘qiydi:\s*1 ta xodim/);
  const other = srv.g.state().users.find(u => u.role === 'employee' && u.id !== emp.id);
  assert.equal(srv.g.ctx.viewFor_(srv.g.ctx.readState_(), other).course.sections.some(x => x.id === 'b2'), false, 'другому сотруднику раздел не уходит');
  await E.evaluate(() => LmsClient.sync()); await E.waitForTimeout(500);
  assert.ok(await E.evaluate(() => LmsClient.initial().course.sections.some(x => x.id === 'b2')), 'выбранный сотрудник раздел видит');
  // глава из Word (.docx): уроки — после строки «3-BOB …», заголовок можно присоединить к прошлому уроку; кто — по отделу
  const xq = s => s.replace(/'/g, '&apos;');
  const para = (txt, o = {}) => '<w:p><w:pPr>' + (o.h ? '<w:pStyle w:val="Heading1"/>' : '') + (o.num ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="' + o.num + '"/></w:numPr>' : '') + '</w:pPr>' + txt + '</w:p>';
  const run = (x, b) => '<w:r>' + (b ? '<w:rPr><w:b/></w:rPr>' : '') + '<w:t xml:space="preserve">' + xq(x) + '</w:t></w:r>';
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const docx = zip({
    'word/styles.xml': '<?xml version="1.0"?><w:styles ' + NS + '><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>',
    'word/numbering.xml': '<?xml version="1.0"?><w:numbering ' + NS + '><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>',
    'word/document.xml': '<?xml version="1.0"?><w:document ' + NS + '><w:body>' + [
      para(run('Maxfiylik ogohlantirishi'), { h: 1, num: 1 }), para(run('3-BOB. SINOV STANDARTLARI'), { h: 1 }),
      para(run('SINOV DARSI BIR'), { h: 1, num: 1 }), para(run('Maqsad:', true) + run(" o'quv matni")),
      para(run('Birinchi band'), { num: 2 }), para(run('Ikkinchi band'), { num: 2 }),
      '<w:tbl><w:tr><w:tc>' + para(run('Vaziyat')) + '</w:tc><w:tc>' + para(run('Amal')) + '</w:tc></w:tr></w:tbl>', para(run('ILOVA-3.1. Namuna')),
      para(run('SINOV DARSI IKKI'), { h: 1, num: 1 }), para(run('Ikkinchi dars matni')),
      para(run("QO'SHIMCHA SKRIPT"), { h: 1, num: 1 }), para(run('Skript matni'))].join('') + '</w:body></w:document>' });
  const dep = srv.g.state().users.find(u => u.id === emp.id).department;
  await A.setInputFiles('#cms-import', { name: '3-bob.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docx });
  await A.waitForSelector('.imp-dlg');
  assert.match(await txt(A, '.imp-dlg .imp-sum'), /3-bob\. Sinov standartlari\s+3 ta dars · 0 ta test savoli · testlar keyin qo‘shiladi/);
  await A.locator('.imp-dlg .imp-lessons input').nth(1).uncheck();
  assert.match(await txt(A, '.imp-dlg .imp-sum'), /2 ta dars/, '«Qo‘shimcha skript» — в предыдущий урок');
  await A.locator('.imp-dlg .aud > .aud-mode input').uncheck();
  await A.locator('.imp-dlg .ac-chip', { hasText: dep }).click();
  await shot(A, '25-word-import');
  await A.locator('.imp-dlg').getByRole('button', { name: 'Yuklash' }).click(); await settle(A);
  const b3 = srv.g.state().course.sections.find(x => x.id === 'b3');
  assert.ok(b3, 'глава из Word на сервере'); assert.equal(b3.title, '3-bob. Sinov standartlari');
  assert.deepEqual(b3.lessons.map(l => l.id + ' ' + l.title), ['b3-1 3.1. Sinov darsi bir', 'b3-2 3.2. Sinov darsi ikki']);
  const h1 = b3.lessons[0].html, h2 = b3.lessons[1].html;
  assert.ok(h1.includes('<strong>Maqsad:</strong> o‘quv matni') && h1.includes('<ul><li>Birinchi band</li><li>Ikkinchi band</li></ul>') && h1.includes('<table>') && h1.includes('class="ilova"'), h1);
  assert.ok(h2.includes('<h3>QO‘SHIMCHA SKRIPT</h3>') && h2.includes('Skript matni'), h2);
  assert.ok(!JSON.stringify(b3).includes('Maxfiylik'), 'то, что до строки «3-BOB», в уроки не попало');
  assert.deepEqual(b3.aud, { positions: [], depts: [dep], users: [] });
  const ss = srv.g.state().course.sections.map(x => x.id);
  assert.ok(ss.indexOf('b2') < ss.indexOf('b3') && ss.indexOf('b3') < ss.indexOf('s2'), '3-bob — между 2-bob и 4-bob');
  const odd = srv.g.state().users.find(u => u.role === 'employee' && u.department !== dep);
  if (odd) assert.equal(srv.g.ctx.viewFor_(srv.g.ctx.readState_(), odd).course.sections.some(x => x.id === 'b3'), false, 'другой отдел главу не получает');
  // пустую главу («+ Yangi bob») можно удалить; главу с уроками — нет
  const nSec = srv.g.state().course.sections.length;
  await A.getByRole('button', { name: '+ Yangi bob' }).click(); await settle(A);
  assert.equal(srv.g.state().course.sections.length, nSec + 1);
  assert.equal(await A.locator('.cms-sec-del').count(), 1, 'кнопка — только у пустого раздела');
  await A.locator('.cms-sec-del').click(); await settle(A);
  assert.equal(srv.g.state().course.sections.length, nSec);
  assert.deepEqual(await rejected(A), [], 'сервер принял раздел и назначение');
  step('главы: файл .json и Word (.docx) — окно «Qayerga / Kimlar o‘qiydi», порядок по номеру, замена на месте, отказ при чужих номерах; кто — по должности, отделу, имени');

  // ---------- обновление страницы: открывается тот же раздел, а не стартовый ----------
  await nav(A, 'staff');
  assert.equal(new URL(A.url()).hash, '#staff', 'раздел — в адресе');
  await A.reload({ waitUntil: 'networkidle' }); await A.waitForSelector('a[href="#staff"].is-on:visible', { timeout: 10000 });
  assert.ok(await A.locator('#f-n-name').count(), 'после обновления — снова «Xodimlar»');
  await nav(E, 'path'); await E.reload({ waitUntil: 'networkidle' }); await E.waitForSelector('a[href="#path"].is-on:visible', { timeout: 10000 });
  await E.getByText('4.1. Test standarti').first().click(); await E.waitForTimeout(600);
  assert.match(new URL(E.url()).hash, /^#lesson\?id=b4-1$/);
  await E.reload({ waitUntil: 'networkidle' }); await E.waitForTimeout(800);
  assert.match(new URL(E.url()).hash, /^#lesson\?id=b4-1$/, 'урок — тот же после обновления');
  assert.ok((await E.innerText('main')).includes('4.1. Test standarti'));
  await E.evaluate(() => { location.hash = '#path'; }); await E.waitForSelector('a[href="#path"].is-on:visible', { timeout: 5000 });
  await E.evaluate(() => { location.hash = '#cms'; }); await E.waitForTimeout(400);
  assert.equal(new URL(E.url()).hash, '#path', 'адрес из чужого кабинета в той же вкладке — остаётся текущий раздел');
  await E.evaluate(() => history.replaceState(null, '', '#cms')); await E.reload({ waitUntil: 'networkidle' }); await E.waitForTimeout(600);
  assert.equal(new URL(E.url()).hash, '#home', 'чужой раздел (кабинет SOP-менеджера) после обновления — стартовая страница');
  step('обновление страницы: тот же раздел и тот же урок; чужой адрес — стартовая страница');

  // ---------- «Tanishuv»: SOP-менеджер меняет приветствие и обязательное знакомство (текст + видео); сотрудник подтверждает ----------
  await nav(A, 'cms'); await A.locator('.lor-tab').filter({ hasText: 'Tanishuv' }).click(); await A.waitForTimeout(300);
  await A.fill('#f-in-g-title', 'Xush kelibsiz!');
  await A.fill('#f-in-i-text', 'Kompaniya haqida matn.\n\nIkkinchi xatboshi.');
  await A.fill('#f-in-v-src', 'https://youtu.be/dQw4w9WgXcQ');
  // документы: PDF и Word (тот же .docx, что выше) — выбором файла; чужой формат — отказ с подсказкой
  const inPdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'.padEnd(3000, ' '));
  await A.setInputFiles('#in-doc-input', { name: 'rasm.png', mimeType: 'image/png', buffer: Buffer.from('x') });
  await A.locator('.in-docs-edit .lor-field-error').waitFor({ timeout: 3000 });
  await A.setInputFiles('#in-doc-input', [{ name: 'Kompaniya qoidalari.pdf', mimeType: 'application/pdf', buffer: inPdf }, { name: 'Ichki tartib.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docx }]);
  await A.waitForFunction(() => document.querySelectorAll('.in-dl-item').length === 2, null, { timeout: 5000 });
  assert.equal(await A.locator('.in-dl-st.is-new').count(), 2, 'до сохранения — «Saqlanmagan»');
  await A.locator('.in-dl-item').nth(1).locator('.in-dl-mv').first().click();   // Word — первым
  assert.equal(await A.locator('.in-dl-item').nth(1).locator('.in-dl-title').inputValue(), 'Kompaniya qoidalari', 'название — из имени файла');
  await A.locator('.in-dl-item').nth(1).locator('.in-dl-title').fill('Kompaniya qoidalari (2026)');
  await A.locator('.in-dl-item').nth(0).locator('.in-dl-video').fill('https://youtu.be/abc123XYZ00');
  await A.locator('.in-admin .in-actions .lor-btn-primary').click(); await settle(A); await A.waitForTimeout(800);
  { const w = srv.g.state().settings.welcome;
    assert.equal(w.title, 'Xush kelibsiz!');
    assert.ok(w.at && w.video && /youtu/.test(w.video.src) && /Ikkinchi/.test(w.introText), 'приветствие, знакомство и видео — на сервере');
    assert.deepEqual(w.docs.map(d => d.name), ['Ichki tartib.docx', 'Kompaniya qoidalari.pdf'], 'документы — на сервере, в выбранном порядке');
    assert.ok(w.docs.every(d => /^lmsfile:/.test(d.data)), 'сами файлы — на Диске, в данных только ссылки');
    assert.equal(w.docs[1].title, 'Kompaniya qoidalari (2026)', 'своё название документа');
    assert.equal(w.docs[0].video.src, 'https://youtu.be/abc123XYZ00', 'у Word — своё видео'); }
  await A.waitForFunction(() => document.querySelectorAll('.in-dl-st.is-ok').length === 2, null, { timeout: 8000 });
  await A.locator('.in-drop').scrollIntoViewIfNeeded(); await shot(A, 'tanishuv-hujjatlar');
  await A.locator('.lor-tab').filter({ hasText: 'Darslar' }).click();
  await E.reload({ waitUntil: 'networkidle' }); await watchSync(E); await E.waitForTimeout(1500);
  // с документами знакомство — на весь экран (документ слева, его видео справа); открывается само при входе,
  // а если страница ещё взяла данные из копии на устройстве — из меню пользователя
  if (!(await E.locator('.ir').count())) { await E.locator('.user-btn').first().click(); await E.locator('.user-pop-links button.intro').click(); }
  await E.locator('.ir').waitFor({ timeout: 5000 });
  assert.ok(await E.locator('.ir-actions button:has-text("Tasdiqlash")').isDisabled(), 'без галочки подтвердить нельзя');
  assert.equal(await E.locator('.ir-tab').count(), 2, 'два документа — две вкладки');
  await E.locator('.ir .dv-doc').waitFor({ timeout: 8000 });
  assert.match(await E.locator('.ir .dv-doc').innerText(), /Birinchi band/, 'Word — сразу на экране, во всю высоту');
  assert.ok(await E.locator('.ir-side iframe[src*="abc123XYZ00"]').count(), 'справа — видео этого документа');
  assert.ok(await E.locator('#in-seen').isDisabled(), 'открыт один документ из двух — галочку не поставить');
  await E.waitForTimeout(400); await shot(E, 'tanishuv-ekran');
  // окна скрываются: «Video» — только документ, «Hujjat» — меняются местами (оба скрыть нельзя), ещё раз — оба
  await E.locator('.ir-lay').nth(1).click();
  assert.deepEqual([await E.locator('.ir-doc').count(), await E.locator('.ir-side').count()], [1, 0], 'видео скрыто — документ на весь экран');
  await E.locator('.ir-lay').nth(0).click();
  assert.deepEqual([await E.locator('.ir-doc').count(), await E.locator('.ir-side').count()], [0, 1], 'теперь только видео');
  await E.locator('.ir-lay').nth(0).click();
  assert.deepEqual([await E.locator('.ir-doc').count(), await E.locator('.ir-side').count()], [1, 1], 'снова оба окна');
  await E.locator('.ir-tab').nth(1).click();
  // PDF: встроенный просмотр, а где браузер не умеет (headless, Android) — кнопка «Hujjatni ochish» с тем же файлом
  await E.locator('.ir iframe.dv-pdf[src^="blob:"], .ir a.dv-open[href^="blob:"]').waitFor({ timeout: 8000 });
  assert.ok(await E.locator('.ir-side iframe[src*="dQw4w9WgXcQ"]').count(), 'у PDF своего видео нет — справа общее видео знакомства');
  if (await E.locator('.ir a.dv-open').count()) { const [tab] = await Promise.all([E.context().waitForEvent('page'), E.locator('.ir a.dv-open').click()]); await tab.close(); }
  assert.equal(await E.locator('.ir-tab.is-seen').count(), 2, 'оба документа отмечены открытыми');
  await E.check('#in-seen'); await E.locator('.ir-actions button:has-text("Tasdiqlash")').click(); await settle(E);
  assert.ok(srv.g.state().users.find(u => u.id === emp.id).introSeenAt, 'знакомство подтверждено — на сервере');
  assert.equal(await E.locator('.ir').count(), 0, 'экран знакомства закрылся');
  step('«Tanishuv»: SOP-менеджер задал приветствие и обязательное знакомство (текст, PDF и Word, видео), на весь экран: документ слева, его видео справа; сотрудник открыл документы и подтвердил');

  // ---------- «Savolnoma»: SOP-менеджер добавляет вопросы списком (варианты, раздел, оценка); сотрудник заполняет; ответы видит SOP ----------
  await nav(A, 'cms'); await A.locator('.lor-tab').filter({ hasText: 'Savolnoma' }).click(); await A.waitForTimeout(300);
  await A.locator('.qn-edit:not(.qn-scales) .qn-imp button').click();
  await A.fill('#f-qn-paste', '1. Nega aynan BURAQ Logistics’ni tanladingiz?\n2. Qaysi ish formati sizga qulay?\n- Ofisda\n- Masofadan\n# Tajriba\n3. Logistikadagi tajribangizni baholang');
  await A.locator('.qn-paste-act .lor-btn-primary').click();
  assert.equal(await A.locator('.qn-item').count(), 4, 'три вопроса и раздел');
  await A.locator('.qn-item').nth(3).locator('select.qn-type-sel').selectOption('scale');
  // шкалы: шаблон темперамента (экстраверсия, нейротизм, искренность); вопрос 2 → экстраверсия (Ofisda = 1), оценка → нейротизм
  await A.locator('.qn-scales .qn-imp button').first().click();
  assert.equal(await A.locator('.qn-sc-card').count(), 3, 'шаблон — три шкалы');
  await A.locator('.qn-item').nth(1).locator('select.qn-scale-sel').selectOption({ label: 'Shkala: Ekstraversiya' });
  await A.locator('.qn-item').nth(1).locator('input.qn-pts').first().fill('1');
  await A.locator('.qn-item').nth(3).locator('select.qn-scale-sel').selectOption({ label: 'Shkala: Neyrotizm (emotsional beqarorlik)' });
  await A.locator('.qn-admin .in-actions .lor-btn-primary').click(); await settle(A);
  { const q = srv.g.state().settings.questionnaire;
    assert.deepEqual(q.questions.map(x => x.type), ['long', 'one', 'section', 'scale']);
    assert.deepEqual(q.questions[1].options, ['Ofisda', 'Masofadan'], 'строки «- …» — варианты');
    assert.equal(q.scales.length, 3); assert.ok(q.temper && q.temper.e === q.scales[0].id && q.temper.n === q.scales[1].id, 'темперамент — по экстраверсии и нейротизму');
    assert.deepEqual([q.questions[1].scale, q.questions[1].pts, q.questions[3].scale], [q.scales[0].id, [1, 0], q.scales[1].id], 'баллы вариантов — в вопросе'); }
  await A.locator('.qn-item').first().scrollIntoViewIfNeeded(); await shot(A, 'savolnoma-kontent');
  await A.locator('.lor-tab').filter({ hasText: 'Darslar' }).click();
  await E.reload({ waitUntil: 'networkidle' }); await watchSync(E); await E.waitForTimeout(1500);
  if (!(await E.locator('.qn-modal').count())) { await E.locator('.user-btn').first().click(); await E.locator('.user-pop-links button.qn').click(); }
  await E.locator('.qn-modal').waitFor({ timeout: 5000 });
  // сначала — согласия: ничего не отмечено заранее; скрытых ([maxfiy]) вопросов нет — две галочки; без первой дальше не пустит
  assert.equal(await E.locator('.qn-modal.qn-cons-step').count(), 1, 'перед анкетой — шаг согласий');
  assert.equal(await E.locator('.qn-cons-opt').count(), 2, 'обработка и ИИ-анализ; особых данных в анкете нет — без третьей');
  assert.equal(await E.locator('.qn-cons-opt input:checked').count(), 0, 'ничего не отмечено заранее');
  assert.match(await E.locator('.qn-cons-opt[data-c="ai"]').innerText(), /Anthropic \(AQSH\)/, 'в согласии на ИИ — кому и куда уходят ответы');
  await E.locator('.qn-cons-go').click();
  assert.equal(await E.locator('.qn-cons-opt.is-err').count(), 1, 'без обязательной галочки дальше не пустит');
  assert.equal(await E.locator('.qn-field.is-long').count(), 0, '…и вопросов не видно');
  await E.locator('.qn-cons-opt[data-c="base"] .qn-consent-l').click();
  await E.locator('.qn-cons-opt[data-c="ai"] .qn-consent-l').click();
  await shot(E, 'savolnoma-rozilik');
  await E.locator('.qn-cons-go').click(); await E.waitForTimeout(300);
  assert.equal(await E.locator('.qn-cons-step').count(), 0, 'дальше — сама анкета');
  await settle(E);
  { const c = srv.g.state().users.find(u => u.id === emp.id).qa.consent;
    assert.ok(c && c.v === 1 && c.base === true && c.ai === true && c.special === false && c.at > 0, 'согласие — на сервере, с версией и временем'); }
  await E.locator('.qn-modal .lor-modal-actions .lor-btn-primary').click();
  assert.equal(await E.locator('.qn-field.is-err').count(), 3, 'без ответов не отправить — три вопроса подсвечены');
  await E.locator('.qn-field').nth(0).locator('textarea').fill('Kompaniya rivojlanmoqda. Tel: +998 90 123 45 67');
  await E.locator('.qn-field').nth(1).locator('.qn-tile').filter({ hasText: 'Masofadan' }).click();
  await E.locator('.qn-field').nth(2).locator('.qn-sc').nth(3).click();
  await shot(E, 'savolnoma-xodim');
  await E.locator('.qn-modal .lor-modal-actions .lor-btn-primary').click(); await settle(E);
  { const qa = srv.g.state().users.find(u => u.id === emp.id).qa, qs = srv.g.state().settings.questionnaire.questions;
    assert.ok(qa && qa.at, 'анкета отправлена — на сервере');
    assert.equal(qa.consent && qa.consent.ai, true, 'согласие при отправке не потерялось');
    assert.deepEqual([qa.answers[qs[0].id], qa.answers[qs[1].id], qa.answers[qs[3].id]], ['Kompaniya rivojlanmoqda. Tel: +998 90 123 45 67', 'Masofadan', 4]); }
  assert.equal(await E.locator('.qn-modal').count(), 0, 'окно закрылось');
  assert.equal(await E.locator('.qn-banner').count(), 0, 'напоминания больше нет');
  await A.reload({ waitUntil: 'networkidle' }); await watchSync(A);
  await nav(A, 'cms'); await A.locator('.lor-tab').filter({ hasText: 'Savolnoma' }).click(); await A.waitForTimeout(300);
  // «Natijalar»: Masofadan → экстраверсия 0, оценка 4 → нейротизм 4: оба далеко ниже средней точки (12) — склонность
  // «флегматический стиль» (словами склонности, не «он — флегматик»)
  assert.equal(await A.locator('.qn-tm-cell.is-phlegmatic b').innerText(), '1', 'в коллективе — у одного ведущая склонность «flegmatik»');
  assert.match(await A.locator('.qn-person').first().innerText(), /Yetakchi moyillik[\s\S]*ko‘proq flegmatik uslubi/);
  assert.equal(await A.locator('.qn-tm-chip').count(), 0, 'цветных ярлыков темперамента нет');
  await shot(A, 'savolnoma-natijalar');
  await A.locator('.qn-person').first().click();
  const qnCard = await A.locator('.qn-ans').innerText();
  assert.ok(/Masofadan/.test(qnCard) && /ko‘proq flegmatik uslubi/.test(qnCard), 'SOP-менеджер видит ответы и склонность');
  assert.match(qnCard, /O‘z-o‘zini baholash so‘rovnomasi\. Moyilliklarni ko‘rsatadi/, 'под результатом — постоянная оговорка');
  // вывод ИИ готовится сам, когда карточку открыли (кнопку нажимать не нужно): подпись «AI qoralamasi», у пунктов — основание,
  // пункт без основания отброшен, вместо «соответствия должности» — что проверить на собеседовании или в работе
  const sopId = srv.g.state().users.find(u => u.login === srv.admin.login).id;
  const lastPrompt = re => { const c = aiCalls.filter(x => re.test(x.messages.slice(-1)[0].content)).pop(); return c ? c.messages.slice(-1)[0].content : ''; };
  await A.locator('.qn-ans .qn-ai-body').waitFor({ timeout: 8000 });
  { const tx = await A.locator('.qn-ans .qn-ai-body').innerText();
    assert.match(tx, /Puxta, barqaror xodim/, 'вывод ИИ — в карточке, сам');
    assert.match(tx, /AI qoralamasi: o‘z-o‘zini baholash javoblari asosida, xato bo‘lishi mumkin/, 'подпись «AI qoralamasi»');
    assert.match(tx, /Barqarorlik[\s\S]*Asos: Neyrotizm: 4,0 \/ 5/, 'у пункта — основание');
    assert.ok(!/Hammaga yoqadi/.test(tx), 'пункт без основания отброшен');
    assert.match(tx, /Suhbatda yoki ishda nimani tekshirish kerak[\s\S]*Tig‘iz kunlarda/, '«что проверить» вместо «соответствия должности»');
    assert.match(tx, /Tayyorlagan: .+ · so‘rov v2/, 'кто готовил и версия запроса'); }
  await settle(A);
  { const rep = srv.g.state().users.find(u => u.id === emp.id).qaReport, pr = lastPrompt(/HR-psixolog/);
    assert.equal(rep.data.roles, 'Hujjatlar bilan ishlash', 'вывод ИИ — на сервере');
    assert.deepEqual([rep.v, rep.by, rep.auto, rep.data.dropped, 'fit' in rep.data], [2, sopId, true, 1, false], 'версия запроса (QN_AI_V), кто готовил, сам; отброшен 1 пункт');
    assert.ok(/Kompaniya rivojlanmoqda\. Tel: \[telefon\]/.test(pr) && !/123 45 67|Dilnoza/.test(pr), 'в ИИ — без имени и телефона');
    assert.ok(/TEST \(o‘z-o‘zini baholash/.test(pr) && !/taxmin qiling/.test(pr.replace(/taxmin qilmang/g, '')), 'ИИ пересказывает посчитанное, не угадывает'); }
  assert.equal(await E.evaluate(id => LmsClient.sync().then(() => (LmsClient.initial().users.find(u => u.id === id) || {}).qaReport), emp.id).catch(() => undefined), undefined, 'сотрудник вывода не видит');
  await A.waitForTimeout(450); await shot(A, 'savolnoma-javoblar');
  // «Rad etish»: текст вывода удаляется, остаётся отметка (кто и когда); после обновления страницы сам заново не готовится
  A.once('dialog', d => d.accept());
  await A.locator('.qn-ans .qn-ai-off').click(); await settle(A);
  { const rep = srv.g.state().users.find(u => u.id === emp.id).qaReport;
    assert.ok(rep && !rep.data && rep.off && rep.offBy === sopId && rep.by === sopId && rep.v === 2, 'отклонён: текста нет, отметка есть'); }
  assert.match(await A.locator('.qn-ans .qn-ai').innerText(), /AI xulosasini .+ rad etgan/, 'в карточке — кто отклонил');
  await A.locator('.qn-ans .lor-modal-x').click();
  await A.reload({ waitUntil: 'networkidle' }); await watchSync(A);
  await nav(A, 'cms'); await A.locator('.lor-tab').filter({ hasText: 'Savolnoma' }).click(); await A.waitForTimeout(300);
  { const n0 = aiCalls.length;
    await A.locator('.qn-person').first().click(); await A.locator('.qn-ans .qn-ai').waitFor({ timeout: 5000 }); await A.waitForTimeout(1200);
    assert.equal(aiCalls.length, n0, 'отклонённый вывод сам не готовится заново'); }
  await A.locator('.qn-ans .lor-modal-x').click();
  // анализ коллектива ИИ — от 5 ответивших с согласием на ИИ: пока ответил один — подсказка, кнопка выключена
  assert.match(await A.locator('.qn-team-ai').innerText(), /kamida 5 kishi/, 'меньше 5 — подсказка');
  assert.ok(await A.locator('.qn-team-ai .qn-team-go').isDisabled(), '…и анализ не запустить');
  // ещё шестеро ответили (сервером, от SOP-менеджера): у пятого нет согласия на ИИ, шестой — до шага согласий
  // («rozilik so‘ralmagan»); оба в анализ не идут
  const extra = [1, 2, 3, 4, 5, 6].map(i => emp.id + 500 + i), sopTk = () => srv.g.post({ action: 'login', login: srv.admin.login, password: srv.admin.password }).token;
  { const qs = srv.g.state().settings.questionnaire.questions, at0 = srv.g.state().users.find(u => u.id === emp.id).qa.at;
    const ops = extra.map((id, i) => ({ op: 'set', path: ['users', { id }], value: { id, role: 'employee', login: 'qn.x' + i, password: 'xodim-12345', name: 'Xodim ' + (i + 1), position: 'Omborchi', status: 'probation',
      qa: Object.assign({ at: at0 - 1000 * (i + 1), answers: { [qs[0].id]: 'Tajriba uchun', [qs[1].id]: i % 2 ? 'Ofisda' : 'Masofadan', [qs[3].id]: 2 + (i % 3) } }, i < 5 ? { consent: { v: 1, at: at0, base: true, ai: i !== 4, special: false } } : {}) } }));
    assert.deepEqual(srv.g.post({ token: sopTk(), action: 'patch', ops }).rejected, []); }
  await A.reload({ waitUntil: 'networkidle' }); await watchSync(A);
  await nav(A, 'cms'); await A.locator('.lor-tab').filter({ hasText: 'Savolnoma' }).click(); await A.waitForTimeout(300);
  // люди — номерами (имён в запросе нет), на экране номера → имена; хранится в карточке SOP-менеджера
  await A.locator('.qn-team-ai .qn-team-go').click();
  await A.locator('.qn-team-body').waitFor({ timeout: 8000 });
  { const tx = await A.locator('.qn-team-body').innerText();
    assert.ok(/Ko‘pchilik o‘zini puxta/.test(tx) && /Dilnoza Karimova-Aliyeva — Hujjatlar bilan/.test(tx), 'анализ коллектива на экране, #1 → имя');
    assert.match(tx, /AI qoralamasi/, 'подпись «AI qoralamasi»');
    assert.match(tx, /Xodimlar o‘zlarini qanday tasvirlaydi[\s\S]*Muhokama uchun: ko‘nikma va rollardagi bo‘shliqlar/, '«как люди описывают себя» и пробелы для обсуждения');
    assert.ok(!/Flegmatiklar ko‘p|Faol savdo menejeri/.test(tx), 'состава по темпераментам и «кого нанять» нет'); }
  await settle(A);
  { const last = lastPrompt(/HR-tahlilchi/);
    assert.ok(last && !/Dilnoza|Xodim \d/.test(last), 'имён в запросе к ИИ нет');
    assert.ok(/XODIMLAR \(5\)/.test(last), 'без согласия на ИИ — не в анализе (5 из 7)');
    assert.ok(!/Puxta, barqaror|AI xulosasi/.test(last) && !/123 45 67/.test(last), 'прежние выводы ИИ и контакты не идут');
    const sop = srv.g.state().users.find(u => u.login === srv.admin.login);
    assert.ok(sop.qaTeam && sop.qaTeam.ids[0] === emp.id && sop.qaTeam.v === 2 && !('hiring' in sop.qaTeam.data), 'анализ — в карточке SOP-менеджера'); }
  assert.equal(await E.evaluate(() => LmsClient.sync().then(() => LmsClient.initial().users.some(u => u.qaTeam))), false, 'сотрудник анализа коллектива не видит');
  await shot(A, 'savolnoma-jamoa-ai');
  // у кого нет согласия на ИИ — ИИ не предлагается и сам не готовится; плашки согласия в списке и карточке
  assert.match(await A.locator('.qn-person', { hasText: 'Xodim 5' }).innerText(), /✕ AI/, 'в списке — «✕ AI»');
  assert.match(await A.locator('.qn-person', { hasText: 'Xodim 6' }).innerText(), /rozilik so‘ralmagan/, 'анкета до шага согласий — «rozilik so‘ralmagan»');
  assert.match(await A.locator('.qn-person', { hasText: 'Xodim 1' }).innerText(), /✓ AI/);
  for (const [nm, re] of [['Xodim 5', /AI tahliliga rozilik bermagan/], ['Xodim 6', /rozilik so‘ralmagan/]]) {
    const n0 = aiCalls.length;
    await A.locator('.qn-person', { hasText: nm }).click(); await A.locator('.qn-ans .qn-ai').waitFor({ timeout: 5000 }); await A.waitForTimeout(1000);
    assert.equal(await A.locator('.qn-ans .qn-ai-go').count(), 0, nm + ': кнопки ИИ нет');
    assert.match(await A.locator('.qn-ans .qn-ai-nocons').innerText(), re, nm + ': почему ИИ нет');
    assert.equal(aiCalls.length, n0, nm + ': в ИИ ничего не ушло');
    if (nm === 'Xodim 5') { const ch = await consChips(A);
      assert.match(ch[0], /^✓ Rozilik v1 · \d\d\.\d\d\.\d{4} \| Ma’lumotlarni qayta ishlashga rozilik · \d\d\.\d\d\.\d{4} · v1/, 'в карточке — согласие плашкой, полный текст с датой и версией — в подсказке: ' + ch);
      assert.match(ch[1], /^✕ AI tahlili \| AI tahliliga rozilik/, '«✕ AI tahlili»: ' + ch); await shot(A, 'savolnoma-rozilik-yoq'); }
    await A.locator('.qn-ans .lor-modal-x').click();
  }
  // временные сотрудники больше не нужны
  assert.deepEqual(srv.g.post({ token: sopTk(), action: 'patch', ops: extra.map(id => ({ op: 'del', path: ['users', { id }] })) }).rejected, []);
  await A.reload({ waitUntil: 'networkidle' }); await watchSync(A);
  await nav(A, 'cms'); await A.locator('.lor-tab').filter({ hasText: 'Savolnoma' }).click(); await A.waitForTimeout(300);
  await A.locator('.qn-views .seg button').nth(1).click();
  // вопросы из Word: заголовки — разделы, маркированный список — варианты к вопросу выше (не сохраняем — только проверка)
  const qn0 = await A.locator('.qn-item').count();
  await A.setInputFiles('#qn-docx', { name: 'savollar.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docx });
  await A.waitForFunction(n => document.querySelectorAll('.qn-item').length > n, qn0, { timeout: 5000 });
  assert.ok(await A.locator('.qn-item.is-sec').count() >= 2, 'заголовки Word — разделы');
  assert.ok(await A.locator('.qn-item-opt input[value="Birinchi band"]').count(), 'маркированный список — варианты');
  assert.ok(await A.locator('.in-dirty').count(), 'до «Saqlash» — «не сохранено»');
  await A.locator('.lor-tab').filter({ hasText: 'Darslar' }).click();
  step('«Savolnoma»: SOP-менеджер добавил вопросы списком (варианты, раздел, оценка 1–5), сотрудник заполнил обязательные; результаты: шкалы, темперамент, вывод ИИ (сотруднику не виден); вопросы из Word');

  // ---------- «сначала анкета»: новые поля (согласие, таблица языков, дата) и пометки в тексте; сотрудник заполняет по шагам до всего остального ----------
  await nav(A, 'cms'); await A.locator('.lor-tab').filter({ hasText: 'Savolnoma' }).click(); await A.waitForTimeout(300);
  await A.locator('.qn-views .seg button').nth(1).click();
  await A.locator('.qn-edit:not(.qn-scales) .qn-imp button').click();
  await A.fill('#f-qn-paste', '@birinchi\n# Tillar\nQaysi tillarni bilasiz? [jadval: Bilmayman | O‘rta | Yuqori] [asosiy]\n- Rus tili\n- Xitoy tili\nTug‘ilgan sanangiz [sana] [profil:birth]\nPasport seriyasi va raqami [qisqa] [maxfiy] [profil:passport]\n# Tasdiq va rozilik\nMa’lumotlarim to‘g‘ri ekanini tasdiqlayman [rozilik]');
  await A.locator('.qn-paste-act .lor-btn-primary').click();
  assert.ok(await A.locator('#qn-first').isChecked(), '«@birinchi» включил «сначала анкета»');
  await A.locator('.qn-admin .in-actions .lor-btn-primary').click(); await settle(A);
  { const q = srv.g.state().settings.questionnaire, by = t => q.questions.find(x => x.text.startsWith(t));
    assert.equal(q.first, true);
    assert.deepEqual([by('Qaysi tillarni').type, by('Qaysi tillarni').cols, by('Qaysi tillarni').options, by('Qaysi tillarni').key], ['grid', ['Bilmayman', 'O‘rta', 'Yuqori'], ['Rus tili', 'Xitoy tili'], true]);
    assert.deepEqual([by('Tug‘ilgan').type, by('Tug‘ilgan').prof, by('Pasport').secret, by('Pasport').prof, by('Ma’lumotlarim').type], ['date', 'birth', true, 'passport', 'consent']); }
  // как анкета до шага согласий: поля согласий нет. Анкета снова «к заполнению» (новые обязательные) — сначала шаг согласий
  assert.deepEqual(srv.g.post({ token: sopTk(), action: 'patch', ops: [{ op: 'del', path: ['users', { id: emp.id }, 'qa', 'consent'] }] }).rejected, []);
  // без согласия на ИИ выводов ИИ сервер не хранит: отметка «Rad etish» по нему и анализ коллектива с ним — той же правкой
  { const st = srv.g.state(), sop = st.users.find(u => u.login === srv.admin.login);
    assert.equal(st.users.find(u => u.id === emp.id).qaReport, undefined, 'вывода ИИ по нему нет');
    assert.ok(sop.qaTeam && !sop.qaTeam.data && !sop.qaTeam.ids && sop.qaTeam.gone > 0, 'анализ коллектива — отметкой без текста'); }
  await E.reload({ waitUntil: 'networkidle' }); await watchSync(E);
  await E.locator('.qn-page .qn-cons-step').waitFor({ timeout: 8000 });
  assert.equal(await E.locator('.app-body').count(), 0, 'пока анкета не отправлена — платформы нет');
  assert.equal(await E.locator('.qn-cons-opt').count(), 3, 'в анкете есть [maxfiy] — третья галочка (особые данные)');
  assert.equal(await E.locator('.qn-cons-opt input:checked').count(), 0, 'ничего не отмечено заранее');
  await E.locator('.qn-cons-go').click();
  assert.equal(await E.locator('.qn-cons-opt.is-err').count(), 1, 'без обязательной галочки — дальше нельзя');
  assert.equal(await E.locator('.qn-page .qn-wiz').count(), 0, '…только выйти');
  assert.equal(await E.locator('.qn-page-foot button', { hasText: 'Chiqish' }).count(), 1, 'кнопка «Chiqish»');
  for (const k of ['base', 'ai', 'special']) await E.locator('.qn-cons-opt[data-c="' + k + '"] .qn-consent-l').click();
  await shot(E, 'anketa-0-rozilik');
  await E.locator('.qn-cons-go').click();
  await E.locator('.qn-page .qn-wiz').waitFor({ timeout: 5000 });
  assert.equal(await E.locator('.qn-stp').count(), 4, 'шаги по разделам');
  await shot(E, 'anketa-1-qadam');
  // прежние ответы уже есть — сразу к новым разделам
  await E.locator('.qn-stp').nth(2).click();
  await E.locator('.qn-page-foot .lor-btn-primary').click();
  assert.ok(await E.locator('.qn-field.is-err').count() >= 2, 'без ответов дальше не пускает');
  await E.locator('.qn-lv-row').nth(0).locator('.qn-lv-pill').nth(2).click();
  await E.locator('.qn-lv-row').nth(1).locator('.qn-lv-pill').nth(1).click();
  assert.equal(await E.locator('.qn-lv-row').nth(0).locator('.qn-lv-pill.is-fill, .qn-lv-pill.is-on').count(), 2, 'уровень заполняется до выбранного');
  await E.fill('.qn-field.is-date input[type="date"]', '1999-04-12');
  await E.fill('.qn-field.is-text input', 'AA 1234567');
  await shot(E, 'anketa-2-tillar');
  await E.locator('.qn-page-foot .lor-btn-primary').click(); await E.waitForTimeout(300);
  await E.locator('.qn-consent-l').click();
  await shot(E, 'anketa-3-rozilik');
  await E.locator('.qn-page-foot .lor-btn-primary').click();
  await E.locator('.qn-done').waitFor({ timeout: 5000 });
  await settle(E);
  { const qa = srv.g.state().users.find(u => u.id === emp.id).qa, q = srv.g.state().settings.questionnaire, by = t => q.questions.find(x => x.text.startsWith(t));
    assert.deepEqual(qa.answers[by('Qaysi tillarni').id], { 'Rus tili': 'Yuqori', 'Xitoy tili': 'O‘rta' });
    assert.equal(qa.answers[by('Tug‘ilgan').id], '1999-04-12'); assert.equal(qa.answers[by('Ma’lumotlarim').id], true);
    assert.deepEqual([qa.consent.v, qa.consent.base, qa.consent.ai, qa.consent.special], [1, true, true, true], 'согласие на всё — с версией');
    assert.equal(qa.answers[by('Pasport').id], 'AA 1234567', 'с согласием на особые данные — паспорт сохранён'); }
  await shot(E, 'anketa-4-rahmat');
  await E.locator('.qn-done .lor-btn-primary').click();
  await E.locator('.app-body').waitFor({ timeout: 5000 });
  // CEO/SOP: таблица «главное» и скрытый паспорт
  await A.reload({ waitUntil: 'networkidle' }); await watchSync(A);
  await nav(A, 'cms'); await A.locator('.lor-tab').filter({ hasText: 'Savolnoma' }).click(); await A.waitForTimeout(300);
  assert.match(await A.locator('.qn-tbl').innerText(), /Rus tili: Yuqori/, 'в таблице — главный ответ (языки)');
  await A.locator('.qn-tbl tbody tr').first().click();
  // ответы новее отклонённого вывода — ИИ готовит заново сам; в запросе — возрастная группа вместо даты рождения, паспорта нет
  for (let i = 0; i < 50 && !/Tug‘ilgan/.test(lastPrompt(/HR-psixolog/)); i++) await A.waitForTimeout(200);
  { const pr = lastPrompt(/HR-psixolog/);
    assert.ok(/Tug‘ilgan sanangiz\n   Javob: yosh guruhi: \d/.test(pr) && !/1999|AA 1234567|Pasport/.test(pr), 'в ИИ — возрастная группа, без даты рождения и паспорта'); }
  assert.ok(!(await A.locator('.qn-ans').innerText()).includes('AA 1234567'), 'паспорт скрыт, пока не нажать «показать»');
  await A.getByRole('button', { name: 'Maxfiy ma’lumotlarni ko‘rsatish' }).click();
  assert.ok((await A.locator('.qn-ans').innerText()).includes('AA 1234567'), '…а после — виден');
  { const ch = await consChips(A);
    assert.ok(ch.some(x => /^✓ Ma’lumotlar to‘g‘ri \| Ma’lumotlarim to‘g‘ri ekanini tasdiqlayman · \d\d\.\d\d\.\d{4}/.test(x)), 'согласие анкеты — короткой плашкой, полный текст с датой — в подсказке: ' + ch);
    assert.ok(ch.some(x => /^✓ Maxfiy ma’lumotlar \|/.test(x)), 'в анкете есть [maxfiy] — плашка особых данных');
    assert.equal(await A.locator('.qn-ans .qn-ans-acts .lor-btn').count(), 2, 'в шапке — две кнопки одного вида');
    assert.deepEqual(await A.locator('.qn-ans .qn-ans-acts .lor-btn').evaluateAll(b => b.map(x => x.className.includes('lor-btn-outline') && x.className.includes('lor-btn-sm'))), [true, true]); }
  await A.waitForTimeout(400); await shot(A, 'anketa-5-ceo');
  await A.locator('.qn-ans .lor-modal-x').click();
  await A.locator('.lor-tab').filter({ hasText: 'Darslar' }).click();
  step('«сначала анкета»: по шагам до всего остального; таблица языков, дата, согласие; у SOP — таблица «главное», паспорт скрыт до «показать»');

  // ---------- тест после анкеты: пояснение, оценки 1–5 с подписями, темперамент по самой высокой шкале (основной + дополнительный) ----------
  await nav(A, 'cms'); await A.locator('.lor-tab').filter({ hasText: 'Savolnoma' }).click(); await A.waitForTimeout(300);
  await A.locator('.qn-views .seg button').nth(1).click();
  await A.locator('.qn-edit:not(.qn-scales) .qn-imp button').click();
  await A.fill('#f-qn-paste', '@baho: Umuman | Kam | Ba’zan | Ko‘proq | To‘liq\n@chegaralar: 1 Past | 3 O‘rta | 5 Yuqori\n# Temperament testi\n> Har bir holatni 1 dan 5 gacha baholang.\n# Muloqot [shkala: Muloqot] [temperament: sangvinik]\nYangi odamlar bilan tez chiqishaman [baho]\n# Liderlik [shkala: Liderlik] [temperament: xolerik]\nTez qaror qabul qilaman [baho]\n# Mas’uliyat [shkala: Ishonchlilik]\nVazifani oxirigacha bajaraman [baho]');
  await A.locator('.qn-paste-act .lor-btn-primary').click();
  await A.locator('.qn-admin .in-actions .lor-btn-primary').click(); await settle(A);
  { const q = srv.g.state().settings.questionnaire, sc = n => q.scales.find(x => x.name === n);
    assert.equal(q.temper.mode, 'max');
    assert.deepEqual([q.temper.map[sc('Muloqot').id], q.temper.map[sc('Liderlik').id], q.temper.map[sc('Ishonchlilik').id]], ['sanguine', 'choleric', undefined], 'шкала = темперамент, надёжность — отдельно');
    const lq = q.questions.find(x => x.text.startsWith('Tez qaror'));
    assert.deepEqual([lq.type, lq.scale, lq.labels[4]], ['scale', sc('Liderlik').id, 'To‘liq'], 'оценка — в шкале раздела, с подписями');
    assert.ok(q.questions.some(x => x.type === 'note'), 'пояснение — не вопрос'); }
  await E.reload({ waitUntil: 'networkidle' }); await watchSync(E);
  await E.locator('.qn-wiz').waitFor({ timeout: 8000 });
  assert.match(await E.locator('.qn-step-head .lor-h').innerText(), /TEMPERAMENT TESTI/i, 'кто анкету уже заполнил — сразу к тесту');
  assert.ok(await E.locator('.qn-note-box').count(), 'пояснение показано');
  await E.locator('.qn-page-foot .lor-btn-primary').click(); await E.waitForTimeout(250);
  { const w = E.locator('.qn-step .qn-warn');
    assert.equal(await w.count(), 1, 'перед первым вопросом шкал темперамента — честное предупреждение');
    assert.match(await w.innerText(), /to‘g‘ri yoki noto‘g‘ri javob yo‘q[\s\S]*avtomatik tekshiriladi/, '…стандартным текстом из strings.js'); }
  await E.locator('.qn-sc').nth(1).click(); assert.match(await E.locator('.qn-lk-cap').innerText(), /Kam/, 'подпись выбранной оценки — под шкалой');
  await E.locator('.qn-sc').nth(4).click(); assert.match(await E.locator('.qn-lk-cap').innerText(), /To‘liq/, 'оценку можно поменять');
  await E.locator('.qn-page-foot .lor-btn-primary').click(); await E.waitForTimeout(250);
  await E.locator('.qn-sc').nth(4).click();
  await E.locator('.qn-page-foot .lor-btn-primary').click(); await E.waitForTimeout(250);
  await E.locator('.qn-sc').nth(2).click();
  await E.locator('.qn-page-foot .lor-btn-primary').click();
  await E.locator('.qn-done').waitFor({ timeout: 5000 }); await settle(E);
  await E.locator('.qn-done .lor-btn-primary').click();
  await A.reload({ waitUntil: 'networkidle' }); await watchSync(A);
  await nav(A, 'cms'); await A.locator('.lor-tab').filter({ hasText: 'Savolnoma' }).click(); await A.waitForTimeout(300);
  // Muloqot 5 и Liderlik 5 — равны: не «основной + дополнительный», а смешанный профиль; в таблице — словами, без цвета
  assert.match(await A.locator('.qn-tbl tbody tr').first().innerText(), /Aralash profil[\s\S]*sangvinik va xolerik uslublari/, 'в таблице — «aralash profil»');
  await A.locator('.qn-tbl tbody tr').first().click();
  { const tx = await A.locator('.qn-temper').innerText();
    assert.ok(/Aralash profil/.test(tx) && /sangvinik va xolerik uslublari/.test(tx) && !/Xolerik|Sangvinik/.test(tx), 'равные шкалы — смешанный профиль, без ярлыка «основной / дополнительный»'); }
  assert.equal(await A.locator('.qn-ans .qn-prof-grp').count(), 2, 'шкалы темперамента и остальные — двумя группами');
  assert.match(await A.locator('.qn-ans .qn-prof-grp').first().innerText(), /Muloqot[\s\S]*5,0 \/ 5[\s\S]*Liderlik/, 'шкалы темперамента — средним 1–5');
  assert.match(await A.locator('.qn-ans .qn-prof-grp.is-apart').innerText(), /Ishonchlilik[\s\S]*3,0 \/ 5/, 'надёжность — отдельно от шкал темперамента');
  assert.equal(await A.locator('.qn-ans .qn-ax').count(), 1, 'ось 1–5 — одна над списком шкал');
  { const grp = A.locator('.qn-ans .qn-prof-grp').first(), tg = grp.locator('.qn-why-tg').first();
    assert.ok(await grp.locator('.qn-why').first().isHidden(), 'ответы под шкалой свёрнуты');
    assert.match(await tg.innerText(), /Javoblar \(1\)/, 'кнопка — «Javoblar (n)»');
    await tg.click();
    assert.equal(await tg.getAttribute('aria-expanded'), 'true');
    assert.match(await grp.locator('.qn-why').first().innerText(), /Yangi odamlar bilan tez chiqishaman[\s\S]*To‘liq \(5\)/, 'под шкалой — ответ, сильнее всего сдвинувший балл');
    await tg.click(); assert.ok(await grp.locator('.qn-why').first().isHidden(), 'свернуть обратно');
    // «Chop etish / PDF» — в печати всё раскрыто: ответы под шкалами, согласия полным текстом
    await A.evaluate(() => document.body.classList.add('qn-printing')); await A.emulateMedia({ media: 'print' });
    assert.ok(await grp.locator('.qn-why').first().isVisible(), 'в печати ответы под шкалой раскрыты');
    assert.ok(await A.locator('.qn-ans .qn-cons-full').first().evaluate(e => e.getBoundingClientRect().width > 50), 'в печати согласия — полным текстом');
    await A.emulateMedia({ media: 'screen' }); await A.evaluate(() => document.body.classList.remove('qn-printing')); }
  assert.ok(await A.locator('.qn-ans .qn-meter-sem').count() >= 3, 'у полос — затенённая погрешность');
  await A.waitForTimeout(400); await shot(A, 'savolnoma-profil');
  await A.locator('.qn-ans .lor-modal-x').click();
  await A.locator('.lor-tab').filter({ hasText: 'Darslar' }).click();
  // сотрудник видит свой профиль по шкалам и оговорку, но не вывод ИИ (окно анкеты после «Rahmat!» открывается само — или из меню)
  await E.locator('.app-body').waitFor({ timeout: 5000 }); await E.waitForTimeout(400);
  if (!(await E.locator('.qn-modal').count())) { await E.locator('.user-btn').first().click(); await E.locator('.user-pop-links button.qn').click(); }
  await E.locator('.qn-modal .qn-own').waitFor({ timeout: 5000 });
  { const tx = await E.locator('.qn-modal .qn-own').innerText();
    assert.ok(/Aralash profil/.test(tx) && /Ishonchlilik/.test(tx) && /qobiliyat yoki xarakterni emas/.test(tx), 'сотрудник видит свой профиль и оговорку'); }
  assert.equal(await E.locator('.qn-modal .qn-ai').count(), 0, 'вывода ИИ у сотрудника нет');
  // анкета отправлена: ответы теста только посмотреть (заново — лишь по просьбе руководства), остальное можно поправить
  assert.equal(await E.locator('.qn-modal .qn-test-ro').count(), 1, 'над тестом — «javoblarni o‘zgartirib bo‘lmaydi»');
  assert.ok(await E.locator('.qn-modal .qn-sc').count() > 0 && await E.locator('.qn-modal .qn-sc:not([disabled])').count() === 0, 'оценки теста не нажать');
  assert.ok(await E.locator('.qn-modal textarea').first().isEnabled(), 'ответ анкеты — можно поправить');
  await shot(E, 'savolnoma-xodim-profil');
  await E.locator('.qn-modal .lor-modal-x').click();
  step('тест после анкеты: пояснение, честное предупреждение перед шкалами темперамента, оценки 1–5 с подписями; среднее по шкалам, равные шкалы — «aralash profil», надёжность отдельно, ответы под шкалой, оговорка; сотрудник видит свой профиль');

  // ---------- отзыв согласия: «Mening profilim» → «Rozilik» — ИИ-анализ и особые данные выключаются ----------
  await settle(A);
  assert.ok((srv.g.state().users.find(u => u.id === emp.id).qaReport || {}).data, 'вывод ИИ по сотруднику есть');
  await E.locator('.user-btn').first().click(); await E.locator('.user-pop-links .profile').click(); await E.waitForTimeout(300);
  const cbox = E.locator('.pf-modal .qn-cons-box');
  assert.match(await cbox.innerText(), /Ma’lumotlarni qayta ishlashga rozilik berilgan/, 'обработка — отметкой с датой');
  assert.deepEqual([await cbox.locator('.qn-cons-sw[data-c="ai"]').getAttribute('aria-checked'), await cbox.locator('.qn-cons-sw[data-c="special"]').getAttribute('aria-checked')], ['true', 'true']);
  await cbox.locator('.qn-cons-sw[data-c="ai"]').click(); await E.waitForTimeout(200);
  E.once('dialog', d => d.accept());
  await cbox.locator('.qn-cons-sw[data-c="special"]').click(); await E.waitForTimeout(200);
  assert.equal(await cbox.locator('.qn-cons-sw[aria-checked="true"]').count(), 0, 'оба выключены');
  await shot(E, 'savolnoma-rozilik-profil');
  await E.keyboard.press('Escape'); await settle(E);
  { const me = srv.g.state().users.find(u => u.id === emp.id), q = srv.g.state().settings.questionnaire, ps = q.questions.find(x => x.text.startsWith('Pasport'));
    assert.deepEqual([me.qa.consent.base, me.qa.consent.ai, me.qa.consent.special], [true, false, false], 'согласие — на сервере');
    assert.ok(!(ps.id in me.qa.answers), 'без особых данных ответ на [maxfiy] стёрт');
    assert.ok(me.qa.at && srv.g.state().audit.some(x => x.key === 'qn-consent' && x.userId === emp.id && x.ai === false), 'изменение — в журнале'); }
  await E.waitForTimeout(300);
  assert.equal(await E.locator('.qn-page, .qn-banner').count(), 0, 'паспорт теперь не обязателен — анкета не вернулась');
  // SOP-менеджер: прежний вывод ИИ удалён сам, ИИ не предлагается, анализ коллектива — «qayta tayyorlang», строки о нём нет
  await A.reload({ waitUntil: 'networkidle' }); await watchSync(A);
  await nav(A, 'cms'); await A.locator('.lor-tab').filter({ hasText: 'Savolnoma' }).click(); await A.waitForTimeout(300);
  await settle(A);
  assert.equal(srv.g.state().users.find(u => u.id === emp.id).qaReport, undefined, 'вывод ИИ удалён (сервер — той же правкой)');
  { const tx = await A.locator('.qn-team-ai').innerText();
    assert.ok(/AI roziligini qaytarib oldi/.test(tx) && !/Dilnoza Karimova-Aliyeva — Hujjatlar/.test(tx), 'анализа коллектива с ним нет — «qayta tayyorlang»: ' + tx);
    assert.equal(await A.locator('.qn-team-ai .qn-team-gone').count(), 1); }
  assert.match(await A.locator('.qn-tbl tbody tr').first().innerText(), /✕ AI[\s\S]*✕ Maxfiy/, 'в таблице — плашки согласия');
  { const n0 = aiCalls.length;
    await A.locator('.qn-tbl tbody tr').first().click(); await A.locator('.qn-ans .qn-ai').waitFor({ timeout: 5000 }); await A.waitForTimeout(1000);
    assert.equal(aiCalls.length, n0, 'сам не готовится');
    assert.equal(await A.locator('.qn-ans .qn-ai-go, .qn-ans .qn-ai-body').count(), 0, 'ни кнопки, ни прежнего вывода');
    assert.ok(!(await A.locator('.qn-ans').innerText()).includes('AA 1234567'), 'паспорта нет'); }
  await A.locator('.qn-ans .lor-modal-x').click();
  await A.locator('.lor-tab').filter({ hasText: 'Darslar' }).click();
  step('отзыв согласия в «Mening profilim» → «Rozilik»: ИИ и особые данные выключены, ответ [maxfiy] стёрт, вывод ИИ удалён, ИИ не предлагается');

  // ---------- «Javoblar sifati»: пункты-проверки в тексте; сотрудник жмёт «5» подряд и быстро — подсказка «shoshilmang»,
  // у SOP-менеджера — «Profil talqin qilinmaydi» с причинами; «Qayta topshirishni so‘rash» — один раз, обе попытки хранятся ----------
  await nav(A, 'cms'); await A.locator('.lor-tab').filter({ hasText: 'Savolnoma' }).click(); await A.waitForTimeout(300);
  await A.locator('.qn-views .seg button').nth(1).click();
  await A.locator('.qn-edit:not(.qn-scales) .qn-imp button').click();
  await A.fill('#f-qn-paste', '# Qo‘shimcha test\n1. Ishni rejalashtirib boshlayman [baho] [shkala: Tartib]\n2. Hujjatlarni tartibda saqlayman [baho] [shkala: Tartib]\n' +
    '3. Kun oxirida ish joyimni yig‘ishtiraman [baho] [shkala: Tartib]\n4. Bu savolda «2» ni belgilang [diqqat: 2]\n5. Vazifalarni ro‘yxat bilan bajaraman [baho] [shkala: Tartib]\n' +
    '6. Men hech qachon ishga kechikmaganman [samimiylik]\n7. Muddatlarni oldindan belgilayman [baho] [shkala: Tartib]\n8. Men hech qachon mobil telefondan foydalanmaganman [tekshiruv]\n' +
    '9. Ish stolim doim tartibda [baho] [shkala: Tartib]\n10. Yangi ishni darhol boshlayman [baho] [shkala: Tartib]\n11. Rejasiz ishlashni yoqtiraman [baho] [shkala: Tartib] [teskari] [juft: 1]\n' +
    '12. Hujjatlarni qayerga qo‘yganimni tez-tez unutaman [baho] [shkala: Tartib] [teskari] [juft: 2]\n13. Ish joyim ko‘pincha tartibsiz qoladi [baho] [shkala: Tartib] [teskari] [juft: 3]');
  await A.locator('.qn-paste-act .lor-btn-primary').click();
  assert.equal(await A.locator('select.qn-exp-sel').count(), 1, 'в редакторе — пункт на внимательность с верным ответом');
  assert.equal(await A.locator('select.qn-exp-sel').inputValue(), '2');
  assert.equal(await A.locator('input.qn-infreq:checked').count(), 1, 'проверка отмечена');
  assert.equal(await A.locator('input.qn-sd:checked').count(), 1, '«слишком хорошо» отмечено');
  assert.ok(await A.locator('#qn-warn-on').isChecked(), 'предупреждение перед тестом включено');
  await A.locator('.qn-admin .in-actions .lor-btn-primary').click(); await settle(A);
  const tq = {};
  { const q = srv.g.state().settings.questionnaire, by = s => q.questions.find(x => x.text.startsWith(s));
    Object.assign(tq, { at: by('Bu savolda'), inf: by('Men hech qachon mobil'), sd: by('Men hech qachon ishga'), p1: by('Ishni rejalashtirib'), p11: by('Rejasiz') });
    assert.deepEqual([tq.at.type, tq.at.expect, tq.at.scale], ['attn', 2, undefined], 'внимательность — не в шкале');
    assert.deepEqual([tq.inf.infreq, tq.inf.scale, tq.sd.sd], [true, undefined, true]);
    assert.deepEqual([tq.p11.pair, tq.p11.rev], [tq.p1.id, true], '[juft: 1] — пара к вопросу 1 этого текста');
    assert.equal(q.testWarn, undefined, 'стандартный текст предупреждения — не хранится'); }
  await A.locator('.lor-tab').filter({ hasText: 'Darslar' }).click();
  await E.reload({ waitUntil: 'networkidle' }); await watchSync(E);
  await E.locator('.qn-wiz').waitFor({ timeout: 8000 });
  assert.match(await E.locator('.qn-step-head .lor-h').innerText(), /QO‘SHIMCHA TEST/i, 'новый тест — сразу его шаг');
  { const fs = E.locator('.qn-step .qn-field'), n = await fs.count();
    assert.equal(n, 13);
    for (let i = 0; i < n; i++) await fs.nth(i).locator('.qn-sc').nth(4).click();
    assert.equal(await E.locator('.qn-step .qn-fast').count(), 1, '5 ответов подряд быстрее секунды — мягкая подсказка');
    assert.match(await E.locator('.qn-step .qn-fast').innerText(), /shoshilmang/); }
  await shot(E, 'savolnoma-shoshilmang');
  await E.locator('.qn-page-foot .lor-btn-primary').click();
  await E.locator('.qn-done').waitFor({ timeout: 5000 }); await settle(E);
  await E.locator('.qn-done .lor-btn-primary').click();
  { const me = srv.g.state().users.find(u => u.id === emp.id), rt = Object.values(me.qa.meta.rt);
    assert.ok(rt.length >= 12 && rt.every(x => Number.isInteger(x) && x > 0 && x <= 300000), 'время между ответами записано (мс): ' + rt.join(', '));
    assert.equal(me.qa.answers[tq.at.id], 5); }
  await A.reload({ waitUntil: 'networkidle' }); await watchSync(A);
  await nav(A, 'cms'); await A.locator('.lor-tab').filter({ hasText: 'Savolnoma' }).click(); await A.waitForTimeout(300);
  assert.match(await A.locator('.qn-tbl tbody tr').first().locator('.qn-q-chip').innerText(), /Sifat: talqin qilinmaydi/, 'в таблице — плашка рядом с результатом');
  await A.locator('.qn-tbl tbody tr').first().click();
  { const box = A.locator('.qn-ans .qn-q');
    await box.waitFor({ timeout: 5000 });
    const tx = await box.innerText();
    assert.match(tx, /JAVOBLAR SIFATI[\s\S]*Profil talqin qilinmaydi/i, 'красный — «профиль не толкуется»');
    assert.match(tx, /Diqqat savollarida xato: 2 \(2 ta savoldan\)/, 'причины словами: ошибки во внимательности…');
    assert.match(tx, /Qarama-qarshi fikrlarning 3 juftidan 3 tasida ziddiyat/, '…противоречия в парах');
    assert.match(tx, /rad etish uchun asos emas/, 'не основание для отказа');
    assert.ok(await box.locator('.qn-q-why li').count() <= 3, 'не больше трёх причин');
    await box.locator('.qn-q-raw summary').click();
    const raw = await box.locator('.qn-q-raw').innerText();
    assert.match(raw, /Javoblar orasidagi vaqt \(mediana\)\s*\d+(,\d+)? s/, 'сырые значения — в панели');
    assert.match(raw, /Eng uzun bir xil javoblar seriyasi\s*13/, '13 одинаковых подряд'); }
  await shot(A, 'savolnoma-javoblar-sifati');
  A.once('dialog', d => d.accept());
  await A.locator('.qn-ans .qn-q-retake').click(); await settle(A);
  { const qa = srv.g.state().users.find(u => u.id === emp.id).qa;
    assert.ok(qa.retake && qa.prev && qa.prev.answers[tq.at.id] === 5, 'первая попытка — в qa.prev');
    assert.ok(!(tq.at.id in qa.answers) && qa.answers[srv.g.state().settings.questionnaire.questions[0].id], 'ответов теста нет, анкета на месте'); }
  assert.match(await A.locator('.qn-ans .qn-q').innerText(), /Testni qayta topshirish so‘ralgan/);
  assert.equal(await A.locator('.qn-ans .qn-q-retake').count(), 0, 'кнопки больше нет');
  await A.locator('.qn-ans .lor-modal-x').click();
  // сотрудник проходит тест заново: с первого раздела, где у теста нет ответа, с пояснением «Rahbariyat … so‘radi»
  await E.reload({ waitUntil: 'networkidle' }); await watchSync(E);
  await E.locator('.qn-wiz').waitFor({ timeout: 8000 });
  assert.match(await E.locator('.qn-step .qn-retake').innerText(), /yana bir marta topshirishingizni so‘radi/);
  for (let k = 0; k < 12 && !(await E.locator('.qn-done').count()); k++) {
    const fs = E.locator('.qn-step .qn-field:not(.is-done)'), n = await fs.count();
    // у теста — оценки 1–5 и вопрос с баллами шкалы (плитки «Ofisda / Masofadan» — тоже пункт теста)
    for (let i = 0; i < n; i++) {
      const f = fs.nth(0), sc = f.locator('.qn-sc'), tl = f.locator('.qn-tile');
      if (await sc.count()) await sc.nth(k % 2 ? 1 : 3).click(); else if (await tl.count()) await tl.first().click(); else break;
      await E.waitForTimeout(30);
    }
    await E.locator('.qn-page-foot .lor-btn-primary').click(); await E.waitForTimeout(250);
  }
  await E.locator('.qn-done').waitFor({ timeout: 5000 }); await settle(E);
  await E.locator('.qn-done .lor-btn-primary').click();
  { const qa = srv.g.state().users.find(u => u.id === emp.id).qa;
    assert.ok(!qa.retake && qa.retakeAt && qa.prev && typeof qa.answers[tq.at.id] === 'number', 'отправил заново: обе попытки хранятся'); }
  await A.reload({ waitUntil: 'networkidle' }); await watchSync(A);
  await nav(A, 'cms'); await A.locator('.lor-tab').filter({ hasText: 'Savolnoma' }).click(); await A.waitForTimeout(300);
  await A.locator('.qn-tbl tbody tr').first().click();
  await A.locator('.qn-ans .qn-q').waitFor({ timeout: 5000 });
  assert.match(await A.locator('.qn-ans .qn-q-prev').innerText(), /Birinchi urinish .*Profil talqin qilinmaydi/, 'первая попытка — строкой');
  assert.equal(await A.locator('.qn-ans .qn-q-retake').count(), 0, 'повтор — только один раз');
  await A.locator('.qn-ans .lor-modal-x').click();
  await A.locator('.lor-tab').filter({ hasText: 'Darslar' }).click();
  assert.deepEqual(await rejected(E), [], 'сервер принял ответы, время и повтор сотрудника');
  assert.deepEqual(await rejected(A), [], 'сервер принял просьбу пройти тест заново');
  step('«Javoblar sifati»: [diqqat] [tekshiruv] [samimiylik] [juft] из текста; «5» подряд и быстро — «shoshilmang», у SOP — «Profil talqin qilinmaydi» с причинами и показателями; повтор теста — один раз, обе попытки хранятся');

  // ---------- «Lavozim va bo‘limlar»: CEO добавляет должность и отдел; SOP-менеджер выбирает их у нового сотрудника, сам список не меняет ----------
  await C.reload({ waitUntil: 'networkidle' }); await watchSync(C);
  await nav(C, 'staff'); await C.locator('.org-btn').click();
  await C.locator('.org-modal').waitFor({ timeout: 5000 });
  await C.fill('#org-new-positions', 'Haydovchi'); await C.keyboard.press('Enter');
  await C.fill('#org-new-depts', 'Transport bo‘limi'); await C.locator('.org-col').nth(1).locator('.org-add .lor-btn').click();
  await C.fill('#org-new-positions', 'haydovchi'); await C.keyboard.press('Enter');
  assert.match(await C.locator('.org-col').first().locator('.lor-field-error').innerText(), /bor/, 'то же название — нельзя');
  await shot(C, 'lavozim-bolim');
  await C.locator('.org-modal .lor-modal-actions .lor-btn-primary').click(); await settle(C);
  { const st = srv.g.state().settings;
    assert.ok(st.positions.includes('Haydovchi') && st.positions.includes('Omborchi'), 'новая должность — в списке, старые на месте');
    assert.ok(st.depts.includes('Transport bo‘limi'), 'новый отдел — в списке'); }
  assert.deepEqual(await rejected(C), [], 'сервер принял список от CEO');
  await A.reload({ waitUntil: 'networkidle' }); await watchSync(A);
  await nav(A, 'staff');
  assert.ok(await A.locator('#f-n-pos option[value="Haydovchi"]').count(), 'SOP-менеджер видит новую должность у нового сотрудника');
  assert.ok(await A.locator('#f-n-dep option[value="Transport bo‘limi"]').count(), '…и новый отдел');
  await A.locator('.org-btn').click(); await A.locator('.org-modal').waitFor({ timeout: 5000 });
  assert.equal(await A.locator('#org-new-positions').count(), 0, 'у SOP-менеджера список только для просмотра');
  await A.keyboard.press('Escape');
  step('«Lavozim va bo‘limlar»: CEO добавил должность и отдел; у SOP-менеджера они в форме сотрудника, список — только просмотр');

  // ---------- порядок входа нового сотрудника: анкета → тест → приветствие и условия → профиль → «Tanishuv» последним ----------
  const jid = Math.max(...srv.g.state().users.map(u => u.id)) + 1000;
  { const tk = srv.g.post({ action: 'login', login: srv.admin.login, password: srv.admin.password }).token;
    assert.deepEqual(srv.g.post({ token: tk, action: 'patch', ops: [{ op: 'set', path: ['users', { id: jid }], value: { id: jid, role: 'employee', login: 'new.xodim', password: 'xodim-12345', name: 'Sanjar Qodirov', position: 'Omborchi', status: 'probation' } }] }).rejected, []); }
  const J = await device('новый сотрудник');
  await signIn(J, 'new.xodim', 'xodim-12345');
  await J.locator('.qn-page .qn-cons-step').waitFor({ timeout: 8000 });
  assert.equal(await J.locator('.welcome, .ir, .app-body').count(), 0, 'первым делом — анкета (шаг согласий): ни приветствия, ни знакомства');
  await J.locator('.qn-cons-opt[data-c="base"] .qn-consent-l').click(); await J.locator('.qn-cons-go').click();
  await J.locator('.qn-page .qn-wiz').waitFor({ timeout: 5000 });
  await J.locator('.qn-stp', { hasText: /Tillar/i }).click(); await J.waitForTimeout(200);
  assert.ok(await J.locator('.qn-field.is-date').count() && !(await J.locator('.qn-field .qn-q', { hasText: 'Pasport' }).count()), 'без согласия на особые данные [maxfiy] (паспорт) не спрашивается');
  await settle(J);
  { const st = await J.locator('.qn-stp').allInnerTexts(), at = re => st.findIndex(x => re.test(x));
    assert.ok(at(/Tillar/i) >= 0 && at(/Temperament/i) > at(/Tillar/i), 'в анкете сначала вопросы, потом тест темперамента: ' + st.join(' | ')); }
  // анкету и тест по шагам уже проверили выше — здесь ответы те же, что у первого сотрудника
  const jt = srv.g.post({ action: 'login', login: 'new.xodim', password: 'xodim-12345' }).token;
  const jpatch = ops => assert.deepEqual(srv.g.post({ token: jt, action: 'patch', ops }).rejected, []);
  { const c = srv.g.state().users.find(u => u.id === jid).qa.consent;
    assert.deepEqual([c.base, c.ai, c.special], [true, false, false], 'новый сотрудник: только обязательное согласие');
    jpatch([{ op: 'set', path: ['users', { id: jid }, 'qa'], value: { answers: srv.g.state().users.find(u => u.id === emp.id).qa.answers, at: Date.now(), consent: c } }]); }
  await J.reload({ waitUntil: 'networkidle' }); await watchSync(J);
  await J.locator('.welcome').waitFor({ timeout: 8000 });
  assert.equal(await J.locator('.welcome-steps li').count(), 4, 'в приветствии знакомства нет: приветствие, как устроено, помощь, условия');
  assert.equal(await J.locator('.ir').count(), 0);
  for (let i = 0; i < 3; i++) await click(J, 'Keyingi');
  await J.check('#agree1'); await J.check('#agree2');
  await click(J, 'Qabul qilaman va boshlash', { wait: 800 }); await settle(J);
  await J.locator('#f-lastName').waitFor({ timeout: 5000 });
  assert.equal(await J.locator('.ir').count(), 0, 'пока профиль не заполнен — знакомства нет');
  // профиль по шагам тоже проверен выше
  jpatch([{ op: 'set', path: ['users', { id: jid }, 'profile'], value: { lastName: 'Qodirov', firstName: 'Sanjar' } }, { op: 'set', path: ['users', { id: jid }, 'profileComplete'], value: true }, { op: 'set', path: ['users', { id: jid }, 'assetsDeclaredAt'], value: Date.now() }]);
  setClock(true);
  await J.reload({ waitUntil: 'networkidle' }); await watchSync(J);
  await J.locator('.ir').waitFor({ timeout: 8000 });
  assert.match(await J.locator('.ir-step').innerText(), /oxirgi qadam/i, 'знакомство — последний шаг');
  assert.equal(await J.locator('.ir-x').count(), 0, 'крестика нет');
  assert.deepEqual(await J.locator('.ir-actions button').allInnerTexts().then(a => a.map(x => x.replace(/[^\p{L} ]/gu, '').trim().toLowerCase())), ['chiqish', 'tasdiqlash'], 'отложить нельзя — только выйти из аккаунта или подтвердить');
  await J.keyboard.press('Escape'); await J.waitForTimeout(200);
  assert.equal(await J.locator('.ir').count(), 1, 'Escape не закрывает');
  assert.equal(await J.getByRole('button', { name: 'O‘tkazib yuborish' }).count(), 0, 'знакомство по программе — после, не поверх');
  await J.locator('.ir .dv-doc').waitFor({ timeout: 8000 });
  await J.locator('.ir-tab').nth(1).click();
  await J.locator('.ir iframe.dv-pdf[src^="blob:"], .ir a.dv-open[href^="blob:"]').waitFor({ timeout: 8000 });
  if (await J.locator('.ir a.dv-open').count()) { const [tab] = await Promise.all([J.context().waitForEvent('page'), J.locator('.ir a.dv-open').click()]); await tab.close(); }
  await shot(J, 'tanishuv-oxirgi-qadam');
  await J.check('#in-seen'); await J.locator('.ir-actions button:has-text("Tasdiqlash")').click(); await settle(J);
  assert.ok(srv.g.state().users.find(u => u.id === jid).introSeenAt, 'знакомство подтверждено — на сервере');
  await J.locator('.clock-modal').waitFor({ timeout: 5000 });
  assert.equal(await J.locator('.ir').count(), 0);
  setClock(false);
  assert.deepEqual(await rejected(J), [], 'сервер принял всё от нового сотрудника');
  step('порядок входа: анкета → тест темперамента → приветствие и условия → профиль → «Tanishuv» последним (отложить нельзя) → отметка прихода');

  // ---------- удаление сотрудника: «Xodimlar» → «Tahrirlash» → «Xodimni o‘chirish»; вход закрывается сразу ----------
  await A.reload({ waitUntil: 'networkidle' }); await watchSync(A);
  await nav(A, 'staff');
  await A.locator('tr', { hasText: 'Sanjar Qodirov' }).getByRole('button', { name: 'Tahrirlash' }).first().click();
  await A.locator('.ud-open').click();
  await A.locator('.ud-modal').waitFor({ timeout: 5000 });
  assert.ok(await A.locator('.ud-modal .lor-btn-primary').isDisabled(), 'без галочки «tushundim» не удалить');
  await shot(A, 'xodimni-ochirish');
  await A.check('#ud-ok'); await A.locator('.ud-modal .lor-btn-primary').click(); await settle(A);
  assert.equal(srv.g.state().users.some(u => u.id === jid), false, 'карточки нет — на сервере');
  assert.equal(srv.g.post({ action: 'login', login: 'new.xodim', password: 'xodim-12345' }).code, 'login', 'по паролю больше не войти');
  assert.equal(await A.locator('tr', { hasText: 'Sanjar Qodirov' }).count(), 0, 'в списке сотрудников его нет');
  assert.deepEqual(await rejected(A), [], 'сервер принял удаление');
  await J.reload({ waitUntil: 'networkidle' });
  await J.locator('#f-login').waitFor({ timeout: 8000 });
  step('удаление сотрудника: «Xodimlar» → «Tahrirlash» → «Xodimni o‘chirish» с подтверждением; вход закрылся, карточки нет');

  // ---------- вопрос по условию: «Farzandlaringiz soni» — только при «Oilali» ([agar: Oilali]) ----------
  await nav(A, 'cms'); await A.locator('.lor-tab').filter({ hasText: 'Savolnoma' }).click(); await A.waitForTimeout(300);
  await A.locator('.qn-views .seg button').nth(1).click();
  await A.locator('.qn-edit:not(.qn-scales) .qn-imp button').click();
  await A.fill('#f-qn-paste', '# Oila\nOilaviy holatingiz [tanlov]\n- Oilali\n- Oilasiz\nFarzandlaringiz soni [qisqa] [agar: Oilali]');
  await A.locator('.qn-paste-act .lor-btn-primary').click();
  assert.equal(await A.locator('.qn-when.is-on').count(), 1, 'в редакторе — условие «faqat agar …» с отмеченным вариантом');
  await A.locator('.qn-admin .in-actions .lor-btn-primary').click(); await settle(A);
  { const q = srv.g.state().settings.questionnaire, by = t => q.questions.find(x => x.text.startsWith(t));
    assert.deepEqual(by('Farzandlaringiz').when, { q: by('Oilaviy').id, any: ['Oilali'] }, 'условие — на сервере'); }
  await E.reload({ waitUntil: 'networkidle' }); await watchSync(E);
  await E.locator('.qn-wiz').waitFor({ timeout: 8000 });
  const kids = () => E.locator('.qn-field .qn-q', { hasText: 'Farzandlaringiz' }).count();
  assert.equal(await kids(), 0, 'пока не выбрано — вопроса о детях нет');
  await E.locator('.qn-tile', { hasText: 'Oilasiz' }).click();
  assert.equal(await kids(), 0, '«Oilasiz» — вопроса о детях нет');
  await E.locator('.qn-tile', { hasText: 'Oilali' }).click();
  assert.equal(await kids(), 1, '«Oilali» — вопрос о детях появился');
  await E.locator('.qn-tile', { hasText: 'Oilasiz' }).click();
  await E.locator('.qn-page-foot .lor-btn-primary').click();
  await E.locator('.qn-done').waitFor({ timeout: 5000 }); await settle(E);
  assert.equal(srv.g.state().users.find(u => u.id === emp.id).qa.answers[srv.g.state().settings.questionnaire.questions.find(x => x.text.startsWith('Oilaviy')).id], 'Oilasiz');
  step('вопрос по условию: «Farzandlaringiz soni» виден только при «Oilali»; с «Oilasiz» анкета отправляется без него');

  // ---------- анкета, отправленная до шага согласий (как у сотрудника выше, но поля согласий нет, паспорт [maxfiy] сохранён, старый
  // вывод ИИ): вывод ИИ сервер не хранит, у SOP паспорт закрыт; при входе — только шаг согласий; без особых — сначала вопрос ----------
  // правка — входом страницы SOP-менеджера (новый вход сверх 10 закрыл бы самый старый — эту страницу)
  { const st = srv.g.state(), ps = st.settings.questionnaire.questions.find(x => x.text.startsWith('Pasport')), me = st.users.find(u => u.id === emp.id);
    const qa = Object.assign({}, me.qa, { answers: Object.assign({}, me.qa.answers, { [ps.id]: 'AA 7654321' }) }); delete qa.consent;
    const aTok = await A.evaluate(() => localStorage.getItem('lor-lms-token'));
    assert.deepEqual(srv.g.post({ token: aTok, action: 'patch', ops: [
      { op: 'set', path: ['users', { id: emp.id }, 'qa'], value: qa },
      { op: 'set', path: ['users', { id: emp.id }, 'qaReport'], value: { at: Date.now(), v: 1, data: { summary: 'eski xulosa', fit: 'mos' } } }] }).rejected, []);
    assert.equal(srv.g.state().users.find(u => u.id === emp.id).qaReport, undefined, 'вывод ИИ без согласия сервер не хранит'); }
  await A.reload({ waitUntil: 'networkidle' }); await watchSync(A);
  await nav(A, 'cms'); await A.locator('.lor-tab').filter({ hasText: 'Savolnoma' }).click(); await A.waitForTimeout(300);
  await A.locator('.qn-tbl tbody tr', { hasText: 'Dilnoza' }).first().click(); await A.locator('.qn-ans').waitFor({ timeout: 5000 });
  assert.match(await A.locator('.qn-ans .qn-sec-wait').innerText(), /Maxfiy javoblar yopiq/, 'паспорт анкеты до согласий — закрыт');
  assert.equal(await A.getByRole('button', { name: 'Maxfiy ma’lumotlarni ko‘rsatish' }).count(), 0, '…и кнопки «показать» нет');
  assert.ok(!(await A.locator('.qn-ans').innerText()).includes('AA 7654321'));
  await A.locator('.qn-ans .lor-modal-x').click();
  await E.reload({ waitUntil: 'networkidle' }); await watchSync(E);
  await E.locator('.qn-page .qn-cons-step').waitFor({ timeout: 8000 });
  assert.equal(await E.locator('.qn-cons-opt').count(), 3);
  await E.locator('.qn-cons-opt[data-c="base"] .qn-consent-l').click();
  let jMsg = '';
  E.once('dialog', d => { jMsg = d.message(); d.dismiss(); });
  await E.locator('.qn-cons-go').click(); await E.waitForTimeout(300);
  assert.match(jMsg, /Maxfiy savollarga javoblaringiz o‘chiriladi/, 'без особых данных — сначала вопрос');
  assert.equal(await E.locator('.qn-page .qn-cons-step').count(), 1, '«Bekor qilish» — согласие не записано');
  assert.equal(srv.g.state().users.find(u => u.id === emp.id).qa.consent, undefined);
  E.once('dialog', d => d.accept());
  await E.locator('.qn-cons-go').click();
  await E.waitForFunction(() => !document.querySelector('.qn-page'), null, { timeout: 5000 }); await settle(E);
  { const me = srv.g.state().users.find(u => u.id === emp.id), ps = srv.g.state().settings.questionnaire.questions.find(x => x.text.startsWith('Pasport'));
    assert.deepEqual([me.qa.consent.base, me.qa.consent.ai, me.qa.consent.special], [true, false, false], 'согласие записано — анкету заново не спрашивают');
    assert.ok(!(ps.id in me.qa.answers) && me.qa.at && Object.keys(me.qa.answers).length > 5, 'паспорт стёрт, остальные ответы и дата отправки — на месте'); }
  assert.deepEqual(await rejected(E), [], 'сервер принял согласие');
  // ---------- отзыв согласия на обработку: «Mening profilim» → «Rozilik» → «Rozilikni qaytarib olish» — ответы стираются, анкета снова первым шагом ----------
  await E.reload({ waitUntil: 'networkidle' }); await watchSync(E);
  await E.locator('.app-body').waitFor({ timeout: 8000 }); await E.waitForTimeout(500);
  for (let i = 0; i < 3 && await E.locator('.lor-scrim .lor-modal-x').count(); i++) { await E.locator('.lor-scrim .lor-modal-x').first().click(); await E.waitForTimeout(200); }
  await E.locator('.user-btn').first().click(); await E.locator('.user-pop-links .profile').click(); await E.waitForTimeout(300);
  assert.ok(!/SOP menejeriga murojaat/.test(await E.locator('.pf-modal .qn-cons-box').innerText()), 'не отправляет «к SOP-менеджеру»');
  let eMsg = '';
  E.once('dialog', d => { eMsg = d.message(); d.accept(); });
  await E.locator('.pf-modal .qn-cons-off').click();
  await E.locator('.qn-page .qn-cons-step').waitFor({ timeout: 8000 }); await settle(E);
  assert.match(eMsg, /barcha javoblaringiz/, 'сначала — что удалится');
  assert.equal(await E.locator('.pf-modal').count(), 0, 'окно профиля закрылось — виден шаг согласий');
  { const me = srv.g.state().users.find(u => u.id === emp.id);
    assert.deepEqual(Object.keys(me.qa), ['consent'], 'ответов, их времени и прежней попытки теста нет');
    assert.deepEqual([me.qa.consent.base, me.qa.consent.ai, me.qa.consent.special], [false, false, false]);
    assert.ok(srv.g.state().audit.some(x => x.key === 'qn-consent' && x.userId === emp.id && x.base === false), 'отзыв — в журнале'); }
  assert.deepEqual(await rejected(E), [], 'сервер принял отзыв');
  step('анкета до шага согласий: при входе — только согласие (без особых — вопрос, паспорт стёрт), у SOP паспорт закрыт; отзыв согласия на обработку в профиле');

  // ---------- демо больше нет: ?demo=1 — тот же вход на сервер; без адреса сервера — «Server ulanmagan» ----------
  const D = await device('бывшее демо', '?demo=1');
  assert.equal(await D.locator('.demo-box').count(), 0, 'демо-входов нет');
  await D.fill('#f-login', 'metodist'); await D.fill('#f-password', 'admin123'); await D.click('button[type="submit"]');
  await D.waitForSelector('.lor-field-error', { timeout: 15000 });
  assert.ok(await D.locator('#f-password').count(), 'демо-пароль не подходит — вход только на сервер');
  const nctx = await browser.newContext();
  await nctx.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body: "window.LMS_SERVER = '';" }));
  const N = await nctx.newPage();
  N.on('pageerror', e => errors.push('без сервера: ' + e.message));
  await N.goto(srv.url, { waitUntil: 'networkidle' });
  assert.match(await N.innerText('body'), /server ulanmagan/i, 'без адреса сервера — «Server ulanmagan»');
  await shot(N, '13-no-server');
  assert.equal(await N.locator('#f-login').count(), 0, 'и без формы входа');
  step('демо нет: ?demo=1 ведёт на вход сервера, без сервера — «Server ulanmagan»');
  assert.deepEqual(errors, [], 'ошибок на странице нет');
  console.log('всё прошло');
} finally {
  if (errors.length) console.log('ОШИБКИ НА СТРАНИЦЕ:\n' + errors.join('\n'));
  await browser.close(); await srv.close();
}
