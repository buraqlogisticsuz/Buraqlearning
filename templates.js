/* Шаблоны новой платформы (на сервере их подставляет первый вход SOP-менеджера — fillTemplates в app.js):
   карьерная лестница, план адаптации 30/60, график работы; разбор 4-bob из файла прототипа.
   Демо больше нет: выдуманных сотрудников и данных здесь нет, платформа работает только с сервером. */

var DAY = 864e5;

function dayKey(ts) { var d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

function prand(seed) { var x = Math.sin(seed) * 10000; return x - Math.floor(x); }

function acc(mode, extra) { return Object.assign({ mode: mode, depts: [], positions: [], minLevel: 0, users: [], canAdd: 'none' }, extra || {}); }

/* 4-bob → два раздела курса (ombor; transport, chegara, bojxona). Тот же разбор — у «Загрузить курс из файла прототипа» */
function ch4Sections(list) {
  var ch = list.map(function (x) { return { id: x.id, title: x.title, html: x.html, quiz: x.quiz, video: x.video, source: '4-bob' }; });
  return [
    { id: 's2', title: '4-bob. Logistika standartlari · 1-qism: ombor', officialOnly: false, lessons: ch.slice(0, 8) },
    { id: 's3', title: '4-bob. Logistika standartlari · 2-qism: transport, chegara, bojxona', officialOnly: true, lessons: ch.slice(8) }];
}

function seedLevels() {
  /* conds: what it takes to REACH this level — the SOP manager edits them; “task” items are ticked by the SOP manager */
  function L(id, title, role, gold, conds) {
    return { id: id, name: { uz: title, ru: title, en: title, zh: title }, role: role, gold: gold, conds: conds };
  }
  function C(id, type, n, extra) { return Object.assign({ id: id, type: type, n: n }, extra || {}); }
  function T(uz, ru, en, zh) { return { uz: uz, ru: ru, en: en, zh: zh }; }
  return [
    L('trainee', 'Trainee', { uz: 'Stajyor', ru: 'Стажёр', en: '', zh: '实习生' }, 240, []),
    L('junior', 'Junior', { uz: 'Kichik mutaxassis', ru: 'Младший специалист', en: '', zh: '初级专员' }, 300, [
      C('jx', 'xp', 240), C('js1', 'sec', 0, { sid: 's1' }), C('js2', 'sec', 0, { sid: 's2' }), C('jd', 'days', 10),
      C('jt', 'task', 0, { title: T('Birinchi yuk qabulini murabbiy bilan birga o‘tkazish', 'Провести первую приёмку груза вместе с наставником', 'Handle a first cargo intake together with a mentor', '在导师陪同下完成第一次收货') })]),
    L('senior', 'Senior', { uz: 'Katta mutaxassis', ru: 'Старший специалист', en: '', zh: '高级专员' }, 400, [
      C('sx', 'xp', 300), C('ss3', 'sec', 0, { sid: 's3' }), C('sa', 'avg', 85), C('sd', 'drill', 3), C('sp', 'plan', 100), C('st', 'tenure', 60),
      C('stk', 'task', 0, { title: T('10 ta jo‘natmani mustaqil va xatosiz rasmiylashtirish', 'Самостоятельно оформить 10 отправок без ошибок', 'Process 10 shipments on your own without errors', '独立办理 10 票货运且零差错') })]),
    L('teamlead', 'Team Lead', { uz: 'Jamoa rahbari', ru: 'Руководитель группы', en: '', zh: '团队负责人' }, 500, [
      C('tx', 'xp', 400), C('ta', 'avg', 85), C('ti', 'ini', 1), C('tt', 'tenure', 90),
      C('ttk', 'task', 0, { title: T('Bir oy davomida yangi xodimga murabbiylik qilish', 'Месяц наставничества над новым сотрудником', 'Mentor a new employee for a month', '带教一名新员工一个月') })]),
    L('head', 'Head of Department', { uz: 'Bo‘lim boshlig‘i', ru: 'Начальник отдела', en: '', zh: '部门经理' }, 600, [
      C('hx', 'xp', 500), C('ha', 'avg', 90), C('hi', 'ini', 1), C('ht', 'tenure', 180),
      C('htk', 'task', 0, { title: T('Bo‘lim jarayonini yaxshilash loyihasini himoya qilish', 'Защитить проект улучшения процесса отдела', 'Present a process-improvement project for the department', '为部门流程改进项目答辩') })]),
    L('project', 'Project Manager', { uz: 'Loyiha boshqaruvchisi', ru: 'Руководитель проектов', en: '', zh: '项目总监' }, 700, [
      C('px', 'xp', 600), C('pa', 'avg', 92), C('pi', 'ini', 2), C('pt', 'tenure', 180)]),
    L('ceo', 'CEO', { uz: 'Bosh ijrochi direktor', ru: 'Генеральный директор', en: '', zh: '首席执行官' }, 800, [
      C('cx', 'xp', 700), C('ca', 'avg', 95), C('ci', 'ini', 3), C('ct', 'tenure', 365)])];
}

/* milestones of the adaptation plan (one list for everyone) */
function seedPlan() {
  function M(id, day, uz, ru, en, zh) { return { id: id, day: day, text: { uz: uz, ru: ru, en: en, zh: zh } }; }
  return [
    M('p1', 30, 'Anketa, mol-mulk va foydalanish shartlari to‘ldirilgan', 'Анкета, имущество и условия использования заполнены', 'Profile, property and terms completed', '已完成个人信息表、资产登记与使用条款'),
    M('p2', 30, '“Kompaniya bilan tanishuv” bo‘limi to‘liq o‘tilgan', 'Раздел «Знакомство с компанией» пройден полностью', 'The “Getting to know the company” section fully passed', '已完成「公司介绍」章节'),
    M('p3', 30, 'Mentor bilan tanishuv suhbati o‘tkazilgan', 'Проведена вводная встреча с наставником', 'Intro meeting with the mentor held', '已与导师进行入职面谈'),
    M('p6', 60, 'Kurs darslarining kamida yarmi topshirilgan', 'Сдано не менее половины уроков курса', 'At least half of the course lessons passed', '已通过课程中至少一半的课'),
    M('p7', 60, 'Kundalik ish mustaqil, nazoratsiz bajarilyapti', 'Ежедневная работа выполняется самостоятельно, без контроля', 'Daily work is done independently, without supervision', '日常工作可独立完成，无需监督'),
    M('p8', 60, 'Kamida bitta pulse-so‘rovnoma to‘ldirilgan', 'Заполнен хотя бы один пульс-опрос', 'At least one pulse survey completed', '已完成至少一次简短问卷')];
}

/* work schedule per department — the turnstile attendance is compared with it */
function seedSchedule() {
  return { def: { start: '09:00', end: '18:00', grace: 10 },
    dept: { 'Ombor (Yiwu)': { start: '08:00', end: '17:00', grace: 5 }, 'Ombor (Zhongshan)': { start: '08:00', end: '17:00', grace: 5 } } };
}
