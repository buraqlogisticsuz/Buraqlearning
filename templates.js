/* Шаблоны новой платформы (на сервере их подставляет первый вход SOP-менеджера — fillTemplates в app.js):
   карьерная лестница, программы обучения, план адаптации 30/60/90, график работы; разбор 4-bob из файла прототипа.
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

function seedTracks() {
  return [
    { id: 'tr_wh', title: { uz: 'Ombor xodimi', ru: 'Сотрудник склада', en: 'Warehouse staff', zh: '仓库员工' },
      desc: { uz: 'Qabul, markirovka, WMS va ombor xavfsizligi.', ru: 'Приёмка, маркировка, WMS и безопасность склада.', en: 'Receiving, labelling, WMS and warehouse safety.', zh: '收货、贴标、WMS 与仓库安全。' },
      positions: ['Omborchi', 'Ombor mudiri'], sections: ['s1', 's2'] },
    { id: 'tr_cus', title: { uz: 'Bojxona va hujjatlar', ru: 'Таможня и документы', en: 'Customs and documents', zh: '海关与单据' },
      desc: { uz: 'Hujjatlar, deklaratsiya, chegara va tranzit.', ru: 'Документы, декларация, граница и транзит.', en: 'Documents, declarations, border and transit.', zh: '单据、报关、边境与过境。' },
      positions: ['Bojxona deklaranti'], sections: ['s1', 's3'] },
    { id: 'tr_mgr', title: { uz: 'Menejer (to‘liq dastur)', ru: 'Менеджер (полная программа)', en: 'Manager (full programme)', zh: '经理（完整课程）' },
      desc: { uz: 'Butun zanjir: ombor, transport, chegara va mijoz bilan ishlash.', ru: 'Вся цепочка: склад, транспорт, граница и работа с клиентом.', en: 'The whole chain: warehouse, transport, border and client work.', zh: '完整链条：仓库、运输、边境与客户工作。' },
      positions: ['Mijozlar menejeri', 'Logistika menejeri'], sections: ['s1', 's2', 's3'] }];
}

/* milestones of the adaptation plan; `track` limits an item to one programme */
function seedPlan() {
  function M(id, day, track, uz, ru, en, zh) { return { id: id, day: day, track: track, text: { uz: uz, ru: ru, en: en, zh: zh } }; }
  return [
    M('p1', 30, null, 'Anketa, mol-mulk va foydalanish shartlari to‘ldirilgan', 'Анкета, имущество и условия использования заполнены', 'Profile, property and terms completed', '已完成个人信息表、资产登记与使用条款'),
    M('p2', 30, null, '“Kompaniya bilan tanishuv” bo‘limi to‘liq o‘tilgan', 'Раздел «Знакомство с компанией» пройден полностью', 'The “Getting to know the company” section fully passed', '已完成「公司介绍」章节'),
    M('p3', 30, null, 'Mentor bilan tanishuv suhbati o‘tkazilgan', 'Проведена вводная встреча с наставником', 'Intro meeting with the mentor held', '已与导师进行入职面谈'),
    M('p4', 30, 'tr_wh', 'Qabul zonasida mentor nazoratida kamida 5 ta yuk qabul qilingan', 'Под контролем наставника принято не менее 5 грузов', 'At least 5 shipments received under the mentor’s supervision', '在导师指导下完成至少 5 批货物收货'),
    M('p5', 30, 'tr_cus', 'Mentor bilan birga kamida 2 ta deklaratsiya to‘ldirilgan', 'Вместе с наставником заполнено не менее 2 деклараций', 'At least 2 declarations filled in with the mentor', '与导师一起填写至少 2 份报关单'),
    M('p6', 60, null, 'Dastur darslarining kamida yarmi topshirilgan', 'Сдано не менее половины уроков программы', 'At least half of the programme’s lessons passed', '已通过课程中至少一半的课'),
    M('p7', 60, null, 'Kundalik ish mustaqil, nazoratsiz bajarilyapti', 'Ежедневная работа выполняется самостоятельно, без контроля', 'Daily work is done independently, without supervision', '日常工作可独立完成，无需监督'),
    M('p8', 60, null, 'Kamida bitta pulse-so‘rovnoma to‘ldirilgan', 'Заполнен хотя бы один пульс-опрос', 'At least one pulse survey completed', '已完成至少一次简短问卷'),
    M('p9', 60, 'tr_mgr', 'Mijoz bilan mustaqil yozishma va AI-trenajyorda kamida 2 ta ssenariy', 'Самостоятельная переписка с клиентом и 2 сценария в AI-тренажёре', 'Independent client correspondence and 2 AI drill scenarios', '独立与客户沟通，并完成 2 个 AI 情景演练'),
    M('p10', 90, null, 'Dastur bo‘yicha barcha darslar va imtihonlar topshirilgan', 'Все уроки и экзамены программы сданы', 'All programme lessons and exams passed', '已通过课程的全部课程与考试'),
    M('p11', 90, null, 'Kamida bitta tashabbus yuborilgan', 'Отправлена хотя бы одна инициатива', 'At least one initiative submitted', '已提交至少一条建议'),
    M('p12', 90, null, 'Mentor va bo‘lim rahbari yakuniy suhbat o‘tkazgan', 'Проведена итоговая встреча с наставником и руководителем', 'Final review with the mentor and the head of department held', '已与导师和部门负责人进行总结面谈'),
    M('p13', 90, null, 'Sinov muddati yakuni: rasmiy xodim statusiga tavsiya', 'Итог испытательного срока: рекомендация на штатную позицию', 'End of probation: recommendation for a permanent position', '试用期结束：建议转为正式员工')];
}

/* work schedule per department — the turnstile attendance is compared with it */
function seedSchedule() {
  return { def: { start: '09:00', end: '18:00', grace: 10 },
    dept: { 'Ombor (Yiwu)': { start: '08:00', end: '17:00', grace: 5 }, 'Ombor (Zhongshan)': { start: '08:00', end: '17:00', grace: 5 } } };
}
