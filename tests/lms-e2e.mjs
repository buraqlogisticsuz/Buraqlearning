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
  return { body: { model: body.model, stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: 'text', text: 'Javob: ' + q }] } }; } });
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
const nav = async (p, hash) => { await p.locator('a[href="#' + hash + '"]:visible').first().click(); await p.waitForTimeout(600); };
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
  xr.push(['', 'Jasur Toshmatov', '', 'Omborchi', 'Ombor (Yiwu)']);   // без ID — новый сотрудник
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
  const sher2 = srv.g.state().users.find(u => u.id === sher.id), jas = srv.g.state().users.find(u => u.name === 'Jasur Toshmatov');
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
    assert.ok(await A.locator('.imp-dlg .ac-chip.is-on', { hasText: 'Menejer' }).count(), 'программа из файла отмечена');
    await shot(A, '23-import-dialog');
  } });
  let secs = srv.g.state().course.sections;
  const bi = secs.findIndex(x => x.id === 'b2');
  assert.ok(bi >= 0 && bi < secs.findIndex(x => x.id === 's2'), '2-bob — перед 4-bob');
  assert.equal(secs[bi].lessons[0].html.includes('script') || secs[bi].lessons[0].html.includes('onclick'), false, 'лишнее из HTML убрано');
  assert.ok(secs[bi].lessons[0].html.includes('class="ilova"'));
  assert.deepEqual(secs[bi].lessons[0].quiz, [{ q: 'Savol?', options: ['A', 'B', 'C'], answer: 2 }], 'неверный вопрос отброшен');
  assert.deepEqual(srv.g.state().tracks.filter(x => x.sections.includes('b2')).map(x => x.id), ['tr_mgr'], 'раздел — только в выбранной программе');
  assert.match(await txt(A, 'body'), /«2-bob\. Test bo‘limi» yuklandi: 2 ta dars, 1 ta test savoli · 1 ta dastur/);
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
  await A.waitForFunction(() => document.body.innerText.includes('boshqa bo‘limda band'), null, { timeout: 5000 });
  await A.locator('.imp-dlg').getByRole('button', { name: 'Bekor qilish' }).click(); await settle(A);
  assert.equal(srv.g.state().rev, rev1, 'при совпадении номеров уроков ничего не меняется');
  // «Kimlar o‘qiydi» у раздела: только выбранный сотрудник — остальным сервер раздел не отдаёт
  await A.locator('.cms-aud').nth(bi).click(); await A.waitForSelector('.aud-modal');
  await A.locator('.aud-modal .aud-mode', { hasText: 'Tanlangan xodimlar' }).click();
  await A.fill('#aud-sec-q', 'Dilnoza'); await A.locator('.aud-modal .aud-users input').first().check();
  await shot(A, '24-audience');
  await A.locator('.aud-modal').getByRole('button', { name: 'Saqlash' }).click(); await settle(A);
  const b2s = srv.g.state().course.sections.find(x => x.id === 'b2');
  assert.deepEqual(b2s.users, [emp.id]); assert.equal(srv.g.state().tracks.some(x => x.sections.includes('b2')), false, 'из программ убран');
  assert.match(await txt(A, '.cms-tree'), /Kimlar o‘qiydi:\s*1 ta xodim/);
  const other = srv.g.state().users.find(u => u.role === 'employee' && u.id !== emp.id);
  assert.equal(srv.g.ctx.viewFor_(srv.g.ctx.readState_(), other).course.sections.some(x => x.id === 'b2'), false, 'другому сотруднику раздел не уходит');
  await E.evaluate(() => LmsClient.sync()); await E.waitForTimeout(500);
  assert.ok(await E.evaluate(() => LmsClient.initial().course.sections.some(x => x.id === 'b2')), 'выбранный сотрудник раздел видит');
  // пустой раздел («+ Bo‘lim qo‘shish») можно удалить; раздел с уроками — нет
  const nSec = srv.g.state().course.sections.length;
  await A.getByRole('button', { name: '+ Bo‘lim qo‘shish' }).click(); await settle(A);
  assert.equal(srv.g.state().course.sections.length, nSec + 1);
  assert.equal(await A.locator('.cms-sec-del').count(), 1, 'кнопка — только у пустого раздела');
  await A.locator('.cms-sec-del').click(); await settle(A);
  assert.equal(srv.g.state().course.sections.length, nSec);
  assert.deepEqual(await rejected(A), [], 'сервер принял раздел и назначение');
  step('раздел из файла: окно «Qayerga / Kimlar o‘qiydi», 2-bob перед 4-bob, замена на месте, отказ при чужих номерах; раздел — выбранному сотруднику');

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
