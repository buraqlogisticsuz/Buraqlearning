// Учебная платформа в браузере, с сервером на заглушке (tests/lms-dev-server.mjs): SOP-менеджер и сотрудник на двух
// «устройствах». Нужен Playwright (в облачной сессии Claude он есть):  node tests/lms-e2e.mjs [папка для снимков]
// Проверяет: вход, шаблоны, загрузку курса из файла прототипа, создание сотрудника, первые шаги сотрудника
// (условия, анкета со сканом паспорта, мол-мулк), урок → «готов к тесту» → тест (балл считает сервер) → итог SOP-менеджера,
// правку без сети, и что сервер не отклонил ни одной обычной правки.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
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
  await E.selectOption('#f-education', 'Oliy (bakalavr)'); await E.fill('#f-years', '2'); await E.fill('#f-languages', 'O‘zbek, rus');
  await click(E, 'Saqlash va davom etish');
  await shot(E, '4-assets');
  await E.getByText('Menga hozircha kompaniya mol-mulki berilmagan').click();
  await E.getByText('Moddiy javobgarlik.', { exact: false }).click();
  await click(E, 'Anketani yakunlash', { wait: 800 });
  await settle(E);
  const me1 = srv.g.state().users.find(u => u.id === emp.id);
  assert.equal(me1.profileComplete, true, 'анкета заполнена — на сервере');
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

  // ---------- адресат идей: SOP-менеджер создаёт вход CEO ----------
  await nav(A, 'staff');
  await A.fill('#f-ld-name', 'Sherzod Aliyev'); await A.fill('#f-ld-login', 'ceo'); await A.fill('#f-ld-pw', 'ceo-parol-1');
  await click(A, 'Kirish yaratish');
  await settle(A);
  const ceo = srv.g.state().users.find(u => u.login === 'ceo');
  assert.ok(ceo && ceo.role === 'leader' && ceo.post === 'ceo' && !('password' in ceo) && srv.g.props['cred:' + ceo.id], 'вход CEO на сервере');
  step('SOP-менеджер создал вход CEO');

  // ---------- идея (tashabbus) → CEO, уведомления, план адаптации ----------
  await E.reload({ waitUntil: 'networkidle' }); await watchSync(E); await skipTour(E);   // свежие данные: вход CEO уже есть
  await click(E, 'Tashabbus', { wait: 500 });
  await click(E, 'Yuborish', { wait: 300 });                   // без адресата не уходит
  assert.ok((await E.innerText('.ini-modal')).includes('Kimga yuborishni tanlang'), 'нужно выбрать, кому');
  await E.locator('.ini-to-card').first().click();
  assert.ok((await E.innerText('.ini-to-card >> nth=0')).includes('Sherzod Aliyev'), 'в карточке — имя CEO');
  await E.locator('.ini-types:not(.ini-to) .ini-type-card').first().click();
  await E.fill('#f-ini-title', 'Yorliqlarni oldindan chop etish'); await E.fill('#f-ini-text', 'Ertalab navbat kamayadi');
  await E.selectOption('#f-ini-area', { label: 'Ombor' });
  await click(E, 'Yuborish', { wait: 500 });
  await shot(E, '11-ini-sent');
  await E.keyboard.press('Escape');
  await settle(E);
  const idea = srv.g.state().initiatives.find(x => x.uid === emp.id);
  assert.ok(idea && idea.to === 'ceo', 'идея на сервере, адресат — CEO');
  assert.ok(srv.g.state().notifications.some(n => n.userId === ceo.id && n.kind === 'ini_in'), 'CEO получил уведомление');

  const C = await device('CEO');
  await signIn(C, 'ceo', 'ceo-parol-1');
  assert.ok((await C.innerText('main')).includes('Yorliqlarni oldindan chop etish'), 'CEO видит идею');
  assert.equal(await C.evaluate(() => LmsClient.initial().course.sections.length), 0, 'курса у CEO нет');
  await C.selectOption('#f-is-' + idea.id, 'accepted');
  await C.fill('#f-ir-' + idea.id, 'Zo‘r, keyingi haftadan boshlaymiz');
  await click(C, 'Saqlash va xabar berish');
  await settle(C);
  await shot(C, '11b-ceo');
  const ans = srv.g.state().initiatives.find(x => x.id === idea.id);
  assert.equal(ans.status, 'accepted'); assert.equal(ans.reply, 'Zo‘r, keyingi haftadan boshlaymiz');
  assert.deepEqual(await rejected(C), [], 'сервер не отклонил ответ CEO');
  await A.reload({ waitUntil: 'networkidle' }); await watchSync(A);
  const seen = await A.evaluate(id => LmsClient.initial().initiatives.find(x => x.id === id), idea.id);
  assert.ok(seen && seen.status === 'accepted' && !seen.title && !seen.reply, 'SOP-менеджер видит только статус идеи');
  step('идея ушла CEO, CEO ответил; SOP-менеджер текста не видит');
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

  // ---------- демо по ?demo=1: как раньше, данные только в браузере ----------
  const D = await device('демо', '?demo=1');
  assert.equal(await D.locator('.demo-box').count(), 1, 'в демо — демо-входы');
  await D.fill('#f-login', 'metodist'); await D.fill('#f-password', 'admin123'); await D.click('button[type="submit"]');
  await D.waitForFunction(() => !document.querySelector('#f-password'));
  assert.ok((await D.innerText('body')).includes('Nodira Saidova'), 'демо-SOP-менеджер');
  step('демо по ?demo=1 работает без сервера');
  assert.deepEqual(errors, [], 'ошибок на странице нет');
  console.log('всё прошло');
} finally {
  if (errors.length) console.log('ОШИБКИ НА СТРАНИЦЕ:\n' + errors.join('\n'));
  await browser.close(); await srv.close();
}
