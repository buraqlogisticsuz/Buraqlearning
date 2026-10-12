/* @ds-bundle: {"format":4,"namespace":"LOR","components":[{"name":"Button"},{"name":"Arrow"},{"name":"StatusBadge"},{"name":"ProgressBar"},{"name":"TextField"},{"name":"LangSwitch"},{"name":"AppHeader"},{"name":"CourseTree"},{"name":"Protected"},{"name":"Watermark"},{"name":"VideoPlayer"},{"name":"LessonSplit"},{"name":"FeedbackModal"},{"name":"AccessRequest"},{"name":"UpdateToast"},{"name":"QuizQuestion"},{"name":"RequestInbox"},{"name":"ProgressTable"},{"name":"ExamReview"},{"name":"LoginScreen"},{"name":"ProfileForm"}]} */
(function () {
  var R = window.React;
  var h = R.createElement;
  var useState = R.useState, useEffect = R.useEffect, useRef = R.useRef;

  function cx() { var o = []; for (var i = 0; i < arguments.length; i++) if (arguments[i]) o.push(arguments[i]); return o.join(' '); }
  function omit(p, keys) { var o = {}; for (var k in p) if (keys.indexOf(k) < 0) o[k] = p[k]; return o; }
  function initials(n) { return String(n || '').split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase(); }

  /* ------------------------------------------------------------------ i18n */
  var I18N = {
    uz: {
      login_title: 'Tizimga kirish', login: 'Login', password: 'Parol', sign_in: 'Kirish',
      login_hint: 'Login va parolni administrator beradi. Parolni unutgan bo‘lsangiz — metodistga murojaat qiling.',
      app: 'O‘quv platformasi',
      profile_title: 'Xodim anketasi', profile_lock: 'Anketa to‘liq to‘ldirilmaguncha o‘quv bo‘limi yopiq turadi.',
      step_personal: 'Shaxsiy ma’lumotlar', step_contact: 'Aloqa', step_exp: 'Tajriba',
      back: 'Orqaga', save_next: 'Saqlash va davom etish', required_note: '* — majburiy maydonlar',
      contents: 'Mundarija', official_only: 'Rasmiy xodimlar uchun',
      s_probation: 'Sinov muddati', s_official: 'Rasmiy xodim', s_locked: 'Yopiq', s_in_progress: 'O‘rganilmoqda',
      s_exam_ready: 'Imtihonga tayyor', s_passed: 'O‘tdi', s_failed: 'O‘tmadi', s_question: 'Savol yuborildi', s_updated: 'Yangilandi', s_todo: 'Boshlanmagan',
      modal_q: 'Mavzuni to‘liq o‘rganib chiqdingizmi? Nimadir tushunmagan joyingiz qoldimi?',
      opt_a: 'Tushunmagan joyim bor', opt_a_sub: 'Savolingizni yozing — metodist yo‘riqnomaga aniqlik kiritadi.',
      opt_b: 'Hammasini tushundim', opt_b_sub: 'Adminga imtihon topshirish haqida so‘rov yuboriladi.',
      q_label: 'Qaysi band tushunarsiz?', q_placeholder: 'Masalan: 3-qadam — mijozdan yozma tasdiqni kim oladi?',
      send: 'Yuborish', cancel: 'Bekor qilish',
      confirm_title: 'Imtihonga tayyormisiz?', confirm_text: 'Hammasi tushunarli bo‘lsa, adminga imtihon topshirish haqida xabar yuboriladi.',
      yes: 'Ha, tayyorman', no: 'Yo‘q, qayta o‘qiyman',
      sent_q: 'Savolingiz yuborildi. Yo‘riqnoma yangilanganda bildirishnoma olasiz.',
      sent_exam: 'So‘rov yuborildi. Imtihondan o‘tmaguncha keyingi modul yopiq.', close: 'Yopish',
      access_title: 'Sinov muddati tugadimi?', access_text: 'Sinov muddatidan o‘tganligim munosabati bilan keyingi yo‘riqnomalarga ruxsat ochishingizni so‘rayman.',
      access_btn: 'Ruxsat so‘rash', access_pending: 'So‘rov ko‘rib chiqilmoqda', access_ok: 'Ruxsat berildi — rasmiy yo‘riqnomalar ochildi',
      tab_q: 'Savollar', tab_exam: 'Imtihon so‘rovlari', tab_access: 'Ruxsat so‘rovlari',
      reply: 'Javob berish', edit_sop: 'Yo‘riqnomani tahrirlash', grade: 'Natijani qayd etish', approve: 'Tasdiqlash', decline: 'Rad etish',
      toast: 'Siz tushunmagan band bo‘yicha yo‘riqnoma yangilandi', view: 'Ko‘rish',
      video_lock: 'Himoyalangan oqim · yuklab olib bo‘lmaydi',
      quiz_q: 'Savol', check: 'Javobni tekshirish', right: 'To‘g‘ri', wrong: 'Noto‘g‘ri',
      who: 'Kim → kimga', limit: 'Mas’uliyat chegarasi', finish: 'Mavzuni yakunlash',
      review_title: 'Imtihon natijasi', auto_test: 'Avtomatik test', oral: 'Og‘zaki suhbat', pass_mark: 'o‘tish bali',
      pass: 'O‘tdi', fail: 'O‘tmadi', comment: 'Izoh (xodimga ko‘rinadi)', save_result: 'Natijani saqlash',
      th_emp: 'Xodim', th_status: 'Status', th_lesson: 'Joriy dars', th_exams: 'Imtihonlar', th_prog: 'O‘zlashtirish', progress: 'O‘zlashtirish',
      hidden: 'Kontent vaqtincha yashirildi. Davom etish uchun oynaga qayting.'
    },
    ru: {
      login_title: 'Вход в систему', login: 'Логин', password: 'Пароль', sign_in: 'Войти',
      login_hint: 'Логин и пароль выдаёт администратор. Забыли пароль — обратитесь к методисту.',
      app: 'Учебная платформа',
      profile_title: 'Анкета сотрудника', profile_lock: 'Пока анкета не заполнена полностью, обучение закрыто.',
      step_personal: 'Личные данные', step_contact: 'Контакты', step_exp: 'Опыт',
      back: 'Назад', save_next: 'Сохранить и продолжить', required_note: '* — обязательные поля',
      contents: 'Содержание', official_only: 'Для штатных сотрудников',
      s_probation: 'Испытательный срок', s_official: 'Штатный сотрудник', s_locked: 'Закрыто', s_in_progress: 'Изучается',
      s_exam_ready: 'Готов к экзамену', s_passed: 'Сдал', s_failed: 'Не сдал', s_question: 'Вопрос отправлен', s_updated: 'Обновлено', s_todo: 'Не начато',
      modal_q: 'Вы полностью изучили тему? Остались непонятные моменты?',
      opt_a: 'Есть непонятные моменты', opt_a_sub: 'Напишите вопрос — методист уточнит инструкцию.',
      opt_b: 'Всё понятно', opt_b_sub: 'Администратору уйдёт заявка на экзамен.',
      q_label: 'Какой пункт непонятен?', q_placeholder: 'Например: шаг 3 — кто получает письменное подтверждение клиента?',
      send: 'Отправить', cancel: 'Отмена',
      confirm_title: 'Готовы к экзамену?', confirm_text: 'Если всё понятно, администратор получит уведомление о готовности к экзамену.',
      yes: 'Да, готов', no: 'Нет, перечитаю',
      sent_q: 'Вопрос отправлен. Вы получите уведомление, когда инструкцию обновят.',
      sent_exam: 'Заявка отправлена. Следующий модуль откроется после сдачи экзамена.', close: 'Закрыть',
      access_title: 'Испытательный срок завершён?', access_text: 'В связи с прохождением испытательного срока прошу открыть доступ к следующим инструкциям.',
      access_btn: 'Запросить доступ', access_pending: 'Заявка на рассмотрении', access_ok: 'Доступ открыт — штатные инструкции доступны',
      tab_q: 'Вопросы', tab_exam: 'Заявки на экзамен', tab_access: 'Запросы доступа',
      reply: 'Ответить', edit_sop: 'Править инструкцию', grade: 'Внести результат', approve: 'Одобрить', decline: 'Отклонить',
      toast: 'Инструкция по вашему вопросу обновлена', view: 'Открыть',
      video_lock: 'Защищённый поток · скачивание недоступно',
      quiz_q: 'Вопрос', check: 'Проверить ответ', right: 'Верно', wrong: 'Неверно',
      who: 'Кто → кому', limit: 'Границы ответственности', finish: 'Завершить тему',
      review_title: 'Результат экзамена', auto_test: 'Автотест', oral: 'Устная беседа', pass_mark: 'проходной балл',
      pass: 'Сдал', fail: 'Не сдал', comment: 'Комментарий (виден сотруднику)', save_result: 'Сохранить результат',
      th_emp: 'Сотрудник', th_status: 'Статус', th_lesson: 'Текущий урок', th_exams: 'Экзамены', th_prog: 'Освоение', progress: 'Освоение',
      hidden: 'Контент временно скрыт. Вернитесь в окно, чтобы продолжить.'
    },
    en: {
      login_title: 'Sign in', login: 'Login', password: 'Password', sign_in: 'Sign in',
      login_hint: 'Your login and password are issued by the administrator. Forgot it? Contact your methodologist.',
      app: 'Learning platform',
      profile_title: 'Employee profile', profile_lock: 'Training stays locked until the profile is fully completed.',
      step_personal: 'Personal details', step_contact: 'Contacts', step_exp: 'Experience',
      back: 'Back', save_next: 'Save and continue', required_note: '* — required fields',
      contents: 'Contents', official_only: 'For official staff',
      s_probation: 'Probation', s_official: 'Official staff', s_locked: 'Locked', s_in_progress: 'In progress',
      s_exam_ready: 'Ready for exam', s_passed: 'Passed', s_failed: 'Failed', s_question: 'Question sent', s_updated: 'Updated', s_todo: 'Not started',
      modal_q: 'Have you fully studied this topic? Is anything still unclear?',
      opt_a: 'Something is unclear', opt_a_sub: 'Write your question — the methodologist will clarify the SOP.',
      opt_b: 'Everything is clear', opt_b_sub: 'An exam request will be sent to the admin.',
      q_label: 'Which point is unclear?', q_placeholder: 'E.g. step 3 — who gets the client’s written confirmation?',
      send: 'Send', cancel: 'Cancel',
      confirm_title: 'Ready for the exam?', confirm_text: 'If everything is clear, the admin will be notified that you are ready for the exam.',
      yes: 'Yes, I’m ready', no: 'No, I’ll reread',
      sent_q: 'Question sent. You’ll be notified when the SOP is updated.',
      sent_exam: 'Request sent. The next module unlocks after you pass the exam.', close: 'Close',
      access_title: 'Probation finished?', access_text: 'Having completed my probation period, I request access to the next set of instructions.',
      access_btn: 'Request access', access_pending: 'Request under review', access_ok: 'Access granted — official SOPs unlocked',
      tab_q: 'Questions', tab_exam: 'Exam requests', tab_access: 'Access requests',
      reply: 'Reply', edit_sop: 'Edit SOP', grade: 'Record result', approve: 'Approve', decline: 'Decline',
      toast: 'The SOP section you asked about has been updated', view: 'View',
      video_lock: 'Protected stream · download disabled',
      quiz_q: 'Question', check: 'Check answer', right: 'Correct', wrong: 'Incorrect',
      who: 'Who → whom', limit: 'Responsibility boundary', finish: 'Finish topic',
      review_title: 'Exam result', auto_test: 'Auto test', oral: 'Oral interview', pass_mark: 'pass mark',
      pass: 'Passed', fail: 'Failed', comment: 'Comment (visible to employee)', save_result: 'Save result',
      th_emp: 'Employee', th_status: 'Status', th_lesson: 'Current lesson', th_exams: 'Exams', th_prog: 'Progress', progress: 'Progress',
      hidden: 'Content hidden. Return to this window to continue.'
    },
    zh: {
      login_title: '登录系统', login: '登录名', password: '密码', sign_in: '登录',
      login_hint: '登录名和密码由管理员发放。忘记密码请联系培训主管。',
      app: '培训平台',
      profile_title: '员工信息表', profile_lock: '个人信息表未填写完整前，培训内容保持锁定。',
      step_personal: '个人信息', step_contact: '联系方式', step_exp: '工作经历',
      back: '返回', save_next: '保存并继续', required_note: '* — 必填项',
      contents: '目录', official_only: '仅限正式员工',
      s_probation: '试用期', s_official: '正式员工', s_locked: '已锁定', s_in_progress: '学习中',
      s_exam_ready: '待考试', s_passed: '已通过', s_failed: '未通过', s_question: '问题已提交', s_updated: '已更新', s_todo: '未开始',
      modal_q: '本主题是否已学完？还有不清楚的地方吗？',
      opt_a: '有不清楚的地方', opt_a_sub: '写下问题，培训主管会补充说明标准。',
      opt_b: '全部清楚', opt_b_sub: '考试申请将发送给培训主管。',
      q_label: '哪一点不清楚？', q_placeholder: '例如：第 3 步——客户的书面确认由谁收取？',
      send: '发送', cancel: '取消',
      confirm_title: '准备好考试了吗？', confirm_text: '如果全部清楚，系统将通知培训主管你已准备好考试。',
      yes: '是，已准备好', no: '不，我再看一遍',
      sent_q: '问题已发送。标准更新后你会收到通知。',
      sent_exam: '申请已发送。通过考试后将解锁下一模块。', close: '关闭',
      access_title: '试用期结束了吗？', access_text: '本人试用期已满，申请开通后续标准的访问权限。',
      access_btn: '申请权限', access_pending: '申请审核中', access_ok: '权限已开通——正式标准已解锁',
      tab_q: '问题', tab_exam: '考试申请', tab_access: '权限申请',
      reply: '回复', edit_sop: '编辑标准', grade: '录入成绩', approve: '批准', decline: '拒绝',
      toast: '你提问的标准条款已更新', view: '查看',
      video_lock: '受保护的视频流 · 已禁止下载',
      quiz_q: '问题', check: '检查答案', right: '正确', wrong: '错误',
      who: '谁 → 对谁', limit: '职责边界', finish: '完成本主题',
      review_title: '考试结果', auto_test: '自动测验', oral: '口试', pass_mark: '及格线',
      pass: '通过', fail: '未通过', comment: '评语（员工可见）', save_result: '保存结果',
      th_emp: '员工', th_status: '状态', th_lesson: '当前课程', th_exams: '考试', th_prog: '进度', progress: '进度',
      hidden: '内容已隐藏。返回本窗口继续。'
    }
  };
  function tr(lang) { var d = I18N[lang] || I18N.uz; return function (k) { return d[k] != null ? d[k] : (I18N.uz[k] != null ? I18N.uz[k] : k); }; }

  /* ------------------------------------------------------------------ icons (thin line, 1.5px) */
  function Icon(p) {
    var paths = {
      lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z',
      bell: 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0',
      play: 'M9 7l9 5-9 5z',
      check: 'M5 12.5l4.5 4.5L19 7.5',
      x: 'M6 6l12 12M18 6L6 18',
      shield: 'M12 3l7 3v6c0 4.2-3 7.6-7 9-4-1.4-7-4.8-7-9V6z',
      edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
      q: 'M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5v.01'
    };
    var s = p.size || 18;
    return h('svg', { width: s, height: s, viewBox: '0 0 24 24', fill: p.fill ? 'currentColor' : 'none', stroke: p.fill ? 'none' : 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
      h('path', { d: paths[p.name] }), p.name === 'q' ? h('circle', { cx: 12, cy: 12, r: 9 }) : null);
  }

  /* ------------------------------------------------------------------ Button */
  function Button(p) {
    var v = p.variant || 'primary';
    var rest = omit(p, ['variant', 'size', 'arrow', 'block', 'className', 'children']);
    return h('button', Object.assign({ type: 'button' }, rest, { className: cx('lor-btn', 'lor-btn-' + v, p.size === 'sm' && 'lor-btn-sm', p.block && 'lor-btn-block', p.className) }),
      p.children, p.arrow ? h(Arrow, { length: 28 }) : null);
  }

  /* ------------------------------------------------------------------ Arrow (brand thin arrow) */
  function Arrow(p) {
    var L = p.length || 48, left = p.dir === 'left';
    return h('svg', { className: cx('lor-arrow', p.tone === 'red' && 'lor-arrow-red'), width: L, height: 10, viewBox: '0 0 ' + L + ' 10', 'aria-hidden': true },
      h('line', { x1: 1, y1: 5, x2: L - 1, y2: 5 }),
      left ? h('polyline', { points: '6,1 1,5 6,9' }) : h('polyline', { points: (L - 6) + ',1 ' + (L - 1) + ',5 ' + (L - 6) + ',9' }));
  }
  function RegMark() { return h('span', { className: 'lor-reg', 'aria-hidden': true }, '®'); }

  /* ------------------------------------------------------------------ StatusBadge */
  var GLYPH = { passed: '✓', failed: '✕', locked: '', 'exam-ready': '◎', question: '?', updated: '↻', probation: '◔', official: '●', 'in-progress': '•', todo: '○' };
  function StatusBadge(p) {
    var t = tr(p.lang), s = p.status || 'todo';
    return h('span', { className: cx('lor-badge', 'lor-badge-' + s) },
      s === 'locked' ? h(Icon, { name: 'lock', size: 12 }) : h('span', { className: 'lor-badge-ico', 'aria-hidden': true }, GLYPH[s] || '•'),
      p.children || t('s_' + s.replace('-', '_')));
  }

  /* ------------------------------------------------------------------ ProgressBar */
  function ProgressBar(p) {
    var v = Math.max(0, Math.min(100, p.value || 0));
    return h('div', { className: 'lor-progress', style: p.width ? { width: p.width } : null },
      p.label !== false ? h('div', { className: 'lor-progress-head' }, h('span', null, p.label || tr(p.lang)('progress')), h('b', null, v + '%')) : null,
      h('div', { className: 'lor-progress-track', role: 'progressbar', 'aria-valuenow': v, 'aria-valuemin': 0, 'aria-valuemax': 100 },
        h('div', { className: cx('lor-progress-fill', v === 100 && 'is-done'), style: { width: v + '%' } })));
  }

  /* ------------------------------------------------------------------ TextField */
  var fid = 0;
  function TextField(p) {
    var idRef = useRef(null); if (!idRef.current) idRef.current = 'lor-f' + (++fid);
    var id = p.id || idRef.current;
    var common = { id: id, className: cx('lor-input', p.error && 'is-error'), placeholder: p.placeholder, defaultValue: p.value, required: p.required, 'aria-invalid': !!p.error, onChange: p.onChange, type: p.type, readOnly: p.readOnly };
    var control = p.multiline ? h('textarea', omit(common, ['type'])) :
      p.options ? h('select', omit(common, ['type', 'placeholder']), p.options.map(function (o) { return h('option', { key: o, value: o }, o); })) :
      h('input', common);
    return h('div', { className: cx('lor-field', p.className) },
      p.label ? h('label', { className: 'lor-field-label', htmlFor: id }, p.label, p.required ? h('span', { className: 'lor-req', 'aria-hidden': true }, '*') : null) : null,
      control,
      p.error ? h('span', { className: 'lor-field-error' }, p.error) : p.hint ? h('span', { className: 'lor-field-hint' }, p.hint) : null);
  }

  /* ------------------------------------------------------------------ LangSwitch */
  function LangSwitch(p) {
    var st = useState(p.value || 'uz'), v = p.value || st[0];
    function set(l) { st[1](l); if (p.onChange) p.onChange(l); }
    return h('div', { className: cx('lor-lang', p.inverse && 'lor-lang-inverse'), role: 'group', 'aria-label': 'Til / Язык / Language' },
      ['uz', 'ru', 'en', 'zh'].map(function (l) { return h('button', { key: l, type: 'button', className: v === l ? 'is-on' : '', 'aria-pressed': v === l, onClick: function () { set(l); } }, l === 'zh' ? '\u4e2d' : l.toUpperCase()); }));
  }

  /* ------------------------------------------------------------------ AppHeader */
  function AppHeader(p) {
    var t = tr(p.lang), u = p.user || {};
    return h('header', { className: 'lor-header' },
      h('div', { className: 'lor-header-in' },
        p.logoSrc ? h('img', { className: 'lor-header-logo', src: p.logoSrc, alt: 'BURAQ logistics' }) : null,
        h('span', { className: 'lor-header-app' }, p.appName || t('app')),
        p.nav ? h('nav', { className: 'lor-header-nav' }, p.nav.map(function (n, i) { return h('a', { key: i, href: n.href || '#', className: n.active ? 'is-on' : '' }, n.label); })) : null,
        h('span', { className: 'lor-header-sp' }),
        h(LangSwitch, { value: p.lang, onChange: p.onLang, inverse: true }),
        h('button', { type: 'button', className: 'lor-bell', 'aria-label': 'Bildirishnomalar' }, h(Icon, { name: 'bell' }), p.notifications ? h('span', { className: 'lor-bell-n' }, p.notifications) : null),
        u.name ? h('div', { className: 'lor-user' }, h('span', { className: 'lor-user-av' }, initials(u.name)), h('span', null, u.name, u.role ? h('small', null, u.role) : null)) : null));
  }

  /* ------------------------------------------------------------------ CourseTree */
  function TreeIcon(p) {
    var s = p.status;
    if (s === 'locked') return h('span', { className: 'lor-tree-ico lor-ico-locked' }, h(Icon, { name: 'lock', size: 16 }));
    if (s === 'passed') return h('span', { className: 'lor-tree-ico lor-ico-passed', title: 'passed' }, '✓');
    if (s === 'failed') return h('span', { className: 'lor-tree-ico lor-ico-failed' }, '✕');
    if (s === 'exam-ready') return h('span', { className: 'lor-tree-ico lor-ico-exam-ready' }, '◎');
    if (s === 'in-progress') return h('span', { className: 'lor-tree-ico lor-ico-in-progress' });
    return h('span', { className: 'lor-tree-ico lor-ico-todo' });
  }
  function CourseTree(p) {
    var t = tr(p.lang);
    function section(sec, i) {
      return h('div', { key: i, className: cx('lor-tree-sec', sec.officialOnly && 'lor-tree-official') },
        h('div', { className: 'lor-tree-sec-h' },
          h('span', { className: 'lor-eyebrow' }, sec.title),
          sec.officialOnly ? h(StatusBadge, { status: 'locked', lang: p.lang }, t('official_only')) : null),
        h('ul', { className: 'lor-tree-list' }, (sec.lessons || []).map(function (l, j) {
          var locked = l.status === 'locked';
          return h('li', { key: j, className: cx('lor-tree-item', l.active && 'is-active', locked && 'is-locked'), 'aria-current': l.active ? 'page' : null, 'aria-disabled': locked || null, onClick: function () { if (!locked && p.onSelect) p.onSelect(l); } },
            h(TreeIcon, { status: l.status }), h('span', null, l.title),
            p.admin ? h('span', { className: 'lor-tree-admin-act' }, h('button', { type: 'button', 'aria-label': 'Edit' }, h(Icon, { name: 'edit', size: 14 }))) : null);
        })));
    }
    return h('aside', { className: 'lor-tree', 'aria-label': t('contents'), style: p.width ? { width: p.width } : null },
      p.progress != null ? h(ProgressBar, { value: p.progress, lang: p.lang }) : null,
      (p.sections || []).map(section));
  }

  /* ------------------------------------------------------------------ Watermark */
  function Watermark(p) {
    var text = p.text || '';
    var n = p.count || 60, items = [];
    for (var i = 0; i < n; i++) items.push(h('span', { key: i }, text));
    return h('div', { className: 'lor-wm', 'aria-hidden': true }, h('div', { className: 'lor-wm-grid' }, items));
  }

  /* ------------------------------------------------------------------ Protected (deterrents; see README "Kontent himoyasi") */
  function Protected(p) {
    var st = useState(false), hidden = st[0], setHidden = st[1];
    useEffect(function () {
      if (p.guard === false) return;
      function key(e) {
        var k = (e.key || '').toLowerCase(), mod = e.ctrlKey || e.metaKey;
        var devtools = k === 'f12' || (mod && e.shiftKey && (k === 'i' || k === 'j' || k === 'c')) || (e.metaKey && e.altKey && (k === 'i' || k === 'j' || k === 'c'));
        var save = mod && (k === 's' || k === 'p' || k === 'u' || k === 'c' || k === 'a');
        if (devtools || save) { e.preventDefault(); e.stopPropagation(); if (p.onViolation) p.onViolation(k); }
        if (k === 'printscreen') { setHidden(true); try { navigator.clipboard && navigator.clipboard.writeText(''); } catch (_) {} if (p.onViolation) p.onViolation(k); }
      }
      /* focus moving into an embedded video on this page (iframe) also blurs the window — that is not leaving the page */
      function blur() { if (!p.hideOnBlur) return; setTimeout(function () { var a = document.activeElement; if (!(a && a.tagName === 'IFRAME')) setHidden(true); }, 0); }
      function focus() { setHidden(false); }
      function vis() { if (document.hidden && p.hideOnBlur) setHidden(true); }
      window.addEventListener('keydown', key, true); window.addEventListener('keyup', key, true);
      window.addEventListener('blur', blur); window.addEventListener('focus', focus); document.addEventListener('visibilitychange', vis);
      return function () { window.removeEventListener('keydown', key, true); window.removeEventListener('keyup', key, true); window.removeEventListener('blur', blur); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', vis); };
    }, [p.guard, p.hideOnBlur]);
    function stop(e) { e.preventDefault(); }
    return h('div', { className: cx('lor-protected', hidden && 'is-hidden', p.className), onContextMenu: stop, onCopy: stop, onCut: stop, onDragStart: stop, style: p.style },
      p.children,
      p.watermark ? h(Watermark, { text: p.watermark }) : null,
      hidden ? h('div', { className: 'lor-shield', onClick: function () { setHidden(false); } }, tr(p.lang)('hidden')) : null);
  }

  /* ------------------------------------------------------------------ VideoPlayer */
  function VideoPlayer(p) {
    var t = tr(p.lang), pr = p.progress || 0;
    return h('div', { className: 'lor-video' },
      h('div', { className: 'lor-video-frame', onContextMenu: function (e) { e.preventDefault(); } },
        p.children || h('svg', { className: 'lor-video-art', viewBox: '0 0 320 180', preserveAspectRatio: 'xMidYMid slice', 'aria-hidden': true },
          h('line', { x1: 0, y1: 138, x2: 320, y2: 138 }),
          h('rect', { x: 40, y: 88, width: 120, height: 42, rx: 2 }), h('rect', { x: 160, y: 100, width: 36, height: 30, rx: 2 }),
          h('circle', { cx: 70, cy: 134, r: 8 }), h('circle', { cx: 176, cy: 134, r: 8 }),
          h('rect', { x: 216, y: 70, width: 72, height: 60, rx: 1 }), h('line', { x1: 228, y1: 70, x2: 228, y2: 130 }), h('line', { x1: 240, y1: 70, x2: 240, y2: 130 }), h('line', { x1: 252, y1: 70, x2: 252, y2: 130 }), h('line', { x1: 264, y1: 70, x2: 264, y2: 130 }), h('line', { x1: 276, y1: 70, x2: 276, y2: 130 }),
          h('path', { d: 'M20 40 H120 M112 34 L120 40 L112 46' })),
        h('button', { type: 'button', className: 'lor-video-play', 'aria-label': 'Play' }, h(Icon, { name: 'play', fill: true, size: 26 }))),
      h('div', { className: 'lor-video-bar' },
        h('span', null, p.current || '00:00'), h('div', { className: 'lor-video-track' }, h('i', { style: { width: pr + '%' } })), h('span', null, p.duration || '00:00')),
      h('div', { className: 'lor-video-meta' },
        h('span', { className: 'lor-sm' }, p.title),
        h('span', { className: 'lor-video-lock' }, h(Icon, { name: 'shield', size: 14 }), t('video_lock'))));
  }

  /* ------------------------------------------------------------------ LessonSplit */
  function LessonSplit(p) {
    var t = tr(p.lang);
    var steps = p.steps || [];
    return h(Protected, { watermark: p.watermark, lang: p.lang, guard: p.guard, hideOnBlur: p.hideOnBlur },
      h('div', { className: 'lor-lesson' },
        h('article', { className: 'lor-pane' },
          h('div', { className: 'lor-crumb' }, (p.breadcrumb || []).map(function (b, i) { return h(R.Fragment, { key: i }, i ? h(Arrow, { length: 16 }) : null, h('span', null, b)); })),
          h('h2', { className: 'lor-lesson-title' }, p.title),
          p.intro ? h('p', { className: 'lor-sop', style: { margin: 0 } }, p.intro) : null,
          h('ol', { className: 'lor-steps' }, steps.map(function (s, i) {
            return h('li', { key: i, className: 'lor-step' },
              h('span', { className: 'lor-step-n' }, String(i + 1).padStart(2, '0')),
              h('div', null, h('p', null, s.text),
                s.who ? h('span', { className: 'lor-who' }, t('who') + ':', s.who.map(function (w, k) { return h(R.Fragment, { key: k }, k ? h(Arrow, { length: 18 }) : null, h('b', null, w)); })) : null));
          })),
          p.limit ? h('div', { className: 'lor-limit' }, h('span', { className: 'lor-eyebrow' }, t('limit')), p.limit) : null,
          h('div', { className: 'lor-lesson-foot' }, h(Button, { variant: 'primary', arrow: true, onClick: p.onFinish }, t('finish')))),
        h('div', { className: 'lor-pane lor-pane-media' }, h(VideoPlayer, Object.assign({ lang: p.lang }, p.video || {})))));
  }

  /* ------------------------------------------------------------------ FeedbackModal */
  function FeedbackModal(p) {
    var t = tr(p.lang);
    var st = useState(p.step || 'ask'), step = st[0], go = st[1];
    var body;
    if (step === 'ask') {
      body = [
        h('span', { key: 'e', className: 'lor-eyebrow' }, p.lessonTitle),
        h('h3', { key: 'h', className: 'lor-h', id: 'lor-fm-h' }, t('modal_q')),
        h('div', { key: 'c', className: 'lor-choice' },
          h('button', { type: 'button', className: 'lor-choice-a', onClick: function () { go('question'); } }, h('span', { className: 'lor-choice-tag' }, 'A'), h('b', null, t('opt_a')), h('span', null, t('opt_a_sub'))),
          h('button', { type: 'button', className: 'lor-choice-b', onClick: function () { go('confirm'); } }, h('span', { className: 'lor-choice-tag' }, 'B'), h('b', null, t('opt_b')), h('span', null, t('opt_b_sub'))))];
    } else if (step === 'question') {
      body = [
        h('h3', { key: 'h', className: 'lor-h', id: 'lor-fm-h' }, t('opt_a')),
        h(TextField, { key: 'f', label: t('q_label'), multiline: true, placeholder: t('q_placeholder'), required: true }),
        h('div', { key: 'a', className: 'lor-modal-actions' },
          h(Button, { variant: 'ghost', onClick: function () { go('ask'); } }, t('back')),
          h(Button, { variant: 'primary', arrow: true, onClick: function () { go('sent-q'); if (p.onQuestion) p.onQuestion(); } }, t('send')))];
    } else if (step === 'confirm') {
      body = [
        h('h3', { key: 'h', className: 'lor-h', id: 'lor-fm-h' }, t('confirm_title')),
        h('p', { key: 'p', className: 'lor-muted' }, t('confirm_text')),
        h('div', { key: 'a', className: 'lor-modal-actions' },
          h(Button, { variant: 'outline', onClick: function () { go('ask'); } }, t('no')),
          h(Button, { variant: 'primary', arrow: true, onClick: function () { go('sent-exam'); if (p.onExamRequest) p.onExamRequest(); } }, t('yes')))];
    } else {
      body = [
        h('div', { key: 'd', className: 'lor-done' }, h('span', { className: 'lor-done-ico' }, h(Icon, { name: 'check' })),
          h('div', null, h(StatusBadge, { status: step === 'sent-q' ? 'question' : 'exam-ready', lang: p.lang }), h('p', { style: { marginTop: 8 } }, t(step === 'sent-q' ? 'sent_q' : 'sent_exam')))),
        h('div', { key: 'a', className: 'lor-modal-actions' }, h(Button, { variant: 'outline', onClick: p.onClose }, t('close')))];
    }
    return h('div', { className: cx('lor-scrim', p.inline && 'is-inline') },
      h('div', { className: 'lor-modal', role: 'dialog', 'aria-modal': !p.inline, 'aria-labelledby': 'lor-fm-h' },
        h('button', { type: 'button', className: 'lor-modal-x', 'aria-label': t('close'), onClick: p.onClose }, '×'), body));
  }

  /* ------------------------------------------------------------------ AccessRequest */
  function AccessRequest(p) {
    var t = tr(p.lang);
    var st = useState(p.state || 'available'), s = st[0];
    return h('section', { className: 'lor-notice' },
      h('div', { className: 'lor-notice-body' },
        h('b', null, s === 'approved' ? t('access_ok') : t('access_title')),
        s === 'approved' ? null : h('span', null, '“' + t('access_text') + '”')),
      s === 'available' ? h(Button, { variant: 'primary', arrow: true, onClick: function () { st[1]('pending'); if (p.onRequest) p.onRequest(); } }, t('access_btn')) :
      s === 'pending' ? h('span', { className: 'lor-notice-state' }, '◔ ', t('access_pending')) :
      h('span', { className: 'lor-notice-state' }, '✓ ', t('s_official')));
  }

  /* ------------------------------------------------------------------ UpdateToast */
  function UpdateToast(p) {
    var t = tr(p.lang);
    return h('div', { className: 'lor-toast', role: 'status' },
      h('span', { className: 'lor-toast-dot', 'aria-hidden': true }),
      h('div', { className: 'lor-toast-body' }, p.text || t('toast'), p.meta ? h('small', null, p.meta) : null),
      h(Button, { variant: 'outline', size: 'sm', onClick: p.onView }, t('view')));
  }

  /* ------------------------------------------------------------------ QuizQuestion (auto test) */
  function QuizQuestion(p) {
    var t = tr(p.lang);
    var st = useState(p.selected != null ? p.selected : null), sel = st[0];
    var ch = useState(!!p.checked), checked = ch[0];
    return h('div', { className: 'lor-quiz' },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 } },
        h('span', { className: 'lor-eyebrow' }, t('quiz_q') + ' ' + (p.n || 1) + ' / ' + (p.total || 1)),
        p.lessonTitle ? h('span', { className: 'lor-sm lor-muted' }, p.lessonTitle) : null),
      h('h3', { className: 'lor-h' }, p.question),
      h('div', { className: 'lor-quiz-opts', role: 'radiogroup' }, (p.options || []).map(function (o, i) {
        var right = checked && i === p.answer, wrong = checked && i === sel && i !== p.answer;
        return h('button', { key: i, type: 'button', role: 'radio', 'aria-checked': sel === i, className: cx('lor-opt', sel === i && 'is-sel', right && 'is-right', wrong && 'is-wrong'), onClick: function () { if (!checked) st[1](i); } },
          h('span', { className: 'lor-opt-k' }, 'ABCDEF'[i]), h('span', null, o),
          right ? h('span', { className: 'lor-opt-res' }, '✓ ' + t('right')) : wrong ? h('span', { className: 'lor-opt-res' }, '✕ ' + t('wrong')) : null);
      })),
      h('div', { style: { display: 'flex', justifyContent: 'flex-end' } },
        h(Button, { variant: 'primary', arrow: true, disabled: sel == null || checked, onClick: function () { ch[1](true); } }, t('check'))));
  }

  /* ------------------------------------------------------------------ RequestInbox (admin notification centre) */
  function RequestInbox(p) {
    var t = tr(p.lang);
    var st = useState(p.tab || 'questions'), tab = st[0];
    var data = p.items || {};
    var tabs = [['questions', t('tab_q')], ['exams', t('tab_exam')], ['access', t('tab_access')]];
    var list = data[tab] || [];
    function actions(it) {
      if (tab === 'questions') return [h(Button, { key: 1, variant: 'outline', size: 'sm' }, t('reply')), h(Button, { key: 2, variant: 'secondary', size: 'sm' }, t('edit_sop'))];
      if (tab === 'exams') return [h(Button, { key: 1, variant: 'primary', size: 'sm', arrow: true }, t('grade'))];
      return [h(Button, { key: 1, variant: 'ghost', size: 'sm' }, t('decline')), h(Button, { key: 2, variant: 'secondary', size: 'sm' }, t('approve'))];
    }
    return h('section', { className: 'lor-inbox' },
      h('div', { className: 'lor-tabs', role: 'tablist' }, tabs.map(function (tb) {
        return h('button', { key: tb[0], type: 'button', role: 'tab', 'aria-selected': tab === tb[0], className: cx('lor-tab', tab === tb[0] && 'is-on'), onClick: function () { st[1](tb[0]); } },
          tb[1], h('span', { className: 'lor-count' }, (data[tb[0]] || []).length));
      })),
      h('ul', { className: 'lor-inbox-list', role: 'tabpanel' }, list.map(function (it, i) {
        return h('li', { key: i, className: 'lor-req-item' },
          h('span', { className: 'lor-req-av' }, initials(it.name)),
          h('div', { className: 'lor-req-main' },
            h('div', { className: 'lor-req-top' }, it.unread ? h('span', { className: 'lor-unread', 'aria-label': 'new' }) : null, h('b', null, it.name), it.status ? h(StatusBadge, { status: it.status, lang: p.lang }) : null),
            h('span', { className: 'lor-sm lor-muted' }, it.lesson + (it.time ? ' · ' + it.time : '')),
            it.text ? h('p', { className: 'lor-req-text' }, it.text) : null),
          h('div', { className: 'lor-req-act' }, actions(it)));
      })));
  }

  /* ------------------------------------------------------------------ ProgressTable (admin monitoring) */
  function ProgressTable(p) {
    var t = tr(p.lang);
    return h('div', { className: 'lor-table-wrap' },
      h('table', { className: 'lor-table' },
        h('thead', null, h('tr', null, h('th', null, t('th_emp')), h('th', null, t('th_status')), h('th', null, t('th_lesson')), h('th', null, t('th_exams')), h('th', { style: { width: 180 } }, t('th_prog')))),
        h('tbody', null, (p.rows || []).map(function (r, i) {
          return h('tr', { key: i },
            h('td', null, h('div', { className: 'lor-emp' }, h('span', { className: 'lor-req-av', style: { width: 32, height: 32, fontSize: 12 } }, initials(r.name)), h('span', null, r.name, h('small', null, r.position + ' · ID ' + r.id)))),
            h('td', null, h(StatusBadge, { status: r.status, lang: p.lang })),
            h('td', null, r.lesson, r.lessonStatus ? h('div', { style: { marginTop: 4 } }, h(StatusBadge, { status: r.lessonStatus, lang: p.lang })) : null),
            h('td', null, h('span', { className: 'lor-exams', 'aria-label': r.exams.join(',') }, r.exams.map(function (e, k) { return h('i', { key: k, className: e }); }))),
            h('td', null, h(ProgressBar, { value: r.percent, label: false })));
        }))));
  }

  /* ------------------------------------------------------------------ ExamReview (admin records result: auto-test + oral) */
  function ExamReview(p) {
    var t = tr(p.lang);
    var st = useState(p.verdict || null), v = st[0];
    var passedTest = p.testScore >= p.passMark;
    return h('section', { className: 'lor-review lor-card' },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' } },
        h('div', null, h('span', { className: 'lor-eyebrow' }, t('review_title')), h('h3', { className: 'lor-h', style: { marginTop: 4 } }, p.employee), h('span', { className: 'lor-sm lor-muted' }, p.lesson)),
        h(StatusBadge, { status: 'exam-ready', lang: p.lang })),
      h('div', { className: 'lor-review-grid' },
        h('div', { className: 'lor-review-cell' }, h('span', { className: 'lor-eyebrow' }, t('auto_test')), h('span', { className: 'lor-score' }, p.testScore + '%'),
          h('div', { className: 'lor-review-mark' }, h('span', { className: 'lor-sm lor-muted' }, t('pass_mark') + ' ' + p.passMark + '%'), h(StatusBadge, { status: passedTest ? 'passed' : 'failed', lang: p.lang }))),
        h('div', { className: 'lor-review-cell' }, h('span', { className: 'lor-eyebrow' }, t('oral')),
          h('div', { className: 'lor-verdict' },
            h('button', { type: 'button', className: v === 'pass' ? 'is-pass' : '', 'aria-pressed': v === 'pass', onClick: function () { st[1]('pass'); } }, '✓ ', t('pass')),
            h('button', { type: 'button', className: v === 'fail' ? 'is-fail' : '', 'aria-pressed': v === 'fail', onClick: function () { st[1]('fail'); } }, '✕ ', t('fail'))))),
      h(TextField, { label: t('comment'), multiline: true, value: p.comment }),
      h('div', { className: 'lor-modal-actions' }, h(Button, { variant: 'primary', arrow: true, disabled: !v }, t('save_result'))));
  }

  /* ------------------------------------------------------------------ LoginScreen */
  function LoginScreen(p) {
    var st = useState(p.lang || 'uz'), lang = st[0], t = tr(lang);
    return h('div', { className: 'lor-login' },
      h('div', { className: 'lor-login-hero' },
        p.logoSrc ? h('img', { src: p.logoSrc, alt: 'BURAQ logistics' }) : h('span'),
        h('div', { className: 'lor-ladder', 'aria-label': 'Samaradorlik, ishonchlilik, mukammallik' },
          h('span', null, 'Samaradorlik'),
          h('span', null, h(Arrow, { dir: 'left', length: 88, tone: 'red' }), 'Ishonchlilik'),
          h('span', null, 'Mukammallik', h(RegMark))),
        h('div', { className: 'lor-login-foot' }, h('span', null, t('app')), h('span', null, 'BIRGALIKDA MUVAFFAQIYATGA'))),
      h('div', { className: 'lor-login-side' },
        h('form', { className: 'lor-login-card', onSubmit: function (e) { e.preventDefault(); } },
          h('div', { className: 'lor-login-top' }, h('span', { className: 'lor-eyebrow' }, 'LOR · LMS'), h(LangSwitch, { value: lang, onChange: st[1] })),
          h('h1', { className: 'lor-title' }, t('login_title')),
          h(TextField, { label: t('login'), placeholder: 'd.karimova', required: true }),
          h(TextField, { label: t('password'), type: 'password', placeholder: '••••••••', required: true }),
          h(Button, { variant: 'primary', block: true, arrow: true, type: 'submit' }, t('sign_in')),
          h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('login_hint')))));
  }

  /* ------------------------------------------------------------------ ProfileForm (mandatory first-login anketa) */
  function ProfileForm(p) {
    var t = tr(p.lang), step = p.step || 0;
    var steps = [t('step_personal'), t('step_contact'), t('step_exp')];
    var F = p.fields || [
      { label: 'Familiya', required: true, value: 'Karimova' }, { label: 'Ism', required: true, value: 'Dilnoza' },
      { label: 'Otasining ismi', value: 'Rustamovna' }, { label: 'Tug‘ilgan sana', required: true, type: 'date' },
      { label: 'Lavozim', required: true, options: ['Omborchi', 'Mijozlar menejeri', 'Logistika menejeri', 'Bojxona deklaranti'] },
      { label: 'Bo‘lim', required: true, options: ['Logistika bo‘limi', 'Bojxona bo‘limi', 'Savdo bo‘limi', 'Ombor (Yiwu)'] },
      { label: 'Pasport seriyasi va raqami', required: true, placeholder: 'AA 1234567', error: 'Maydonni to‘ldiring' },
      { label: 'Manzil', span: true, placeholder: 'Toshkent sh., …' }];
    return h('section', { className: 'lor-profile' },
      h('div', null, h('span', { className: 'lor-eyebrow' }, (step + 1) + ' / 3'), h('h1', { className: 'lor-title', style: { marginTop: 4 } }, t('profile_title'))),
      h('div', { className: 'lor-lock', role: 'note' }, h(Icon, { name: 'lock' }), t('profile_lock')),
      h('ol', { className: 'lor-stepper' }, steps.map(function (s, i) { return h('li', { key: i, className: i < step ? 'is-done' : i === step ? 'is-on' : '' }, s); })),
      h('div', { className: 'lor-form-grid' }, F.map(function (f, i) { return h(TextField, Object.assign({ key: i, className: f.span ? 'lor-span' : null }, f)); })),
      h('div', { className: 'lor-form-foot' },
        h('span', { className: 'lor-sm lor-muted' }, t('required_note')),
        h('div', { style: { display: 'flex', gap: 8 } }, h(Button, { variant: 'ghost', disabled: step === 0 }, t('back')), h(Button, { variant: 'primary', arrow: true }, t('save_next')))));
  }

  var LOR = window.LOR || {};
  Object.assign(LOR, {
    Button: Button, Arrow: Arrow, RegMark: RegMark, StatusBadge: StatusBadge, ProgressBar: ProgressBar, TextField: TextField, LangSwitch: LangSwitch,
    AppHeader: AppHeader, CourseTree: CourseTree, Protected: Protected, Watermark: Watermark, VideoPlayer: VideoPlayer, LessonSplit: LessonSplit,
    FeedbackModal: FeedbackModal, AccessRequest: AccessRequest, UpdateToast: UpdateToast, QuizQuestion: QuizQuestion,
    RequestInbox: RequestInbox, ProgressTable: ProgressTable, ExamReview: ExamReview, LoginScreen: LoginScreen, ProfileForm: ProfileForm,
    Icon: Icon, i18n: I18N, t: tr
  });
  window.LOR = LOR;
})();
