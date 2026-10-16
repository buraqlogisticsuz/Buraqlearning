var LOGO_W = 'buraq-brand/logo/buraq-logo-white.svg';
var TOUCH_ICON = 'icons/apple-touch-icon.png';
(function () {
  var R = React, h = R.createElement, F = R.Fragment;
  var useState = R.useState, useEffect = R.useEffect, useRef = R.useRef;
  var Btn = LOR.Button, Badge = LOR.StatusBadge, Arrow = LOR.Arrow, Icon = LOR.Icon, Progress = LOR.ProgressBar;
  var PASS_MARK = 80;
  /* the server (lms-client.js), its address is in config.js. Without it the page only says so — there is no demo any more */
  var SV = window.LmsClient && !window.LmsClient.demo ? window.LmsClient : null;
  try { localStorage.removeItem('lor-lms-demo-v8'); } catch (e) {}   // data of the former demo
  // сервер — Apps Script (код для него SOP-менеджер копирует с этой страницы), а не свой сервер на Node (server/, Railway)
  var GS = !!SV && /^https:\/\/script\.google(usercontent)?\.com\//.test(SV.url);
  var SAY = function () {};   /* a toast by string key — App puts its own in */

  /* ---------------- helpers ---------------- */
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function fmt(ts, t) { if (!ts) return ''; if (Date.now() - ts < 60e3) return t('ago_now'); var d = new Date(ts); return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + ' · ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function initials(n) { return String(n || '').split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase(); }
  function firstName(u) { return (u.name || '').split(' ')[0]; }
  function wmText(u) { var p = u.name.split(' '); var d = new Date(); return (p[1] || p[0]) + ' ' + p[0][0] + '. · ID ' + u.id + ' · ' + pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear(); }
  function genPw() { var c = 'abcdefghjkmnpqrstuvwxyz23456789', s = ''; for (var i = 0; i < 8; i++) s += c[Math.floor(Math.random() * c.length)]; return s; }
  function cx() { return Array.prototype.filter.call(arguments, Boolean).join(' '); }

  function flat(course) { var out = []; course.sections.forEach(function (s) { s.lessons.forEach(function (l) { out.push(Object.assign({}, l, { sectionId: s.id, sectionTitle: s.title, officialOnly: s.officialOnly })); }); }); return out; }
  function findLesson(course, id) { return flat(course).filter(function (l) { return l.id === id; })[0]; }
  function prog(db, uid) { return db.progress[uid] || {}; }
  function lessonStatus(db, user, lid) {
    var ls = trackFlat(db, user), i = ls.findIndex(function (l) { return l.id === lid; }); if (i < 0) return 'locked';
    if (ls[i].officialOnly && user.status !== 'official') return 'locked';
    var p = prog(db, user.id)[lid]; if (p && p.status) return p.status;
    var prev = ls[i - 1]; if (!prev || (prog(db, user.id)[prev.id] || {}).status === 'passed') return 'todo';
    return 'locked';
  }
  function available(db, user) { return trackFlat(db, user).filter(function (l) { return !l.officialOnly || user.status === 'official'; }); }
  function mastery(db, user) { var ls = available(db, user); var n = ls.filter(function (l) { return (prog(db, user.id)[l.id] || {}).status === 'passed'; }).length; return { passed: n, total: ls.length, pct: ls.length ? Math.round(n * 100 / ls.length) : 0 }; }
  function currentLesson(db, user) { var ls = trackFlat(db, user); for (var i = 0; i < ls.length; i++) { var s = lessonStatus(db, user, ls[i].id); if (s !== 'passed' && s !== 'locked') return Object.assign({ status: s }, ls[i]); } return null; }

  /* mutations inside update(d => …) */
  /* id of a new record: time plus a random part (d.seq + 1 would collide between two devices) */
  var lastId = 0;
  function nextId() { lastId = Math.max(Date.now() * 100 + Math.floor(Math.random() * 100), lastId + 1); return lastId; }
  function notify(d, userId, text, lessonId) { d.notifications.unshift({ id: nextId(d), userId: userId, text: text, lessonId: lessonId || null, at: Date.now(), read: false }); }
  function setProg(d, uid, lid, patch) { d.progress[uid] = d.progress[uid] || {}; d.progress[uid][lid] = Object.assign({}, d.progress[uid][lid] || {}, patch, { at: Date.now() }); }
  function userOf(db, id) { return db.users.filter(function (u) { return u.id === id; })[0] || { name: '—' }; }

  function useDB() {
    var s = useState(function () { return SV.initial(); }), db = s[0], set = s[1];
    var cur = useRef(db);
    useEffect(function () {
      var off = SV.subscribe(function (d) { cur.current = d; set(d); });
      // the server may have answered between the first render and this subscription — take what is there now
      var d = SV.initial(); cur.current = d; set(d);
      return off;
    }, []);
    /* the “before → after” difference goes to the server queue (computed here, once — not inside set) */
    function update(fn) {
      var prev = cur.current, d = clone(prev); fn(d);
      cur.current = d; SV.change(prev, d); set(d);
    }
    return [db, update];
  }

  /* ======================= FEATURES: sanitizer, rich text, study time, welcome/terms, AI, rating, path ======================= */

  /* ---------- sanitizer (SOP html is admin-authored; still allowlisted) ---------- */
  var ALLOWED = { P: 1, BR: 1, STRONG: 1, B: 1, EM: 1, I: 1, U: 1, UL: 1, OL: 1, LI: 1, H3: 1, H4: 1, TABLE: 1, THEAD: 1, TBODY: 1, TR: 1, TH: 1, TD: 1, IMG: 1, DIV: 1, SPAN: 1, BLOCKQUOTE: 1 };
  var OK_CLASSES = ['note', 'ilova', 'wide', 'tall', 'gal'];
  function sanitize(html) {
    var doc = new DOMParser().parseFromString('<div>' + (html || '') + '</div>', 'text/html'), root = doc.body.firstChild;
    (function walk(n) {
      Array.prototype.slice.call(n.childNodes).forEach(function (c) {
        if (c.nodeType === 3) return;
        if (c.nodeType !== 1) { n.removeChild(c); return; }
        if (!ALLOWED[c.tagName]) {
          if (!/^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|LINK|META|svg)$/i.test(c.tagName)) { walk(c); while (c.firstChild) n.insertBefore(c.firstChild, c); }
          n.removeChild(c); return;
        }
        Array.prototype.slice.call(c.attributes).forEach(function (a) {
          var k = a.name.toLowerCase(), v = a.value;
          var ok = (k === 'class' && v.split(/\s+/).every(function (x) { return !x || OK_CLASSES.indexOf(x) >= 0; }))
            || ((k === 'colspan' || k === 'rowspan') && /^\d+$/.test(v))
            || (c.tagName === 'IMG' && k === 'src' && /^(img\/[\w.-]+|data:image\/(png|jpe?g|gif|webp);base64,[\w+/=]+)$/.test(v))
            || (c.tagName === 'IMG' && (k === 'alt' || k === 'loading'));
          if (!ok) c.removeAttribute(a.name);
        });
        if (c.tagName === 'IMG' && !c.getAttribute('src')) { n.removeChild(c); return; }
        walk(c);
      });
    })(root);
    return root.innerHTML;
  }
  function plain(html) { return String(html || '').replace(/<(br|\/p|\/li|\/h\d|\/tr|\/div|\/blockquote)[^>]*>/gi, '\n').replace(/<\/t[dh]>/gi, ' | ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim(); }
  function lessonText(l) {
    return [l.title, l.intro, (l.steps || []).map(function (s, i) { return (i + 1) + '. ' + s.text + (s.who && s.who.length ? ' (' + s.who.join(' → ') + ')' : ''); }).join('\n'), plain(l.html), l.limit ? 'Mas’uliyat chegarasi: ' + l.limit : ''].filter(Boolean).join('\n');
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function inl(s) { return s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*(?!\s)([^*]+?)\*/g, '$1<em>$2</em>'); }
  function mdLite(src) {
    var out = [], list = null;
    function close() { if (list) { out.push('</' + list + '>'); list = null; } }
    esc(src || '').split('\n').forEach(function (l) {
      var m;
      if ((m = l.match(/^\s*[-•*]\s+(.*)/))) { if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; } out.push('<li>' + inl(m[1]) + '</li>'); }
      else if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; } out.push('<li>' + inl(m[1]) + '</li>'); }
      else if ((m = l.match(/^\s*#{1,4}\s+(.*)/))) { close(); out.push('<h4>' + inl(m[1]) + '</h4>'); }
      else if (!l.trim()) close();
      else { close(); out.push('<p>' + inl(l) + '</p>'); }
    });
    close(); return out.join('');
  }

  /* ---------- rich text editor (CMS) ---------- */
  function RichEditor(p) {
    var t = p.t, ref = useRef(null);
    useEffect(function () { if (ref.current) ref.current.innerHTML = sanitize(p.value || ''); }, [p.docKey]);
    function emit() { p.onChange(ref.current.innerHTML); }
    function cmd(c, v) { ref.current.focus(); try { document.execCommand(c, false, v); } catch (e) {} emit(); }
    var tools = [['H', function () { cmd('formatBlock', 'h4'); }, 'Heading'], ['¶', function () { cmd('formatBlock', 'p'); }, 'Paragraph'], ['B', function () { cmd('bold'); }, 'Bold'], ['I', function () { cmd('italic'); }, 'Italic'],
      ['•', function () { cmd('insertUnorderedList'); }, 'List'], ['1.', function () { cmd('insertOrderedList'); }, 'Numbered list'], [t('note_btn'), function () { cmd('formatBlock', 'blockquote'); }, t('note_btn')], ['⌫', function () { cmd('removeFormat'); }, 'Clear']];
    return h('div', { className: 'rte' },
      h('div', { className: 'rte-bar', role: 'toolbar', 'aria-label': t('rte_hint') }, tools.map(function (x) { return h('button', { key: x[2], type: 'button', title: x[2], 'aria-label': x[2], onMouseDown: function (e) { e.preventDefault(); }, onClick: x[1] }, x[0]); })),
      h('div', { ref: ref, className: 'rte-area sop-body', contentEditable: true, suppressContentEditableWarning: true, role: 'textbox', 'aria-multiline': true, 'aria-label': t('body'), onInput: emit, onBlur: emit,
        onPaste: function (e) { e.preventDefault(); var txt = (e.clipboardData || window.clipboardData).getData('text/plain'); document.execCommand('insertText', false, txt); emit(); } }));
  }

  /* ---------- SOP body with image lightbox ---------- */
  function SopBody(p) {
    var s = useState(null), html = sanitize(p.html);
    return h(F, null,
      h('div', { className: 'sop-body', dangerouslySetInnerHTML: { __html: html }, onClick: function (e) { if (e.target && e.target.tagName === 'IMG') s[1](e.target.getAttribute('src')); } }),
      s[0] ? h('div', { className: 'lightbox', role: 'dialog', 'aria-modal': true, onClick: function () { s[1](null); } }, h('img', { src: s[0], alt: '' }), h('button', { type: 'button', className: 'lor-modal-x', 'aria-label': 'Close' }, '×')) : null);
  }

  /* ---------- study time & reminders ---------- */
  var GOAL = 120;
  function todayKey() { return dayKey(Date.now()); }
  function studyMin(db, uid, key) { return ((db.study || {})[uid] || {})[key || todayKey()] || 0; }
  function fmtMin(m, t) { m = Math.max(0, Math.round(m)); var hh = Math.floor(m / 60), mm = m % 60; return hh ? hh + ' ' + t('h') + ' ' + pad(mm) + ' ' + t('min') : mm + ' ' + t('min'); }
  function hm(m) { m = Math.max(0, Math.round(m)); return Math.floor(m / 60) + ':' + pad(m % 60); }
  function daysSince(u) { return Math.max(1, Math.ceil((Date.now() - (u.startedAt || Date.now())) / DAY)); }
  function avgMinutes(db, u) { var st = (db.study || {})[u.id] || {}, sum = 0; for (var k in st) sum += st[k]; return sum / daysSince(u); }
  function streakOf(db, uid) { var s = studyMin(db, uid) >= GOAL ? 1 : 0; for (var i = 1; i < 400; i++) { if (studyMin(db, uid, dayKey(Date.now() - i * DAY)) >= GOAL) s++; else break; } return s; }

  function TodayChip(p) {
    var m = studyMin(p.db, p.user.id), pct = Math.min(100, m * 100 / GOAL);
    return h('button', { type: 'button', className: cx('today-chip', m >= GOAL && 'is-done'), onClick: p.onClick, title: p.t('today_goal') + ': ' + p.t('goal_2h') },
      h('span', null, p.t('today') + ' ' + hm(m) + ' / 2:00'), h('i', null, h('b', { style: { width: pct + '%' } })));
  }

  function DailyGoal(p) {
    var t = p.t, u = p.user, m = studyMin(p.db, u.id), done = m >= GOAL, st = streakOf(p.db, u.id);
    return h('section', { className: cx('box goal-box', done && 'is-done') },
      h('div', { className: 'goal-top' }, h('span', { className: 'lor-eyebrow' }, t('today_goal') + ' · ' + t('goal_2h')), st ? h('span', { className: 'lor-sm lor-muted' }, st + ' ' + t('streak')) : null),
      h('div', { className: 'goal-num' }, h('b', null, hm(m)), h('span', null, '/ 2:00')),
      h('div', { className: 'lor-progress-track', role: 'progressbar', 'aria-valuenow': Math.round(m), 'aria-valuemin': 0, 'aria-valuemax': GOAL }, h('div', { className: cx('lor-progress-fill', done && 'is-done'), style: { width: Math.min(100, m * 100 / GOAL) + '%' } })),
      h('p', { className: 'lor-sm', style: { margin: 0 } }, done ? '✓ ' + t('goal_done') : t('remind_text') + fmtMin(GOAL - m, t)),
      h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('reminder_time') + ': ' + (u.reminderTime || '19:00') + ' · ' + t('study_note')));
  }

  /* ---------- terms & welcome ---------- */
  function TermsList(p) {
    var items = TERMS[p.lang] || TERMS.uz;
    return h('ol', { className: 'terms-list' }, items.map(function (x, i) { return h('li', { key: i }, h('b', null, x[0]), h('span', null, x[1])); }));
  }
  function TermsModal(p) {
    var t = p.t;
    useEffect(function () { function k(e) { if (e.key === 'Escape') p.onClose(); } window.addEventListener('keydown', k); return function () { window.removeEventListener('keydown', k); }; }, []);
    return h('div', { className: 'lor-scrim', onMouseDown: function (e) { if (e.target === e.currentTarget) p.onClose(); } },
      h('div', { className: 'lor-modal terms-modal', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'tm-h' },
        h('button', { type: 'button', className: 'lor-modal-x', 'aria-label': t('close'), onClick: p.onClose }, '×'),
        h('span', { className: 'lor-eyebrow' }, t('app_full') + ' · ' + t('terms_version')), h('h2', { className: 'lor-h', id: 'tm-h' }, t('w4_t')),
        h('div', { className: 'terms-scroll' }, h(TermsList, { lang: p.lang })),
        p.acceptedAt ? h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, '✓ ' + t('accepted_on') + ': ' + fmt(p.acceptedAt, t)) : null));
  }
  function Welcome(p) {
    var t = p.t, u = p.user, s = useState(0), step = s[0], a1 = useState(false), a2 = useState(false);
    var slides = [
      { t: t('w1_t'), body: h('p', { className: 'lor-sop', style: { margin: 0 } }, t('w1_p')) },
      { t: t('w2_t'), body: h('ol', { className: 'welcome-list' }, t('w2_list').split('|').map(function (x, i) { return h('li', { key: i }, x); })) },
      { t: t('w3_t'), body: h('ul', { className: 'welcome-list is-ul' }, t('w3_list').split('|').map(function (x, i) { var parts = x.split(' — '); return h('li', { key: i }, h('b', null, parts[0]), parts[1] ? ' — ' + parts[1] : ''); })) },
      { t: t('w4_t'), body: h(F, null, h('p', { className: 'lor-muted', style: { margin: 0 } }, t('terms_intro')), h('div', { className: 'terms-scroll' }, h(TermsList, { lang: p.lang })),
        h('label', { className: 'check big' }, h('input', { type: 'checkbox', id: 'agree1', checked: a1[0], onChange: function (e) { a1[1](e.target.checked); } }), t('agree1')),
        h('label', { className: 'check big' }, h('input', { type: 'checkbox', id: 'agree2', checked: a2[0], onChange: function (e) { a2[1](e.target.checked); } }), t('agree2'))) }];
    var cur = slides[step], last = step === slides.length - 1;
    function accept() { p.update(function (d) { d.users.forEach(function (x) { if (x.id === u.id) { x.termsAcceptedAt = Date.now(); x.termsVersion = '1.0'; } }); d.audit.unshift({ id: nextId(d), userId: u.id, key: 'terms-accepted', at: Date.now() }); }); }
    return h('div', { className: 'welcome' },
      h('div', { className: 'welcome-card' },
        h('div', { className: 'welcome-side' },
          h('img', { src: LOGO_W, alt: 'BURAQ logistics', width: 104, height: 36 }),
          h('div', null, h('span', { className: 'welcome-hello' }, t('w_hello') + ','), h('b', { className: 'welcome-name' }, firstName(u))),
          h('ol', { className: 'welcome-steps' }, slides.map(function (x, i) { return h('li', { key: i, className: cx(i === step && 'is-on', i < step && 'is-done') }, x.t); })),
          h(LOR.LangSwitch, { value: p.lang, onChange: p.setLang, inverse: true })),
        h('div', { className: 'welcome-main' },
          h('span', { className: 'lor-eyebrow' }, (step + 1) + ' / ' + slides.length),
          h('h1', { className: 'lor-title' }, cur.t),
          h('div', { className: 'welcome-body' }, cur.body),
          h('div', { className: 'welcome-foot' },
            step === 0 ? h(Btn, { variant: 'ghost', onClick: p.logout }, t('logout')) : h(Btn, { variant: 'ghost', onClick: function () { s[1](step - 1); } }, t('prev')),
            last ? h('div', { className: 'welcome-final' }, h(Btn, { variant: 'ghost', onClick: p.logout }, t('decline_exit')), h(Btn, { variant: 'primary', arrow: true, disabled: !(a1[0] && a2[0]), onClick: accept }, t('accept_start')))
              : h(Btn, { variant: 'primary', arrow: true, onClick: function () { s[1](step + 1); } }, t('next'))))));
  }

  /* ---------- AI (claude.use("sample")) ---------- */
  /* AI through the server (Claude API; the key lives only in the script properties) — the same interface as claude.use('sample'):
     sampler(prompt | turns, { signal, modelTier, onText }) → { text, truncated }, sampler.json(...) → parsed JSON */
  function looseJson(s) {
    var t = String(s || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try { return JSON.parse(t); } catch (e) {}
    var a = Math.min.apply(null, ['{', '['].map(function (c) { var i = t.indexOf(c); return i < 0 ? Infinity : i; })), b = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
    if (a !== Infinity && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) {} }
    var err = new Error('bad json'); err.code = 'bad_json'; throw err;
  }
  var SERVER_SAMPLER = SV ? (function () {
    function run(input, opts, json) {
      opts = opts || {};
      var msgs = typeof input === 'string' ? [{ role: 'user', content: input }]
        : (input || []).map(function (m) { return { role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') }; });
      return SV.ai(msgs, { tier: opts.modelTier === 'quick' ? 'quick' : 'default', json: json, signal: opts.signal }).then(function (r) {
        if (json) return looseJson(r.text);
        if (opts.onText) opts.onText({ text: r.text });
        return { text: r.text, truncated: !!r.truncated };
      }, function (e) { var x = new Error(e.message); x.code = e.code; x.text = ''; throw x; });
    }
    var f = function (input, opts) { return run(input, opts, false); };
    f.json = function (input, opts) { return run(input, opts, true); };
    return f;
  })() : null;
  function useSampler() {
    var s = useState(undefined);
    useEffect(function () { return SV.onStatus(function (st) { s[1](function () { return st.ai ? SERVER_SAMPLER : null; }); }); }, []);
    return s[0];
  }
  function aiErr(e, t) {
    var c = e && e.code;
    if (c === 'not_granted' || c === 'sampling_disabled' || c === 'not_declared' || c === 'capability_disabled' || c === 'capability_removed') return t('ai_denied');
    if (c === 'rate_limited') return t('ai_rate');
    if (c === 'ai_limit') return t('srv_ai_limit');
    if (c === 'ai_off' || c === 'ai_key') return t('srv_ai_unavail');
    if (c === 'net') return t('srv_net');
    if (c === 'refused') return t('ai_refused');
    return t('ai_err');
  }
  var LANG_NAME = { uz: 'o‘zbek tili (lotin yozuvi)', ru: 'русский язык', en: 'English', zh: '简体中文 (Simplified Chinese)' };
  function stems(s) { var m = String(s || '').toLowerCase().replace(/[‘’'`ʻʼ]/g, '').match(/[a-zа-яёқғҳў0-9]{3,}/g) || []; var o = {}; m.forEach(function (w) { o[w.slice(0, 5)] = 1; }); return o; }
  function pickLessons(ls, q, currentId, n) {
    var qs = Object.keys(stems(q));
    var scored = ls.map(function (l) {
      var txt = l._txt || (l._txt = lessonText(l)), st = l._st || (l._st = stems(txt)), ti = stems(l.title), sc = 0;
      qs.forEach(function (w) { if (st[w]) sc += 1; if (ti[w]) sc += 4; });
      if (l.id === currentId) sc += 6;
      return { l: l, sc: sc };
    }).filter(function (x) { return x.sc > 0; }).sort(function (a, b) { return b.sc - a.sc; });
    return scored.slice(0, n || 3).map(function (x) { return x.l; });
  }
  function accessibleLessons(db, u) { return (u.role === 'admin' ? flat(db.course) : trackFlat(db, u)).filter(function (l) { return u.role === 'admin' || !l.officialOnly || u.status === 'official'; }); }
  function standardsBlock(list, cap) {
    var left = cap || 30000;
    return list.map(function (l) { var txt = lessonText(l).slice(0, Math.max(0, Math.min(14000, left))); left -= txt.length; return txt ? '=== ' + l.title + ' (' + l.sectionTitle + ') ===\n' + txt : ''; }).filter(Boolean).join('\n\n');
  }
  function analyticsFor(db) {
    var rows = ratingRows(db).filter(function (r) { return r.current; });
    return {
      employees: db.users.filter(function (u) { return u.role === 'employee'; }).map(function (u) {
        var r = rows.filter(function (x) { return x.id === u.id; })[0] || {}, cur = currentLesson(db, u);
        return { name: u.name, position: u.position, status: u.status, cohort: u.cohort, daysInProgram: daysSince(u), passedLessons: r.passed, totalLessons: r.total, avgTestScore: Math.round(r.avgScore || 0), todayMinutes: studyMin(db, u.id), avgMinutesPerDay: Math.round(avgMinutes(db, u)), ratingScore: r.score, levelAndRank: rankLabel(rankOf(db, u), 'uz', T('uz')), xp: rankOf(db, u).xp, currentLesson: cur ? cur.title + ' [' + cur.status + ']' : null, profileComplete: !!u.profileComplete };
      }),
      openRequests: db.requests.filter(function (r) { return r.state === 'open'; }).map(function (r) { var l = r.lessonId ? findLesson(db.course, r.lessonId) : null; return { type: r.type, employee: userOf(db, r.userId).name, lesson: l ? l.title : null, text: r.text || null, score: r.score != null ? r.score : null }; }),
      pulseSurvey: pulseSummary(db),
      workErrors: (db.errors || []).slice(0, 25).map(function (x) { return { employee: userOf(db, x.uid).name, category: x.cat, severity: x.sev, sop: x.lessonId ? lessonTitle(db, x.lessonId) : null, what: x.text, status: x.status }; }),
      aiDrills: (db.drills || []).map(function (x) { return { employee: userOf(db, x.uid).name, scenario: x.scen, score_1_5: x.score, criteria: x.criteria }; }),
      sopUpdatesPendingAck: (db.sopUpdates || []).filter(function (x) { return (x.required || []).some(function (uid) { return !(x.acks || {})[uid]; }); }).map(function (x) { return { sop: lessonTitle(db, x.lessonId), pending: (x.required || []).filter(function (uid) { return !(x.acks || {})[uid]; }).map(function (uid) { return userOf(db, uid).name; }) }; }),
      initiatives: (db.initiatives || []).filter(function (x) { return !iniTo(x).length; }).map(function (x) { return { type: x.type, area: x.area, title: x.title, status: x.status, author: userOf(db, x.uid).name }; }),
      propertyNeedsHRAction: (db.assets || []).filter(assetAttn).map(function (a) { return { employee: userOf(db, a.uid).name, item: a.name, status: a.status, note: a.mismatch || (a.issue && a.issue.text) || null }; }),
      alumniAverages: (function () { var a = db.alumni || []; if (!a.length) return null; var s = function (f) { return Math.round(a.reduce(function (x, y) { return x + f(y); }, 0) / a.length); }; return { count: a.length, avgScore: s(function (x) { return x.stats.avgScore; }), avgMinutesPerDay: s(function (x) { return x.stats.avgMinutes; }), avgDaysToFinish: s(function (x) { return x.stats.days; }) }; })(),
      dailyGoalMinutes: GOAL
    };
  }

  function AIMentor(p) {
    var t = p.t, db = p.db, u = p.user, admin = u.role === 'admin', sampler = p.sampler;
    var ms = useState([]), msgs = ms[0], setMsgs = ms[1], inp = useState(''), busy = useState(false), ctl = useRef(null), listRef = useRef(null), taRef = useRef(null);
    useEffect(function () { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [msgs]);
    useEffect(function () { if (p.open && taRef.current) taRef.current.focus(); }, [p.open]);
    function patchLast(fn) { setMsgs(function (prev) { var c = prev.slice(), last = Object.assign({}, c[c.length - 1]); fn(last); c[c.length - 1] = last; return c; }); }
    function send(text) {
      text = (text || '').trim(); if (!text || busy[0] || !sampler) return;
      var ls = accessibleLessons(db, u), picks = pickLessons(ls, text + ' ' + msgs.filter(function (m) { return m.role === 'user'; }).slice(-1).map(function (m) { return m.content; }).join(' '), p.lessonId, admin ? 2 : 3);
      var rules = [
        admin ? 'Siz BURAQ Logistics kompaniyasining korporativ o‘quv platformasida (BURAQ o‘quv platformasi) SOP menejeri (admin) uchun AI-yordamchisiz. Standartlar matni va xodimlar progressi (ANALITIKA JSON) asosida yordam berasiz: kim orqada qolayotganini aniqlash, savollarga javob loyihasi, standartlarni yaxshilash takliflari, xodimlar kayfiyati (pulse-so‘rovnoma), tashabbuslar va mol-mulk hisobi bo‘yicha xulosalar.'
          : 'Siz BURAQ Logistics kompaniyasining korporativ o‘quv platformasidagi (BURAQ o‘quv platformasi) AI-mentorsiz. Yangi xodimga kompaniya standartlarini (SOP) tushuntirasiz.',
        'Qoidalar:',
        '- Faqat quyida berilgan STANDARTLAR matniga (va adminga ANALITIKA ma’lumotlariga) tayaning. Matnda yo‘q narsani o‘ylab topmang. Javob topilmasa, buni ochiq ayting' + (admin ? '.' : ' va “SOP menejeriga yuborish” tugmasi orqali savol yuborishni taklif qiling.'),
        '- Javob tili: ' + (LANG_NAME[p.lang] || LANG_NAME.uz) + '. Qisqa va aniq yozing; jarayonni qadamlar ro‘yxati bilan bering. Oddiy markdown (ro‘yxat, **qalin**) mumkin, jadval ishlatmang.',
        '- Javob oxirida bitta qatorda manbani yozing, masalan: "Manba: 4.2. Omborda yukni qabul qilish standartlari".',
        admin ? '' : '- Test savollariga tayyor javob varianti (A/B/C) aytmang — mavzuni tushuntiring.',
        '- Mijozlarning shaxsiy ma’lumotlari, parollar kabi maxfiy ma’lumotlarni so‘ramang va tarqatmang.',
        'Foydalanuvchi: ' + u.name + ', lavozimi: ' + u.position + ', status: ' + (admin ? 'SOP menejeri' : u.status) + '.',
        admin ? '\nANALITIKA (JSON):\n' + JSON.stringify(analyticsFor(db)) : '',
        '\nPLATFORMADAGI DARSLAR RO‘YXATI: ' + ls.map(function (l) { return l.title; }).join('; '),
        (function () { var g = glossaryBlock(db, u); return g ? '\nKOMPANIYA ATAMALARI (lug‘at — javobda shu ta’riflardan foydalaning):\n' + g : ''; })(),
        '\nSTANDARTLAR:\n' + (picks.length ? standardsBlock(picks, admin ? 18000 : 30000) : '(Savolga mos standart topilmadi.)')
      ].filter(Boolean).join('\n');
      var hist = msgs.filter(function (m) { return !m.error && m.content; }).slice(-6).map(function (m) { return { role: m.role, content: m.content }; });
      var turns = [{ role: 'user', content: rules }].concat(hist).concat([{ role: 'user', content: text }]);
      setMsgs(msgs.concat([{ role: 'user', content: text }, { role: 'assistant', content: '', streaming: true, q: text, sources: picks.map(function (l) { return { id: l.id, title: l.title }; }) }]));
      inp[1](''); busy[1](true);
      var c = new AbortController(); ctl.current = c;
      sampler(turns, { cache: false, signal: c.signal, onText: function (x) { patchLast(function (m) { m.content = x.text; }); } })
        .then(function (r) { patchLast(function (m) { m.content = r.text; m.streaming = false; m.truncated = r.truncated; }); })
        .catch(function (e) { patchLast(function (m) { m.streaming = false; if (e && e.code === 'cancelled') { m.content = e.text || ''; m.stopped = true; return; } m.content = e && e.code !== 'refused' && e.text ? e.text : ''; m.error = aiErr(e, t); }); })
        .then(function () { busy[1](false); });
    }
    function toMethodist(i) {
      var m = msgs[i], lid = m.sources && m.sources[0] ? m.sources[0].id : null;
      p.update(function (d) { d.requests.unshift({ id: nextId(d), type: 'question', userId: u.id, lessonId: lid, text: m.q, at: Date.now(), state: 'open', unread: true, viaAI: true }); });
      setMsgs(msgs.map(function (x, k) { return k === i ? Object.assign({}, x, { sent: true }) : x; }));
      p.say(t('ai_sent'));
    }
    var sugg = t(admin ? 'ai_sugg_admin' : 'ai_sugg').split('|');
    return h(F, null,
      !p.open ? h('button', { type: 'button', className: 'ai-fab', onClick: function () { p.setOpen(true); }, 'aria-label': t('ai_title') },
        h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z' })), t('ai_title')) : null,
      p.open ? h('section', { className: 'ai-panel', role: 'dialog', 'aria-label': t('ai_title') },
        h('header', { className: 'ai-head' },
          h('div', null, h('b', null, t('ai_title')), h('span', null, admin ? t('ai_sub_admin') : t('ai_sub'))),
          msgs.length ? h('button', { type: 'button', className: 'app-link ai-clear', onClick: function () { if (ctl.current) ctl.current.abort(); setMsgs([]); } }, t('ai_clear')) : null,
          h('button', { type: 'button', className: 'ai-x', 'aria-label': t('close'), onClick: function () { p.setOpen(false); } }, '×')),
        h('div', { className: 'ai-list', ref: listRef, 'aria-live': 'polite' },
          sampler === null ? h('p', { className: 'ai-empty' }, t('ai_unavail')) : null,
          !msgs.length && sampler !== null ? h('div', { className: 'ai-empty' }, h('p', null, t('ai_disclaimer')), h('div', { className: 'ai-sugg' }, sugg.map(function (s) { return h('button', { key: s, type: 'button', disabled: !sampler, onClick: function () { send(s); } }, s); }))) : null,
          msgs.map(function (m, i) {
            if (m.role === 'user') return h('div', { key: i, className: 'ai-msg is-user' }, m.content);
            return h('div', { key: i, className: 'ai-msg is-ai' },
              m.content ? h('div', { className: 'ai-md', dangerouslySetInnerHTML: { __html: mdLite(m.content) } }) : m.streaming ? h('p', { className: 'ai-thinking' }, t('ai_thinking')) : null,
              m.error ? h('p', { className: 'lor-field-error' }, m.error) : null,
              !m.streaming && !m.error && m.sources && m.sources.length ? h('div', { className: 'ai-src' }, h('span', null, t('ai_sources') + ':'), m.sources.map(function (s) { return h('button', { key: s.id, type: 'button', className: 'ai-chip', onClick: function () { if (p.openLesson) p.openLesson(s.id); } }, s.title); })) : null,
              !m.streaming && !admin && m.content ? h('div', { className: 'ai-act' }, m.sent ? h('span', { className: 'lor-sm made' }, '✓ ' + t('ai_sent')) : h('button', { type: 'button', className: 'app-link', onClick: function () { toMethodist(i); } }, t('ai_to_methodist'))) : null);
          })),
        h('form', { className: 'ai-form', onSubmit: function (e) { e.preventDefault(); send(inp[0]); } },
          h('textarea', { id: 'ai-input', ref: taRef, className: 'lor-input', rows: 2, value: inp[0], placeholder: t('ai_ph'), disabled: !sampler, 'aria-label': t('ai_ph'), onChange: function (e) { inp[1](e.target.value); }, onKeyDown: function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(inp[0]); } } }),
          busy[0] ? h(Btn, { variant: 'outline', size: 'sm', onClick: function () { if (ctl.current) ctl.current.abort(); } }, t('ai_stop')) : h(Btn, { variant: 'primary', size: 'sm', type: 'submit', disabled: !sampler || !inp[0].trim() }, t('ai_send')))) : null);
  }

  /* ---------- rating ---------- */
  function mkRow(id, name, position, cohort, current, passed, total, avg, am, days) {
    var mastery = Math.round(passed * 100 / total), disc = Math.min(1, am / GOAL) * 100;
    return { id: id, name: name, position: position, cohort: cohort, current: current, passed: passed, total: total, mastery: mastery, avgScore: avg, avgMinutes: am, days: days, discipline: Math.round(disc), score: Math.round(0.5 * mastery + 0.3 * avg + 0.2 * disc) };
  }
  function ratingRows(db) {
    var total = flat(db.course).length || 1, rows = [];
    db.users.filter(function (u) { return u.role === 'employee'; }).forEach(function (u) {
      var pr = prog(db, u.id), passed = 0, sc = [];
      for (var k in pr) if (pr[k].status === 'passed') { passed++; if (pr[k].score != null) sc.push(pr[k].score); }
      var rw = mkRow(u.id, u.name, u.position, u.cohort, true, passed, total, sc.length ? sc.reduce(function (a, b) { return a + b; }, 0) / sc.length : 0, avgMinutes(db, u), daysSince(u)); var rk = rankOf(db, u); rw.lvl = rk.li; rw.xp = rk.xp; rows.push(rw);
    });
    (db.alumni || []).forEach(function (a) { var rw = mkRow(a.id, a.name, a.position, a.cohort, false, Math.min(a.stats.passed, total), total, a.stats.avgScore, a.stats.avgMinutes, a.stats.days); rw.lvl = a.level || 0; rows.push(rw); });
    rows.sort(function (a, b) { return b.score - a.score || b.mastery - a.mastery; });
    rows.forEach(function (r, i) { r.rank = i + 1; });
    return rows;
  }
  function cohortLabel(c, lang) { if (!c) return '—'; var m = +c.split('-')[1] - 1, n = (MONTHS[lang] || MONTHS.uz)[m] || ''; return n.charAt(0).toUpperCase() + n.slice(1) + ' ' + c.split('-')[0]; }
  function tpl(s, o) { return s.replace(/\{(\w+)\}/g, function (_, k) { return o[k]; }); }

  function Rating(p) {
    var t = p.t, db = p.db, u = p.user, f = useState('all');
    var all = ratingRows(db), rows = all.filter(function (r) { return f[0] === 'all' || (f[0] === 'cur' ? r.current : !r.current); });
    var me = all.filter(function (r) { return r.id === u.id; })[0], cohort = all.filter(function (r) { return r.current && me && r.cohort === me.cohort; });
    var cohortRank = me ? cohort.findIndex(function (r) { return r.id === me.id; }) + 1 : 0;
    return h('div', { className: 'app-wrap' },
      h('div', { className: 'page-head' }, h('div', null, h('span', { className: 'lor-eyebrow' }, t('r_current') + ' + ' + t('r_prev')), h('h1', { className: 'lor-title' }, t('rating_title')))),
      me ? h('section', { className: 'box me-box' },
        h('div', { className: 'me-rank' }, h('span', { className: 'lor-eyebrow' }, t('r_you')), h('b', null, '#' + me.rank), h('span', { className: 'lor-sm lor-muted' }, tpl(t('r_place'), { n: all.length, k: me.rank }))),
        h('div', { className: 'me-score' }, h('span', { className: 'lor-eyebrow' }, t('r_score')), h('b', null, me.score), h('span', { className: 'lor-sm lor-muted' }, tpl(t('r_place_cohort'), { k: cohortRank }) + ' · ' + cohortLabel(me.cohort, p.lang))),
        h('div', { className: 'me-parts' },
          h(Progress, { value: me.mastery, label: t('r_mastery') + ' · 50%' }),
          h(Progress, { value: Math.round(me.avgScore), label: t('r_avg') + ' · 30%' }),
          h(Progress, { value: me.discipline, label: t('r_daily') + ' ' + hm(me.avgMinutes) + ' · 20%' }))) : null,
      h('div', { className: 'seg', role: 'tablist' }, [['all', t('r_all')], ['cur', t('r_current')], ['prev', t('r_prev')]].map(function (x) { return h('button', { key: x[0], type: 'button', role: 'tab', 'aria-selected': f[0] === x[0], className: f[0] === x[0] ? 'is-on' : '', onClick: function () { f[1](x[0]); } }, x[1]); })),
      h('div', { className: 'lor-table-wrap' }, h('table', { className: 'lor-table rating-table' },
        h('thead', null, h('tr', null, ['#', t('r_candidate'), t('level'), t('r_cohort'), t('r_state'), t('r_mastery'), t('r_avg'), t('r_daily'), t('r_score')].map(function (x, i) { return h('th', { key: i }, x); }))),
        h('tbody', null, rows.map(function (r) {
          var mine = r.id === u.id;
          return h('tr', { key: r.id, className: cx(mine && 'is-me') },
            h('td', { className: 'rank' }, h('span', { className: cx('rank-n', r.rank <= 3 && 'top') }, r.rank)),
            h('td', null, h('div', { className: 'lor-emp' }, h(Av, { name: r.name, src: userOf(db, r.id).avatar, size: 32 }), h('span', null, r.name, mine ? h('em', { className: 'you-tag' }, t('r_you')) : null, h('small', null, r.position)))),
            h('td', null, h(LevelBadge, { t: t, small: true, name: lvlShort(levelsOf(db)[Math.min(r.lvl || 0, levelsOf(db).length - 1)], p.lang), n: r.lvl || 0 })),
            h('td', null, cohortLabel(r.cohort, p.lang)),
            h('td', null, r.current ? h(Badge, { status: 'in-progress', lang: p.lang }, t('r_active')) : h(Badge, { status: 'passed', lang: p.lang }, t('r_grad'))),
            h('td', { className: 'num' }, r.passed + '/' + r.total),
            h('td', { className: 'num' }, r.avgScore ? Math.round(r.avgScore) + '%' : '—'),
            h('td', { className: 'num' }, hm(r.avgMinutes)),
            h('td', null, h('div', { className: 'score-cell' }, h('b', null, r.score), h('i', null, h('span', { style: { width: r.score + '%' } })))));
        })))),
      h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('r_formula')));
  }

  /* ---------- charts (single series, inline SVG) ---------- */
  function StudyChart(p) {
    var t = p.t, data = p.data, W = 700, H = 220, L = 34, B = 28, T = 12, max = Math.max(180, Math.max.apply(null, data.map(function (d) { return d.m; })) + 20);
    var y = function (v) { return T + (H - T - B) * (1 - v / max); }, bw = (W - L - 8) / data.length;
    return h('svg', { className: 'chart', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': t('p_study14') },
      [0, 60, 120, 180].filter(function (v) { return v <= max; }).map(function (v) { return h('g', { key: v }, h('line', { x1: L, x2: W - 4, y1: y(v), y2: y(v), className: v === GOAL ? 'goal' : 'grid' }), h('text', { x: L - 6, y: y(v) + 4, textAnchor: 'end', className: 'ax' }, v / 60 + t('h'))); }),
      data.map(function (d, i) {
        var x = L + 4 + i * bw, hgt = Math.max(0, y(0) - y(d.m));
        return h('g', { key: d.k, className: 'bar-g' },
          h('rect', { x: x + 3, y: T, width: bw - 6, height: H - T - B, className: 'hit' }),
          d.m ? h('rect', { x: x + bw * 0.18, y: y(d.m), width: bw * 0.64, height: hgt, rx: 3, className: d.m >= GOAL ? 'bar met' : 'bar' }) : null,
          h('text', { x: x + bw / 2, y: H - 8, textAnchor: 'middle', className: cx('ax', d.today && 'strong') }, d.label),
          h('title', null, d.full + ': ' + fmtMin(d.m, t)));
      }));
  }
  function ScoreChart(p) {
    var data = p.data, W = 700, H = 200, L = 34, B = 28, T = 12, y = function (v) { return T + (H - T - B) * (1 - v / 100); }, bw = (W - L - 8) / Math.max(data.length, 6);
    return h('svg', { className: 'chart', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': p.t('p_scores') },
      [0, 50, 80, 100].map(function (v) { return h('g', { key: v }, h('line', { x1: L, x2: W - 4, y1: y(v), y2: y(v), className: v === 80 ? 'goal' : 'grid' }), h('text', { x: L - 6, y: y(v) + 4, textAnchor: 'end', className: 'ax' }, v)); }),
      data.map(function (d, i) {
        var x = L + 4 + i * bw;
        return h('g', { key: d.id, className: 'bar-g' },
          h('rect', { x: x + 3, y: T, width: bw - 6, height: H - T - B, className: 'hit' }),
          h('rect', { x: x + bw * 0.2, y: y(d.s), width: bw * 0.6, height: y(0) - y(d.s), rx: 3, className: d.s >= 80 ? 'bar met' : 'bar low' }),
          h('text', { x: x + bw / 2, y: y(d.s) - 5, textAnchor: 'middle', className: 'val' }, d.s),
          h('text', { x: x + bw / 2, y: H - 8, textAnchor: 'middle', className: 'ax' }, d.n),
          h('title', null, d.title + ': ' + d.s + '%'));
      }));
  }

  /* ---------- my path (report + analysis) ---------- */
  function MyPath(p) {
    var t = p.t, db = p.db, u = p.user, sampler = p.sampler;
    var all = ratingRows(db), me = all.filter(function (r) { return r.id === u.id; })[0], ls = flat(db.course), pr = prog(db, u.id);
    var days = daysSince(u), total = ls.length, passed = me ? me.passed : 0;
    var alumni = db.alumni || [], pace = alumni.length ? alumni.reduce(function (s, a) { return s + a.stats.passed / a.stats.days; }, 0) / alumni.length : 0;
    var expected = Math.min(total, Math.round(pace * days * 10) / 10), grads = alumni.filter(function (a) { return a.stats.passed >= total; });
    var gradDays = grads.length ? Math.round(grads.reduce(function (s, a) { return s + a.stats.days; }, 0) / grads.length) : null;
    var myPace = passed / days, daysLeft = myPace > 0 ? Math.ceil((total - passed) / myPace) : null;
    var endDate = daysLeft != null ? new Date(Date.now() + daysLeft * DAY) : null;
    var study = []; for (var i = 13; i >= 0; i--) { var ts = Date.now() - i * DAY, d = new Date(ts); study.push({ k: dayKey(ts), m: studyMin(db, u.id, dayKey(ts)), label: String(d.getDate()), full: pad(d.getDate()) + '.' + pad(d.getMonth() + 1), today: i === 0 }); }
    var scores = ls.filter(function (l) { return pr[l.id] && pr[l.id].score != null && (pr[l.id].status === 'passed' || pr[l.id].status === 'failed' || pr[l.id].status === 'exam-ready'); }).map(function (l) { return { id: l.id, s: pr[l.id].score, n: (l.title.match(/^[\d.–]+/) || [l.id.toUpperCase()])[0].replace(/\.$/, ''), title: l.title }; });
    var weak = scores.filter(function (x) { return x.s < 85; }).sort(function (a, b) { return a.s - b.s; }).slice(0, 3);
    var cur = currentLesson(db, u), rt = useState(u.reminderTime || '19:00');
    var an = useState(''), anBusy = useState(false), anErr = useState('');
    function analyse() {
      if (!sampler) return;
      var data = { name: u.name, position: u.position, status: u.status, daysInProgram: days, passedLessons: passed, totalLessons: total, avgTestScore: me ? Math.round(me.avgScore) : 0, levelAndRank: rankLabel(rankOf(db, u), 'uz', T('uz')), xpInLevel: rankOf(db, u).inLevel, xpToNextLevel: rankOf(db, u).next ? Math.max(0, rankOf(db, u).need - rankOf(db, u).inLevel) : null, nextLevelProgressPct: rankOf(db, u).pct, nextLevelRequirements: rankOf(db, u).reqs.map(function (q) { return reqText(q, T('uz')) + ' (' + condValue(q, T('uz')) + ')' + (q.ok ? ' — bajarilgan' : ' — bajarilmagan'); }),
        todayMinutes: studyMin(db, u.id), avgMinutesPerDay: Math.round(avgMinutes(db, u)), goalMinutesPerDay: GOAL, streakDays: streakOf(db, u.id), last14DaysMinutes: study.map(function (s) { return s.m; }),
        testScores: scores.map(function (s) { return { lesson: s.title, score: s.s }; }), currentLesson: cur ? cur.title : null,
        previousCandidates: { count: alumni.length, avgLessonsPerDay: Math.round(pace * 100) / 100, expectedLessonsByNow: expected, avgDaysToFinish: gradDays, avgScore: alumni.length ? Math.round(alumni.reduce(function (s, a) { return s + a.stats.avgScore; }, 0) / alumni.length) : null } };
      var prompt = 'Siz BURAQ Logistics kompaniyasining o‘quv platformasidagi murabbiysiz. Quyidagi nomzod ma’lumotlarini tahlil qiling va unga shaxsan murojaat qilib yozing (siz deb). Javob tili: ' + (LANG_NAME[p.lang] || LANG_NAME.uz) + '.\n' +
        'Tuzilma (markdown sarlavhalar bilan, jami 180 so‘zdan oshmasin):\n## Umumiy holat\n## Kuchli tomonlar\n## E’tibor berish kerak\n## Keyingi 7 kun rejasi (3–5 aniq qadam, kunlik 2 soat maqsadini hisobga oling)\n' +
        'Faqat berilgan raqamlarga tayaning, o‘ylab topmang. Oldingi nomzodlar bilan solishtiring.\n\nMA’LUMOTLAR (JSON):\n' + JSON.stringify(data);
      an[1](''); anErr[1](''); anBusy[1](true);
      sampler(prompt, { onText: function (x) { an[1](x.text); } }).then(function (r) { an[1](r.text); }).catch(function (e) { if (e && e.text) an[1](e.text); anErr[1](aiErr(e, t)); }).then(function () { anBusy[1](false); });
    }
    var diff = passed - expected;
    return h('div', { className: 'app-wrap' },
      h('div', { className: 'page-head' }, h('div', null, h('span', { className: 'lor-eyebrow' }, u.position + ' · ' + cohortLabel(u.cohort, p.lang)), h('h1', { className: 'lor-title' }, t('path_title'), h(PageTip, { t: t, id: 'path' })))),
      h('div', { className: 'tiles' },
        [[t('level'), (function () { var k = rankOf(db, u); return k.inLevel + ' XP'; })(), rankLabel(rankOf(db, u), p.lang, t)], [t('r_mastery'), passed + '/' + total, (me ? me.mastery : 0) + '%'], [t('r_avg'), me && me.avgScore ? Math.round(me.avgScore) + '%' : '—', t('pass_mark') + ' 80%'], [t('today'), hm(studyMin(db, u.id)) + ' / 2:00', streakOf(db, u.id) + ' ' + t('streak')]].map(function (x) { return h('div', { key: x[0], className: 'tile' }, h('span', { className: 'lor-eyebrow' }, x[0]), h('b', null, x[1]), h('span', { className: 'lor-sm lor-muted' }, x[2])); })),
      h(PlanBox, Object.assign({}, p, { u: p.user })),
      h(LevelCard, Object.assign({}, p, { rules: true })),
      h(CareerLadder, p),
      h('section', { className: 'box' },
        h('div', { className: 'chart-head' }, h('h2', { className: 'lor-h' }, t('p_study14')), h('div', { className: 'legend' }, h('span', null, h('i', { className: 'lg met' }), t('p_met')), h('span', null, h('i', { className: 'lg' }), t('p_notmet')), h('span', null, h('i', { className: 'lg line' }), t('p_goal_line')))),
        h('div', { className: 'chart-wrap' }, h(StudyChart, { t: t, data: study })),
        h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('study_note'))),
      h('div', { className: 'home-grid' },
        h('section', { className: 'box' },
          h('h2', { className: 'lor-h' }, t('p_compare')),
          h('p', { style: { margin: 0 } }, tpl(t('p_you_days'), { d: days, n: passed }) + ' ' + tpl(t('p_alumni_avg'), { n: expected })),
          h('div', null, h(Badge, { status: diff > 0.5 ? 'passed' : diff < -0.5 ? 'failed' : 'in-progress', lang: p.lang }, diff > 0.5 ? t('p_ahead') : diff < -0.5 ? t('p_behind') : t('p_even'))),
          endDate ? h('p', { className: 'lor-sm', style: { margin: 0 } }, tpl(t('p_forecast'), { date: pad(endDate.getDate()) + '.' + pad(endDate.getMonth() + 1) + '.' + endDate.getFullYear(), d: daysLeft })) : null,
          gradDays ? h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, tpl(t('p_alumni_finish'), { d: gradDays })) : null),
        h('section', { className: 'box' },
          h('h2', { className: 'lor-h' }, t('p_weak')),
          weak.length ? h('ul', { className: 'weak-list' }, weak.map(function (w) { return h('li', { key: w.id }, h('span', null, w.title), h('span', { className: 'weak-r' }, h('b', null, w.s + '%'), h(Btn, { variant: 'outline', size: 'sm', onClick: function () { p.go({ name: 'lesson', id: w.id }); } }, t('p_review')))); }))
            : h('p', { className: 'lor-muted', style: { margin: 0 } }, scores.length ? '✓' : t('p_no_scores')))),
      h('section', { className: 'box' },
        h('div', { className: 'chart-head' }, h('h2', { className: 'lor-h' }, t('p_scores')), h('div', { className: 'legend' }, h('span', null, h('i', { className: 'lg line' }), t('p_pass_line')))),
        scores.length ? h('div', { className: 'chart-wrap' }, h(ScoreChart, { t: t, data: scores })) : h('p', { className: 'lor-muted', style: { margin: 0 } }, t('p_no_scores'))),
      h('section', { className: 'box ai-box' },
        h('div', { className: 'chart-head' }, h('div', null, h('h2', { className: 'lor-h' }, t('ai_analysis')), h('p', { className: 'lor-sm lor-muted', style: { margin: '4px 0 0' } }, t('ai_analysis_hint'))),
          h(Btn, { variant: 'secondary', size: 'sm', disabled: !sampler || anBusy[0], onClick: analyse }, anBusy[0] ? t('ai_thinking') : t('ai_analysis_btn'))),
        sampler === null ? h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('ai_unavail')) : null,
        anBusy[0] && !an[0] ? h('p', { className: 'ai-thinking' }, t('ai_thinking')) : null,
        an[0] ? h('div', { className: 'ai-md', dangerouslySetInnerHTML: { __html: mdLite(an[0]) } }) : null,
        anErr[0] ? h('p', { className: 'lor-field-error' }, anErr[0]) : null),
      h('section', { className: 'box' },
        h('h2', { className: 'lor-h' }, t('p_path')),
        h('ol', { className: 'path-list' }, ls.map(function (l) {
          var st = lessonStatus(db, u, l.id), x = pr[l.id] || {}, here = cur && cur.id === l.id;
          return h('li', { key: l.id, className: cx('st-' + st, here && 'is-here') },
            h('span', { className: 'path-dot', 'aria-hidden': true }),
            h('div', { className: 'path-main' }, h('button', { type: 'button', className: 'path-title', disabled: st === 'locked', onClick: function () { p.go({ name: 'lesson', id: l.id }); } }, l.title), h('span', { className: 'lor-sm lor-muted' }, l.sectionTitle + (x.at && st === 'passed' ? ' · ' + fmt(x.at, t) : ''))),
            h('div', { className: 'path-r' }, here ? h('span', { className: 'here-tag' }, t('p_here')) : null, x.score != null ? h('span', { className: 'lor-sm num' }, x.score + '%') : null, h(Badge, { status: st, lang: p.lang })));
        }))),
      h('section', { className: 'box' },
        h('h2', { className: 'lor-h' }, t('p_settings')),
        h('div', { className: 'filters' }, h(Field, { name: 'remind', label: t('reminder_time'), value: rt[0], options: ['09:00', '13:00', '17:00', '19:00', '21:00'], onChange: function (v) { rt[1](v); p.update(function (d) { d.users.forEach(function (x) { if (x.id === u.id) x.reminderTime = v; }); }); } })),
        h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('goal_set_by'))));
  }

  /* ---------- levels (lavozim darajasi) and XP ---------- */
  var XP_LESSON = 20, XP_TOP_SCORE = 10, XP_GOAL_DAY = 10, XP_INI_OK = 25, XP_INI_DONE = 50, XP_SURVEY = 5;
  var XP_DRILL = 10;
  function levelsOf(db) { return db.levels && db.levels.length ? db.levels : []; }
  function lvlName(l, lang) { return l ? (l.name[lang] || l.name.uz) : '—'; }
  /* compact label for badges and ladders (e.g. “CEO”) */
  function lvlShort(l, lang) { return l ? (l.short || lvlName(l, lang)) : '—'; }
  /* local role name (Stajyor, Kichik menejer…) — hidden when it only repeats the title */
  function lvlRole(l, lang) {
    if (!l || !l.role) return '';
    var r = l.role[lang] != null ? l.role[lang] : (l.role.uz || ''), n = lvlName(l, lang).toLowerCase();
    return !r || n === r.toLowerCase() || n.indexOf('(' + r.toLowerCase() + ')') >= 0 ? '' : r;
  }
  function lvlAlt(l, lang) { if (!l || !l.alt) return ''; return typeof l.alt === 'string' ? l.alt : (l.alt[lang] || l.alt.uz || ''); }
  function acceptedIni(db, u) { return (db.initiatives || []).filter(function (x) { return x.uid === u.id && (x.status === 'accepted' || x.status === 'done'); }).length; }
  function xpOf(db, u) {
    var pr = prog(db, u.id), xp = 0;
    for (var k in pr) if (pr[k].status === 'passed') { xp += XP_LESSON; if (pr[k].score >= 90) xp += XP_TOP_SCORE; }
    var st = (db.study || {})[u.id] || {}; for (var d in st) if (st[d] >= GOAL) xp += XP_GOAL_DAY;
    (db.initiatives || []).forEach(function (x) { if (x.uid === u.id) { if (x.status === 'accepted' || x.status === 'done') xp += XP_INI_OK; if (x.status === 'done') xp += XP_INI_DONE; } });
    xp += ((u.pulse || {}).n || 0) * XP_SURVEY;
    xp += drillLessons(db, u.id) * XP_DRILL;
    xp += xtXp(db, u.id);
    return xp;
  }
  function sectionPassed(db, u, sid) { var s = db.course.sections.filter(function (x) { return x.id === sid; })[0]; if (!s || !s.lessons.length) return true;
    var ids = trackSecIds(db, u); if (ids && ids.indexOf(sid) < 0) return true; return s.lessons.every(function (l) { return (prog(db, u.id)[l.id] || {}).status === 'passed'; }); }
  function avgScoreOf(db, u) { var pr = prog(db, u.id), sc = []; for (var k in pr) if (pr[k].status === 'passed' && pr[k].score != null) sc.push(pr[k].score); return sc.length ? sc.reduce(function (a, b) { return a + b; }, 0) / sc.length : 0; }
  function rankOf(db, u) {
    var L = levelsOf(db), li = Math.min(u.level || 0, Math.max(0, L.length - 1)), lv = L[li], total = xpOf(db, u), inL = Math.max(0, total - (u.levelXpBase || 0));
    var nx = L[li + 1] || null, reqs = [];
    if (nx) { condsOf(nx).forEach(function (c) { var q = condState(db, u, c, inL); if (q) reqs.push(q); }); reqs = reqs.concat(xtConds(db, u, li)); }
    var xq = reqs.filter(function (q) { return q.key === 'xp'; })[0], done = reqs.filter(function (q) { return q.ok; }).length;
    var pct = !nx ? 100 : reqs.length ? Math.floor(reqs.reduce(function (sm, q) { return sm + q.frac; }, 0) * 100 / reqs.length + 1e-9) : 100;
    var pending = db.requests.some(function (r) { return r.type === 'level' && r.userId === u.id && r.state === 'open'; });
    return { li: li, level: lv, xp: total, inLevel: inL, need: xq ? xq.n : 0, next: nx, reqs: reqs, done: done, pct: pct, eligible: !!nx && done === reqs.length, pending: pending };
  }
  function rankLabel(r, lang, t) { return lvlShort(r.level, lang); }
  function LevelBadge(p) {
    return h('span', { className: cx('lvl-badge', p.small && 'is-sm') }, h(LevelEmblem, { n: (p.n || 0) + 1, size: p.small ? 20 : 26, uid: 'lb' + (p.n || 0) + (p.small ? 's' : '') }), h('span', null, p.name));
  }
  function reqText(r, t, lang) { return condText(r, t, lang || 'uz'); }
  /* local caption under the grade title, e.g. “Stajyor” */
  function lvlSub(l, lang, t) { return [lvlRole(l, lang), lvlAlt(l, lang) ? t('or_alt') + ' ' + lvlAlt(l, lang) : ''].filter(Boolean).join(' · '); }

  function PerkList(p) {
    return h('ul', { className: 'perk-list' }, (p.items || []).slice(0, p.max || 9).map(function (x, i) {
      return h('li', { key: i }, h('span', { className: 'perk-ico', 'aria-hidden': true }, '✦'), h('span', null, h('b', null, x[0]), x[1] ? h('span', null, x[1]) : null));
    }));
  }

  /* the full HR ladder: what each step asks for and what the company gives in return */
  function CareerLadder(p) {
    var t = p.t, db = p.db, u = p.user, L = levelsOf(db), r = rankOf(db, u);
    return h('section', { className: 'box career' },
      h('div', { className: 'chart-head' }, h('div', null, h('h2', { className: 'lor-h' }, t('career_t')), h('p', { className: 'lor-sm lor-muted', style: { margin: '4px 0 0' } }, t('career_s')))),
      h('ol', { className: 'career-list' }, L.map(function (lv, i) {
        var now = i === r.li, past = i < r.li, g = levelGrow(lv, p.lang), pk = levelPerks(lv, p.lang);
        return h('li', { key: lv.id, className: cx(now && 'is-now', past && 'is-done') },
          h('details', { open: now },
            h('summary', null,
              h('span', { className: 'career-n' }, i + 1),
              h('span', { className: 'career-t' }, h('b', null, lvlName(lv, p.lang)), lvlRole(lv, p.lang) ? h('small', null, lvlRole(lv, p.lang)) : null),
              now ? h('span', { className: 'career-tag' }, t('career_now')) : past ? h('span', { className: 'career-tag done' }, '✓') : null,
              stepXp(L, i) != null ? h('span', { className: 'career-xp' }, stepXp(L, i) + ' XP') : i < L.length - 1 ? h('span', { className: 'career-xp' }, tpl(t('lr_n_conds'), { n: condsOf(L[i + 1]).length })) : null),
            h('div', { className: 'career-b' },
              h('p', { className: 'career-desc' }, levelDesc(lv, p.lang)),
              g.length ? h('div', { className: 'grow-box' }, h('span', { className: 'lor-eyebrow' }, i ? t('career_grow') : t('lvl_grow')), h('ul', { className: 'grow-list' }, g.map(function (x, k) { return h('li', { key: k }, x); }))) : null,
              pk.length ? h('div', null, h('span', { className: 'lor-eyebrow' }, t('career_perks')), h(PerkList, { items: pk })) : h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('career_no_perks')))));
      })),
      h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('career_note')));
  }


  /* hover/tap a rung of the ladder: a floating card with what has to grow and what the company gives */
  function LadderSteps(p) {
    var t = p.t, db = p.db, L = levelsOf(db), r = p.rank;
    var st = useState(null), cur = st[0], pin = useRef(false), boxRef = useRef(null), elRef = useRef(null);
    function place(el, i) {
      elRef.current = el;
      var q = el.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
      var w = Math.min(340, vw - 24), left = Math.max(12, Math.min(q.left + q.width / 2 - w / 2, vw - w - 12));
      var sBelow = vh - q.bottom - 16, sAbove = q.top - 86, below = sBelow >= 300 || sBelow >= sAbove;
      st[1]({ i: i, w: w, left: left, max: Math.max(180, Math.round(below ? sBelow : sAbove)),
        top: below ? Math.round(q.bottom + 10) : null, bottom: below ? null : Math.round(vh - q.top + 10) });
    }
    function open(e, i) { place(e.currentTarget, i); }
    function close() { if (!pin.current) st[1](null); }
    useEffect(function () {
      if (!cur) return;
      function away(e) { if (boxRef.current && !boxRef.current.contains(e.target)) { pin.current = false; st[1](null); } }
      function esc(e) { if (e.key === 'Escape') { pin.current = false; st[1](null); } }
      function bye() { if (elRef.current && document.contains(elRef.current)) place(elRef.current, cur.i); else { pin.current = false; st[1](null); } }
      document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
      window.addEventListener('scroll', bye, true); window.addEventListener('resize', bye);
      return function () { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); window.removeEventListener('scroll', bye, true); window.removeEventListener('resize', bye); };
    }, [cur && cur.i]);
    var lv = cur ? L[cur.i] : null, g = lv ? levelGrow(lv, p.lang) : [], pk = lv ? levelPerks(lv, p.lang) : [];
    return h('div', { className: 'ladder-wrap', ref: boxRef },
      h('ol', { className: 'ladder' }, L.map(function (x, i) {
        return h('li', { key: x.id, className: cx(i < r.li && 'done', i === r.li && 'on', cur && cur.i === i && 'is-hot') },
          h('button', {
            type: 'button', className: 'ladder-btn', 'aria-expanded': !!(cur && cur.i === i),
            'aria-label': lvlName(x, p.lang) + ' — ' + t('career_t'),
            onMouseEnter: function (e) { open(e, i); }, onMouseLeave: close,
            onFocus: function (e) { open(e, i); }, onBlur: close,
            onClick: function (e) { if (cur && cur.i === i && pin.current) { pin.current = false; st[1](null); } else { pin.current = true; place(e.currentTarget, i); } }
          }, h('span', { className: 'ladder-n' }, i + 1), h('span', { className: 'ladder-name' }, lvlShort(x, p.lang)), h('span', { className: 'ladder-more', 'aria-hidden': true }, 'i')));
      })),
      h('p', { className: 'ladder-hint lor-sm lor-muted' }, t('lvl_pop_hint')),
      cur && lv ? h('div', { className: 'lvl-pop', role: 'tooltip', style: { width: cur.w, maxHeight: cur.max, left: cur.left, top: cur.top == null ? 'auto' : cur.top, bottom: cur.bottom == null ? 'auto' : cur.bottom } },
        h('div', { className: 'lvl-pop-h' },
          h(LevelEmblem, { n: cur.i + 1, size: 30, uid: 'pop' + cur.i, className: 'lvl-mini' }),
          h('div', null, h('b', null, lvlName(lv, p.lang)), lvlRole(lv, p.lang) ? h('small', null, lvlRole(lv, p.lang)) : null),
          stepXp(L, cur.i) != null ? h('span', { className: 'lvl-pop-xp' }, stepXp(L, cur.i) + ' XP') : null),
        cur.i === r.li ? h('span', { className: 'lvl-pop-tag' }, t('career_now')) : cur.i < r.li ? h('span', { className: 'lvl-pop-tag done' }, '\u2713') : null,
        h('p', { className: 'lvl-pop-desc' }, levelDesc(lv, p.lang)),
        g.length ? h('div', { className: 'grow-box' }, h('span', { className: 'lor-eyebrow' }, cur.i ? t('career_grow') : t('lvl_grow')), h('ul', { className: 'grow-list' }, g.map(function (x, k) { return h('li', { key: k }, x); }))) : null,
        pk.length ? h('div', null, h('span', { className: 'lor-eyebrow' }, t('career_perks')), h(PerkList, { items: pk, max: 3 }),
          pk.length > 3 ? h('span', { className: 'lor-sm lor-muted' }, tpl(t('lvl_pop_more'), { n: pk.length - 3 })) : null)
          : h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('career_no_perks'))) : null);
  }

  function LevelCard(p) {
    var t = p.t, db = p.db, u = p.user, r = rankOf(db, u);
    var lv = r.level; if (!lv) return null;
    var left = r.reqs.length - r.done, full = !!p.rules;
    function ask() { p.update(function (d) { d.requests.unshift({ id: nextId(d), type: 'level', userId: u.id, fromLevel: r.li, toLevel: r.li + 1, xp: r.xp, at: Date.now(), state: 'open', unread: true }); }); p.say(t('level_pending')); }
    return h('section', { className: 'box level-card' },
      h('div', { className: 'level-top' },
        h('div', { className: 'level-now' }, h('span', { className: 'lor-eyebrow' }, t('your_level')),
          h('div', { className: 'level-title' }, h(LevelEmblem, { n: r.li + 1, size: 38, uid: 'lc' + r.li, className: 'lvl-mini' }), h('b', null, lvlName(lv, p.lang))),
          lvlSub(lv, p.lang, t) ? h('span', { className: 'level-sub' }, lvlSub(lv, p.lang, t)) : null),
        h('div', { className: 'level-xp' }, h('b', null, r.inLevel), h('span', null, 'XP ' + t('in_level') + ' · ' + t('xp_total') + ' ' + r.xp))),
      r.next ? h('div', { className: 'level-scale' },
        h('div', { className: 'level-scale-h' }, h('span', { className: 'lor-eyebrow' }, tpl(t('lr_title'), { x: lvlName(r.next, p.lang) }) + (lvlRole(r.next, p.lang) ? ' (' + lvlRole(r.next, p.lang) + ')' : '')),
          !full ? h('button', { type: 'button', className: 'app-link', onClick: function () { p.go({ name: 'path' }); } }, t('lr_more')) : null),
        h(LevelRuler, Object.assign({}, p, { u: u, rank: r, list: full, tag: full ? 'f' : 'h' })),
        !full ? h('p', { className: 'lor-sm', style: { margin: 0 } }, r.eligible ? t('lr_ready') : tpl(t('lr_left'), { n: left })) : null,
        u.role === 'employee' ? (r.pending ? h('span', { className: 'lor-notice-state light' }, '\u25D4 ' + t('level_pending')) : h('div', { className: 'level-ask' }, h(Btn, { variant: r.eligible ? 'primary' : 'outline', arrow: r.eligible, disabled: !r.eligible, onClick: ask }, t('ask_level')), !r.eligible ? h('span', { className: 'lor-sm lor-muted' }, t('lr_ask_hint')) : null)) : null)
        : h('p', { className: 'lor-sm', style: { margin: 0 } }, t('top_level')),
      h(LadderSteps, { t: t, db: db, lang: p.lang, rank: r }),
      r.next && full ? h('div', { className: 'level-next' },
        h('span', { className: 'lor-eyebrow' }, t('next_level') + ': ' + lvlName(r.next, p.lang) + (lvlRole(r.next, p.lang) ? ' (' + lvlRole(r.next, p.lang) + ')' : '')),
        (function () {
          var g = levelGrow(r.next, p.lang);
          return g.length ? h('div', { className: 'grow-box' }, h('span', { className: 'lor-eyebrow' }, t('lvl_grow')), h('ul', { className: 'grow-list' }, g.map(function (x, i) { return h('li', { key: i }, x); }))) : null;
        })(),
        (function () {
          var pk = levelPerks(r.next, p.lang);
          return pk.length ? h('details', { className: 'perk-fold' }, h('summary', null, t('career_next_perks') + ' · ' + pk.length), h(PerkList, { items: pk })) : null;
        })()) : null,
      u.lastPromo && u.role === 'employee' ? h('div', null, h('button', { type: 'button', className: 'app-link', onClick: function () { Sfx.unlock(); p.update(function (d) { d.users.forEach(function (x) { if (x.id === u.id) x.celebrate = Object.assign({}, x.lastPromo, { replay: true }); }); }); } }, h(ReplayIcon), ' ', t('cel_replay_link'))) : null,
      p.rules ? h('div', { className: 'xp-rules' }, h('span', { className: 'lor-eyebrow' }, t('xp_rules')), h('ul', null, [t('xp_r1'), t('xp_r2'), t('xp_r3'), t('xp_r4'), t('xp_r5'), t('xp_r7')].map(function (x) { return h('li', { key: x }, x); }))) : null);
  }

  function LevelsAdmin(p) {
    var t = p.t, db = p.db, s = useState(function () { return clone(levelsOf(db)); }), L = s[0], pv = useState(null);
    function preview(li) { var me = p.user; pv[1]({ id: -1, role: 'employee', name: me.name, position: me.position, level: li, levelXpBase: 0, celebrate: { kind: 'level', li: li, fromLi: Math.max(0, li - 1), at: Date.now() } }); }
    function set(i, fn) { var c = clone(L); fn(c[i]); s[1](c); }
    function save() { p.update(function (d) { var c = clone(L).map(function (x, i) { delete x.silver; delete x.req; delete x.minAvg; delete x.minIni; x.conds = i ? normConds(x.conds) : []; return x; }); c.forEach(function (x, i) { var g = stepXp(c, i); if (g != null) x.gold = g; else if (i < c.length - 1) x.gold = 0; }); d.levels = c; }); p.say(t('lvl_saved')); }
    function objOf(v) { return typeof v === 'string' ? { uz: v, ru: v, en: v, zh: v } : Object.assign({}, v || {}); }
    var emps = db.users.filter(function (u) { return u.role === 'employee'; }), LG = ['uz', 'ru', 'en', 'zh'];
    return h('div', { className: 'app-wrap' },
      h('div', { className: 'page-head' }, h('div', null, h('span', { className: 'lor-eyebrow' }, t('ladder')), h('h1', { className: 'lor-title' }, t('nav_levels'), h(PageTip, { t: t, id: 'levels' })))),
      h('p', { className: 'lor-muted', style: { margin: 0, maxWidth: 820 } }, t('lvl_hint')),
      h('ol', { className: 'ladder ladder-top', 'aria-label': t('ladder') }, L.map(function (x, i) { return h('li', { key: x.id, className: 'on' }, h('span', { className: 'ladder-n' }, i + 1), h('span', null, lvlShort(x, p.lang), lvlRole(x, p.lang) ? h('small', null, lvlRole(x, p.lang)) : null)); })),
      pv[0] ? h(Celebration, Object.assign({}, p, { key: 'pv' + pv[0].celebrate.at, user: pv[0], preview: true, go: function () {}, onDone: function () { pv[1](null); } })) : null,
      h('div', { className: 'lvl-grid' }, L.map(function (lv, i) {
        var people = emps.filter(function (u) { return Math.min(u.level || 0, L.length - 1) === i; }).map(function (u) { return { u: u, r: rankOf(db, u) }; });
        return h('section', { key: lv.id, className: 'box lvl-edit' },
          h('div', { className: 'lvl-edit-h' }, h(LevelEmblem, { n: i + 1, size: 40, uid: 'adm' + i, className: 'lvl-mini' }),
            h('div', { className: 'lvl-edit-t' }, h('b', null, lvlName(lv, p.lang)), lvlSub(lv, p.lang, t) ? h('span', { className: 'lor-sm lor-muted' }, lvlSub(lv, p.lang, t)) : null),
            i > 0 ? h('button', { type: 'button', className: 'app-link', onClick: function () { preview(i); } }, '✦ ' + t('cel_preview_btn')) : null,
            i > 0 && !people.length ? h('button', { type: 'button', className: 'app-link danger', onClick: function () { s[1](L.filter(function (_, k) { return k !== i; })); } }, t('remove')) : null),
          h('p', { className: 'lor-sm', style: { margin: 0 } }, levelDesc(lv, p.lang)),
          i > 0 ? h(CondEditor, { t: t, db: db, lang: p.lang, conds: condsOf(lv), onChange: function (cs) { set(i, function (x) { x.conds = cs; }); } }) : h('p', { className: 'lor-sm lor-muted lvl-first' }, t('lc_first')),
          h('details', { className: 'lvl-texts' },
            h('summary', null, t('lvl_texts')),
            h('div', { className: 'lvl-names' },
              LG.map(function (lg) { return h(Field, { key: 'n' + lg, name: 'ln' + i + lg, label: t('lvl_name') + ' · ' + lg.toUpperCase(), value: lv.name[lg], onChange: function (v) { set(i, function (x) { x.name[lg] = v; }); } }); }),
              LG.map(function (lg) { return h(Field, { key: 'r' + lg, name: 'lr' + i + lg, label: t('lvl_role') + ' · ' + lg.toUpperCase(), value: (lv.role || {})[lg] || '', onChange: function (v) { set(i, function (x) { x.role = objOf(x.role); x.role[lg] = v; }); } }); })),
            h('div', { className: 'lvl-desc' }, LG.map(function (lg) { return h(Field, { key: lg, name: 'ld' + i + lg, multiline: true, rows: 3, label: t('lvl_desc') + ' · ' + lg.toUpperCase(), value: (lv.desc || lvlLib(lv, 'desc'))[lg] || '', onChange: function (v) { set(i, function (x) { x.desc = Object.assign({}, x.desc || lvlLib(x, 'desc')); x.desc[lg] = v; }); } }); })),
            h('div', { className: 'lvl-desc' }, LG.map(function (lg) { return h(Field, { key: 'g' + lg, name: 'lgw' + i + lg, multiline: true, rows: 3, label: t('lvl_grow') + ' · ' + lg.toUpperCase(), hint: t('lvl_line_hint'), value: levelGrow(lv, lg).join('\n'), onChange: function (v) { set(i, function (x) { x.grow = Object.assign({}, x.grow || lvlLib(x, 'grow')); x.grow[lg] = v.split('\n').map(function (y) { return y.trim(); }).filter(Boolean); }); } }); })),
            h('div', { className: 'lvl-desc' }, LG.map(function (lg) { return h(Field, { key: 'p' + lg, name: 'lpk' + i + lg, multiline: true, rows: 4, label: t('lvl_perks') + ' · ' + lg.toUpperCase(), hint: t('lvl_perk_hint'), value: levelPerks(lv, lg).map(function (y) { return y[0] + ' — ' + y[1]; }).join('\n'), onChange: function (v) { set(i, function (x) { x.perks = Object.assign({}, x.perks || lvlLib(x, 'perks')); x.perks[lg] = v.split('\n').map(function (y) { return y.trim(); }).filter(Boolean).map(function (y) { var m = y.split(' — '); return [m[0], m.slice(1).join(' — ')]; }); }); } }); }))),
          h('div', { className: 'lvl-people' }, h('span', { className: 'lor-eyebrow' }, t('lvl_people') + ' · ' + people.length),
            people.map(function (x) { return h('span', { key: x.u.id, className: 'lvl-person' }, x.u.name, h('small', null, x.r.next ? x.r.pct + '%' : x.r.inLevel + ' XP')); })));
      })),
      h('div', { className: 'box-row' },
        h(Btn, { variant: 'outline', onClick: function () { var n = L.length + 1; s[1](L.concat([{ id: 'lvl' + Date.now().toString(36), name: { uz: n + '-daraja', ru: 'Уровень ' + n, en: 'Level ' + n, zh: n + ' 级' }, role: { uz: '', ru: '', en: '', zh: '' }, alt: { uz: '', ru: '', en: '', zh: '' }, gold: 0, conds: [{ id: condId(), type: 'xp', n: 600 }, { id: condId(), type: 'tenure', n: 180 }] }])); } }, '+ ' + t('add_level')),
        h(Btn, { variant: 'primary', arrow: true, onClick: save }, t('save'))));
  }

  /* ---------- AI helper inside the Content (CMS) editor ---------- */
  function CmsAI(p) {
    var t = p.t, sampler = p.sampler, draft = p.draft;
    var open = useState(true), busy = useState(null), res = useState(null), err = useState(''), instr = useState(''), qn = useState('5'), ctl = useRef(null);
    useEffect(function () { res[1](null); err[1](''); if (ctl.current) ctl.current.abort(); busy[1](null); }, [draft.id]);
    var LANG = 'o‘zbek tili, lotin yozuvi (o‘ va g‘ harflarida ‘ belgisi)';
    function src() { return lessonText({ title: draft.title, intro: draft.intro, steps: draft.steps, html: draft.html, limit: draft.limit }).slice(0, 24000); }
    function run(kind) {
      if (!sampler || busy[0]) return;
      var text = src(), hasText = plain(draft.html).length > 40 || (draft.steps || []).length;
      if (kind !== 'custom' && !hasText) { err[1](t('ai_empty_text')); return; }
      if (kind === 'custom' && !instr[0].trim()) return;
      var head = 'Siz BURAQ Logistics kompaniyasining o‘quv platformasida SOP menejeriga yordam beruvchi AI-muharrirsiz. Kontent tili: ' + LANG + '.\n';
      var prompt, json = false;
      if (kind === 'quiz') { json = true; prompt = head + 'Quyidagi standart asosida ' + qn[0] + ' ta test savolini tuzing. Har bir savol standartdagi aniq qoida, muddat, raqam yoki mas’ul shaxsni tekshirsin; to‘g‘ri javob matnda bo‘lishi shart. 4 ta variant, bittasi to‘g‘ri, qolganlari ishonarli, lekin noto‘g‘ri. To‘g‘ri variant o‘rni har xil bo‘lsin.\nFaqat JSON massiv qaytaring: [{"q":"savol","options":["A","B","C","D"],"answer":0}] (answer — to‘g‘ri variant indeksi 0–3).\n' + ((draft.quiz || []).length ? 'Mavjud savollarni takrorlamang: ' + draft.quiz.map(function (x) { return x.q; }).join(' | ') + '\n' : '') + '\nSTANDART:\n' + text; }
      else if (kind === 'steps') { json = true; prompt = head + 'Quyidagi standartdan asosiy ish jarayonini 4–8 ta ketma-ket qadamga ajrating. Har qadam — bitta aniq harakat (kim nima qiladi, qachongacha). "who" — ishtirok etuvchi rollar zanjiri (kim → kimga), standartdagi nomlar bilan.\nFaqat JSON massiv qaytaring: [{"text":"harakat","who":["Omborchi","Logist"]}].\n\nSTANDART:\n' + text; }
      else if (kind === 'intro') { prompt = head + 'Quyidagi standart uchun darsning qisqa kirishini yozing: 1–2 gap, xodimga bu standart nima uchun kerakligini tushuntirsin. Faqat kirish matnini qaytaring, qo‘shtirnoqsiz va markdownsiz.\n\nSTANDART:\n' + text; }
      else if (kind === 'clarify') { prompt = head + 'Xodimlar ushbu standart bo‘yicha savollar berishgan. Standartning qaysi joylari noaniq ekanini aniqlang va har biri uchun standartga qo‘shiladigan aniq matnni taklif qiling. Tuzilma: har bir savol uchun "**Muammo:** …" va "**Taklif qilinadigan matn:** …". Faqat standartga tayanib yozing; standartda javob bo‘lmasa, buni ochiq ayting va SOP menejeri aniqlashtirishi kerakligini yozing.\n\nSAVOLLAR:\n' + (p.questions || []).map(function (q, i) { return (i + 1) + '. ' + q; }).join('\n') + '\n\nSTANDART:\n' + text; }
      else { prompt = head + 'SOP menejeri topshirig‘i: ' + instr[0].trim() + '\n\nNatijani darsning YANGI TO‘LIQ standart matni sifatida HTML ko‘rinishida qaytaring. Faqat quyidagi teglar: <h3>, <h4>, <p>, <strong>, <em>, <ul>, <ol>, <li>, <table>, <tr>, <th>, <td>, <blockquote> (eslatma uchun), <br>. Mavjud <img ...> teglarini o‘zgartirmasdan saqlang. Faktlar, raqamlar va muddatlarni o‘ylab topmang: agar topshiriq yangi mavzu bo‘lsa va ma’lumot yetarli bo‘lmasa, [SOP menejeri to‘ldiradi] belgisini qo‘ying. Faqat HTML qaytaring, izohsiz va ``` belgilarisiz.\n\nJORIY MATN (HTML):\n' + (draft.html || '').slice(0, 30000) + '\n\nDars nomi: ' + draft.title; }
      if (kind === 'improve') { prompt = head + 'Quyidagi standart matnini o‘qish uchun tuzilmaga keltiring: aniq sarlavhalar (<h4>), qadamlar uchun raqamli ro‘yxat, "ESLATMA" va "MUHIM" joylar uchun <blockquote>, imlo xatolarini tuzating. MAZMUN, RAQAMLAR, MUDDATLAR VA TALABLARNI O‘ZGARTIRMANG, hech narsa qo‘shmang va olib tashlamang. Mavjud <img ...> va <div class="ilova"> teglarini o‘zgartirmasdan saqlang. Faqat quyidagi teglar: <h3>, <h4>, <p>, <strong>, <em>, <ul>, <ol>, <li>, <table>, <tr>, <th>, <td>, <blockquote>, <br>, <div class="ilova">, <img>. Faqat HTML qaytaring, izohsiz va ``` belgilarisiz.\n\nMATN (HTML):\n' + (draft.html || '').slice(0, 30000); }
      var isHtml = kind === 'improve' || kind === 'custom';
      var c = new AbortController(); ctl.current = c;
      busy[1](kind); res[1](null); err[1]('');
      var call = json ? sampler.json(prompt, { signal: c.signal }) : sampler(prompt, { signal: c.signal, modelTier: kind === 'intro' ? 'quick' : 'default', onText: isHtml || kind === 'clarify' ? function (x) { res[1]({ kind: kind, text: x.text, streaming: true }); } : undefined });
      call.then(function (r) {
        if (kind === 'quiz') {
          var qs = (Array.isArray(r) ? r : []).filter(function (x) { return x && typeof x.q === 'string' && Array.isArray(x.options) && x.options.length >= 2 && x.options.every(function (o) { return typeof o === 'string'; }) && +x.answer >= 0 && +x.answer < x.options.length; }).map(function (x) { return { q: x.q.trim(), options: x.options.slice(0, 4).map(String), answer: Math.min(+x.answer, 3) }; });
          if (!qs.length) { err[1](t('ai_bad_json')); return; } res[1]({ kind: kind, quiz: qs });
        } else if (kind === 'steps') {
          var st = (Array.isArray(r) ? r : []).filter(function (x) { return x && typeof x.text === 'string' && x.text.trim(); }).map(function (x) { return { text: x.text.trim(), who: Array.isArray(x.who) ? x.who.map(String).filter(Boolean).slice(0, 5) : [] }; });
          if (!st.length) { err[1](t('ai_bad_json')); return; } res[1]({ kind: kind, steps: st });
        } else {
          var txt = String(r.text || '').replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/, '').trim();
          res[1]({ kind: kind, text: kind === 'intro' ? txt.replace(/^["“]|["”]$/g, '') : txt, html: isHtml ? sanitize(txt) : null, truncated: r.truncated });
        }
      }).catch(function (e) { if (e && e.code === 'cancelled') return; err[1](e && e.code === 'invalid_json' ? t('ai_bad_json') : aiErr(e, t)); }).then(function () { busy[1](null); });
    }
    function apply(mode) {
      var r = res[0]; if (!r) return;
      p.setD(function (d) {
        if (r.kind === 'quiz') d.quiz = (mode === 'replace' ? [] : d.quiz).concat(r.quiz);
        else if (r.kind === 'steps') d.steps = (mode === 'replace' ? [] : d.steps).concat(r.steps);
        else if (r.kind === 'intro') d.intro = r.text;
        else if (r.html != null) { d.html = r.html; d._v = (d._v || 0) + 1; }
      });
      res[1](null); p.say(t('ai_applied'));
    }
    var r = res[0], tools = [['quiz', t('ai_quiz')], ['improve', t('ai_improve')], ['intro', t('ai_intro')], ['steps', t('ai_steps')]];
    if ((p.questions || []).length) tools.push(['clarify', t('ai_clarify')]);
    return h('section', { className: 'cms-ai' },
      h('button', { type: 'button', className: 'cms-ai-h', 'aria-expanded': open[0], onClick: function () { open[1](!open[0]); } },
        h('span', { className: 'cms-ai-spark', 'aria-hidden': true }, '✦'), h('b', null, t('cms_ai')), h('span', { className: 'lor-sm lor-muted' }, open[0] ? '▴' : '▾')),
      open[0] ? h('div', { className: 'cms-ai-body' },
        h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, sampler === null ? t('ai_unavail') : t('cms_ai_hint')),
        h('div', { className: 'cms-ai-tools' },
          tools.map(function (x) { return h(Btn, { key: x[0], variant: 'outline', size: 'sm', disabled: !sampler || !!busy[0], onClick: function () { run(x[0]); } }, busy[0] === x[0] ? t('ai_thinking') : x[1]); }),
          h('label', { className: 'cms-ai-qn' }, t('q_count'), h('select', { className: 'lor-input slim', value: qn[0], onChange: function (e) { qn[1](e.target.value); } }, ['3', '5', '8', '10'].map(function (n) { return h('option', { key: n, value: n }, n); })))),
        h('div', { className: 'cms-ai-custom' },
          h('textarea', { id: 'cms-ai-instr', className: 'lor-input', rows: 2, value: instr[0], placeholder: t('ai_custom_ph'), 'aria-label': t('ai_custom'), onChange: function (e) { instr[1](e.target.value); } }),
          busy[0] ? h(Btn, { variant: 'outline', size: 'sm', onClick: function () { if (ctl.current) ctl.current.abort(); busy[1](null); } }, t('ai_stop')) : h(Btn, { variant: 'secondary', size: 'sm', disabled: !sampler || !instr[0].trim(), onClick: function () { run('custom'); } }, t('ai_run'))),
        err[0] ? h('p', { className: 'lor-field-error', style: { margin: 0 } }, err[0]) : null,
        r ? h('div', { className: 'cms-ai-res' },
          h('span', { className: 'lor-eyebrow' }, t('ai_result')),
          r.kind === 'quiz' ? h('ol', { className: 'ai-quiz-prev' }, r.quiz.map(function (q, i) { return h('li', { key: i }, h('b', null, q.q), h('ul', null, q.options.map(function (o, k) { return h('li', { key: k, className: k === q.answer ? 'ok' : '' }, (k === q.answer ? '✓ ' : '') + o); }))); }))
            : r.kind === 'steps' ? h('ol', { className: 'ai-quiz-prev' }, r.steps.map(function (s, i) { return h('li', { key: i }, s.text, s.who.length ? h('span', { className: 'lor-sm lor-muted' }, ' — ' + s.who.join(' → ')) : null); }))
            : r.kind === 'intro' ? h('p', { style: { margin: 0 } }, r.text)
            : r.kind === 'clarify' ? h('div', { className: 'ai-md', dangerouslySetInnerHTML: { __html: mdLite(r.text) } })
            : h('div', { className: 'cms-ai-html sop-body', dangerouslySetInnerHTML: { __html: sanitize(r.streaming ? r.text : r.html) } }),
          r.truncated ? h('p', { className: 'lor-field-error', style: { margin: 0 } }, t('ai_truncated')) : null,
          r.streaming ? null : h('div', { className: 'cms-ai-act' },
            h(Btn, { variant: 'ghost', size: 'sm', onClick: function () { res[1](null); } }, t('discard')),
            r.kind === 'clarify' ? null
              : (r.kind === 'quiz' || r.kind === 'steps') ? h(F, null, h(Btn, { variant: 'outline', size: 'sm', onClick: function () { apply('replace'); } }, t('apply_replace')), h(Btn, { variant: 'primary', size: 'sm', onClick: function () { apply('add'); } }, t('apply_add')))
              : h(Btn, { variant: 'primary', size: 'sm', disabled: !!r.truncated, onClick: function () { apply(); } }, t('apply')))) : null) : null);
  }

  /* ---------- level texts, promotion notice, profile menu ---------- */
  function lvlLib(lv, k) { return (lv && LEVEL_LIB[lv.id] ? LEVEL_LIB[lv.id][k] : null) || {}; }
  function levelGrow(lv, lang) { var o = (lv && lv.grow) || lvlLib(lv, 'grow'); return (o[lang] || o.uz || []).slice(); }
  function levelPerks(lv, lang) { var o = (lv && lv.perks) || lvlLib(lv, 'perks'); return (o[lang] || o.uz || []).slice(); }
  function levelDesc(lv, lang) { if (!lv) return ''; var d = lv.desc || lvlLib(lv, 'desc'); return d[lang] || d.uz || ''; }
  /* keepAt: the employee’s own device congratulates but does not move the level date — with the server that is the SOP manager’s */
  function markPromotion(d, uid, li, fromLi, keepAt) {
    d.users.forEach(function (x) { if (x.id === uid) { x.celebrate = { kind: 'level', li: li, fromLi: fromLi, at: Date.now() }; x.lastRank = String(li); if (!keepAt && (!x.levelAt || Date.now() - x.levelAt > 6e4)) x.levelAt = Date.now(); } });
    d.notifications.unshift({ id: nextId(d), userId: uid, promo: { li: li }, text: '', path: true, at: Date.now(), read: false });
  }
  function notifText(n, db, lang, t) {
    if (n.kind === 'ini_in') return t('n_ini_in');
    if (n.kind === 'ini' && n.ini) return tpl(t('n_ini_' + n.ini.s), { x: n.ini.title }) + (n.ini.xp ? ' (+' + n.ini.xp + ' XP)' : '') + (n.ini.reply ? ' — ' + n.ini.reply : '');
    if (n.kind === 'asset' && n.asset) return tpl(t('n_as_' + n.asset.k), { x: n.asset.name });
    if (n.kind === 'pulse') return t('n_pulse');
    if (n.kind === 'err' && n.err) return tpl(t(n.err.retrain ? 'n_err_train' : 'n_err'), { c: t('ec_' + n.err.cat), x: n.err.ttl });
    if (n.kind === 'errfix' && n.err) return tpl(t('n_errfix'), { name: n.err.name, x: n.err.ttl, n: n.err.score });
    if (n.kind === 'sop' && n.sop) return tpl(t('n_sop'), { x: n.sop.ttl });
    if (n.kind === 'month') return monthNotif(n, lang, t);
    if (n.kind === 'late') return lateNotif(n, t);
    if (n.kind === 'xt') return xtNotif(n, t);
    if (n.kind === 'ltask' && n.lt) return tpl(t('n_ltask'), { x: txtOf(n.lt.x, lang) });
    if (n.kind === 'pay' && n.pay) return tpl(t('n_pay_' + n.pay.s), { m: ymLabel(n.pay.ym, lang, true), x: sumTxt(n.pay.total, t) }) + (n.pay.reply ? ' — ' + n.pay.reply : '');
    if (!n.promo) return n.text;
    var lv = levelsOf(db)[n.promo.li];
    return tpl(t('n_promo_level'), { x: lvlName(lv, lang) }) + ' ' + levelDesc(lv, lang);
  }
  /* level emblem: shield with the level number, rank chevrons and a laurel (original drawing) */
  function LevelEmblem(p) {
    var n = p.n || 1, s = p.size || 120, uid = 'le' + (p.uid || n), cxp = 60, cyp = 74, R = 52, parts = [];
    for (var i = 0; i < 8; i++) {
      var deg = 120 + i * 16, a = deg * Math.PI / 180, x = cxp + R * Math.cos(a), y = cyp + R * Math.sin(a), rot = deg + 25;
      parts.push(h('ellipse', { key: 'l' + i, className: 'lf', cx: x.toFixed(1), cy: y.toFixed(1), rx: 4, ry: 8.6, transform: 'rotate(' + rot.toFixed(1) + ' ' + x.toFixed(1) + ' ' + y.toFixed(1) + ')' }));
      var x2 = 2 * cxp - x;
      parts.push(h('ellipse', { key: 'r' + i, className: 'lf', cx: x2.toFixed(1), cy: y.toFixed(1), rx: 4, ry: 8.6, transform: 'rotate(' + (-rot).toFixed(1) + ' ' + x2.toFixed(1) + ' ' + y.toFixed(1) + ')' }));
    }
    function pt(deg, rr) { var a = deg * Math.PI / 180; return [(cxp + rr * Math.cos(a)).toFixed(1), (cyp + rr * Math.sin(a)).toFixed(1)]; }
    var s1 = pt(112, R - 2), s2 = pt(238, R - 2);
    var shield = 'M60 20 L94 31 V66 C94 92 79 108 60 118 C41 108 26 92 26 66 V31 Z';
    var chev = []; for (var k = 0; k < Math.min(4, n); k++) { var yy = 36 + k * 6.5; chev.push(h('path', { key: 'c' + k, className: 'chev', d: 'M49 ' + yy + ' L60 ' + (yy + 6) + ' L71 ' + yy })); }
    /* levels 5+ earn stars above the shield */
    var stars = [], ns = Math.max(0, Math.min(3, n - 4));
    for (var q = 0; q < ns; q++) {
      var sx = 60 + (q - (ns - 1) / 2) * 17, sp = [];
      for (var j = 0; j < 10; j++) { var aa = -Math.PI / 2 + j * Math.PI / 5, rr = j % 2 ? 2.9 : 7; sp.push((sx + rr * Math.cos(aa)).toFixed(1) + ',' + (10 + rr * Math.sin(aa)).toFixed(1)); }
      stars.push(h('polygon', { key: 's' + q, className: 'star-top', points: sp.join(' ') }));
    }
    return h('svg', { className: cx('lvl-emblem', p.className), width: s, height: Math.round(s * 140 / 136), viewBox: '-8 0 136 140', 'aria-hidden': true },
      h('defs', null, h('clipPath', { id: uid + 'c' }, h('path', { d: shield })), h('linearGradient', { id: uid + 'g', x1: 0, x2: 1, y1: 0, y2: 0 }, h('stop', { offset: '0', stopColor: '#fff', stopOpacity: 0 }), h('stop', { offset: '.5', stopColor: '#fff', stopOpacity: .9 }), h('stop', { offset: '1', stopColor: '#fff', stopOpacity: 0 }))),
      h('path', { className: 'stem', d: 'M' + s1[0] + ' ' + s1[1] + ' A ' + (R - 2) + ' ' + (R - 2) + ' 0 0 1 ' + s2[0] + ' ' + s2[1] }),
      h('path', { className: 'stem', d: 'M' + (120 - s1[0]).toFixed(1) + ' ' + s1[1] + ' A ' + (R - 2) + ' ' + (R - 2) + ' 0 0 0 ' + (120 - s2[0]).toFixed(1) + ' ' + s2[1] }),
      parts,
      h('path', { className: 'ribbon', d: 'M28 110 L92 110 L87 119 L92 128 L28 128 L33 119 Z' }),
      h('path', { className: 'shield', d: shield }),
      h('path', { className: 'shield-in', d: 'M60 27 L88 36 V66 C88 88 76 101 60 110 C44 101 32 88 32 66 V36 Z' }),
      chev, stars,
      h('text', { className: 'num', x: 60, y: 95, textAnchor: 'middle' }, String(n)),
      h('g', { clipPath: 'url(#' + uid + 'c)' }, h('rect', { className: 'shine shine-le', x: -10, y: 10, width: 26, height: 120, fill: 'url(#' + uid + 'g)' })));
  }

  /* ---------- celebration sound: synthesized with Web Audio (no audio files) ---------- */
  function sfxEngine(ctx) {
    var comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.25;
    var master = ctx.createGain(); master.gain.value = 0.55; master.connect(comp); comp.connect(ctx.destination);
    var verb = ctx.createConvolver(), vg = ctx.createGain(); vg.gain.value = 0.8;
    verb.buffer = (function () { var len = Math.floor(ctx.sampleRate * 2.2), b = ctx.createBuffer(2, len, ctx.sampleRate); for (var c = 0; c < 2; c++) { var d = b.getChannelData(c); for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); } return b; })();
    verb.connect(vg); vg.connect(master);
    var nb = null, bus = master;
    function noise() { if (!nb) { var len = ctx.sampleRate * 2; nb = ctx.createBuffer(1, len, ctx.sampleRate); var d = nb.getChannelData(0); for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; } var s = ctx.createBufferSource(); s.buffer = nb; s.loop = true; return s; }
    function out(node, wet) { node.connect(bus); if (wet) { var g = ctx.createGain(); g.gain.value = wet; node.connect(g); g.connect(verb); } }
    function env(g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + d); }
    function snare(t, v) { var n = noise(), f = ctx.createBiquadFilter(), g = ctx.createGain(); f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.7; env(g, t, 0.002, v, 0.1); n.connect(f); f.connect(g); out(g, 0.25); n.start(t, Math.random()); n.stop(t + 0.12); }
    function kick(t, v) { var o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.4); env(g, t, 0.004, v, 0.55); o.connect(g); out(g, 0.15); o.start(t); o.stop(t + 0.6); }
    function crash(t, v, dur) { var n = noise(), f = ctx.createBiquadFilter(), g = ctx.createGain(); f.type = 'highpass'; f.frequency.value = 5200; env(g, t, 0.003, v, dur); n.connect(f); f.connect(g); out(g, 0.45); n.start(t, Math.random()); n.stop(t + dur + 0.05); }
    function whoosh(t, dur, v) { var n = noise(), f = ctx.createBiquadFilter(), g = ctx.createGain(); f.type = 'bandpass'; f.Q.value = 0.9; f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(4200, t + dur); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + dur * 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); n.connect(f); f.connect(g); out(g, 0.3); n.start(t, Math.random()); n.stop(t + dur + 0.05); }
    function brass(t, f0, dur, v) {
      var f = ctx.createBiquadFilter(), g = ctx.createGain(); f.type = 'lowpass'; f.Q.value = 1.1;
      f.frequency.setValueAtTime(500, t); f.frequency.linearRampToValueAtTime(3200, t + 0.05); f.frequency.exponentialRampToValueAtTime(1500, t + Math.max(0.1, dur));
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.025); g.gain.setValueAtTime(v, t + dur); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.28);
      [-7, 5].forEach(function (det) { var o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f0; o.detune.value = det; o.connect(f); o.start(t); o.stop(t + dur + 0.3); });
      f.connect(g); out(g, 0.35);
    }
    function chime(t, f0, v, dur) { var g = ctx.createGain(), o = ctx.createOscillator(), o2 = ctx.createOscillator(), g2 = ctx.createGain(); o.type = 'sine'; o.frequency.value = f0; o2.type = 'sine'; o2.frequency.value = f0 * 2.76; g2.gain.value = 0.3; env(g, t, 0.004, v, dur); o.connect(g); o2.connect(g2); g2.connect(g); out(g, 0.55); o.start(t); o2.start(t); o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05); }
    function pad(t, f0, v, dur) { var o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'triangle'; o.frequency.value = f0; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.12); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g); out(g, 0.5); o.start(t); o.stop(t + dur + 0.05); }
    function pop(t, v) { var n = noise(), f = ctx.createBiquadFilter(), g = ctx.createGain(); f.type = 'bandpass'; f.frequency.value = 700 + Math.random() * 900; f.Q.value = 1.4; env(g, t, 0.002, v, 0.22); n.connect(f); f.connect(g); out(g, 0.5); n.start(t, Math.random()); n.stop(t + 0.25); }
    function clap(t, v) { var n = noise(), f = ctx.createBiquadFilter(), g = ctx.createGain(); f.type = 'bandpass'; f.frequency.value = 1100 + Math.random() * 1400; f.Q.value = 0.9; env(g, t, 0.001, v, 0.07); n.connect(f); f.connect(g); out(g, 0.35); n.start(t, Math.random()); n.stop(t + 0.09); }
    function applause(t, dur, v) { var cnt = Math.floor(dur * 34); for (var i = 0; i < cnt; i++) { var tt = t + Math.random() * dur, x = (tt - t) / dur, amp = v * (x < 0.15 ? x / 0.15 : 1 - (x - 0.15) / 0.85 * 0.92); clap(tt, Math.max(0.005, amp * (0.45 + Math.random() * 0.55))); } }
    var SPARK = [2093, 2349.3, 2637, 3136, 3520];
    function sparkles(t, n, v) { for (var i = 0; i < n; i++) chime(t + i * 0.085 + Math.random() * 0.03, SPARK[Math.floor(Math.random() * SPARK.length)], v, 0.6); }
    function roll(t, dur, n, v0, v1) { for (var i = 0; i < n; i++) { var x = i / n; snare(t + dur * Math.pow(x, 0.72), v0 + (v1 - v0) * x); } }
    function newBus(t) { bus = ctx.createGain(); bus.gain.setValueAtTime(1, t); bus.connect(master); return bus; }
    var C4 = 261.63, C5 = 523.25, E5 = 659.25, G5 = 783.99, C6 = 1046.5;
    return {
      master: master,
      level: function (t) {
        var b = newBus(t); roll(t, 1.12, 30, 0.06, 0.5); whoosh(t + 0.25, 0.95, 0.22);
        var T = t + 1.2; kick(T, 0.95); crash(T, 0.38, 2.4);
        brass(T, C5, 0.1, 0.2); brass(T + 0.15, C5, 0.1, 0.2); brass(T + 0.3, C5, 0.1, 0.2);
        [C5, E5, G5].forEach(function (f) { brass(T + 0.45, f, 1.05, 0.12); }); brass(T + 0.45, C4, 1.05, 0.1);
        brass(T + 1.62, G5, 0.12, 0.15); [E5, G5].forEach(function (f) { brass(T + 1.8, f, 0.9, 0.09); }); brass(T + 1.8, C6, 0.95, 0.14); brass(T + 1.8, C4, 0.95, 0.08);
        kick(T + 1.8, 0.6); crash(T + 1.8, 0.2, 1.8); sparkles(T + 0.45, 9, 0.045); applause(T + 0.25, 3.2, 0.12);
        return b;
      },
      pop: function (t) { pop(t, 0.22); chime(t + 0.02, SPARK[Math.floor(Math.random() * SPARK.length)], 0.035, 0.5); }
    };
  }
  var Sfx = (function () {
    var ctx = null, eng = null, muted = false, cur = null;
    try { muted = localStorage.getItem('lor-sfx-muted') === '1'; } catch (e) {}
    function ensure() {
      try {
        if (!ctx) { var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false; ctx = new AC(); eng = sfxEngine(ctx); eng.master.gain.value = muted ? 0 : 0.55; }
        if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(function () {});
        return true;
      } catch (e) { return false; }
    }
    function play(fn) { if (!ensure()) return; try { hush(); cur = eng[fn](ctx.currentTime + 0.05); } catch (e) {} }
    function hush() { if (cur && ctx) { try { cur.gain.setTargetAtTime(0, ctx.currentTime, 0.08); } catch (e) {} cur = null; } }
    return {
      unlock: ensure, level: function () { play('level'); }, hush: hush,
      pop: function () { if (!ctx || muted || ctx.state !== 'running') return; try { eng.pop(ctx.currentTime); } catch (e) {} },
      isMuted: function () { return muted; },
      setMuted: function (m) { muted = !!m; try { localStorage.setItem('lor-sfx-muted', m ? '1' : '0'); } catch (e) {} if (eng) { try { eng.master.gain.setTargetAtTime(m ? 0 : 0.55, ctx.currentTime, 0.04); } catch (e) {} } },
      state: function () { return ctx ? ctx.state : 'none'; }
    };
  })();
  window.LOR_SFX = Sfx; window.LOR_SFX_ENGINE = sfxEngine;

  /* ---------- celebration visuals: confetti cannons + fireworks on a canvas ---------- */
  var IMPACT_MS = 1250, CARD_MS = 2500;
  function createFx(canvas, o) {
    var g = canvas.getContext('2d'), dpr = Math.min(2, window.devicePixelRatio || 1), W = 0, H = 0, parts = [], rockets = [], raf = 0, last = 0, live = false, timers = [];
    function size() { W = window.innerWidth; H = window.innerHeight; canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0); }
    size(); window.addEventListener('resize', size);
    function rnd(a, b) { return a + Math.random() * (b - a); }
    function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
    function confetti(x, y, ang, spread, n, speed) {
      for (var i = 0; i < n; i++) { var a = (ang + rnd(-spread, spread)) * Math.PI / 180, v = rnd(speed * 0.45, speed);
        parts.push({ k: Math.random() < 0.18 ? 'c' : 'r', x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, w: rnd(6, 11), h: rnd(9, 16), rot: rnd(0, 6.28), vr: rnd(-0.25, 0.25), tilt: rnd(0, 6.28), vt: rnd(0.08, 0.2), col: pick(o.colors), life: 1, decay: rnd(0.0022, 0.0042), drag: 0.985, gr: 0.22 }); }
    }
    function burst(x, y, col, n) {
      for (var i = 0; i < n; i++) { var a = i / n * Math.PI * 2 + rnd(-0.05, 0.05), v = rnd(2.2, 5.4);
        parts.push({ k: 's', x: x, y: y, px: x, py: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, col: Math.random() < 0.25 ? '#ffffff' : col, life: 1, decay: rnd(0.011, 0.018), drag: 0.965, gr: 0.05, r: rnd(1.4, 2.4) }); }
      if (o.onPop) o.onPop();
    }
    function rocket(x, ty, col) { rockets.push({ x: x, y: H + 10, vy: -rnd(10, 13), ty: ty, col: col }); }
    function frame(ts) {
      var dt = last ? Math.min(3, (ts - last) / 16.67) : 1; last = ts;
      g.clearRect(0, 0, W, H);
      for (var i = rockets.length - 1; i >= 0; i--) { var r = rockets[i]; r.y += r.vy * dt; r.vy += 0.13 * dt;
        g.globalAlpha = 0.9; g.strokeStyle = r.col; g.lineWidth = 2.2; g.beginPath(); g.moveTo(r.x, r.y); g.lineTo(r.x, r.y + 16); g.stroke();
        if (r.y <= r.ty || r.vy >= -1.5) { burst(r.x, r.y, r.col, 72); rockets.splice(i, 1); } }
      for (var j = parts.length - 1; j >= 0; j--) { var p = parts[j];
        p.vx *= Math.pow(p.drag, dt); p.vy = p.vy * Math.pow(p.drag, dt) + p.gr * dt; p.px = p.x; p.py = p.y; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= p.decay * dt;
        if (p.life <= 0 || p.y > H + 40) { parts.splice(j, 1); continue; }
        g.globalAlpha = Math.max(0, Math.min(1, p.life * 1.4));
        if (p.k === 's') { g.strokeStyle = p.col; g.lineWidth = p.r; g.beginPath(); g.moveTo(p.px - p.vx * 2.2, p.py - p.vy * 2.2); g.lineTo(p.x, p.y); g.stroke(); }
        else { p.rot += p.vr * dt; p.tilt += p.vt * dt; g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.scale(1, Math.cos(p.tilt)); g.fillStyle = p.col; if (p.k === 'c') { g.beginPath(); g.arc(0, 0, p.w * 0.45, 0, 6.283); g.fill(); } else g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); g.restore(); }
      }
      g.globalAlpha = 1;
      raf = (live || parts.length || rockets.length) ? requestAnimationFrame(frame) : 0;
    }
    function at(ms, fn) { timers.push(setTimeout(fn, ms)); }
    function kick() { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } }
    function reset() { timers.forEach(clearTimeout); timers = []; parts = []; rockets = []; }
    return {
      play: function (kind, cx, cy) {
        reset(); if (o.reduce) return;
        live = true; kick();
        var big = kind === 'level';
        at(IMPACT_MS, function () {
          confetti(-10, H * 0.9, -62, 16, big ? 150 : 90, big ? 25 : 21);
          confetti(W + 10, H * 0.9, -118, 16, big ? 150 : 90, big ? 25 : 21);
          confetti(cx, cy, -90, 180, big ? 70 : 45, 10);
        });
        (big ? [1550, 1950, 2350, 2850, 3350, 3950, 4650, 5300] : [1700, 2400, 3100]).forEach(function (ms) { at(ms, function () { rocket(rnd(W * 0.12, W * 0.88), rnd(H * 0.1, H * 0.4), pick(o.fw)); }); });
        at(big ? 2700 : 2300, function () { for (var k = 0; k < (big ? 4 : 2); k++) confetti(rnd(0, W), -20, 90, 25, 35, 5); });
        at(big ? 6800 : 4200, function () { live = false; });
      },
      stop: function () { timers.forEach(clearTimeout); timers = []; live = false; },
      destroy: function () { reset(); live = false; if (raf) cancelAnimationFrame(raf); raf = 0; window.removeEventListener('resize', size); }
    };
  }

  function SpeakerIcon(p) { return h('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4z' }), p.muted ? h('path', { d: 'M16 9.5l5 5M21 9.5l-5 5' }) : h('path', { d: 'M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11' })); }
  function ReplayIcon() { return h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: 'M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5' })); }

  /* ---------- the celebration screen shown after a promotion ---------- */
  function Celebration(p) {
    var t = p.t, db = p.db, u = p.user, c = u.celebrate, L = levelsOf(db), lv = L[c.li], lang = p.lang;
    var fromLi = c.fromLi != null ? c.fromLi : Math.max(0, c.li - 1);
    var st = useState(c.replay ? 'show' : 'teaser'), stage = st[0];
    var ph = useState(0), phase = ph[0], run = useState(c.replay ? 1 : 0), runN = run[0], mu = useState(Sfx.isMuted());
    var cvs = useRef(null), fx = useRef(null), emb = useRef(null), root = useRef(null), openBtn = useRef(null), primBtn = useRef(null);
    var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var r = rankOf(db, u);
    useEffect(function () { var prev = document.body.style.overflow; document.body.style.overflow = 'hidden'; return function () { document.body.style.overflow = prev; Sfx.hush(); }; }, []);
    useEffect(function () {
      if (!cvs.current) return;
      fx.current = createFx(cvs.current, { reduce: reduce, colors: ['#DE0441', '#ffffff', '#8db8f2', '#034CAA', '#ff7b9a'], fw: ['#DE0441', '#ffffff', '#8db8f2', '#034CAA'], onPop: Sfx.pop });
      return function () { if (fx.current) fx.current.destroy(); };
    }, []);
    useEffect(function () { if (stage === 'teaser' && openBtn.current) openBtn.current.focus(); }, [stage]);
    useEffect(function () {
      if (!runN) return;
      ph[1](0);
      Sfx.level();
      var rect = emb.current ? emb.current.getBoundingClientRect() : null;
      var x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2, y = rect ? rect.top + rect.height / 2 : window.innerHeight / 3;
      if (root.current) { root.current.style.setProperty('--cx', x + 'px'); root.current.style.setProperty('--cy', y + 'px'); }
      if (fx.current) fx.current.play('level', x, y);
      var a = setTimeout(function () { ph[1](1); }, reduce ? 0 : IMPACT_MS), b = setTimeout(function () { ph[1](2); }, reduce ? 300 : CARD_MS);
      return function () { clearTimeout(a); clearTimeout(b); if (fx.current) fx.current.stop(); };
    }, [runN]);
    useEffect(function () { if (phase === 2 && primBtn.current) primBtn.current.focus({ preventScroll: true }); }, [phase]);
    useEffect(function () { function k(e) { if (e.key === 'Escape') close(false); } window.addEventListener('keydown', k); return function () { window.removeEventListener('keydown', k); }; }, []);
    if (!lv) return null;
    function start() { Sfx.unlock(); st[1]('show'); run[1](function (n) { return n + 1; }); }
    function close(goPath) {
      Sfx.hush();
      if (p.preview) { if (p.onDone) p.onDone(); return; }
      p.update(function (d) { d.users.forEach(function (x) { if (x.id === u.id) { x.lastPromo = { kind: 'level', li: c.li, fromLi: fromLi }; x.celebrate = null; if (!c.replay) x.medalNew = true; } }); d.notifications.forEach(function (n) { if (n.userId === u.id && n.promo) n.read = true; }); });
      if (goPath) p.go({ name: 'path' });
    }
    function toggleMute() { var m = !mu[0]; Sfx.setMuted(m); mu[1](m); if (!m) Sfx.unlock(); }
    var next = r.need && r.inLevel < r.need ? tpl(t('xp_to_next'), { n: Math.max(0, r.need - r.inLevel) }) : r.next ? t('xp_enough') : t('top_level');
    var n = L.length, fromPct = n > 1 ? fromLi / (n - 1) * 100 : 0, toPct = n > 1 ? c.li / (n - 1) * 100 : 0;
    var eyebrow = t('promo_new_level');
    return h('div', { ref: root, className: cx('cel', 'k-level', stage === 'show' && 'is-show', phase >= 1 && 'is-impact', phase >= 2 && 'is-card', reduce && 'is-reduced'), role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'cel-title' },
      h('div', { className: 'cel-bg', 'aria-hidden': true }, h('div', { className: 'cel-rays' })),
      h('canvas', { ref: cvs, className: 'cel-canvas', 'aria-hidden': true }),
      h('div', { className: 'cel-flash', 'aria-hidden': true }),
      p.preview ? h('span', { className: 'cel-tag' }, t('cel_preview_tag')) : null,
      h('button', { type: 'button', className: 'cel-mute', onClick: toggleMute, 'aria-pressed': !mu[0], 'aria-label': mu[0] ? t('sound_on') : t('sound_off'), title: mu[0] ? t('sound_on') : t('sound_off') }, h(SpeakerIcon, { muted: mu[0] })),
      stage === 'teaser' ? h('div', { className: 'cel-teaser' },
        h('div', { className: 'cel-gift', 'aria-hidden': true }, h('div', { className: 'orbit' }, h('i'), h('i'), h('i')), h('div', { className: 'orb' }, h('span', null, '✦'))),
        h('span', { className: 'cel-eyebrow' }, eyebrow),
        h('h2', { className: 'cel-title show', id: 'cel-title' }, t('cel_teaser_t')),
        h('p', { className: 'cel-sub show' }, t('cel_teaser_s')),
        h('button', { type: 'button', ref: openBtn, className: 'lor-btn lor-btn-primary cel-open', onClick: start }, t('cel_open'), h(Arrow, { length: 28 })),
        h('span', { className: 'cel-hint' }, h(SpeakerIcon, { muted: mu[0] }), mu[0] ? t('sound_off_hint') : t('cel_sound_hint')))
      : h('div', { className: 'cel-stage', key: runN },
        h('span', { className: 'cel-eyebrow' }, eyebrow),
        h('div', { className: 'cel-emblem', ref: emb },
          h('div', { className: 'cel-glow' }), h('div', { className: 'cel-ring' }), h('div', { className: 'cel-ring r2' }),
          h('div', { className: 'flip' },
            h('div', { className: 'face front' }, h(LevelEmblem, { n: fromLi + 1, size: 160, uid: 'f' + runN })),
            h('div', { className: 'face back' }, h(LevelEmblem, { n: c.li + 1, size: 160, uid: 'b' + runN })))),
        h('h2', { className: 'cel-title', id: 'cel-title' }, tpl(t('promo_title'), { name: firstName(u) })),
        h('p', { className: 'cel-sub' }, tpl(t('cel_promoted'), { x: lvlName(lv, lang) })),
        lvlSub(lv, lang, t) ? h('p', { className: 'cel-role' }, lvlSub(lv, lang, t)) : null,
        h('div', { className: 'cel-move' }, h('span', { className: 'old' }, lvlShort(L[fromLi], lang)), h(Arrow, { length: 44, tone: 'red' }), h('span', { className: 'new' }, lvlShort(lv, lang))),
        h('div', { className: 'cel-ladder' },
          h('div', { className: 'track', style: { left: (50 / n) + '%', right: (50 / n) + '%' } }, h('span', { className: 'fill', style: { width: (phase >= 1 ? toPct : fromPct) + '%' } })),
          h('ol', { style: { gridTemplateColumns: 'repeat(' + n + ', minmax(0, 1fr))' } }, L.map(function (x, i) { return h('li', { key: x.id, className: cx(i < c.li && 'done', i === c.li && 'now') }, h('span', { className: 'n' }, i + 1), h('small', null, lvlShort(x, lang))); }))),
        h('div', { className: 'cel-card', 'aria-hidden': phase < 2 },
          h('div', { className: 'promo-sec' }, h('span', { className: 'lor-eyebrow' }, t('promo_means')),
            h('p', null, h('b', null, lvlName(lv, lang) + (lvlRole(lv, lang) ? ' (' + lvlRole(lv, lang) + ')' : '') + '. '), levelDesc(lv, lang)),
            h('p', { className: 'lor-sm lor-muted' }, t('cel_rank_reset'))),
          levelPerks(lv, lang).length ? h('div', { className: 'promo-sec' }, h('span', { className: 'lor-eyebrow' }, t('promo_perks')), h(PerkList, { items: levelPerks(lv, lang), max: 4 })) : null,
          h('div', { className: 'promo-sec' }, h('span', { className: 'lor-eyebrow' }, t('promo_next')), h('p', null, next)),
          h('div', { className: 'cel-actions' },
            h('button', { type: 'button', className: 'app-link replay', tabIndex: phase < 2 ? -1 : 0, onClick: function () { Sfx.unlock(); run[1](function (k) { return k + 1; }); } }, h(ReplayIcon), ' ', t('cel_replay')),
            h(Btn, { variant: 'outline', tabIndex: phase < 2 ? -1 : 0, onClick: function () { close(false); } }, t('promo_close')),
            h('button', { type: 'button', ref: primBtn, className: 'lor-btn lor-btn-primary', tabIndex: phase < 2 ? -1 : 0, onClick: function () { close(true); } }, t('promo_go'), h(Arrow, { length: 28 }))))));
  }

  function UserMenu(p) {
    var t = p.t, u = p.user, r = p.rank, o = useState(false), open = o[0], ref = useRef(null);
    useEffect(function () { if (!open) return; function off(e) { if (ref.current && !ref.current.contains(e.target)) o[1](false); } function k(e) { if (e.key === 'Escape') o[1](false); } document.addEventListener('mousedown', off); window.addEventListener('keydown', k); return function () { document.removeEventListener('mousedown', off); window.removeEventListener('keydown', k); }; }, [open]);
    var lv = r && r.level, pct = r && r.need ? Math.min(100, r.inLevel * 100 / r.need) : 100;
    return h('div', { className: 'user-wrap', ref: ref },
      h('button', { type: 'button', className: 'lor-user user-btn', 'aria-expanded': open, 'aria-haspopup': 'menu', onClick: function () { o[1](!open); if (p.isNew && p.onSeen) p.onSeen(); } },
        h('span', { className: cx('av-wrap', p.isNew && 'is-new') }, u.avatar ? h('img', { className: 'lor-user-av av-img', src: u.avatar, alt: '' }) : h('span', { className: 'lor-user-av' }, initials(u.name)), r ? h(LevelEmblem, { n: r.li + 1, size: 22, uid: 'avh', className: 'av-medal lvl-mini' }) : null),
        h('span', { className: 'app-user-txt' }, u.name, h('small', null, r ? rankLabel(r, p.lang, t) : p.subtitle)),
        h('span', { className: 'caret', 'aria-hidden': true }, '▾')),
      open ? h('div', { className: 'user-pop', role: 'menu' },
        h('div', { className: 'user-pop-h' },
          h('span', { className: 'av-wrap big' }, u.avatar ? h('img', { className: 'lor-user-av av-img', src: u.avatar, alt: '' }) : h('span', { className: 'lor-user-av' }, initials(u.name)), r ? h(LevelEmblem, { n: r.li + 1, size: 30, uid: 'avp', className: 'av-medal lvl-mini' }) : null),
          h('div', null, h('b', null, u.name), h('span', { className: 'lor-sm lor-muted' }, u.position + (u.department ? ' · ' + u.department : '')))),
        r ? h('div', { className: 'user-pop-lvl' },
          h('div', { className: 'user-pop-row' }, h(LevelBadge, { t: t, name: lvlShort(lv, p.lang), n: r.li }), h('span', { className: 'lor-sm lor-muted num' }, r.inLevel + ' XP')),
          lvlRole(lv, p.lang) || lvlShort(lv, p.lang) !== lvlName(lv, p.lang) ? h('span', { className: 'lor-sm lor-muted' }, [lvlShort(lv, p.lang) !== lvlName(lv, p.lang) ? lvlName(lv, p.lang) : '', lvlRole(lv, p.lang)].filter(Boolean).join(' · ')) : null,
          h('div', { className: 'lor-progress-track' }, h('div', { className: 'lor-progress-fill', style: { width: pct + '%' } })),
          h('span', { className: 'lor-sm lor-muted' }, r.need && r.inLevel < r.need ? tpl(t('xp_to_next'), { n: r.need - r.inLevel }) : r.next ? t('xp_enough') : t('top_level'))) : null,
        p.theme ? h(ThemeBlock, { t: t, value: p.theme.v, onChange: p.theme.set }) : null,
        p.hint ? h(HintSwitch, { t: t, on: p.hint.on, onToggle: p.hint.toggle }) : null,
        h('div', { className: 'user-pop-links' },
          p.onProfile ? h('button', { type: 'button', role: 'menuitem', className: 'profile', onClick: function () { o[1](false); p.onProfile(); } }, t('nav_profile')) : null,
          p.onPath ? h('button', { type: 'button', role: 'menuitem', onClick: function () { o[1](false); p.onPath(); } }, t('nav_path')) : null,
          (p.links || []).map(function (l) { return h('button', { key: l.key, type: 'button', role: 'menuitem', className: l.key, onClick: function () { o[1](false); l.onClick(); } }, h('span', null, l.label), l.count ? h('span', { className: 'app-navcount' }, l.count) : null); }),
          p.onTerms ? h('button', { type: 'button', role: 'menuitem', onClick: function () { o[1](false); p.onTerms(); } }, t('terms_link')) : null,
          h('button', { type: 'button', role: 'menuitem', className: 'logout', onClick: p.onLogout }, t('logout')))) : null);
  }

  /* ======================= FEATURES 2: property register · pulse survey · initiatives ======================= */

  function patchUser(d, uid, fn) { d.users.forEach(function (x) { if (x.id === uid) fn(x); }); }
  function employees(db) { return db.users.filter(function (u) { return u.role === 'employee'; }); }
  function fmtDay(s) { if (!s) return '—'; var m = String(s).split('-'); return m.length === 3 ? m[2] + '.' + m[1] + '.' + m[0] : s; }
  function fmtDate(ts) { var d = new Date(ts); return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear(); }
  function mean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; }
  var rkey = 0;
  function rid() { rkey++; return 'k' + Date.now().toString(36) + rkey; }

  /* ---------- icons (line icons, 24×24) ---------- */
  var ICO = {
    laptop: 'M4 5h16v11H4zM2 19h20', phone: 'M8 2.5h8a1.5 1.5 0 0 1 1.5 1.5v16a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 20V4A1.5 1.5 0 0 1 8 2.5zM11 18.5h2',
    sim: 'M7 2.5h7.5l4 4v15H7zM10 11h6v6h-6zM13 11v6M10 14h6', monitor: 'M3 4h18v12H3zM9 20h6M12 16v4',
    scanner: 'M3 5v14M6 5v14M9.5 5v14M13 5v14M15.5 5v14M18 5v14M21 5v14', token: 'M9 2.5h6v5H9zM6.5 7.5h11v10a4 4 0 0 1-4 4h-3a4 4 0 0 1-4-4zM11 4.5v1M13 4.5v1',
    pass: 'M4 6h16v14H4zM9 3h6v3H9zM8 12.5a2 2 0 1 0 4 0a2 2 0 1 0-4 0M7 17h6M14.5 12h3M14.5 15h3', uniform: 'M8 3l4 3 4-3 4 3-2 5v10H6V11L4 6zM12 6v15',
    keys: 'M15 3a5 5 0 1 1-4.2 7.7L4 17.5V21h3.5v-2h2v-2h2l1.3-1.3A5 5 0 0 1 15 3zM16.5 7.5h.01', furniture: 'M7 3h10v8H7zM5 11h14v3H5zM7 14v7M17 14v7',
    other: 'M3 7.5l9-4.5 9 4.5v9L12 21l-9-4.5zM3 7.5l9 4.5 9-4.5M12 12v9',
    bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.1V16h5v-.1c0-.8.4-1.6 1.1-2.1A6 6 0 0 0 12 3z',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    problem: 'M12 3l9.5 17h-19zM12 10v4.5M12 17.5v.01', idea: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.1V16h5v-.1c0-.8.4-1.6 1.1-2.1A6 6 0 0 0 12 3z',
    benefit: 'M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6-4.5-4.2 6.1-.7z', spark: 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z',
    lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z',
    doc: 'M6 3h8l4 4v14H6zM14 3v4h4M9 12.5h6M9 16.5h6',
    truck: 'M3 6h11v9H3zM14 9h3.5l2.5 3v3h-6zM4.5 17.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M15.5 17.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0',
    team: 'M8.5 11a3 3 0 1 0 0-6a3 3 0 0 0 0 6M2.5 20v-1.4c0-2.2 2.7-3.6 6-3.6s6 1.4 6 3.6V20M16.5 5.6a3 3 0 0 1 0 5.3M18 15.4c1.9.5 3.5 1.6 3.5 3.2V20',
    flag: 'M5.5 3v18M5.5 4h12l-2.4 4 2.4 4h-12',
    clip: 'M9 3.5h6v3H9zM7 5h-2v16h14V5h-2M8.5 13l2.2 2.2L15.5 10',
    chat: 'M3.5 5h11v8H8l-4.5 3.5zM17 9h3.5v8.5L17 15.5h-5.5V13',
    refresh: 'M20 12a8 8 0 1 1-2.4-5.7M20 4v4.5h-4.5',
    mentor: 'M9 11.2a3.2 3.2 0 1 0 0-6.4a3.2 3.2 0 0 0 0 6.4M3 20v-1.2c0-2.4 2.7-3.8 6-3.8s6 1.4 6 3.8V20M18.2 3l1 2.3 2.3 1-2.3 1-1 2.3-1-2.3-2.3-1 2.3-1z',
    target: 'M12 3v3M12 18v3M3 12h3M18 12h3M12 7.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 0 0 0-9M12 10.8a1.2 1.2 0 1 0 0 2.4a1.2 1.2 0 0 0 0-2.4',
    search: 'M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 0 0 0-13M15.2 15.2L20.5 20.5',
    case: 'M3.5 7.5h17v12h-17zM9 7.5V5.2a1.7 1.7 0 0 1 1.7-1.7h2.6A1.7 1.7 0 0 1 15 5.2v2.3M3.5 12.5h17M11 12.5v2h2v-2'
  };
  function Ico(p) { return h('svg', { width: p.size || 20, height: p.size || 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: p.w || 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, className: p.className }, h('path', { d: ICO[p.name] || ICO.other })); }

  /* ======================= 1. PROPERTY REGISTER (mol-mulk hisobi) ======================= */
  var ASSET_TYPES = ['laptop', 'phone', 'sim', 'monitor', 'scanner', 'token', 'pass', 'uniform', 'keys', 'furniture', 'other'];
  var ASSET_SERIAL = { laptop: 1, phone: 1, sim: 1, monitor: 1, scanner: 1, token: 1, pass: 1 };
  var ASSET_CONDS = ['new', 'good', 'used', 'damaged'];
  var ASSET_QUICK = ['laptop', 'phone', 'sim', 'pass', 'uniform', 'scanner', 'other'];
  var ASSET_BADGE = { issued: 'probation', declared: 'in-progress', mismatch: 'question', active: 'passed', issue: 'failed', returned: 'todo' };
  function assetsOf(db, uid) { return (db.assets || []).filter(function (a) { return a.uid === uid; }); }
  function assetAttn(a) { return a.status === 'declared' || a.status === 'mismatch' || a.status === 'issue'; }
  function blankAsset(type) { return { key: rid(), type: type || 'laptop', name: '', serial: '', qty: 1, cond: 'good', date: dayKey(Date.now()), note: '' }; }
  function assetErrors(r, t) {
    var e = {};
    if (!String(r.name || '').trim()) e.name = t('fill_required');
    if (ASSET_SERIAL[r.type] && !String(r.serial || '').trim()) e.serial = t('fill_required');
    if (!(+r.qty >= 1)) e.qty = t('as_qty_err');
    if (!r.date) e.date = t('fill_required');
    else if (r.date > dayKey(Date.now())) e.date = t('as_date_future');
    return e;
  }
  function assetNotify(d, uid, k, name) { d.notifications.unshift({ id: nextId(d), userId: uid, kind: 'asset', asset: { k: k, name: name }, text: '', route: 'assets', at: Date.now(), read: false }); }
  function AssetStatus(p) {
    var a = p.a, t = p.t, key = a.status === 'issue' ? 'as_st_issue_' + ((a.issue || {}).kind || 'damaged') : (a.status === 'issued' && p.admin ? 'as_st_issued_admin' : 'as_st_' + a.status);
    return h(Badge, { status: ASSET_BADGE[a.status] || 'todo', lang: p.lang }, t(key));
  }
  function AssetMeta(p) { var a = p.a, t = p.t; return [t('at_' + a.type), a.serial, a.qty > 1 ? a.qty + ' ' + t('pcs') : '', t('ac_' + a.cond), t('as_since') + ' ' + fmtDay(a.date)].filter(Boolean).join(' · '); }

  function AssetFields(p) {
    var t = p.t, r = p.row, e = p.errors || {}, k = p.idk;
    function set(f, v) { var o = Object.assign({}, r); o[f] = v; p.onChange(o); }
    return h('div', { className: 'asset-row' },
      h('div', { className: 'asset-row-h' }, h('span', { className: 'as-ico' }, h(Ico, { name: r.type, size: 18 })), h('b', null, t('at_' + r.type)),
        p.onRemove ? h('button', { type: 'button', className: 'app-link danger', onClick: p.onRemove }, t('remove')) : null),
      h('div', { className: 'asset-grid' },
        h(Field, { name: k + '-type', label: t('as_type'), value: r.type, options: ASSET_TYPES.map(function (x) { return [x, t('at_' + x)]; }), onChange: function (v) { set('type', v); } }),
        h(Field, { name: k + '-name', className: 'f-wide', label: t('as_name'), required: true, value: r.name, error: e.name, placeholder: t('as_ph_' + r.type), onChange: function (v) { set('name', v); } }),
        h(Field, { name: k + '-serial', label: t(r.type === 'sim' ? 'as_serial_sim' : 'as_serial'), required: !!ASSET_SERIAL[r.type], value: r.serial, error: e.serial, placeholder: r.type === 'sim' ? '+998 __ ___ __ __' : r.type === 'pass' ? 'P-0000' : 'BQ-…', onChange: function (v) { set('serial', v); } }),
        h(Field, { name: k + '-qty', type: 'number', label: t('as_qty'), required: true, value: r.qty, error: e.qty, onChange: function (v) { set('qty', v); } }),
        h(Field, { name: k + '-cond', label: t('as_cond'), value: r.cond, options: ASSET_CONDS.map(function (c) { return [c, t('ac_' + c)]; }), onChange: function (v) { set('cond', v); } }),
        h(Field, { name: k + '-date', type: 'date', label: t('as_date'), required: true, value: r.date, error: e.date, onChange: function (v) { set('date', v); } }),
        h(Field, { name: k + '-note', label: t('as_note'), value: r.note, placeholder: t('as_note_ph'), onChange: function (v) { set('note', v); } })),
      ASSET_SERIAL[r.type] ? h('span', { className: 'lor-field-hint' }, t(r.type === 'sim' ? 'as_serial_hint_sim' : 'as_serial_hint')) : null);
  }

  /* anketa · step 4 */
  function assetsStepErrors(db, u, A, t) {
    var e = {};
    assetsOf(db, u.id).filter(function (a) { return a.status === 'issued'; }).forEach(function (a) {
      var x = A.hr[a.id];
      if (!x || !x.v) e['hr-' + a.id] = t('as_hr_required');
      else if (x.v === 'mismatch' && !String(x.note || '').trim()) e['hrn-' + a.id] = t('fill_required');
    });
    A.rows.forEach(function (r) { var re = assetErrors(r, t); if (Object.keys(re).length) e['row-' + r.key] = re; });
    if (!assetsOf(db, u.id).some(function (a) { return a.status === 'issued'; }) && !A.rows.length && !A.none) e.none = t('as_none_required');
    if (!A.ack) e.ack = t('as_ack_required');
    return e;
  }
  function saveAssetsStep(d, uid, A) {
    var now = Date.now();
    d.assets = d.assets || [];
    d.assets.forEach(function (a) {
      var x = a.uid === uid && a.status === 'issued' ? A.hr[a.id] : null; if (!x) return;
      if (x.v === 'ok') { a.status = 'active'; a.confirmedAt = now; } else { a.status = 'mismatch'; a.mismatch = String(x.note || '').trim(); }
    });
    A.rows.forEach(function (r) { d.assets.push({ id: 'a' + nextId(d), uid: uid, type: r.type, name: r.name.trim(), serial: String(r.serial || '').trim(), qty: Math.max(1, +r.qty || 1), cond: r.cond, date: r.date, note: String(r.note || '').trim(), status: 'declared', src: 'self', at: now }); });
    patchUser(d, uid, function (x) { x.assetsDeclaredAt = now; x.assetsAck = now; x.assetsNone = !!A.none && !A.rows.length && !assetsOf(d, uid).length; });
  }
  function AssetsStep(p) {
    var t = p.t, db = p.db, u = p.user, A = p.value, errs = p.errors || {};
    var hr = assetsOf(db, u.id).filter(function (a) { return a.status === 'issued'; });
    function upd(fn) { var c = clone(A); fn(c); p.onChange(c); }
    return h('div', { className: 'assets-step' },
      h('div', { className: 'as-intro' }, h('span', { className: 'as-intro-ico' }, h(Ico, { name: 'other', size: 26 })),
        h('div', null, h('b', null, t('as_step_title')), h('p', null, t('as_step_intro')))),
      hr.length ? h('section', { className: 'as-block' },
        h('div', { className: 'as-block-h' }, h('span', { className: 'lor-eyebrow' }, t('as_hr_title') + ' · ' + hr.length), h('span', { className: 'lor-sm lor-muted' }, t('as_hr_hint'))),
        hr.map(function (a) {
          var ans = A.hr[a.id] || {};
          return h('div', { key: a.id, className: cx('as-hr', ans.v && 'is-' + ans.v, errs['hr-' + a.id] && 'is-error') },
            h('div', { className: 'as-hr-main' }, h('span', { className: 'as-ico' }, h(Ico, { name: a.type, size: 20 })),
              h('div', { className: 'as-hr-t' }, h('b', null, a.name), h('span', { className: 'lor-sm lor-muted' }, h(AssetMeta, { a: a, t: t })))),
            h('div', { className: 'as-hr-act', role: 'radiogroup', 'aria-label': a.name },
              h('button', { type: 'button', role: 'radio', 'aria-checked': ans.v === 'ok', className: cx('as-pill', ans.v === 'ok' && 'on-ok'), onClick: function () { upd(function (c) { c.hr[a.id] = { v: 'ok' }; }); } }, '✓ ' + t('as_hr_ok')),
              h('button', { type: 'button', role: 'radio', 'aria-checked': ans.v === 'mismatch', className: cx('as-pill', ans.v === 'mismatch' && 'on-bad'), onClick: function () { upd(function (c) { c.hr[a.id] = { v: 'mismatch', note: (c.hr[a.id] || {}).note || '' }; }); } }, t('as_hr_diff'))),
            ans.v === 'mismatch' ? h(Field, { name: 'hrn-' + a.id, span: true, label: t('as_hr_note'), required: true, multiline: true, rows: 2, value: ans.note, error: errs['hrn-' + a.id], placeholder: t('as_hr_note_ph'), onChange: function (v) { upd(function (c) { c.hr[a.id].note = v; }); } }) : null,
            errs['hr-' + a.id] ? h('span', { className: 'lor-field-error' }, errs['hr-' + a.id]) : null);
        })) : null,
      h('section', { className: 'as-block' },
        h('div', { className: 'as-block-h' }, h('span', { className: 'lor-eyebrow' }, t(hr.length ? 'as_self_title_more' : 'as_self_title')), h('span', { className: 'lor-sm lor-muted' }, t('as_self_hint'))),
        A.rows.map(function (r, i) { return h(AssetFields, { key: r.key, t: t, idk: 'r' + r.key, row: r, errors: errs['row-' + r.key], onChange: function (v) { upd(function (c) { c.rows[i] = v; }); }, onRemove: function () { upd(function (c) { c.rows.splice(i, 1); }); } }); }),
        h('div', { className: 'as-quick' }, h('span', { className: 'lor-sm lor-muted' }, '+ ' + t('as_add') + ':'),
          ASSET_QUICK.map(function (x) { return h('button', { key: x, type: 'button', className: 'as-chip', onClick: function () { upd(function (c) { c.rows.push(blankAsset(x)); c.none = false; }); } }, h(Ico, { name: x, size: 16 }), t('at_' + x)); })),
        !hr.length ? h('label', { className: 'check big' }, h('input', { type: 'checkbox', id: 'as-none', checked: !!A.none, disabled: A.rows.length > 0, onChange: function (e) { var v = e.target.checked; upd(function (c) { c.none = v; }); } }), t('as_none')) : null,
        errs.none ? h('span', { className: 'lor-field-error' }, errs.none) : null),
      h('label', { className: cx('check big as-ack', errs.ack && 'is-error') }, h('input', { type: 'checkbox', id: 'as-ack', checked: !!A.ack, onChange: function (e) { var v = e.target.checked; upd(function (c) { c.ack = v; }); } }),
        h('span', null, h('b', null, t('as_ack_t') + ' '), t('as_ack'))),
      errs.ack ? h('span', { className: 'lor-field-error' }, errs.ack) : null);
  }

  /* employee · “My property” */
  function AssetCard(p) {
    var a = p.a, t = p.t;
    return h('article', { className: cx('as-card', 'st-' + a.status) },
      h('div', { className: 'as-card-h' }, h('span', { className: 'as-ico' }, h(Ico, { name: a.type, size: 20 })),
        h('div', { className: 'as-card-t' }, h('b', null, a.name), h('span', { className: 'lor-sm lor-muted' }, t('at_' + a.type)),
          h('span', { className: 'as-card-st' }, h(AssetStatus, { a: a, t: t, lang: p.lang, admin: p.admin })))),
      h('dl', { className: 'as-dl' }, [[t('as_serial_short'), a.serial || '—'], [t('as_qty'), a.qty], [t('as_cond'), t('ac_' + a.cond)], [t('as_date'), fmtDay(a.date)]].map(function (x) { return h('div', { key: x[0] }, h('dt', null, x[0]), h('dd', null, x[1])); })),
      a.note ? h('p', { className: 'lor-sm lor-muted as-note' }, a.note) : null,
      a.status === 'issue' && a.issue ? h('p', { className: 'as-alert' }, h('b', null, t('as_st_issue_' + a.issue.kind) + ': '), a.issue.text) : null,
      a.status === 'mismatch' && a.mismatch ? h('p', { className: 'as-alert' }, h('b', null, t('as_st_mismatch') + ': '), a.mismatch) : null,
      a.status === 'returned' && a.returnedAt ? h('p', { className: 'lor-sm lor-muted as-note' }, t('as_returned_on') + ' ' + fmtDate(a.returnedAt)) : null,
      p.children);
  }
  function MyAssets(p) {
    var t = p.t, db = p.db, u = p.user, list = assetsOf(db, u.id);
    var add = useState(null), er = useState({}), rep = useState(null), mis = useState(null);
    var pending = list.filter(function (a) { return a.status === 'issued'; });
    var cur = list.filter(function (a) { return a.status !== 'returned' && a.status !== 'issued'; });
    var gone = list.filter(function (a) { return a.status === 'returned'; });
    function setStatus(id, fn) { p.update(function (d) { d.assets.forEach(function (x) { if (x.id === id) { fn(x); x.updAt = Date.now(); } }); }); }
    function saveNew() {
      var r = add[0], e = assetErrors(r, t); er[1](e); if (Object.keys(e).length) return;
      p.update(function (d) { d.assets = d.assets || []; d.assets.push({ id: 'a' + nextId(d), uid: u.id, type: r.type, name: r.name.trim(), serial: String(r.serial || '').trim(), qty: Math.max(1, +r.qty || 1), cond: r.cond, date: r.date, note: String(r.note || '').trim(), status: 'declared', src: 'self', at: Date.now() }); });
      add[1](null); p.say(t('as_sent_hr'));
    }
    function sendReport() {
      var r = rep[0]; if (!r.text.trim()) { er[1]({ rep: t('fill_required') }); return; }
      setStatus(r.id, function (x) { x.status = 'issue'; x.issue = { kind: r.kind, text: r.text.trim(), at: Date.now() }; });
      rep[1](null); er[1]({}); p.say(t('as_reported'));
    }
    function sendMismatch() {
      var r = mis[0]; if (!r.text.trim()) { er[1]({ mis: t('fill_required') }); return; }
      setStatus(r.id, function (x) { x.status = 'mismatch'; x.mismatch = r.text.trim(); });
      mis[1](null); er[1]({}); p.say(t('as_sent_hr'));
    }
    return h('div', { className: 'app-wrap' },
      h('div', { className: 'page-head' },
        h('div', null, h('span', { className: 'lor-eyebrow' }, t('as_eyebrow')), h('h1', { className: 'lor-title' }, t('as_my_title'), h(PageTip, { t: t, id: 'assets' }))),
        add[0] ? null : h(Btn, { variant: 'primary', arrow: true, onClick: function () { add[1](blankAsset('laptop')); er[1]({}); } }, t('as_add_new'))),
      h('p', { className: 'lor-muted', style: { margin: 0, maxWidth: 820 } }, t('as_my_intro')),
      u.assetsDeclaredAt ? h('div', { className: 'as-decl' }, h('span', { className: 'made' }, '✓ ' + t('as_declared_on') + ' ' + fmtDate(u.assetsDeclaredAt)), h('span', { className: 'lor-sm lor-muted' }, t('as_ack_short'))) : null,
      pending.length ? h('section', { className: 'box as-pending' },
        h('div', { className: 'as-block-h' }, h('span', { className: 'lor-eyebrow' }, t('as_hr_title') + ' · ' + pending.length), h('span', { className: 'lor-sm lor-muted' }, t('as_hr_hint'))),
        pending.map(function (a) {
          var open = mis[0] && mis[0].id === a.id;
          return h(AssetCard, { key: a.id, a: a, t: t, lang: p.lang },
            open ? h('div', { className: 'as-inline' },
              h(Field, { name: 'mis-' + a.id, label: t('as_hr_note'), required: true, multiline: true, rows: 2, value: mis[0].text, error: er[0].mis, placeholder: t('as_hr_note_ph'), onChange: function (v) { mis[1](Object.assign({}, mis[0], { text: v })); } }),
              h('div', { className: 'as-act' }, h(Btn, { variant: 'ghost', size: 'sm', onClick: function () { mis[1](null); } }, t('cancel')), h(Btn, { variant: 'primary', size: 'sm', onClick: sendMismatch }, t('send'))))
              : h('div', { className: 'as-act' },
                h(Btn, { variant: 'outline', size: 'sm', onClick: function () { mis[1]({ id: a.id, text: '' }); er[1]({}); } }, t('as_hr_diff')),
                h(Btn, { variant: 'primary', size: 'sm', onClick: function () { setStatus(a.id, function (x) { x.status = 'active'; x.confirmedAt = Date.now(); }); p.say(t('as_confirmed')); } }, '✓ ' + t('as_hr_ok'))));
        })) : null,
      add[0] ? h('section', { className: 'box' },
        h('h2', { className: 'lor-h', style: { margin: 0 } }, t('as_add_new')),
        h(AssetFields, { t: t, idk: 'new', row: add[0], errors: er[0], onChange: function (v) { add[1](v); } }),
        h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('as_add_note')),
        h('div', { className: 'as-act' }, h(Btn, { variant: 'ghost', onClick: function () { add[1](null); er[1]({}); } }, t('cancel')), h(Btn, { variant: 'primary', arrow: true, onClick: saveNew }, t('as_send_hr')))) : null,
      cur.length ? h('div', { className: 'as-cards' }, cur.map(function (a) {
        var open = rep[0] && rep[0].id === a.id;
        return h(AssetCard, { key: a.id, a: a, t: t, lang: p.lang },
          a.status === 'active' ? (open ? h('div', { className: 'as-inline' },
            h('div', { className: 'seg', role: 'radiogroup', 'aria-label': t('as_report') }, ['damaged', 'lost', 'broken'].map(function (k) { return h('button', { key: k, type: 'button', role: 'radio', 'aria-checked': rep[0].kind === k, className: rep[0].kind === k ? 'is-on' : '', onClick: function () { rep[1](Object.assign({}, rep[0], { kind: k })); } }, t('as_st_issue_' + k)); })),
            h(Field, { name: 'rep-' + a.id, label: t('as_report_text'), required: true, multiline: true, rows: 2, value: rep[0].text, error: er[0].rep, placeholder: t('as_report_ph'), onChange: function (v) { rep[1](Object.assign({}, rep[0], { text: v })); } }),
            h('div', { className: 'as-act' }, h(Btn, { variant: 'ghost', size: 'sm', onClick: function () { rep[1](null); } }, t('cancel')), h(Btn, { variant: 'primary', size: 'sm', onClick: sendReport }, t('send'))))
            : h('div', { className: 'as-act' }, h('button', { type: 'button', className: 'app-link', onClick: function () { rep[1]({ id: a.id, kind: 'damaged', text: '' }); er[1]({}); } }, t('as_report')))) : null);
      })) : (!pending.length && !add[0] ? h('section', { className: 'box' }, h('p', { className: 'lor-muted', style: { margin: 0 } }, u.assetsNone ? t('as_none_state') : t('as_empty'))) : null),
      gone.length ? h('details', { className: 'box as-gone' }, h('summary', null, t('as_returned') + ' · ' + gone.length), h('div', { className: 'as-cards' }, gone.map(function (a) { return h(AssetCard, { key: a.id, a: a, t: t, lang: p.lang }); }))) : null);
  }

  /* admin · property register */
  function AssetsAdmin(p) {
    var t = p.t, db = p.db, emps = employees(db), all = db.assets || [];
    var f = useState(p.uid ? 'all' : 'attn'), fu = useState(p.uid ? String(p.uid) : ''), ft = useState('');
    var asg = useState(null), er = useState({}), ed = useState(null);
    useEffect(function () { if (p.uid) { fu[1](String(p.uid)); f[1]('all'); } }, [p.uid]);
    var SEG = [['attn', t('as_f_attn')], ['issued', t('as_f_issued')], ['active', t('as_f_active')], ['returned', t('as_f_returned')], ['all', t('all')]];
    function inSeg(a, s) { return s === 'all' ? true : s === 'attn' ? assetAttn(a) : a.status === s; }
    var rows = all.filter(function (a) { return inSeg(a, f[0]) && (!fu[0] || String(a.uid) === fu[0]) && (!ft[0] || a.type === ft[0]); })
      .sort(function (a, b) { return (assetAttn(b) - assetAttn(a)) || ((b.issue || {}).at || b.at || 0) - ((a.issue || {}).at || a.at || 0); });
    var declared = emps.filter(function (u) { return u.assetsDeclaredAt; }).length;
    function act(a, fn, k) {
      p.update(function (d) { d.assets.forEach(function (x) { if (x.id === a.id) { fn(x); x.updAt = Date.now(); } }); if (k) assetNotify(d, a.uid, k, a.name); });
    }
    function remove(a, k) { p.update(function (d) { d.assets = d.assets.filter(function (x) { return x.id !== a.id; }); if (k) assetNotify(d, a.uid, k, a.name); }); }
    function assign() {
      var r = asg[0], e = assetErrors(r, t); if (!r.uid) e.uid = t('fill_required'); er[1](e); if (Object.keys(e).length) return;
      p.update(function (d) { d.assets = d.assets || []; d.assets.push({ id: 'a' + nextId(d), uid: +r.uid, type: r.type, name: r.name.trim(), serial: String(r.serial || '').trim(), qty: Math.max(1, +r.qty || 1), cond: r.cond, date: r.date, note: String(r.note || '').trim(), status: 'issued', src: 'hr', at: Date.now() }); assetNotify(d, +r.uid, 'assigned', r.name.trim()); });
      asg[1](null); p.say(t('as_assigned'));
    }
    function saveEdit() {
      var r = ed[0], e = assetErrors(r, t); er[1](e); if (Object.keys(e).length) return;
      act({ id: r.id, uid: r.uid, name: r.name }, function (x) { x.type = r.type; x.name = r.name.trim(); x.serial = String(r.serial || '').trim(); x.qty = Math.max(1, +r.qty || 1); x.cond = r.cond; x.date = r.date; x.note = String(r.note || '').trim(); x.status = 'active'; x.mismatch = null; x.confirmedAt = Date.now(); }, 'fixed');
      ed[1](null); p.say(t('as_fixed'));
    }
    function actions(a) {
      if (a.status === 'declared') return [h(Btn, { key: 'ok', variant: 'secondary', size: 'sm', onClick: function () { act(a, function (x) { x.status = 'active'; x.confirmedAt = Date.now(); }, 'confirmed'); p.say(t('as_verified')); } }, t('as_verify')), h(Btn, { key: 'no', variant: 'ghost', size: 'sm', onClick: function () { remove(a, 'removed'); } }, t('as_reject'))];
      if (a.status === 'mismatch') return [h(Btn, { key: 'fix', variant: 'secondary', size: 'sm', onClick: function () { ed[1](Object.assign({ key: a.id }, clone(a))); er[1]({}); } }, t('as_fix')), h(Btn, { key: 'rm', variant: 'ghost', size: 'sm', onClick: function () { remove(a, 'removed'); } }, t('as_writeoff'))];
      if (a.status === 'issue') return [h(Btn, { key: 'res', variant: 'secondary', size: 'sm', onClick: function () { act(a, function (x) { x.status = 'active'; x.resolved = x.issue; x.issue = null; }, 'resolved'); } }, t('as_resolved')), h(Btn, { key: 'ret', variant: 'ghost', size: 'sm', onClick: function () { act(a, function (x) { x.status = 'returned'; x.returnedAt = Date.now(); }, 'returned'); } }, t('as_mark_returned'))];
      if (a.status === 'active') return [h(Btn, { key: 'ret', variant: 'ghost', size: 'sm', onClick: function () { act(a, function (x) { x.status = 'returned'; x.returnedAt = Date.now(); }, 'returned'); } }, t('as_mark_returned'))];
      if (a.status === 'issued') return [h(Btn, { key: 'cn', variant: 'ghost', size: 'sm', onClick: function () { remove(a, null); } }, t('as_cancel_issue'))];
      return [h('span', { key: 'r', className: 'lor-sm lor-muted' }, a.returnedAt ? fmtDate(a.returnedAt) : '—')];
    }
    return h('div', { className: 'app-wrap' },
      h('div', { className: 'page-head' },
        h('div', null, h('span', { className: 'lor-eyebrow' }, t('as_eyebrow')), h('h1', { className: 'lor-title' }, t('as_admin_title'), h(PageTip, { t: t, id: 'aassets' }))),
        asg[0] ? null : h(Btn, { variant: 'primary', arrow: true, onClick: function () { asg[1](Object.assign(blankAsset('laptop'), { uid: fu[0] || '' })); er[1]({}); } }, t('as_assign'))),
      h('div', { className: 'tiles' },
        [[t('as_t_active'), all.filter(function (a) { return a.status === 'active'; }).length], [t('as_t_attn'), all.filter(assetAttn).length], [t('as_t_issued'), all.filter(function (a) { return a.status === 'issued'; }).length], [t('as_t_declared'), declared + ' / ' + emps.length]].map(function (x) { return h('div', { key: x[0], className: 'tile' }, h('span', { className: 'lor-eyebrow' }, x[0]), h('b', null, x[1])); })),
      asg[0] ? h('section', { className: 'box' },
        h('h2', { className: 'lor-h', style: { margin: 0 } }, t('as_assign')),
        h('div', { className: 'filters' }, h(Field, { name: 'asg-uid', label: t('th_emp'), required: true, value: asg[0].uid, error: er[0].uid, options: [['', '—']].concat(emps.map(function (u) { return [String(u.id), u.name]; })), onChange: function (v) { asg[1](Object.assign({}, asg[0], { uid: v })); } })),
        h(AssetFields, { t: t, idk: 'asg', row: asg[0], errors: er[0], onChange: function (v) { asg[1](Object.assign({}, v, { uid: asg[0].uid })); } }),
        h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('as_assign_note')),
        h('div', { className: 'as-act' }, h(Btn, { variant: 'ghost', onClick: function () { asg[1](null); er[1]({}); } }, t('cancel')), h(Btn, { variant: 'primary', arrow: true, onClick: assign }, t('as_assign_btn')))) : null,
      ed[0] ? h('section', { className: 'box' },
        h('h2', { className: 'lor-h', style: { margin: 0 } }, t('as_fix') + ' · ' + userOf(db, ed[0].uid).name),
        ed[0].mismatch ? h('p', { className: 'as-alert' }, h('b', null, t('as_emp_says') + ': '), ed[0].mismatch) : null,
        h(AssetFields, { t: t, idk: 'ed', row: ed[0], errors: er[0], onChange: function (v) { ed[1](Object.assign({}, ed[0], v)); } }),
        h('div', { className: 'as-act' }, h(Btn, { variant: 'ghost', onClick: function () { ed[1](null); } }, t('cancel')), h(Btn, { variant: 'primary', arrow: true, onClick: saveEdit }, t('as_save_confirm')))) : null,
      h('div', { className: 'seg', role: 'tablist' }, SEG.map(function (x) {
        var n = all.filter(function (a) { return inSeg(a, x[0]) && (!fu[0] || String(a.uid) === fu[0]); }).length;
        return h('button', { key: x[0], type: 'button', role: 'tab', 'aria-selected': f[0] === x[0], className: f[0] === x[0] ? 'is-on' : '', onClick: function () { f[1](x[0]); } }, x[1] + ' · ' + n);
      })),
      h('div', { className: 'filters' },
        h(Field, { name: 'as-fu', label: t('th_emp'), value: fu[0], options: [['', t('all')]].concat(emps.map(function (u) { return [String(u.id), u.name]; })), onChange: fu[1] }),
        h(Field, { name: 'as-ft', label: t('as_type'), value: ft[0], options: [['', t('all')]].concat(ASSET_TYPES.map(function (x) { return [x, t('at_' + x)]; })), onChange: ft[1] })),
      h('div', { className: 'lor-table-wrap' }, h('table', { className: 'lor-table as-table' },
        h('thead', null, h('tr', null, [t('th_emp'), t('as_item'), t('as_serial_short'), t('as_qty'), t('as_cond'), t('as_date'), t('th_status'), ''].map(function (x, i) { return h('th', { key: i }, x); }))),
        h('tbody', null, rows.length ? rows.map(function (a) {
          var u = userOf(db, a.uid);
          return h('tr', { key: a.id, className: cx(assetAttn(a) && 'is-attn') },
            h('td', null, h('div', { className: 'lor-emp' }, h(Av, { name: u.name, src: u.avatar, size: 32 }), h('span', null, u.name, h('small', null, u.position)))),
            h('td', null, h('div', { className: 'as-cell' }, h('span', { className: 'as-ico' }, h(Ico, { name: a.type, size: 18 })), h('span', null, h('b', null, a.name), h('small', null, t('at_' + a.type) + (a.src === 'self' ? ' · ' + t('as_src_self') : ' · ' + t('as_src_hr'))))),
              a.status === 'issue' && a.issue ? h('p', { className: 'as-alert sm' }, h('b', null, t('as_st_issue_' + a.issue.kind) + ' · ' + fmt(a.issue.at, t) + ': '), a.issue.text) : null,
              a.status === 'mismatch' && a.mismatch ? h('p', { className: 'as-alert sm' }, h('b', null, t('as_emp_says') + ': '), a.mismatch) : null,
              a.status === 'declared' && a.note ? h('p', { className: 'lor-sm lor-muted', style: { margin: '6px 0 0' } }, a.note) : null),
            h('td', null, a.serial ? h('code', null, a.serial) : '—'),
            h('td', { className: 'num' }, a.qty),
            h('td', null, t('ac_' + a.cond)),
            h('td', { className: 'num' }, fmtDay(a.date)),
            h('td', null, h(AssetStatus, { a: a, t: t, lang: p.lang, admin: true })),
            h('td', null, h('div', { className: 'as-row-act' }, actions(a))));
        }) : h('tr', null, h('td', { colSpan: 8, className: 'lor-muted' }, t('as_none_rows')))))),
      h('section', { className: 'box' },
        h('span', { className: 'lor-eyebrow' }, t('as_decl_title')),
        h('ul', { className: 'as-decl-list' }, emps.map(function (u) {
          var mine = assetsOf(db, u.id), live = mine.filter(function (a) { return a.status !== 'returned'; }).length, attn = mine.filter(assetAttn).length;
          return h('li', { key: u.id }, h('button', { type: 'button', className: 'as-decl-btn', onClick: function () { fu[1](String(u.id)); f[1]('all'); } },
            h(Av, { name: u.name, src: u.avatar, size: 28 }), h('span', { className: 'as-decl-n' }, u.name, h('small', null, u.assetsDeclaredAt ? '✓ ' + fmtDate(u.assetsDeclaredAt) + (u.assetsNone ? ' · ' + t('as_none_short') : '') : '○ ' + t('not_filled'))),
            h('span', { className: 'as-decl-c' }, live + ' ' + t('pcs'), attn ? h('span', { className: 'app-navcount' }, attn) : null)));
        }))));
  }

  /* ======================= 2. PULSE SURVEY (AI) ======================= */
  var PULSE_TOPICS = ['env', 'manager', 'workload', 'conditions', 'training', 'process', 'growth', 'motivation'];
  var PULSE_BANK = {
    uz: { env: 'Jamoadagi muhitdan qanchalik mamnunsiz — hamkasblar bilan ishlash qulaymi?', manager: 'Rahbaringiz yoki mentoringizdan kerakli yordamni o‘z vaqtida olyapsizmi?', workload: 'Ish hajmini ish vaqtida bemalol uddalayapsizmi?', conditions: 'Ish joyingiz sharoiti va jihozlar (kompyuter, skaner, maxsus kiyim) sizni qoniqtiradimi?', training: 'O‘quv platformasi darslari va adaptatsiya ishingizda haqiqatan yordam beryaptimi?', process: 'Ish jarayonlari va kim nimaga javob berishi sizga qanchalik aniq?', growth: 'BURAQ’da o‘sish va yangi darajaga chiqish imkoniyatini ko‘ryapsizmi?', motivation: 'Mehnatingiz qadrlanayotganini his qilyapsizmi?' },
    ru: { env: 'Насколько вам комфортно в команде — легко ли работать с коллегами?', manager: 'Получаете ли вы вовремя нужную помощь от руководителя или наставника?', workload: 'Успеваете ли вы справляться с объёмом работы в рабочее время?', conditions: 'Устраивают ли вас условия на рабочем месте и оборудование (компьютер, сканер, спецодежда)?', training: 'Помогают ли уроки платформы и адаптация в реальной работе?', process: 'Насколько вам понятны рабочие процессы и кто за что отвечает?', growth: 'Видите ли вы в BURAQ возможность роста и перехода на новый уровень?', motivation: 'Чувствуете ли вы, что ваш труд ценят?' },
    en: { env: 'How comfortable is the team atmosphere — is it easy to work with colleagues?', manager: 'Do you get the help you need from your manager or mentor on time?', workload: 'Can you comfortably handle your workload within working hours?', conditions: 'Are you satisfied with your workplace conditions and equipment (computer, scanner, workwear)?', training: 'Do the platform lessons and onboarding actually help in your daily work?', process: 'How clear are the work processes and who is responsible for what?', growth: 'Do you see a way to grow and reach the next level at BURAQ?', motivation: 'Do you feel your work is appreciated?' }
  };
  var TOPIC_DESC = { env: 'jamoadagi muhit, hamkasblar bilan munosabat', manager: 'rahbar va mentordan yordam, qo‘llab-quvvatlash', workload: 'ish yuklamasi, vaqt yetishi', conditions: 'ish joyi sharoiti, jihozlar, ombor/ofis sharoiti', training: 'o‘qitish, platforma darslari, adaptatsiya', process: 'jarayonlar va mas’uliyat aniqligi', growth: 'o‘sish va martaba imkoniyati', motivation: 'motivatsiya, e’tirof, mehnat qadrlanishi' };
  function pulseCfg(db) { return Object.assign({ on: true, every: 3, round: 0 }, (db.settings || {}).survey || {}); }
  function pulseDue(db, u) {
    var c = pulseCfg(db), pu = u.pulse || {}; if (!c.on || u.role !== 'employee') return false;
    if (pu.snooze === dayKey(Date.now())) return false;
    if (c.round && (pu.last || 0) < c.round) return true;
    return Date.now() - (pu.last || u.startedAt || Date.now()) >= c.every * DAY;
  }
  function pulseCycle(db, u) { var c = pulseCfg(db), pu = u.pulse || {}; return c.round && (pu.last || 0) < c.round ? 'r' + c.round : 'd' + (pu.last || u.startedAt || 0); }
  function pickTopics(u) { var hs = (u.pulse || {}).topics || {}; return PULSE_TOPICS.slice().sort(function (a, b) { return (hs[a] || 0) - (hs[b] || 0) || PULSE_TOPICS.indexOf(a) - PULSE_TOPICS.indexOf(b); }).slice(0, 3); }
  function bankQs(topics, lang) { var b = PULSE_BANK[lang] || PULSE_BANK.uz; return topics.map(function (k) { return { topic: k, type: 'scale', q: b[k] }; }); }
  function cleanQs(r, topics, lang) {
    var out = [], seen = {};
    (Array.isArray(r) ? r : (r && Array.isArray(r.questions) ? r.questions : [])).forEach(function (x) {
      if (!x || typeof x.q !== 'string' || topics.indexOf(x.topic) < 0 || seen[x.topic]) return;
      var q = x.q.trim(); if (q.length < 8 || q.length > 240) return;
      if (x.type === 'choice') {
        var o = Array.isArray(x.options) ? x.options.filter(function (s) { return typeof s === 'string' && s.trim(); }).map(function (s) { return s.trim().slice(0, 80); }).slice(0, 5) : [];
        if (o.length < 2) return; out.push({ topic: x.topic, type: 'choice', q: q, options: o });
      } else out.push({ topic: x.topic, type: 'scale', q: q });
      seen[x.topic] = 1;
    });
    if (!out.length) return null;
    var bank = bankQs(topics, lang);
    return topics.map(function (k, i) { return out.filter(function (x) { return x.topic === k; })[0] || bank[i]; });
  }
  function pulsePrompt(u, topics, lang) {
    var low = ((u.pulse || {}).low || []).filter(function (k) { return topics.indexOf(k) >= 0; });
    return 'Siz BURAQ Logistics kompaniyasida HR uchun ichki “pulse” so‘rovnomasini o‘tkazuvchi AI yordamchisiz. Maqsad — xodim kompaniya, jamoa va ish sharoitlaridan qanchalik mamnunligini hamda takliflarini bilish.\n' +
      'Xodim: lavozimi — ' + u.position + ', bo‘limi — ' + u.department + ', kompaniyada ' + daysSince(u) + ' kun, status — ' + (u.status === 'official' ? 'rasmiy xodim' : 'sinov muddatida') + '.\n' +
      (low.length ? 'O‘tgan safar past baholangan mavzular: ' + low.join(', ') + ' — bu mavzularda vaziyat o‘zgarganmi, shuni aniqlashtiring.\n' : '') +
      'Quyidagi mavzularning har biri bo‘yicha aynan bitta, jami ' + topics.length + ' ta savol tuzing:\n' + topics.map(function (k) { return '- ' + k + ': ' + TOPIC_DESC[k]; }).join('\n') + '\n' +
      'Talablar: savol qisqa (25 so‘zgacha), do‘stona va lavozimiga mos (masalan, omborchidan ombor sharoiti, deklarantdan hujjatlar haqida so‘rang). Sog‘liq, oila, din, siyosat va aniq ish haqi miqdori haqida so‘ramang. Savollar tili: ' + (LANG_NAME[lang] || LANG_NAME.uz) + '.\n' +
      'Turlar: "scale" — 1 dan 5 gacha baho (5 — eng yaxshi holat; savolni shunday tuzingki, yuqori baho yaxshi ma’noni bildirsin) yoki "choice" — bitta variant tanlash (3–4 ta qisqa variant). Kamida 2 ta savol "scale" bo‘lsin.\n' +
      'Faqat JSON massiv qaytaring, izohsiz: [{"topic":"' + topics[0] + '","type":"scale","q":"..."},{"topic":"' + (topics[1] || topics[0]) + '","type":"choice","q":"...","options":["...","...","..."]}]';
  }
  function Face(p) {
    var v = p.v, m = { 1: 'M8 16.8q4-3.6 8 0', 2: 'M8.6 16.2q3.4-1.8 6.8 0', 3: 'M8.6 15.6h6.8', 4: 'M8.6 14.4q3.4 2.4 6.8 0', 5: 'M8 13.8q4 4.6 8 0' }[v];
    return h('svg', { width: p.size || 36, height: p.size || 36, viewBox: '0 0 24 24', 'aria-hidden': true, className: 'face-ic f' + v },
      h('circle', { cx: 12, cy: 12, r: 10, className: 'fc' }), h('circle', { cx: 8.8, cy: 9.8, r: 1.15, className: 'fe' }), h('circle', { cx: 15.2, cy: 9.8, r: 1.15, className: 'fe' }), h('path', { d: m, className: 'fm' }));
  }
  function PulseBubble(p) {
    var t = p.t, c = pulseCfg(p.db);
    return h('section', { className: 'pulse-bubble', role: 'dialog', 'aria-labelledby': 'pb-t' },
      h('span', { className: 'pb-av', 'aria-hidden': true }, h(Ico, { name: 'spark', size: 18 })),
      h('div', { className: 'pb-body' },
        h('b', { id: 'pb-t' }, tpl(t('pulse_hi'), { name: firstName(p.user) })),
        h('p', null, tpl(t('pulse_invite'), { n: c.every })),
        h('div', { className: 'pb-act' }, h(Btn, { variant: 'primary', size: 'sm', onClick: p.onStart }, t('pulse_start')), h(Btn, { variant: 'ghost', size: 'sm', onClick: p.onLater }, t('pulse_later')))),
      h('button', { type: 'button', className: 'pb-x', 'aria-label': t('close'), onClick: p.onClose }, '×'));
  }
  function PulseCard(p) {
    var t = p.t;
    return h('section', { className: 'box pulse-card' },
      h('span', { className: 'pb-av big', 'aria-hidden': true }, h(Ico, { name: 'spark', size: 22 })),
      h('div', { className: 'pulse-card-b' }, h('span', { className: 'lor-eyebrow' }, t('pulse_eyebrow')), h('h2', { className: 'lor-h' }, t('pulse_card_t')), h('p', { className: 'lor-sm lor-muted' }, tpl(t('pulse_card_p'), { n: pulseCfg(p.db).every }))),
      h(Btn, { variant: 'primary', arrow: true, onClick: p.onStart }, t('pulse_start')));
  }

  function SurveyModal(p) {
    var t = p.t, db = p.db, u = p.user, lang = p.lang, sampler = p.sampler, cfg = pulseCfg(db);
    var topics = useRef(pickTopics(u)).current;
    var qs = useState(null), src = useState(''), st = useState(0), step = st[0];
    var mood = useState(0), ans = useState({}), txt = useState('');
    var fu = useState(null), fuA = useState(''), saved = useRef(null), started = useRef(false), ctl = useRef(null), boxRef = useRef(null);
    var total = 2 + topics.length;
    useEffect(function () {
      if (started.current || sampler === undefined) return;
      started.current = true;
      function fallback() { qs[1](function (x) { return x || bankQs(topics, lang); }); src[1](function (x) { return x || 'bank'; }); }
      if (!sampler || typeof sampler.json !== 'function') { fallback(); return; }
      var c = new AbortController(); ctl.current = c;
      var timer = setTimeout(function () { c.abort(); fallback(); }, 15000);
      sampler.json(pulsePrompt(u, topics, lang), { signal: c.signal, modelTier: 'quick' })
        .then(function (r) { var v = cleanQs(r, topics, lang); if (v) { qs[1](v); src[1]('ai'); } else fallback(); })
        .catch(fallback).then(function () { clearTimeout(timer); });
    }, [sampler]);
    useEffect(function () { return function () { if (ctl.current) ctl.current.abort(); }; }, []);
    useEffect(function () { function k(e) { if (e.key === 'Escape') p.onClose(); } window.addEventListener('keydown', k); return function () { window.removeEventListener('keydown', k); }; }, []);
    useEffect(function () { if (boxRef.current) { var el = boxRef.current.querySelector('.sv-focus'); if (el) el.focus({ preventScroll: true }); } }, [step, !!qs[0]]);
    function go(n) { st[1](n); }
    function pick(i, v) { var o = Object.assign({}, ans[0]); o[i] = v; ans[1](o); setTimeout(function () { st[1](function (s) { return s === i + 1 ? s + 1 : s; }); }, 260); }
    function submit() {
      var list = qs[0] || bankQs(topics, lang), now = Date.now();
      var resp = { at: now, uid: u.id, dept: u.department, mood: mood[0], lang: lang, ai: src[0] === 'ai',
        answers: list.map(function (q, i) { return { topic: q.topic, q: q.q, type: q.type, options: q.options, v: ans[0][i] != null ? ans[0][i] : null }; }), text: txt[0].trim(), follow: null };
      var low = resp.answers.filter(function (a) { return a.type === 'scale' && a.v != null && a.v <= 2; }).map(function (a) { return a.topic; });
      p.update(function (d) {
        d.surveys = d.surveys || []; resp.id = 'p' + nextId(d); d.surveys.unshift(resp);
        patchUser(d, u.id, function (x) { var pu = x.pulse = Object.assign({ n: 0, topics: {} }, x.pulse || {}); pu.topics = Object.assign({}, pu.topics); pu.n = (pu.n || 0) + 1; pu.last = now; pu.snooze = null; pu.low = low; pu.mood = resp.mood; pu.text = resp.text; topics.forEach(function (k) { pu.topics[k] = now; }); });
        d.notifications.forEach(function (n) { if (n.userId === u.id && n.kind === 'pulse') n.read = true; });
      });
      saved.current = resp;
      var needFollow = low.length || mood[0] <= 2 || resp.text;
      if (!needFollow) { go(total + 1); return; }
      var fixed = { reply: t('pulse_fu_reply'), q: t('pulse_fu_q') };
      if (!sampler || typeof sampler.json !== 'function') { if (low.length || mood[0] <= 2) { fu[1](fixed); go(total); } else go(total + 1); return; }
      fu[1]('loading'); go(total);
      var prompt = 'Siz BURAQ Logistics’dagi HR pulse-so‘rovnomasining AI yordamchisisiz. Xodim hozirgina so‘rovnomani to‘ldirdi.\nJAVOBLAR (JSON): ' +
        JSON.stringify({ mood_1_5: resp.mood, answers: resp.answers.map(function (a) { return { topic: a.topic, question: a.q, answer: a.v }; }), suggestion: resp.text }) +
        '\nVazifa: 1) "reply" — 1–2 gapda samimiy minnatdorchilik; fikrini tushunganingizni ko‘rsating, lekin va’da bermang va qaror qabul qilingan demang. 2) "q" — eng past baholangan mavzu yoki taklif bo‘yicha BITTA aniqlashtiruvchi savol (aynan nima xalaqit beradi yoki qanday yechimni ko‘radi). Hammasi yaxshi bo‘lsa, "q" bo‘sh qator bo‘lsin. Til: ' + (LANG_NAME[lang] || LANG_NAME.uz) + '.\nFaqat JSON: {"reply":"...","q":"..."}';
      var c = new AbortController(); ctl.current = c;
      sampler.json(prompt, { signal: c.signal, modelTier: 'quick' }).then(function (r) {
        if (r && typeof r.reply === 'string' && r.reply.trim()) fu[1]({ reply: r.reply.trim().slice(0, 400), q: typeof r.q === 'string' ? r.q.trim().slice(0, 240) : '' });
        else fu[1](low.length || mood[0] <= 2 ? fixed : { reply: t('pulse_thanks_p'), q: '' });
      }).catch(function () { fu[1](low.length || mood[0] <= 2 ? fixed : { reply: t('pulse_thanks_p'), q: '' }); });
    }
    function finishFollow() {
      var r = saved.current, f = fu[0];
      if (r && f && f.q && fuA[0].trim()) p.update(function (d) { (d.surveys || []).forEach(function (s) { if (s.id === r.id) s.follow = { q: f.q, a: fuA[0].trim() }; }); });
      go(total + 1);
    }
    var list = qs[0], MOOD = [1, 2, 3, 4, 5], body;
    if (step === 0) body = h('div', { className: 'sv-q' },
      h('h3', { className: 'sv-title', id: 'sv-h' }, t('pulse_mood_q')),
      h('div', { className: 'sv-moods', role: 'radiogroup', 'aria-labelledby': 'sv-h' }, MOOD.map(function (v, i) {
        return h('button', { key: v, type: 'button', role: 'radio', 'aria-checked': mood[0] === v, className: cx('sv-mood', mood[0] === v && 'is-on', i === 0 && 'sv-focus'), onClick: function () { mood[1](v); setTimeout(function () { st[1](function (s) { return s === 0 ? 1 : s; }); }, 260); } },
          h(Face, { v: v, size: 44 }), h('span', null, t('mood_' + v)));
      })));
    else if (step >= 1 && step <= topics.length) {
      var qi = step - 1, q = list && list[qi];
      body = !q ? h('div', { className: 'sv-q sv-loading', 'aria-live': 'polite' }, h('span', { className: 'sv-dots', 'aria-hidden': true }, h('i'), h('i'), h('i')), h('p', null, t('pulse_loading')))
        : h('div', { className: 'sv-q' },
          h('span', { className: 'lor-eyebrow' }, t('pt_' + q.topic)),
          h('h3', { className: 'sv-title', id: 'sv-h' }, q.q),
          q.type === 'choice' ? h('div', { className: 'sv-opts', role: 'radiogroup', 'aria-labelledby': 'sv-h' }, q.options.map(function (o, k) {
            return h('button', { key: k, type: 'button', role: 'radio', 'aria-checked': ans[0][qi] === o, className: cx('sv-opt', ans[0][qi] === o && 'is-on', k === 0 && 'sv-focus'), onClick: function () { pick(qi, o); } }, h('span', { className: 'sv-radio', 'aria-hidden': true }), o);
          }))
            : h(F, null, h('div', { className: 'sv-scale', role: 'radiogroup', 'aria-labelledby': 'sv-h' }, [1, 2, 3, 4, 5].map(function (v) {
              return h('button', { key: v, type: 'button', role: 'radio', 'aria-checked': ans[0][qi] === v, 'aria-label': v + ' — ' + t('mood_' + v), className: cx('sv-num', 'n' + v, ans[0][qi] === v && 'is-on', v === 1 && 'sv-focus'), onClick: function () { pick(qi, v); } }, v);
            })), h('div', { className: 'sv-ends', 'aria-hidden': true }, h('span', null, '1 — ' + t('scale_lo')), h('span', null, '5 — ' + t('scale_hi')))));
    }
    else if (step === topics.length + 1) body = h('div', { className: 'sv-q' },
      h('span', { className: 'lor-eyebrow' }, t('pt_suggest')),
      h('h3', { className: 'sv-title', id: 'sv-h' }, t('pulse_suggest_q')),
      h('textarea', { id: 'sv-text', className: 'lor-input sv-focus', rows: 4, value: txt[0], placeholder: t('pulse_suggest_ph'), 'aria-labelledby': 'sv-h', onChange: function (e) { txt[1](e.target.value); } }),
      h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('pulse_ini_hint'), ' ', h('button', { type: 'button', className: 'app-link', onClick: function () { p.onClose(); if (p.openIni) p.openIni(); } }, t('ini_btn'))));
    else if (step === total) body = h('div', { className: 'sv-q' },
      fu[0] === 'loading' ? h('div', { className: 'sv-loading', 'aria-live': 'polite' }, h('span', { className: 'sv-dots', 'aria-hidden': true }, h('i'), h('i'), h('i')), h('p', null, t('ai_thinking')))
        : fu[0] ? h(F, null,
          h('div', { className: 'sv-ai' }, h('span', { className: 'pb-av', 'aria-hidden': true }, h(Ico, { name: 'spark', size: 16 })), h('p', null, fu[0].reply)),
          fu[0].q ? h(F, null, h('h3', { className: 'sv-title', id: 'sv-h' }, fu[0].q),
            h('textarea', { id: 'sv-fu', className: 'lor-input sv-focus', rows: 3, value: fuA[0], placeholder: t('pulse_fu_ph'), 'aria-labelledby': 'sv-h', onChange: function (e) { fuA[1](e.target.value); } })) : null) : null);
    else body = h('div', { className: 'sv-done' },
      h('span', { className: 'sv-done-ico', 'aria-hidden': true }, h(Icon, { name: 'check' })),
      h('h3', { className: 'sv-title', id: 'sv-h' }, t('pulse_thanks_t')),
      h('p', null, t('pulse_thanks_p')),
      h('p', { className: 'lor-sm lor-muted' }, '+' + XP_SURVEY + ' XP · ' + tpl(t('pulse_next'), { d: fmtDate(Date.now() + cfg.every * DAY) })));
    var foot;
    if (step === 0) foot = [h('span', { key: 's' }), h(Btn, { key: 'n', variant: 'primary', arrow: true, disabled: !mood[0], onClick: function () { go(1); } }, t('next'))];
    else if (step <= topics.length) foot = [h(Btn, { key: 'b', variant: 'ghost', onClick: function () { go(step - 1); } }, t('prev')), h(Btn, { key: 'n', variant: 'primary', arrow: true, disabled: !list || ans[0][step - 1] == null, onClick: function () { go(step + 1); } }, t('next'))];
    else if (step === topics.length + 1) foot = [h(Btn, { key: 'b', variant: 'ghost', onClick: function () { go(step - 1); } }, t('prev')), h(Btn, { key: 'n', variant: 'primary', arrow: true, onClick: submit }, t('pulse_submit'))];
    else if (step === total) foot = [h(Btn, { key: 'b', variant: 'ghost', disabled: fu[0] === 'loading', onClick: function () { go(total + 1); } }, t('pulse_skip')), h(Btn, { key: 'n', variant: 'primary', arrow: true, disabled: fu[0] === 'loading', onClick: finishFollow }, t('pulse_finish'))];
    else foot = [h('span', { key: 's' }), h(Btn, { key: 'c', variant: 'primary', onClick: p.onClose }, t('close'))];
    var pct = Math.min(100, step * 100 / (total));
    return h('div', { className: 'lor-scrim sv-scrim', onMouseDown: function (e) { if (e.target === e.currentTarget && step > total) p.onClose(); } },
      h('div', { className: 'lor-modal sv-modal', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'sv-h', ref: boxRef },
        h('div', { className: 'sv-head' },
          h('span', { className: 'pb-av', 'aria-hidden': true }, h(Ico, { name: 'spark', size: 16 })),
          h('div', { className: 'sv-head-t' }, h('b', null, t('pulse_title')), h('span', null, step <= total - 1 ? tpl(t('pulse_step'), { k: Math.min(step + 1, total), n: total }) : t('pulse_title_sub'))),
          h('button', { type: 'button', className: 'lor-modal-x', 'aria-label': t('close'), onClick: p.onClose }, '×')),
        h('div', { className: 'sv-bar', 'aria-hidden': true }, h('i', { style: { width: pct + '%' } })),
        h('p', { className: 'sv-anon' }, h(Ico, { name: 'lock', size: 14 }), t('pulse_named_note'), src[0] === 'ai' && step <= topics.length && step > 0 ? h('span', { className: 'sv-ai-tag' }, '✦ ' + t('pulse_ai_tag')) : null),
        body,
        h('div', { className: 'sv-foot' }, foot)));
  }

  /* admin · pulse analytics */
  function pulseStats(db, days) {
    var from = Date.now() - days * DAY, list = (db.surveys || []).filter(function (s) { return s.at >= from; });
    var prevList = (db.surveys || []).filter(function (s) { return s.at < from && s.at >= from - days * DAY; });
    function topicAvg(L, k) { var v = []; L.forEach(function (s) { (s.answers || []).forEach(function (a) { if (a.topic === k && a.type === 'scale' && a.v != null) v.push(+a.v); }); }); return { avg: mean(v), n: v.length }; }
    var topics = PULSE_TOPICS.map(function (k) { var c = topicAvg(list, k), pv = topicAvg(prevList, k); return { k: k, avg: c.avg, n: c.n, prev: pv.avg }; });
    var emps = employees(db).filter(function (u) { return u.profileComplete; });
    var part = emps.length ? emps.filter(function (u) { return (u.pulse || {}).last >= Date.now() - 14 * DAY; }).length / emps.length : 0;
    return { list: list, n: list.length, mood: mean(list.map(function (s) { return s.mood; }).filter(Boolean)), prevMood: mean(prevList.map(function (s) { return s.mood; }).filter(Boolean)), topics: topics, part: part, emps: emps.length };
  }
  function pulseSummary(db) { var s = pulseStats(db, 30); return { responses30d: s.n, moodAvg: s.mood ? Math.round(s.mood * 10) / 10 : null, participation14d: Math.round(s.part * 100) + '%', topics: s.topics.filter(function (x) { return x.n; }).map(function (x) { return { topic: x.k, avg: Math.round(x.avg * 10) / 10, answers: x.n }; }), suggestions: s.list.map(function (r) { return r.text; }).filter(Boolean).slice(0, 15) }; }

  function PulseAdmin(p) {
    var t = p.t, db = p.db, cfg = pulseCfg(db), rg = useState(30), days = rg[0], S = pulseStats(db, days);
    var more = useState(8), ai = useState(''), aiBusy = useState(false), aiE = useState('');
    function setCfg(fn) { p.update(function (d) { d.settings = d.settings || {}; d.settings.survey = Object.assign({}, pulseCfg(d)); fn(d.settings.survey); }); }
    function sendNow() { setCfg(function (c) { c.round = Date.now(); }); p.say(t('pulse_sent_all')); }
    function summarize() {
      if (!p.sampler || aiBusy[0]) return;
      var data = { periodDays: days, responses: S.n, participation14d: Math.round(S.part * 100) + '%', moodAvg_1_5: S.mood ? Math.round(S.mood * 10) / 10 : null, previousPeriodMood: S.prevMood ? Math.round(S.prevMood * 10) / 10 : null,
        topics: S.topics.filter(function (x) { return x.n; }).map(function (x) { return { topic: x.k, label: t('pt_' + x.k), avg_1_5: Math.round(x.avg * 10) / 10, answers: x.n, previousAvg: x.prev ? Math.round(x.prev * 10) / 10 : null }; }),
        suggestions: S.list.map(function (r) { return r.text; }).filter(Boolean), followUps: S.list.filter(function (r) { return r.follow; }).map(function (r) { return r.follow.q + ' — ' + r.follow.a; }),
        choiceAnswers: [].concat.apply([], S.list.map(function (r) { return (r.answers || []).filter(function (a) { return a.type === 'choice'; }).map(function (a) { return a.q + ' — ' + a.v; }); })) };
      var prompt = 'Siz BURAQ Logistics kompaniyasining HR-analitigisiz. Quyida xodimlarning pulse-so‘rovnoma natijalari (so‘nggi ' + days + ' kun). Rahbariyat uchun qisqa hisobot yozing (markdown, 220 so‘zgacha):\n## Umumiy kayfiyat\n## Asosiy muammolar (raqamlar bilan)\n## Ijobiy tomonlar\n## Tavsiya etiladigan 3–5 chora (aniq, amaliy, mas’ul bilan)\nFaqat berilgan ma’lumotga tayaning, o‘ylab topmang. Ismlarni faqat kerak bo‘lganda tilga oling. Til: ' + (LANG_NAME[p.lang] || LANG_NAME.uz) + '.\n\nMA’LUMOT (JSON):\n' + JSON.stringify(data);
      ai[1](''); aiE[1](''); aiBusy[1](true);
      p.sampler(prompt, { onText: function (x) { ai[1](x.text); } }).then(function (r) { ai[1](r.text); }).catch(function (e) { if (e && e.text) ai[1](e.text); aiE[1](aiErr(e, t)); }).then(function () { aiBusy[1](false); });
    }
    var weeks = []; for (var w = 5; w >= 0; w--) { var a = Date.now() - (w + 1) * 7 * DAY, b = Date.now() - w * 7 * DAY, L = (db.surveys || []).filter(function (s) { return s.at >= a && s.at < b; }); weeks.push({ k: w, m: mean(L.map(function (s) { return s.mood; })), n: L.length, label: w === 0 ? t('pulse_this_week') : tpl(t('pulse_weeks_ago'), { n: w }) }); }
    var ranked = S.topics.filter(function (x) { return x.n; }).sort(function (a, b) { return a.avg - b.avg; }), worst = ranked[0];
    return h(F, null,
      h('section', { className: 'box pulse-cfg' },
        h('div', { className: 'pulse-cfg-h' }, h('div', null, h('span', { className: 'lor-eyebrow' }, t('pulse_settings')), h('p', { className: 'lor-sm lor-muted', style: { margin: '4px 0 0' } }, tpl(t('pulse_cfg_hint'), { n: cfg.every }))),
          h(Btn, { variant: 'outline', size: 'sm', disabled: !cfg.on, onClick: sendNow }, t('pulse_send_now'))),
        h('div', { className: 'pulse-cfg-row' },
          h('label', { className: 'check' }, h('input', { type: 'checkbox', checked: cfg.on, onChange: function (e) { var v = e.target.checked; setCfg(function (c) { c.on = v; }); } }), t('pulse_on')),
          h('label', { className: 'pulse-every' }, t('pulse_every'), h('select', { className: 'lor-input slim', value: cfg.every, onChange: function (e) { var v = +e.target.value; setCfg(function (c) { c.every = v; }); } }, [3, 4, 5, 7].map(function (n) { return h('option', { key: n, value: n }, tpl(t('pulse_every_n'), { n: n })); }))))),
      h('div', { className: 'seg', role: 'tablist' }, [[7, t('pulse_7d')], [30, t('pulse_30d')], [90, t('pulse_90d')]].map(function (x) { return h('button', { key: x[0], type: 'button', role: 'tab', 'aria-selected': days === x[0], className: days === x[0] ? 'is-on' : '', onClick: function () { rg[1](x[0]); } }, x[1]); })),
      h('div', { className: 'tiles' },
        h('div', { className: 'tile' }, h('span', { className: 'lor-eyebrow' }, t('pulse_t_resp')), h('b', null, S.n), h('span', { className: 'lor-sm lor-muted' }, tpl(t('pulse_t_days'), { n: days }))),
        h('div', { className: 'tile' }, h('span', { className: 'lor-eyebrow' }, t('pulse_t_part')), h('b', null, Math.round(S.part * 100) + '%'), h('span', { className: 'lor-sm lor-muted' }, t('pulse_t_part_sub'))),
        h('div', { className: 'tile' }, h('span', { className: 'lor-eyebrow' }, t('pulse_t_mood')), h('div', { className: 'tile-mood' }, S.mood ? h(Face, { v: Math.max(1, Math.min(5, Math.round(S.mood))), size: 34 }) : null, h('b', null, S.mood ? S.mood.toFixed(1) : '—')), h('span', { className: 'lor-sm lor-muted' }, S.prevMood && S.mood ? (S.mood >= S.prevMood ? '▴ ' : '▾ ') + tpl(t('pulse_vs_prev'), { v: S.prevMood.toFixed(1) }) : '/ 5')),
        h('div', { className: 'tile' }, h('span', { className: 'lor-eyebrow' }, t('pulse_t_worst')), h('b', { className: 'tile-sm' }, worst ? t('pt_' + worst.k) : '—'), h('span', { className: 'lor-sm lor-muted' }, worst ? worst.avg.toFixed(1) + ' / 5' : ''))),
      h('div', { className: 'home-grid' },
        h('section', { className: 'box' },
          h('div', { className: 'chart-head' }, h('h2', { className: 'lor-h' }, t('pulse_topics')), h('div', { className: 'legend' }, h('span', null, h('i', { className: 'lg met' }), '≥ 3.5'), h('span', null, h('i', { className: 'lg mid' }), '3–3.5'), h('span', null, h('i', { className: 'lg low' }), '< 3'))),
          h('ul', { className: 'hbar' }, S.topics.map(function (x) {
            var cls = !x.n ? '' : x.avg < 3 ? 'low' : x.avg < 3.5 ? 'mid' : 'met';
            return h('li', { key: x.k }, h('span', { className: 'hbar-l' }, t('pt_' + x.k)),
              h('span', { className: 'hbar-t', title: x.n ? x.avg.toFixed(2) + ' · ' + x.n : '' }, x.n ? h('i', { className: cls, style: { width: ((x.avg - 1) / 4 * 100) + '%' } }) : null),
              h('span', { className: 'hbar-v' }, x.n ? h(F, null, h('b', null, x.avg.toFixed(1)), x.prev ? h('small', { className: x.avg >= x.prev ? 'up' : 'down' }, (x.avg >= x.prev ? '▴' : '▾') + Math.abs(x.avg - x.prev).toFixed(1)) : null, h('small', null, x.n)) : h('small', null, '—')));
          })),
          h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('pulse_topics_note'))),
        h('section', { className: 'box' },
          h('h2', { className: 'lor-h', style: { margin: 0 } }, t('pulse_trend')),
          h('div', { className: 'mood-trend' }, weeks.map(function (x) {
            return h('div', { key: x.k, className: 'mt-col', title: x.n + ' · ' + (x.m ? x.m.toFixed(2) : '—') },
              h('span', { className: 'mt-v' }, x.m ? x.m.toFixed(1) : '—'),
              h('span', { className: 'mt-track' }, x.m ? h('i', { className: x.m < 3 ? 'low' : x.m < 3.5 ? 'mid' : 'met', style: { height: ((x.m - 1) / 4 * 100) + '%' } }) : null),
              h('small', null, x.label));
          })),
          h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('pulse_trend_note')))),
      h('section', { className: 'box ai-box' },
        h('div', { className: 'chart-head' }, h('div', null, h('h2', { className: 'lor-h' }, t('pulse_ai')), h('p', { className: 'lor-sm lor-muted', style: { margin: '4px 0 0' } }, t('pulse_ai_hint'))),
          h(Btn, { variant: 'secondary', size: 'sm', disabled: !p.sampler || aiBusy[0] || !S.n, onClick: summarize }, aiBusy[0] ? t('ai_thinking') : '✦ ' + t('pulse_ai_btn'))),
        p.sampler === null ? h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('ai_unavail')) : null,
        aiBusy[0] && !ai[0] ? h('p', { className: 'ai-thinking' }, t('ai_thinking')) : null,
        ai[0] ? h('div', { className: 'ai-md', dangerouslySetInnerHTML: { __html: mdLite(ai[0]) } }) : null,
        aiE[0] ? h('p', { className: 'lor-field-error' }, aiE[0]) : null),
      h('section', { className: 'box' },
        h('div', { className: 'chart-head' }, h('h2', { className: 'lor-h' }, t('pulse_resp')), h('span', { className: 'lor-sm lor-muted' }, t('pulse_resp_note'))),
        S.list.length ? h('ul', { className: 'sv-list' }, S.list.slice(0, more[0]).map(function (s) {
          var who = s.uid ? userOf(db, s.uid).name + ' · ' + s.dept : t('pulse_anon') + ' · ' + s.dept;
          return h('li', { key: s.id, className: 'sv-item' },
            h('div', { className: 'sv-item-h' }, h(Face, { v: s.mood || 3, size: 30 }), h('div', null, h('b', null, who), h('span', { className: 'lor-sm lor-muted' }, fmt(s.at, t) + (s.ai ? ' · ✦ ' + t('pulse_ai_tag') : ''))), h('span', { className: 'sv-mood-l' }, t('mood_' + (s.mood || 3)))),
            h('ul', { className: 'sv-ans' }, (s.answers || []).map(function (a, i) { return h('li', { key: i }, h('span', { className: 'sv-ans-q' }, h('em', null, t('pt_' + a.topic)), a.q), a.type === 'scale' ? h('span', { className: cx('sv-score', a.v <= 2 ? 'low' : a.v >= 4 ? 'hi' : '') }, a.v != null ? a.v + ' / 5' : '—') : h('span', { className: 'sv-choice' }, a.v || '—')); })),
            s.text ? h('p', { className: 'sv-text' }, '“' + s.text + '”') : null,
            s.follow ? h('p', { className: 'sv-follow' }, h('span', null, '✦ ' + s.follow.q), h('b', null, s.follow.a)) : null);
        })) : h('p', { className: 'lor-muted', style: { margin: 0 } }, t('pulse_no_resp')),
        S.list.length > more[0] ? h('div', null, h(Btn, { variant: 'outline', size: 'sm', onClick: function () { more[1](more[0] + 10); } }, t('pulse_more'))) : null));
  }

  /* ======================= 3. INITIATIVES (tashabbus) ======================= */
  var INI_TYPES = ['problem', 'idea', 'benefit'];
  /* whom an employee sends an initiative to — each has a login of their own (role 'leader', post) and sees only theirs;
     the SOP manager does not read them (the server hides the text from the admin) */
  var INI_TO = ['ceo', 'pm', 'boss'];
  /* access levels — the same as the server's lvl_: ceo — everything, salary, every login; sop — learning and staff, no
     salary; boss — the owner: sees everything, changes only his card and the answers to ideas sent to him; pm — ideas only */
  function lvlOf(u) { if (!u) return 'none'; if (u.role === 'admin') return u.post === 'ceo' ? 'ceo' : u.post === 'boss' ? 'boss' : 'sop'; return u.role === 'leader' ? 'pm' : 'employee'; }
  /* the people ideas go to: CEO, Project Manager, the owner (CEO and the owner are admins with a post since v10) */
  function leadersOf(db, post) { return db.users.filter(function (u) { return (u.role === 'leader' || u.role === 'admin') && INI_TO.indexOf(u.post) >= 0 && (!post || u.post === post); }); }
  /* the owner's page changes only what the server lets him change — anything else says «view only» instead of being sent */
  function roUpdate(p, t) {
    return function (fn) {
      var prev = p.db, d = clone(prev), me = p.user.id;
      fn(d);
      var find = function (list, id) { return (list || []).filter(function (x) { return x && x.id === id; })[0]; };
      var ok = LmsSync.diff(prev, d).every(function (op) {
        var top = op.path[0], seg = op.path[1] || {};
        if (top === 'lang' || top === 'session') return true;
        if (top === 'users') return seg.id === me && op.path.length >= 3 && ['role', 'post', 'login', 'password'].indexOf(op.path[2]) < 0;
        if (top === 'notifications') { var n = find(prev.notifications, seg.id); return !n || n.userId === me; }
        if (top === 'initiatives') return iniTo(find(prev.initiatives, seg.id) || {}).indexOf('boss') >= 0;
        return false;
      });
      if (ok) p.update(fn); else p.say(t('ro_note'));
    };
  }
  /* recipients of an initiative — one or several (an early one may hold a single string) */
  function iniTo(x) { return !x ? [] : Array.isArray(x.to) ? x.to : x.to ? [x.to] : []; }
  function iniToLabel(x, t) { return iniTo(x).map(function (k) { return t('ini_to_s_' + k); }).join(', '); }
  var INI_AREAS = ['warehouse', 'transport', 'customs', 'clients', 'office', 'it', 'training', 'other'];
  var INI_STATUS = ['new', 'review', 'accepted', 'done', 'declined'];
  var INI_BADGE = { new: 'todo', review: 'in-progress', accepted: 'exam-ready', done: 'passed', declined: 'failed' };
  function IniStatus(p) { return h(Badge, { status: INI_BADGE[p.s] || 'todo', lang: p.lang }, p.t('is_' + p.s)); }
  function IniType(p) { return h('span', { className: 'ini-type t-' + p.type }, h(Ico, { name: p.type, size: 14, w: 1.8 }), p.t('it_' + p.type)); }
  function iniXp(x, s) { return (s === 'accepted' || s === 'done' ? XP_INI_OK : 0) + (s === 'done' ? XP_INI_DONE : 0); }
  function iniNotify(d, x, s, reply) { d.notifications.unshift({ id: nextId(d), userId: x.uid, kind: 'ini', ini: { title: x.title, s: s, reply: reply || '', xp: Math.max(0, iniXp(x, s) - iniXp(x, x.status)), to: iniTo(x) }, text: '', route: 'ideas', at: Date.now(), read: false }); }

  function IniButton(p) {
    return h('button', { type: 'button', className: 'ini-btn', onClick: p.onClick, title: p.t('ini_btn_hint'), 'aria-label': p.t('ini_btn') + ' — ' + p.t('ini_btn_hint') },
      h(Ico, { name: 'bulb', size: 18, w: 1.8 }), h('span', null, p.t('ini_btn')));
  }
  function IniHomeCard(p) {
    var t = p.t, mine = (p.db.initiatives || []).filter(function (x) { return x.uid === p.user.id; });
    return h('section', { className: 'box ini-card' },
      h('span', { className: 'ini-card-ico', 'aria-hidden': true }, h(Ico, { name: 'bulb', size: 26, w: 1.8 })),
      h('div', { className: 'ini-card-b' }, h('span', { className: 'lor-eyebrow' }, t('ini_eyebrow')), h('h2', { className: 'lor-h' }, t('ini_card_t')), h('p', { className: 'lor-sm' }, t('ini_card_p'))),
      h('div', { className: 'ini-card-a' }, h('button', { type: 'button', className: 'ini-btn big', onClick: p.onNew }, h(Ico, { name: 'bulb', size: 18, w: 1.8 }), h('span', null, t('ini_new'))),
        mine.length ? h('button', { type: 'button', className: 'app-link', onClick: p.onList }, tpl(t('ini_mine_n'), { n: mine.length })) : null));
  }

  function IniModal(p) {
    var t = p.t, u = p.user, sampler = p.sampler;
    var f = useState({ to: [], type: '', area: '', title: '', text: '', benefit: '' }), v = f[0];
    var er = useState({}), done = useState(false), ai = useState(null), aiBusy = useState(false), aiE = useState(''), ctl = useRef(null), boxRef = useRef(null);
    useEffect(function () { function k(e) { if (e.key === 'Escape') close(); } window.addEventListener('keydown', k); return function () { window.removeEventListener('keydown', k); if (ctl.current) ctl.current.abort(); }; }, []);
    useEffect(function () { if (boxRef.current) { var b = boxRef.current.querySelector('.ini-types button'); if (b) b.focus({ preventScroll: true }); } }, []);
    function close() { if (ctl.current) ctl.current.abort(); p.onClose(); }
    function set(k, x) { var o = Object.assign({}, f[0]); o[k] = x; f[1](o); if (er[0][k]) { var e = Object.assign({}, er[0]); delete e[k]; er[1](e); } }
    function polish() {
      if (!sampler || aiBusy[0]) return;
      var prompt = 'Siz BURAQ Logistics kompaniyasida xodimlarning tashabbuslarini rahbariyatga tushunarli qilib yozishga yordam beruvchi AI muharrirsiz.\nTASHABBUS turi: ' + v.type + ' (problem — muammo, idea — g‘oya, benefit — foydali shart-sharoit taklifi); sohasi: ' + (v.area || '—') + '.\nSarlavha: ' + v.title + '\nTavsif: ' + v.text + '\nFoyda / yechim: ' + (v.benefit || '—') + '\n' +
        'Vazifa: matnni aniq, qisqa va hurmatli ohangda qayta yozing: tavsifda — nima bo‘lyapti, qayerda, kimga ta’sir qiladi; foyda/yechimda — nima taklif qilinadi va qanday natija kutiladi. Ma’noni o‘zgartirmang, yangi fakt, raqam yoki ism qo‘shmang; muallif bergan raqamlarni saqlang. Sarlavha 70 belgidan oshmasin. Til: ' + (LANG_NAME[p.lang] || LANG_NAME.uz) + '.\nFaqat JSON qaytaring: {"title":"...","text":"...","benefit":"..."}';
      var c = new AbortController(); ctl.current = c; aiBusy[1](true); aiE[1](''); ai[1](null);
      sampler.json(prompt, { signal: c.signal }).then(function (r) {
        if (!r || typeof r.title !== 'string' || typeof r.text !== 'string') { aiE[1](t('ai_bad_json')); return; }
        ai[1]({ title: r.title.trim().slice(0, 90), text: r.text.trim().slice(0, 1500), benefit: typeof r.benefit === 'string' ? r.benefit.trim().slice(0, 1000) : v.benefit });
      }).catch(function (e) { if (e && e.code === 'cancelled') return; aiE[1](e && e.code === 'invalid_json' ? t('ai_bad_json') : aiErr(e, t)); }).then(function () { aiBusy[1](false); });
    }
    function submit() {
      var e = {};
      if (!v.to.length) e.to = t('ini_pick_to');
      if (!v.type) e.type = t('ini_pick_type');
      if (!v.area) e.area = t('fill_required');
      if (!v.title.trim()) e.title = t('fill_required');
      if (v.text.trim().length < 15) e.text = t('ini_text_short');
      er[1](e); if (Object.keys(e).length) { var first = boxRef.current && boxRef.current.querySelector('.is-error, [aria-invalid="true"]'); if (first && first.focus) first.focus(); return; }
      p.update(function (d) {
        d.initiatives = d.initiatives || [];
        var to = INI_TO.filter(function (k) { return v.to.indexOf(k) >= 0; });
        d.initiatives.unshift({ id: 'i' + nextId(d), uid: u.id, to: to, type: v.type, area: v.area, title: v.title.trim(), text: v.text.trim(), benefit: v.benefit.trim(), status: 'new', at: Date.now() });
        // the recipient learns there is something new — without the title (no one else should read it)
        leadersOf(d).filter(function (l) { return to.indexOf(l.post) >= 0; }).forEach(function (l) { d.notifications.unshift({ id: nextId(d), userId: l.id, kind: 'ini_in', ini: { to: to }, text: '', route: 'ideas', at: Date.now(), read: false }); });
      });
      done[1](true);
    }
    var ty = v.type || 'idea';
    return h('div', { className: 'lor-scrim', onMouseDown: function (e) { if (e.target === e.currentTarget && done[0]) close(); } },
      h('div', { className: 'lor-modal ini-modal', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'ini-h', ref: boxRef },
        h('button', { type: 'button', className: 'lor-modal-x', 'aria-label': t('close'), onClick: close }, '×'),
        done[0] ? h('div', { className: 'ini-done' },
          h('span', { className: 'ini-done-ico', 'aria-hidden': true }, h(Ico, { name: 'bulb', size: 34, w: 1.7 })),
          h('h2', { className: 'lor-h', id: 'ini-h' }, t('ini_done_t')),
          h('p', null, t('ini_done_p')),
          h('ol', { className: 'ini-flow' }, ['new', 'review', 'accepted', 'done'].map(function (s) { return h('li', { key: s }, h(IniStatus, { s: s, t: t, lang: p.lang })); })),
          h('div', { className: 'lor-modal-actions' }, h(Btn, { variant: 'outline', onClick: close }, t('close')), h(Btn, { variant: 'primary', arrow: true, onClick: function () { close(); p.onList(); } }, t('ini_my'))))
          : h(F, null,
            h('div', { className: 'ini-head' }, h('span', { className: 'ini-head-ico', 'aria-hidden': true }, h(Ico, { name: 'bulb', size: 22, w: 1.8 })), h('div', null, h('span', { className: 'lor-eyebrow' }, t('ini_eyebrow')), h('h2', { className: 'lor-h', id: 'ini-h' }, t('ini_title')))),
            h('p', { className: 'lor-muted' }, t('ini_intro')),
            h('span', { className: 'lor-field-label ini-to-l', id: 'ini-to-l' }, t('ini_to'), h('span', { className: 'lor-req', 'aria-hidden': true }, '*')),
            h('div', { className: 'ini-types ini-to', role: 'group', 'aria-labelledby': 'ini-to-l' }, INI_TO.map(function (x) {
              var who = leadersOf(p.db, x).map(function (l) { return l.name; }).join(', '), on = v.to.indexOf(x) >= 0;
              return h('button', { key: x, type: 'button', role: 'checkbox', 'aria-checked': on, className: cx('ini-type-card ini-to-card', on && 'is-on'),
                  onClick: function () { set('to', on ? v.to.filter(function (k) { return k !== x; }) : v.to.concat([x])); } },
                h('span', { className: 'ini-tc-ico', 'aria-hidden': true }, h(Ico, { name: on ? 'check' : 'team', size: 20, w: 1.8 })), h('b', null, t('ini_to_' + x)), h('span', null, who || t('ini_to_sub_' + x)));
            })),
            er[0].to ? h('span', { className: 'lor-field-error' }, er[0].to) : h('span', { className: 'lor-sm lor-muted' }, t('ini_to_hint')),
            h('span', { className: 'lor-field-label ini-to-l' }, t('ini_type'), h('span', { className: 'lor-req', 'aria-hidden': true }, '*')),
            h('div', { className: 'ini-types', role: 'radiogroup', 'aria-label': t('ini_type') }, INI_TYPES.map(function (x) {
              return h('button', { key: x, type: 'button', role: 'radio', 'aria-checked': v.type === x, className: cx('ini-type-card', 't-' + x, v.type === x && 'is-on'), onClick: function () { set('type', x); } },
                h('span', { className: 'ini-tc-ico', 'aria-hidden': true }, h(Ico, { name: x, size: 20, w: 1.8 })), h('b', null, t('it_' + x)), h('span', null, t('it_' + x + '_sub')));
            })),
            er[0].type ? h('span', { className: 'lor-field-error' }, er[0].type) : null,
            h('div', { className: 'lor-form-grid' },
              h(Field, { name: 'ini-area', label: t('ini_area'), required: true, value: v.area, error: er[0].area, options: [['', '—']].concat(INI_AREAS.map(function (x) { return [x, t('ia_' + x)]; })), onChange: function (x) { set('area', x); } }),
              h(Field, { name: 'ini-title', label: t('ini_title_f'), required: true, value: v.title, error: er[0].title, placeholder: t('ini_title_ph_' + ty), onChange: function (x) { set('title', x.slice(0, 90)); } }),
              h(Field, { name: 'ini-text', span: true, multiline: true, rows: 4, label: t('ini_text_' + ty), required: true, value: v.text, error: er[0].text, placeholder: t('ini_text_ph_' + ty), onChange: function (x) { set('text', x); } }),
              h(Field, { name: 'ini-benefit', span: true, multiline: true, rows: 3, label: t('ini_benefit_' + ty), value: v.benefit, placeholder: t('ini_benefit_ph'), onChange: function (x) { set('benefit', x); } })),
            h('div', { className: 'ini-ai' },
              h(Btn, { variant: 'outline', size: 'sm', disabled: !sampler || aiBusy[0] || v.text.trim().length < 15, onClick: polish }, aiBusy[0] ? t('ai_thinking') : '✦ ' + t('ini_ai')),
              h('span', { className: 'lor-sm lor-muted' }, sampler === null ? t('ai_unavail') : t('ini_ai_hint'))),
            aiE[0] ? h('p', { className: 'lor-field-error' }, aiE[0]) : null,
            ai[0] ? h('div', { className: 'cms-ai-res' },
              h('span', { className: 'lor-eyebrow' }, t('ai_result')),
              h('b', null, ai[0].title), h('p', { className: 'ini-pre' }, ai[0].text), ai[0].benefit ? h('p', { className: 'ini-pre lor-sm' }, h('b', null, t('ini_benefit_short') + ': '), ai[0].benefit) : null,
              h('div', { className: 'cms-ai-act' }, h(Btn, { variant: 'ghost', size: 'sm', onClick: function () { ai[1](null); } }, t('discard')), h(Btn, { variant: 'primary', size: 'sm', onClick: function () { f[1](Object.assign({}, v, ai[0])); ai[1](null); } }, t('apply')))) : null,
            h('p', { className: 'ini-named' }, h(Ico, { name: 'team', size: 16 }), h('span', null, t('ini_named_note'))),
            h('div', { className: 'lor-modal-actions' }, h(Btn, { variant: 'ghost', onClick: close }, t('cancel')), h('button', { type: 'button', className: 'ini-btn big', onClick: submit }, h(Ico, { name: 'bulb', size: 18, w: 1.8 }), h('span', null, t('ini_send')))))));
  }

  function IniItem(p) {
    var x = p.x, t = p.t, db = p.db, admin = p.admin;
    var st = useState(x.status), rp = useState(x.reply || '');
    useEffect(function () { st[1](x.status); rp[1](x.reply || ''); }, [x.status, x.reply]);
    var author = userOf(db, x.uid).name, au = userOf(db, x.uid);
    function save() {
      var s = st[0], r = rp[0].trim();
      p.update(function (d) { d.initiatives.forEach(function (y) { if (y.id === x.id) { y.status = s; y.reply = r; y.repliedAt = Date.now(); if (p.post) y.repliedBy = p.post; if (s === 'accepted' && !y.acceptedAt) y.acceptedAt = Date.now(); } }); iniNotify(d, x, s, r); });
      p.say(t('ini_saved'));
    }
    var dirty = st[0] !== x.status || rp[0].trim() !== (x.reply || '');
    return h('article', { className: cx('box ini-item', 'st-' + x.status) },
      h('div', { className: 'ini-item-h' }, h(IniType, { type: x.type, t: t }), h('span', { className: 'ini-area' }, t('ia_' + x.area)), iniTo(x).length ? h('span', { className: 'ini-area ini-to-chip' }, '→ ' + iniToLabel(x, t)) : null, h('span', { className: 'lor-sm lor-muted' }, fmt(x.at, t)), h('span', { className: 'ini-sp' }), h(IniStatus, { s: x.status, t: t, lang: p.lang })),
      h('h3', { className: 'ini-title' }, x.title),
      admin ? h('div', { className: 'ini-author' }, h(Av, { name: author, src: au.avatar, size: 26 }), h('span', null, author, h('small', null, au.position + ' · ' + au.department))) : null,
      h('p', { className: 'ini-pre' }, x.text),
      x.benefit ? h('div', { className: 'ini-benefit' }, h('span', { className: 'lor-eyebrow' }, t('ini_benefit_' + x.type)), h('p', { className: 'ini-pre' }, x.benefit)) : null,
      !admin && x.reply ? h('div', { className: 'ini-reply' }, h('span', { className: 'lor-eyebrow' }, t('ini_reply') + (x.repliedBy ? ' · ' + t('ini_to_s_' + x.repliedBy) : '') + (x.repliedAt ? ' · ' + fmt(x.repliedAt, t) : '')), h('p', null, x.reply)) : null,
      !admin && (x.status === 'accepted' || x.status === 'done') ? h('span', { className: 'ini-xp' }, '+' + (XP_INI_OK + (x.status === 'done' ? XP_INI_DONE : 0)) + ' XP') : null,
      admin ? h('div', { className: 'ini-admin' },
        h('div', { className: 'ini-admin-row' },
          h(Field, { name: 'is-' + x.id, label: t('th_status'), value: st[0], options: INI_STATUS.map(function (s) { return [s, t('is_' + s)]; }), onChange: st[1] }),
          h(Field, { name: 'ir-' + x.id, className: 'ini-reply-f', multiline: true, rows: 2, label: t('ini_reply_f'), value: rp[0], placeholder: t('ini_reply_ph'), onChange: rp[1] })),
        h('div', { className: 'ini-admin-act' },
          h('span', { className: 'lor-sm lor-muted' }, tpl(t('ini_xp_note'), { a: XP_INI_OK, b: XP_INI_DONE })),
          h(Btn, { variant: 'primary', size: 'sm', disabled: !dirty, onClick: save }, t('ini_save_notify')))) : null);
  }

  /* ======================= SALARY: fixed + KPI (lms-pay.js — the same formula runs on the server) =======================
     The SOP manager sets the terms (Maosh → Shartlar: fixed, KPI bonus, indicators). An employee sees only own terms,
     enters the actual figures (platform figures — attendance, study hours, lessons, XP, extra tasks, errors — fill in by
     themselves), sees how every line is counted and saves the calculation to the history. The SOP manager sees who
     calculated what, with which figures and how, checks the platform figures against today's data and approves or
     returns it. */
  var PAY_SRC = ['manual', 'att_late', 'att_absent', 'att_ontime', 'study_h', 'lessons', 'xp', 'xtasks', 'errors'];
  var PAY_MAX = 20, PAY_DRAFT_MAX = 40, PAY_TRIES = 30;   // a month per employee: sent, not sent (as on the server); tries kept in one
  function payId() { return 'pc' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function money(n) { return String(Math.round(+n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0'); }
  function sumTxt(n, t) { return money(n) + ' ' + t('pay_cur'); }
  function payNum(v) { var n = parseFloat(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : 0; }
  function numTxt(n) { return String(Math.round(n * 100) / 100).replace('.', ','); }
  /* a platform figure for one month */
  function paySrcVal(db, u, ym, src) {
    if (src === 'att_late' || src === 'att_absent' || src === 'att_ontime') { var c = attMonth(db, u, ym); return src === 'att_late' ? c.late : src === 'att_absent' ? c.absent : (c.onTimePct || 0); }
    if (src === 'study_h' || src === 'lessons' || src === 'xp') { var m = monthStats(db, u, ym); return src === 'study_h' ? Math.round(m.minutes / 6) / 10 : src === 'lessons' ? m.lessons : m.xp; }
    var s0 = ymStart(ym), e1 = ymStart(ymShift(ym, 1));
    if (src === 'xtasks') return (db.xtasks || []).filter(function (x) { return x.uid === u.id && x.status === 'done' && x.doneAt >= s0 && x.doneAt < e1; }).length;
    if (src === 'errors') return (db.errors || []).filter(function (x) { return x.uid === u.id && x.at >= s0 && x.at < e1; }).length;
    return 0;
  }
  /* the condition of one indicator in plain words */
  function payRule(k, t) {
    var un = k.unit ? ' ' + k.unit : '';
    if (k.type === 'unit') return tpl(t(k.rate < 0 ? 'pay_rule_minus' : 'pay_rule_unit'), { u: k.unit || t('pay_unit1'), x: sumTxt(Math.abs(k.rate), t) });
    if (k.type === 'bonus') return tpl(t(k.less ? 'pay_rule_bonus_less' : 'pay_rule_bonus'), { p: numTxt(k.plan) + un, x: sumTxt(k.amount, t) });
    var s = [tpl(t('pay_rule_plan'), { p: numTxt(k.plan) + un, w: numTxt(k.w) })];
    if (k.less) s.push(t('pay_rule_less'));
    if (k.min) s.push(tpl(t('pay_rule_min'), { n: numTxt(k.min) }));
    if ((k.cap || 100) !== 100) s.push(tpl(t('pay_rule_cap'), { n: numTxt(k.cap) }));
    return s.join(' · ');
  }
  /* how one line was counted */
  function payHow(k, ln, base, t) {
    var un = k.unit ? ' ' + k.unit : '';
    if (k.type === 'unit') return numTxt(ln.f) + un + ' × ' + sumTxt(k.rate, t) + ' = ' + sumTxt(ln.a, t);
    if (k.type === 'bonus') return numTxt(ln.f) + un + (ln.a ? ' ✓ ' : ' ✗ ') + '→ ' + sumTxt(ln.a, t);
    var ratio = k.less ? tpl(t('pay_how_less'), { f: numTxt(ln.f) + un, p: numTxt(k.plan) + un }) : numTxt(ln.f) + ' / ' + numTxt(k.plan) + un;
    var below = !ln.s && k.min && (k.less ? ln.f > 0 : ln.f < k.plan * k.min / 100);
    return ratio + ' → ' + numTxt(ln.s) + '%' + (below ? ' (' + tpl(t('pay_below'), { n: numTxt(k.min) }) + ')' : '') + ' × ' + numTxt(k.w) + '% × ' + sumTxt(base, t) + ' = ' + sumTxt(ln.a, t);
  }
  function PayStatus(p) { return h('span', { className: 'pay-st is-' + p.s }, p.t('pay_st_' + p.s)); }
  /* the tries of one visit: when, the typed figures, the total */
  function PayTries(p) {
    var t = p.t, c = p.c, man = (c.scheme.kpis || []).filter(function (k) { return k.src === 'manual'; });
    if (!(c.tries || []).length) return null;
    return h('div', { className: 'pay-tries' }, h('span', { className: 'lor-eyebrow' }, tpl(t('pay_tries'), { n: c.tries.length })),
      h('ol', null, c.tries.map(function (y, i) {
        return h('li', { key: i }, h('span', { className: 'pay-hwhen' }, fmtDT(y.at).slice(11)),
          h('span', null, man.map(function (k) { return k.name + ': ' + numTxt((y.inputs || {})[k.id] || 0) + (k.unit ? ' ' + k.unit : ''); }).join(' · ') || '—'),
          h('b', null, sumTxt(y.total, t)));
      })));
  }
  /* a saved calculation, line by line; check — the SOP manager: platform figures against today's data */
  function PayLines(p) {
    var t = p.t, c = p.c, kp = {};
    (c.scheme.kpis || []).forEach(function (k) { kp[k.id] = k; });
    return h('div', { className: 'pay-lines' },
      h('div', { className: 'pay-line is-fixed' }, h('span', null, t('pay_fixed')), h('span', null), h('b', null, sumTxt(c.fixed, t))),
      (c.lines || []).map(function (ln) {
        var k = kp[ln.k] || { name: ln.k, type: 'unit', rate: 0 }, now = p.check && k.src && k.src !== 'manual' && p.u ? paySrcVal(p.db, p.u, c.ym, k.src) : null;
        return h('div', { key: ln.k, className: 'pay-line' },
          h('span', null, k.name, k.src && k.src !== 'manual' ? h('small', { className: 'pay-auto' }, t('pay_src_' + k.src)) : null),
          h('span', { className: 'pay-how' }, payHow(k, ln, c.scheme.base, t), now !== null && now !== ln.f ? h('em', { className: 'pay-diff' }, ' ⚠ ' + tpl(t('pay_now'), { x: numTxt(now) })) : null),
          h('b', { className: ln.a < 0 ? 'is-minus' : '' }, (ln.a > 0 ? '+' : '') + sumTxt(ln.a, t)));
      }),
      h('div', { className: 'pay-line is-total' }, h('span', null, t('pay_total')), h('span', null, c.pct != null ? tpl(t('pay_pct_line'), { n: c.pct }) : ''), h('b', null, sumTxt(c.total, t))));
  }
  /* the total counts up when it changes */
  function useTween(v) {
    var s = useState(v), cur = useRef(v);
    useEffect(function () {
      var from = cur.current, t0 = 0, id = 0;
      if (from === v || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) { cur.current = v; s[1](v); return; }
      function step(ts) { if (!t0) t0 = ts; var k = Math.min(1, (ts - t0) / 450), e = 1 - Math.pow(1 - k, 3); cur.current = from + (v - from) * e; s[1](cur.current); if (k < 1) id = requestAnimationFrame(step); }
      id = requestAnimationFrame(step);
      return function () { cancelAnimationFrame(id); };
    }, [v]);
    return s[0];
  }

  /* the employee: own terms, the calculator, own history */
  function PayPage(p) {
    var t = p.t, db = p.db, u = p.user, mine = LmsPay.schemeFor(db.pay, u);
    var thisYm = ymOf(Date.now()), ymS = useState(thisYm), ym = ymS[0], inS = useState({}), noteS = useState(''), openS = useState(null);
    var head = h('div', { className: 'page-head' },
      h('div', null, h('span', { className: 'lor-eyebrow' }, t('pay_eyebrow')), h('h1', { className: 'lor-title' }, t('pay_title'), h(PageTip, { t: t, id: 'pay' }))),
      mine ? h('div', { className: 'seg pay-months', role: 'group', 'aria-label': t('pay_month') }, [ymShift(thisYm, -1), thisYm].map(function (m) {
        return h('button', { key: m, type: 'button', className: ym === m ? 'is-on' : '', 'aria-pressed': ym === m, onClick: function () { ymS[1](m); } }, ymLabel(m, p.lang));
      })) : null);
    var hist = (db.payCalcs || []).filter(function (c) { return c.uid === u.id; }).sort(function (a, b) { return b.at - a.at; });
    var snap = mine ? LmsPay.snapshot(mine.scheme) : null, vals = {};
    if (mine) snap.kpis.forEach(function (k) { vals[k.id] = k.src === 'manual' ? payNum(inS[0][ym + '|' + k.id]) : paySrcVal(db, u, ym, k.src); });
    var r = mine ? LmsPay.calc(snap, mine.fixed, vals) : null;
    var typed = mine ? snap.kpis.some(function (k) { return k.src === 'manual' && String(inS[0][ym + '|' + k.id] || '').trim() !== ''; }) : false;

    /* every calculation is recorded: a pause in typing makes a «try»; leaving the page, the tab or the month sends
       the tries to the history as «not sent» unless they were sent with «Hisobni saqlash» (the SOP manager sees both) */
    var live = useRef(null), sess = useRef({ ym: ym, tries: [] });
    live.current = { snap: snap, fixed: r ? r.fixed : 0, vals: vals, total: r ? r.total : 0, ym: ym, typed: typed, db: db, update: p.update, uid: u.id };
    function addTry() {
      var L = live.current, x = sess.current;
      if (!L.snap || !L.typed || x.ym !== L.ym) return;
      var last = x.tries[x.tries.length - 1] || (x.base ? { inputs: x.base } : null);   // base — the figures just sent
      if (last && LmsSync.equal(last.inputs, L.vals)) return;
      x.tries = x.tries.concat([{ at: Date.now(), inputs: L.vals, total: L.total }]).slice(-PAY_TRIES);
    }
    function flushDraft() {
      var L = live.current, x = sess.current;
      sess.current = { ym: L.ym, tries: [] };
      if (!x.tries.length || !L.snap) return;
      if ((L.db.payCalcs || []).filter(function (c) { return c.uid === L.uid && c.ym === x.ym && c.status === 'draft'; }).length >= PAY_DRAFT_MAX) return;
      var last = x.tries[x.tries.length - 1], rr = LmsPay.calc(L.snap, L.fixed, last.inputs);
      var rec = { id: payId(), uid: L.uid, at: x.tries[0].at, ym: x.ym, scheme: L.snap, fixed: rr.fixed, inputs: last.inputs, kpi: rr.kpi, total: rr.total, pct: rr.pct, lines: rr.lines, tries: x.tries, status: 'draft' };
      L.update(function (d) { d.payCalcs = d.payCalcs || []; d.payCalcs.unshift(rec); });
    }
    var key = JSON.stringify(vals);
    useEffect(function () { var id = setTimeout(addTry, 1500); return function () { clearTimeout(id); }; }, [key]);
    useEffect(function () { if (sess.current.ym !== ym) flushDraft(); }, [ym]);
    useEffect(function () {
      function hide() { if (document.visibilityState === 'hidden') { addTry(); flushDraft(); } }
      document.addEventListener('visibilitychange', hide);
      return function () { document.removeEventListener('visibilitychange', hide); addTry(); flushDraft(); };
    }, []);

    if (!mine) return h('div', { className: 'app-wrap' }, head,
      h('section', { className: 'box pay-empty' }, h('span', { className: 'ini-card-ico', 'aria-hidden': true }, h(Ico, { name: 'target', size: 26, w: 1.8 })), h('p', { style: { margin: 0 } }, t('pay_none'))),
      hist.length ? h(PayHistory, { t: t, lang: p.lang, list: hist, open: openS }) : null);
    var lineOf = {};
    r.lines.forEach(function (ln) { lineOf[ln.k] = ln; });
    var n = hist.filter(function (c) { return c.ym === ym && c.status !== 'draft'; }).length;
    function setIn(k, v) { var o = Object.assign({}, inS[0]); o[ym + '|' + k] = v; inS[1](o); }
    function save() {
      addTry();   // the figures on the screen are the last try
      var rec = { id: payId(), uid: u.id, at: Date.now(), ym: ym, scheme: snap, fixed: r.fixed, inputs: vals, kpi: r.kpi, total: r.total, pct: r.pct, lines: r.lines, status: 'saved' };
      if (sess.current.tries.length) rec.tries = sess.current.tries;
      sess.current = { ym: ym, tries: [], base: vals };
      if (noteS[0].trim()) rec.note = noteS[0].trim().slice(0, 300);
      p.update(function (d) { d.payCalcs = d.payCalcs || []; d.payCalcs.unshift(rec); });
      noteS[1](''); openS[1](rec.id); p.say(t('pay_saved'));
    }
    return h('div', { className: 'app-wrap' }, head,
      h('div', { className: 'pay-grid' },
        h('div', { className: 'pay-main' },
          h('section', { className: 'box pay-terms' },
            h('div', { className: 'box-row', style: { marginTop: 0 } }, h('h2', { className: 'lor-h' }, t('pay_cond')), h('span', { className: 'pay-scheme' }, snap.title)),
            h('div', { className: 'pay-tiles' },
              h('div', { className: 'tile' }, h('span', { className: 'lor-eyebrow' }, t('pay_fixed')), h('b', { className: 'tile-sm' }, sumTxt(r.fixed, t))),
              h('div', { className: 'tile' }, h('span', { className: 'lor-eyebrow' }, t('pay_base')), h('b', { className: 'tile-sm' }, sumTxt(snap.base, t)))),
            mine.scheme.note ? h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, mine.scheme.note) : null),
          h('section', { className: 'box' },
            h('h2', { className: 'lor-h' }, t('pay_kpis')),
            snap.kpis.length ? h('ul', { className: 'pay-kpis' }, snap.kpis.map(function (k) {
              var ln = lineOf[k.id], auto = k.src !== 'manual', pct = k.type === 'plan' ? Math.max(0, Math.min(ln.s || 0, k.cap || 100)) : null;
              return h('li', { key: k.id, className: 'pay-kpi' },
                h('div', { className: 'pay-kpi-top' },
                  h('div', null, h('b', null, k.name), h('div', { className: 'lor-sm lor-muted' }, payRule(k, t))),
                  h('span', { className: cx('pay-amt', ln.a < 0 && 'is-minus', !ln.a && 'is-zero') }, (ln.a > 0 ? '+' : '') + sumTxt(ln.a, t))),
                h('div', { className: 'pay-kpi-in' },
                  auto ? h('div', { className: 'pay-autoval' }, h('b', null, numTxt(vals[k.id]) + (k.unit ? ' ' + k.unit : '')), h('small', { className: 'pay-auto' }, t('pay_src_' + k.src) + ' · ' + t('pay_auto')))
                    : h('label', { className: 'pay-input' }, h('span', { className: 'sr-only' }, k.name),
                      h('input', { className: 'lor-input', id: 'pay-in-' + k.id, inputMode: 'decimal', placeholder: '0', value: inS[0][ym + '|' + k.id] || '', onChange: function (e) { setIn(k.id, e.target.value.replace(/[^\d.,\s-]/g, '')); } }),
                      k.unit ? h('span', { className: 'lor-muted' }, k.unit) : null),
                  pct !== null ? h('div', { className: cx('pay-bar', k.min && ln.s < k.min && 'is-low'), title: numTxt(ln.s) + '%' },
                    h('i', { style: { width: Math.min(100, pct / (k.cap > 100 ? k.cap : 100) * 100) + '%' } }), k.cap > 100 ? h('span', { className: 'pay-bar-100', style: { left: 100 / k.cap * 100 + '%' } }) : null) : null,
                  pct !== null ? h('span', { className: 'pay-bar-n' }, numTxt(ln.s) + '%') : null));
            })) : h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('pay_no_kpi')))),
        h('aside', { className: 'pay-side' },
          h(PayResult, { t: t, lang: p.lang, ym: ym, r: r, snap: snap }),
          h('section', { className: 'box pay-save' },
            h(Field, { name: 'pay-note', label: t('pay_note'), multiline: true, rows: 2, value: noteS[0], onChange: noteS[1] }),
            h(Btn, { variant: 'primary', arrow: true, block: true, disabled: n >= PAY_MAX, onClick: save }, t('pay_save')),
            h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, n >= PAY_MAX ? tpl(t('pay_max'), { n: PAY_MAX }) : t('pay_disclaimer'))))),
      h(PayHistory, { t: t, lang: p.lang, list: hist, open: openS }));
  }
  /* the result card: the total counts up, the parts and «how it was counted» */
  function PayResult(p) {
    var t = p.t, r = p.r, shown = useTween(r.total), kp = {};
    p.snap.kpis.forEach(function (k) { kp[k.id] = k; });
    return h('section', { className: 'pay-result', 'aria-live': 'polite' },
      h('span', { className: 'lor-eyebrow' }, t('pay_result') + ' · ' + ymLabel(p.ym, p.lang)),
      h('div', { className: 'pay-total' }, h('b', null, money(shown)), h('span', null, t('pay_cur'))),
      h('div', { className: 'pay-split' },
        h('div', null, h('small', null, t('pay_fixed')), h('b', null, money(r.fixed))),
        h('div', null, h('small', null, t('pay_kpi_sum')), h('b', null, (r.kpi > 0 ? '+' : '') + money(r.kpi))),
        r.pct != null ? h('div', null, h('small', null, t('pay_kpi_pct')), h('b', null, r.pct + '%')) : null),
      h('details', { className: 'pay-howbox' }, h('summary', null, t('pay_how')),
        h('ul', null, r.lines.map(function (ln) { var k = kp[ln.k]; return h('li', { key: ln.k }, h('span', null, k.name), h('span', null, payHow(k, ln, p.snap.base, t))); }))));
  }
  /* own history: when, for which month, how much, status and the SOP manager's answer */
  function PayHistory(p) {
    var t = p.t, open = p.open;
    return h('section', { className: 'box pay-hist' },
      h('div', { className: 'box-row', style: { marginTop: 0 } }, h('h2', { className: 'lor-h' }, t('pay_hist')), h('span', { className: 'lor-count' }, p.list.length)),
      p.list.length ? h('ul', { className: 'pay-hlist' }, p.list.map(function (c) {
        var on = open[0] === c.id;
        return h('li', { key: c.id, className: cx('pay-hitem', on && 'is-open') },
          h('button', { type: 'button', className: 'pay-hrow', 'aria-expanded': on, onClick: function () { open[1](on ? null : c.id); } },
            h('span', { className: 'pay-hwhen' }, fmtDT(c.at)), h('span', null, ymLabel(c.ym, p.lang)),
            h('b', null, sumTxt(c.total, t)), h('span', { className: 'lor-muted' }, (c.tries || []).length > 1 ? tpl(t('pay_tries_n'), { n: c.tries.length }) : c.pct != null ? 'KPI ' + c.pct + '%' : ''), h(PayStatus, { s: c.status, t: t })),
          on ? h('div', { className: 'pay-hbody' },
            h(PayLines, { t: t, c: c }),
            h(PayTries, { t: t, c: c }),
            c.note ? h('p', { className: 'lor-sm', style: { margin: 0 } }, h('b', null, t('pay_note_l') + ': '), c.note) : null,
            c.reply ? h('p', { className: 'lor-sm pay-reply', style: { margin: 0 } }, h('b', null, t('pay_reply') + ': '), c.reply) : null) : null);
      })) : h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('pay_hist_none')));
  }
  function fmtDT(ts) { var d = new Date(ts); return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }

  /* the SOP manager: history of everyone's calculations, the terms, per-person terms */
  function PayAdmin(p) {
    var t = p.t, db = p.db, tab = useState(p.tab || 'hist'), calcs = db.payCalcs || [], schemes = (db.pay && db.pay.schemes) || [];
    var wait = calcs.filter(function (c) { return c.status === 'saved'; }).length;
    return h('div', { className: 'app-wrap' },
      h('div', { className: 'page-head' }, h('div', null, h('span', { className: 'lor-eyebrow' }, t('pay_eyebrow')), h('h1', { className: 'lor-title' }, t('pay_admin_title'), h(PageTip, { t: t, id: 'apay' })))),
      h('div', { className: 'lor-tabs fb-tabs', role: 'tablist' }, [['hist', t('pay_tab_hist'), wait], ['schemes', t('pay_tab_schemes'), schemes.length], ['people', t('pay_tab_people'), null]].map(function (x) {
        return h('button', { key: x[0], type: 'button', role: 'tab', 'aria-selected': tab[0] === x[0], className: cx('lor-tab', tab[0] === x[0] && 'is-on'), onClick: function () { tab[1](x[0]); } }, x[1], x[2] != null ? h('span', { className: 'lor-count' }, x[2]) : null);
      })),
      tab[0] === 'schemes' ? h(PaySchemes, p) : tab[0] === 'people' ? h(PayPeople, p) : h(PayHistAdmin, p));
  }
  function payNotify(d, c, s, reply) {
    d.notifications.unshift({ id: nextId(d), userId: c.uid, kind: 'pay', route: 'pay', pay: { s: s, ym: c.ym, total: c.total, reply: reply || null }, at: Date.now(), read: false });
  }
  /* who calculated what and how — a timeline by day; approve or return with a comment */
  function PayHistAdmin(p) {
    var t = p.t, db = p.db, fu = useState(''), fm = useState(''), fs = useState(''), open = useState(null), rep = useState('');
    var all = (db.payCalcs || []).slice().sort(function (a, b) { return b.at - a.at; });
    var months = all.map(function (c) { return c.ym; }).filter(function (m, i, a) { return a.indexOf(m) === i; });
    var people = all.map(function (c) { return c.uid; }).filter(function (m, i, a) { return a.indexOf(m) === i; });
    var list = all.filter(function (c) { return (!fu[0] || String(c.uid) === fu[0]) && (!fm[0] || c.ym === fm[0]) && (!fs[0] || c.status === fs[0]); });
    var tries = function (c) { return Math.max(1, (c.tries || []).length); };
    /* who calculated how much — for the chosen month: calculations (every try), sent, the last one */
    var who = {};
    all.filter(function (c) { return !fm[0] || c.ym === fm[0]; }).forEach(function (c) {
      var w = who[c.uid] = who[c.uid] || { uid: c.uid, n: 0, sent: 0, last: 0, total: 0 }, at = Math.max(c.at, ((c.tries || [])[(c.tries || []).length - 1] || {}).at || 0);
      w.n += tries(c); if (c.status !== 'draft') w.sent++;
      if (at > w.last) { w.last = at; w.total = c.total; }
    });
    var whoList = Object.keys(who).map(function (k) { return who[k]; }).sort(function (a, b) { return b.last - a.last; });
    var days = [];
    list.forEach(function (c) { var k = dayKey(c.at); if (!days.length || days[days.length - 1].k !== k) days.push({ k: k, items: [] }); days[days.length - 1].items.push(c); });
    function decide(c, s) {
      var reply = rep[0].trim();
      p.update(function (d) { (d.payCalcs || []).forEach(function (x) { if (x.id === c.id) { x.status = s; x.by = p.user.id; x.repliedAt = Date.now(); if (reply) x.reply = reply; else delete x.reply; } }); payNotify(d, c, s, reply); });
      rep[1](''); p.say(t(s === 'approved' ? 'pay_ok_done' : 'pay_back_done'));
    }
    function excel() {
      var a = [['Sana', 'Xodim', 'Lavozim', 'Oy', 'Belgilangan maosh', 'KPI', 'Jami', 'KPI, %', 'Holat', 'Hisob-kitoblar', 'Izoh', 'SOP menejeri javobi']], b = [['Sana', 'Xodim', 'Oy', 'Ko‘rsatkich', 'Manba', 'Fakt', 'Bajarilish, %', 'Summa']], tr = [['Vaqt', 'Xodim', 'Oy', 'Holat', 'Faktlar', 'Jami']], tu = T('uz');
      list.forEach(function (c) {
        var w = userOf(db, c.uid), kp = {};
        (c.scheme.kpis || []).forEach(function (k) { kp[k.id] = k; });
        a.push([fmtDT(c.at), w.name, w.position || '', c.ym, c.fixed, c.kpi, c.total, c.pct != null ? c.pct : '', tu('pay_st_' + c.status), tries(c), c.note || '', c.reply || '']);
        (c.tries || []).forEach(function (y) { tr.push([fmtDT(y.at), w.name, c.ym, tu('pay_st_' + c.status), (c.scheme.kpis || []).filter(function (k) { return k.src === 'manual'; }).map(function (k) { return k.name + ': ' + ((y.inputs || {})[k.id] || 0); }).join('; '), y.total]); });
        (c.lines || []).forEach(function (ln) { var k = kp[ln.k] || {}; b.push([fmtDT(c.at), w.name, c.ym, k.name || ln.k, tu('pay_src_' + (k.src || 'manual')), ln.f, ln.s != null ? ln.s : '', ln.a]); });
      });
      downloadBlob('buraq-maosh-' + dayKey(Date.now()) + '.xlsx', makeXlsx([{ name: 'Hisoblar', rows: a }, { name: 'Qatorlar', rows: b }, { name: 'Hisob-kitoblar', rows: tr }]));
    }
    var sel = function (v, set, opts, label) { return h('label', { className: 'pay-filter' }, h('span', { className: 'lor-eyebrow' }, label), h('select', { className: 'lor-input slim', value: v, onChange: function (e) { set(e.target.value); } }, h('option', { value: '' }, t('pay_f_all')), opts)); };
    return h(F, null,
      h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('pay_hist_hint')),
      h('div', { className: 'tiles' },
        [[t('pay_tile_n'), list.reduce(function (s, c) { return s + tries(c); }, 0)], [t('pay_tile_people'), list.map(function (c) { return c.uid; }).filter(function (m, i, a) { return a.indexOf(m) === i; }).length],
          [t('pay_tile_wait'), list.filter(function (c) { return c.status === 'saved'; }).length], [t('pay_tile_ok'), list.filter(function (c) { return c.status === 'approved'; }).length]]
          .map(function (x) { return h('div', { key: x[0], className: 'tile' }, h('span', { className: 'lor-eyebrow' }, x[0]), h('b', null, x[1])); })),
      h('div', { className: 'pay-filters' },
        sel(fu[0], fu[1], people.map(function (id) { return h('option', { key: id, value: String(id) }, userOf(db, id).name); }), t('pay_f_emp')),
        sel(fm[0], fm[1], months.map(function (m) { return h('option', { key: m, value: m }, ymLabel(m, p.lang)); }), t('pay_month')),
        sel(fs[0], fs[1], ['saved', 'approved', 'rejected', 'draft'].map(function (s) { return h('option', { key: s, value: s }, t('pay_st_' + s)); }), t('pay_f_status')),
        h('span', { style: { flex: 1 } }),
        list.length ? h(Btn, { variant: 'secondary', size: 'sm', onClick: excel }, t('imp_x_export')) : null),
      whoList.length ? h('section', { className: 'box', style: { padding: 0 } },
        h('h2', { className: 'lor-h pay-who-h' }, t('pay_who_t') + (fm[0] ? ' · ' + ymLabel(fm[0], p.lang) : '')),
        h('div', { className: 'lor-table-wrap' }, h('table', { className: 'lor-table pay-who' },
          h('thead', null, h('tr', null, [t('fio'), t('pay_col_tries'), t('pay_col_saved'), t('pay_col_last'), t('pay_col_sum')].map(function (x, i) { return h('th', { key: i }, x); }))),
          h('tbody', null, whoList.map(function (w) {
            var x = userOf(db, w.uid);
            return h('tr', { key: w.uid, className: cx(String(w.uid) === fu[0] && 'is-on') },
              h('td', null, h('button', { type: 'button', className: 'pay-who-b', onClick: function () { fu[1](String(w.uid) === fu[0] ? '' : String(w.uid)); } }, h(Av, { name: x.name, src: x.avatar, size: 28 }), h('span', null, x.name, h('small', null, x.position || '')))),
              h('td', null, h('b', null, w.n)), h('td', null, w.sent), h('td', null, fmtDT(w.last)), h('td', null, sumTxt(w.total, t)));
          }))))) : null,
      days.length ? days.map(function (g) {
        return h('section', { key: g.k, className: 'box pay-day' },
          h('span', { className: 'lor-eyebrow' }, fmtDT(keyDate(g.k).getTime()).slice(0, 10)),
          h('ul', { className: 'pay-tl' }, g.items.map(function (c) {
            var w = userOf(db, c.uid), on = open[0] === c.id;
            return h('li', { key: c.id, className: cx('pay-tli', on && 'is-open') },
              h('button', { type: 'button', className: 'pay-tlrow', 'aria-expanded': on, onClick: function () { open[1](on ? null : c.id); rep[1](''); } },
                h(Av, { name: w.name, src: w.avatar, size: 34 }),
                h('span', { className: 'pay-tlwho' }, h('b', null, w.name), ' ', h('span', { className: 'lor-muted' }, tpl(t('pay_calced'), { m: ymLabel(c.ym, p.lang, true) })),
                  h('small', null, (w.position || '') + ' · ' + fmtDT(c.at).slice(11) + ((c.tries || []).length > 1 ? ' · ' + tpl(t('pay_tries_n'), { n: c.tries.length }) : '') + (c.note ? ' · «' + c.note + '»' : ''))),
                h('span', { className: 'pay-tlsum' }, h('b', null, sumTxt(c.total, t)), c.pct != null ? h('small', null, 'KPI ' + c.pct + '%') : null),
                h(PayStatus, { s: c.status, t: t })),
              on ? h('div', { className: 'pay-hbody' },
                h(PayLines, { t: t, c: c, db: db, u: w, check: true }),
                h(PayTries, { t: t, c: c }),
                c.status === 'draft' ? h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('pay_draft_note'))
                : c.status === 'saved' && lvlOf(p.user) !== 'ceo' ? h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('pay_wait_ceo'))
                : c.status === 'saved' ? h('div', { className: 'pay-decide' },
                  h(Field, { name: 'pay-rep', label: t('pay_reply'), multiline: true, rows: 2, placeholder: t('pay_reply_ph'), value: rep[0], onChange: rep[1] }),
                  h('div', { className: 'box-row' },
                    h(Btn, { variant: 'ghost', size: 'sm', onClick: function () { decide(c, 'rejected'); } }, t('pay_reject')),
                    h(Btn, { variant: 'primary', size: 'sm', arrow: true, onClick: function () { decide(c, 'approved'); } }, t('pay_approve'))))
                  : h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, tpl(t('pay_decided'), { s: t('pay_st_' + c.status), d: c.repliedAt ? fmtDT(c.repliedAt) : '' }) + (c.reply ? ' — ' + c.reply : ''))) : null);
          })));
      }) : h('section', { className: 'box pay-empty' }, h('p', { style: { margin: 0 } }, all.length ? t('pay_f_none') : t('pay_hist_none_all'))));
  }
  /* the terms: per positions — fixed, KPI bonus at 100 %, the indicators */
  function payKpi() { return { id: 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: '', unit: '', src: 'manual', type: 'plan', plan: 100, w: 100, min: 0, cap: 100 }; }
  function PaySchemes(p) {
    var t = p.t, db = p.db, list = (db.pay && db.pay.schemes) || [], ed = useState(null), er = useState('');
    var allPos = STAFF_POS.concat(db.users.filter(function (u) { return u.role === 'employee' && u.position; }).map(function (u) { return u.position; })).filter(function (x, i, a) { return a.indexOf(x) === i; });
    function users(s) { return db.users.filter(function (u) { var m = u.role === 'employee' && LmsPay.schemeFor(db.pay, u); return m && m.scheme.id === s.id; }); }
    function save() {
      var s = ed[0];
      if (!s.title.trim()) { er[1](t('fill_required')); return; }
      var clean = Object.assign({}, s, { title: s.title.trim(), fixed: payNum(s.fixed), base: payNum(s.base), kpis: s.kpis.filter(function (k) { return k.name.trim(); }).map(function (k) {
        var o = { id: k.id, name: k.name.trim(), unit: (k.unit || '').trim(), src: k.src, type: k.type };
        if (k.type === 'plan') { o.plan = payNum(k.plan); o.w = payNum(k.w); o.min = payNum(k.min); o.cap = payNum(k.cap) || 100; }
        else if (k.type === 'unit') o.rate = payNum(k.rate);
        else { o.plan = payNum(k.plan); o.amount = payNum(k.amount); }
        if (k.type !== 'unit' && k.less) o.less = true;
        return o;
      }) });
      p.update(function (d) {
        d.pay = d.pay || { schemes: [], people: {} }; d.pay.schemes = d.pay.schemes || [];
        var i = d.pay.schemes.map(function (x) { return x.id; }).indexOf(clean.id);
        if (i >= 0) d.pay.schemes[i] = clean; else d.pay.schemes.push(clean);
      });
      ed[1](null); er[1](''); p.say(t('pay_s_saved'));
    }
    function del(s) { if (!window.confirm(t('pay_s_del_q'))) return; p.update(function (d) { d.pay.schemes = d.pay.schemes.filter(function (x) { return x.id !== s.id; }); }); }
    if (ed[0]) {
      var s = ed[0], set = function (k, v) { var o = Object.assign({}, s); o[k] = v; ed[1](o); };
      var setK = function (i, k, v) { var ks = s.kpis.slice(); ks[i] = Object.assign({}, ks[i]); ks[i][k] = v; if (k === 'src' && v !== 'manual' && !ks[i].unit) ks[i].unit = t('pay_u_' + v); set('kpis', ks); };
      var snap = LmsPay.snapshot(Object.assign({}, s, { kpis: s.kpis.filter(function (k) { return k.name.trim(); }) })), ex = {};
      snap.kpis.forEach(function (k) { ex[k.id] = k.type === 'unit' ? 0 : k.plan; });
      var wsum = snap.kpis.filter(function (k) { return k.type === 'plan'; }).reduce(function (a, k) { return a + k.w; }, 0), hasPlan = snap.kpis.some(function (k) { return k.type === 'plan'; });
      var num = function (name, label, v, on) { return h(Field, { name: name, label: label, type: 'number', value: v, onChange: on }); };
      return h('section', { className: 'box pay-editor' },
        h('h2', { className: 'lor-h' }, list.some(function (x) { return x.id === s.id; }) ? t('pay_s_edit') : t('pay_new')),
        h('div', { className: 'pay-ed-grid' },
          h(Field, { name: 'pay-title', label: t('pay_s_title'), required: true, value: s.title, error: er[0], placeholder: t('pay_s_title_ph'), onChange: function (v) { set('title', v); } }),
          num('pay-fixed', t('pay_fixed') + ', ' + t('pay_cur'), s.fixed, function (v) { set('fixed', v); }),
          num('pay-base', t('pay_base') + ', ' + t('pay_cur'), s.base, function (v) { set('base', v); })),
        h('div', { className: 'lor-field' }, h('span', { className: 'lor-field-label' }, t('pay_s_pos')),
          h('div', { className: 'ac-chips' }, allPos.map(function (x) { var on = (s.positions || []).indexOf(x) >= 0; return h('button', { key: x, type: 'button', className: cx('ac-chip', on && 'is-on'), 'aria-pressed': on, onClick: function () { set('positions', on ? s.positions.filter(function (y) { return y !== x; }) : (s.positions || []).concat([x])); } }, x); }))),
        h(Field, { name: 'pay-snote', label: t('pay_s_note'), value: s.note || '', placeholder: t('pay_s_note_ph'), onChange: function (v) { set('note', v); } }),
        h('h3', { className: 'wz-sub' }, t('pay_kpis')),
        h('ol', { className: 'pay-ed-kpis' }, s.kpis.map(function (k, i) {
          var f = function (key, label, v, extra) { return h(Field, Object.assign({ key: key, name: 'pk-' + i + '-' + key, label: label, value: v, onChange: function (x) { setK(i, key, x); } }, extra || {})); };
          return h('li', { key: k.id, className: 'pay-ed-kpi' },
            h('div', { className: 'pay-ed-row' },
              f('name', t('pay_k_name'), k.name, { placeholder: t('pay_k_name_ph') }),
              f('src', t('pay_k_src'), k.src, { options: PAY_SRC.map(function (x) { return [x, t('pay_src_' + x)]; }) }),
              f('type', t('pay_k_type'), k.type, { options: LmsPay.TYPES.map(function (x) { return [x, t('pay_t_' + x)]; }) }),
              f('unit', t('pay_k_unit'), k.unit, { placeholder: t('pay_k_unit_ph') })),
            h('div', { className: 'pay-ed-row is-params' },
              k.type === 'unit' ? f('rate', t('pay_k_rate'), k.rate, { type: 'number', hint: t('pay_k_rate_h') })
                : f('plan', t(k.type === 'bonus' ? 'pay_k_cond' : 'pay_k_plan'), k.plan, { type: 'number' }),
              k.type === 'plan' ? f('w', t('pay_k_w'), k.w, { type: 'number' }) : null,
              k.type === 'plan' ? f('min', t('pay_k_min'), k.min, { type: 'number', hint: t('pay_k_min_h') }) : null,
              k.type === 'plan' ? f('cap', t('pay_k_cap'), k.cap, { type: 'number' }) : null,
              k.type === 'bonus' ? f('amount', t('pay_k_amount') + ', ' + t('pay_cur'), k.amount, { type: 'number' }) : null,
              k.type !== 'unit' ? h('label', { className: 'check pay-less' }, h('input', { type: 'checkbox', checked: !!k.less, onChange: function (e) { setK(i, 'less', e.target.checked); } }), t('pay_k_less')) : null,
              h('button', { type: 'button', className: 'app-link pay-ed-del', onClick: function () { set('kpis', s.kpis.filter(function (_, j) { return j !== i; })); } }, t('remove'))),
            snap.kpis.filter(function (x) { return x.id === k.id; }).map(function (x) { return h('p', { key: 'r', className: 'lor-sm lor-muted', style: { margin: 0 } }, '→ ' + payRule(x, t)); }));
        })),
        h('div', { className: 'box-row' },
          h(Btn, { variant: 'secondary', size: 'sm', onClick: function () { set('kpis', s.kpis.concat([payKpi()])); } }, '+ ' + t('pay_kpi_add')),
          hasPlan ? h('span', { className: cx('lor-sm', wsum !== 100 ? 'pay-warn' : 'lor-muted') }, tpl(t('pay_wsum'), { n: numTxt(wsum) }) + (wsum !== 100 ? ' ' + t('pay_wsum_bad') : ' ✓')) : null),
        h('p', { className: 'pay-example' }, tpl(t('pay_example'), { x: sumTxt(LmsPay.calc(snap, payNum(s.fixed), ex).total, t) })),
        h('div', { className: 'box-row' },
          h(Btn, { variant: 'ghost', size: 'sm', onClick: function () { ed[1](null); er[1](''); } }, t('cancel')),
          h(Btn, { variant: 'primary', arrow: true, onClick: save }, t('save'))));
    }
    return h(F, null,
      h('div', { className: 'box-row', style: { marginTop: 0 } },
        h('p', { className: 'lor-sm lor-muted', style: { margin: 0, maxWidth: 720 } }, t('pay_schemes_hint')),
        lvlOf(p.user) !== 'ceo' ? null : h(Btn, { variant: 'primary', size: 'sm', arrow: true, onClick: function () { ed[1]({ id: 'ps' + Date.now().toString(36), title: '', positions: [], fixed: '', base: '', note: '', kpis: [payKpi()] }); } }, t('pay_new'))),
      list.length ? h('div', { className: 'pay-cards' }, list.map(function (s) {
        var us = users(s), snap = LmsPay.snapshot(s);
        return h('section', { key: s.id, className: 'box pay-card' },
          h('div', { className: 'box-row', style: { marginTop: 0 } }, h('h2', { className: 'lor-h' }, s.title), h('span', { className: 'lor-count' }, tpl(t('pay_s_users'), { n: us.length }))),
          (s.positions || []).length ? h('div', { className: 'ac-chips' }, s.positions.map(function (x) { return h('span', { key: x, className: 'ac-chip is-static' }, x); })) : h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('pay_s_nopos')),
          h('div', { className: 'pay-tiles' },
            h('div', { className: 'tile' }, h('span', { className: 'lor-eyebrow' }, t('pay_fixed')), h('b', { className: 'tile-sm' }, sumTxt(s.fixed, t))),
            h('div', { className: 'tile' }, h('span', { className: 'lor-eyebrow' }, t('pay_base')), h('b', { className: 'tile-sm' }, sumTxt(s.base, t)))),
          h('ul', { className: 'pay-rules' }, snap.kpis.map(function (k) { return h('li', { key: k.id }, h('b', null, k.name), h('span', { className: 'lor-sm lor-muted' }, (k.src !== 'manual' ? t('pay_src_' + k.src) + ' · ' : '') + payRule(k, t))); })),
          lvlOf(p.user) !== 'ceo' ? null : h('div', { className: 'box-row' },
            h('button', { type: 'button', className: 'app-link danger', onClick: function () { del(s); } }, t('remove')),
            h(Btn, { variant: 'secondary', size: 'sm', onClick: function () { ed[1](JSON.parse(JSON.stringify(Object.assign({ note: '' }, s)))); } }, t('pay_s_edit'))));
      })) : h('section', { className: 'box pay-empty' }, h('p', { style: { margin: 0 } }, t('pay_s_none'))));
  }
  /* per person: another scheme than the position's, own fixed salary */
  function PayPeople(p) {
    var t = p.t, db = p.db, pay = db.pay || {}, schemes = pay.schemes || [], ym = ymOf(Date.now()), ro = lvlOf(p.user) !== 'ceo';
    var emps = db.users.filter(function (u) { return u.role === 'employee'; });
    function setP(uid, k, v) {
      p.update(function (d) {
        d.pay = d.pay || { schemes: [], people: {} }; d.pay.people = d.pay.people || {};
        var o = Object.assign({}, d.pay.people[uid] || {});
        if (v === '' || v == null) delete o[k]; else o[k] = k === 'fixed' ? payNum(v) : v;
        if (Object.keys(o).length) d.pay.people[uid] = o; else delete d.pay.people[uid];
      });
    }
    return h(F, null,
      h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('pay_people_hint')),
      h('section', { className: 'box', style: { padding: 0 } }, h('div', { className: 'lor-table-wrap' }, h('table', { className: 'lor-table pay-people' },
        h('thead', null, h('tr', null, [t('fio'), t('pay_k_scheme'), t('pay_fixed'), ymLabel(ym, p.lang)].map(function (x, i) { return h('th', { key: i }, x); }))),
        h('tbody', null, emps.map(function (u) {
          var own = (pay.people || {})[u.id] || {}, m = LmsPay.schemeFor(pay, u), byPos = LmsPay.schemeFor({ schemes: schemes, people: {} }, u);
          var last = (db.payCalcs || []).filter(function (c) { return c.uid === u.id && c.ym === ym; }).sort(function (a, b) { return b.at - a.at; })[0];
          return h('tr', { key: u.id },
            h('td', null, h('div', { className: 'lor-emp' }, h(Av, { name: u.name, src: u.avatar, size: 32 }), h('span', null, u.name, h('small', null, u.position)))),
            h('td', null, h('select', { className: 'lor-input slim', 'aria-label': t('pay_k_scheme'), value: own.schemeId || '', disabled: ro, onChange: function (e) { setP(u.id, 'schemeId', e.target.value); } },
              h('option', { value: '' }, byPos ? tpl(t('pay_by_pos'), { x: byPos.scheme.title }) : t('pay_no_scheme')),
              schemes.map(function (s) { return h('option', { key: s.id, value: s.id }, s.title); }))),
            h('td', null, h('input', { className: 'lor-input slim pay-fix-in', type: 'number', 'aria-label': t('pay_fixed'), placeholder: m ? money(m.scheme.fixed) : '—', disabled: !m || ro, defaultValue: own.fixed != null ? own.fixed : '', key: 'f' + (own.fixed != null ? own.fixed : ''), onBlur: function (e) { var v = e.target.value.trim(); if (String(own.fixed != null ? own.fixed : '') !== v) setP(u.id, 'fixed', v); } }),
              m && own.fixed != null ? h('small', { className: 'lor-muted', style: { display: 'block' } }, t('pay_fixed_own')) : null),
            h('td', null, last ? h('span', null, h('b', null, sumTxt(last.total, t)), ' ', h(PayStatus, { s: last.status, t: t })) : h('span', { className: 'lor-muted' }, '—')));
        }))))));
  }

  function MyIdeas(p) {
    var t = p.t, db = p.db, u = p.user;
    var list = (db.initiatives || []).filter(function (x) { return x.uid === u.id; }).sort(function (a, b) { return b.at - a.at; });
    var ok = list.filter(function (x) { return x.status === 'accepted' || x.status === 'done'; });
    var xp = ok.reduce(function (s, x) { return s + XP_INI_OK + (x.status === 'done' ? XP_INI_DONE : 0); }, 0);
    return h('div', { className: 'app-wrap' },
      h('div', { className: 'page-head' },
        h('div', null, h('span', { className: 'lor-eyebrow' }, t('ini_eyebrow')), h('h1', { className: 'lor-title' }, t('ini_my'), h(PageTip, { t: t, id: 'ideas' }))),
        h('button', { type: 'button', className: 'ini-btn big', onClick: p.onNew }, h(Ico, { name: 'bulb', size: 18, w: 1.8 }), h('span', null, t('ini_new')))),
      h('div', { className: 'tiles' },
        [[t('ini_t_sent'), list.length], [t('ini_t_review'), list.filter(function (x) { return x.status === 'new' || x.status === 'review'; }).length], [t('ini_t_ok'), list.filter(function (x) { return x.status === 'accepted' || x.status === 'done'; }).length], [t('ini_t_xp'), '+' + xp]].map(function (x) { return h('div', { key: x[0], className: 'tile' }, h('span', { className: 'lor-eyebrow' }, x[0]), h('b', null, x[1])); })),
      list.length ? list.map(function (x) { return h(IniItem, { key: x.id, x: x, t: t, db: db, lang: p.lang }); })
        : h('section', { className: 'box ini-empty' }, h('span', { className: 'ini-card-ico', 'aria-hidden': true }, h(Ico, { name: 'bulb', size: 26, w: 1.8 })), h('p', { style: { margin: 0 } }, t('ini_empty'))),
      h('section', { className: 'box' }, h('span', { className: 'lor-eyebrow' }, t('ini_how')),
        h('ol', { className: 'ini-flow' }, ['new', 'review', 'accepted', 'done'].map(function (s) { return h('li', { key: s }, h(IniStatus, { s: s, t: t, lang: p.lang }), h('span', { className: 'lor-sm lor-muted' }, t('is_' + s + '_d'))); })),
        h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, tpl(t('ini_xp_note'), { a: XP_INI_OK, b: XP_INI_DONE }))));
  }

  /* the reviewer's list: a recipient (CEO, PM, Boss) — the initiatives sent to them; the SOP manager — old ones without a recipient */
  function IniAdmin(p) {
    var only = p.only || function (x) { return !iniTo(x).length; };
    var t = p.t, db = p.db, all = (db.initiatives || []).filter(only).sort(function (a, b) { return b.at - a.at; });
    var fs = useState('open'), fty = useState(''), far = useState(''), ai = useState(''), aiBusy = useState(false), aiE = useState('');
    var SEG = [['open', t('ini_f_open')], ['new', t('is_new')], ['review', t('is_review')], ['accepted', t('is_accepted')], ['done', t('is_done')], ['declined', t('is_declined')], ['all', t('all')]];
    function inSeg(x, s) { return s === 'all' ? true : s === 'open' ? (x.status === 'new' || x.status === 'review') : x.status === s; }
    var list = all.filter(function (x) { return inSeg(x, fs[0]) && (!fty[0] || x.type === fty[0]) && (!far[0] || x.area === far[0]); });
    function summarize() {
      if (!p.sampler || aiBusy[0]) return;
      var prompt = 'Siz BURAQ Logistics rahbariyati uchun tahlilchisiz. Quyida xodimlarning tashabbuslari (muammolar, g‘oyalar, foydali takliflar). Qisqa tahlil yozing (markdown, 220 so‘zgacha):\n## Asosiy mavzular\n## Tezkor yutuqlar (kam xarajat, tez natija)\n## Katta loyihalar\n## Keyingi qadamlar\nHar bir fikrda tegishli tashabbus sarlavhasini qavsda keltiring. Faqat berilgan matnga tayaning, anonim mualliflarni aniqlashga urinmang. Til: ' + (LANG_NAME[p.lang] || LANG_NAME.uz) + '.\n\nTASHABBUSLAR (JSON):\n' + JSON.stringify(all.map(function (x) { return { type: x.type, area: x.area, title: x.title, text: x.text, benefit: x.benefit, status: x.status }; }));
      ai[1](''); aiE[1](''); aiBusy[1](true);
      p.sampler(prompt, { onText: function (x) { ai[1](x.text); } }).then(function (r) { ai[1](r.text); }).catch(function (e) { if (e && e.text) ai[1](e.text); aiE[1](aiErr(e, t)); }).then(function () { aiBusy[1](false); });
    }
    var routed = p.only ? [] : (db.initiatives || []).filter(function (x) { return iniTo(x).length; });
    return h(F, null,
      p.only ? null : h('section', { className: 'box ini-routed' },
        h('span', { className: 'lor-eyebrow' }, t('fb_routed_t')),
        h('p', { className: 'lor-sm', style: { margin: 0 } }, t('fb_routed_p')),
        h('div', { className: 'ini-routed-list' }, INI_TO.map(function (x) {
          var mine = routed.filter(function (y) { return iniTo(y).indexOf(x) >= 0; }), who = leadersOf(db, x).map(function (l) { return l.name; }).join(', ');
          return h('div', { key: x, className: 'ini-routed-i' }, h('b', null, t('ini_to_' + x)), h('span', { className: 'lor-sm lor-muted' }, who || t('ld_none')),
            h('span', { className: 'lor-sm' }, tpl(t('fb_routed_n'), { n: mine.length, m: mine.filter(function (y) { return y.status === 'new'; }).length })));
        }))),
      h('div', { className: 'tiles' },
        [['new', t('is_new')], ['review', t('is_review')], ['accepted', t('is_accepted')], ['done', t('is_done')]].map(function (x) { return h('div', { key: x[0], className: 'tile' }, h('span', { className: 'lor-eyebrow' }, x[1]), h('b', null, all.filter(function (y) { return y.status === x[0]; }).length)); })),
      h('div', { className: 'seg', role: 'tablist' }, SEG.map(function (x) { var n = all.filter(function (y) { return inSeg(y, x[0]); }).length; return h('button', { key: x[0], type: 'button', role: 'tab', 'aria-selected': fs[0] === x[0], className: fs[0] === x[0] ? 'is-on' : '', onClick: function () { fs[1](x[0]); } }, x[1] + ' · ' + n); })),
      h('div', { className: 'filters' },
        h(Field, { name: 'ini-fty', label: t('ini_type'), value: fty[0], options: [['', t('all')]].concat(INI_TYPES.map(function (x) { return [x, t('it_' + x)]; })), onChange: fty[1] }),
        h(Field, { name: 'ini-far', label: t('ini_area'), value: far[0], options: [['', t('all')]].concat(INI_AREAS.map(function (x) { return [x, t('ia_' + x)]; })), onChange: far[1] })),
      h('section', { className: 'box ai-box' },
        h('div', { className: 'chart-head' }, h('div', null, h('h2', { className: 'lor-h' }, t('ini_ai_sum')), h('p', { className: 'lor-sm lor-muted', style: { margin: '4px 0 0' } }, t('ini_ai_sum_hint'))),
          h(Btn, { variant: 'secondary', size: 'sm', disabled: !p.sampler || aiBusy[0] || !all.length, onClick: summarize }, aiBusy[0] ? t('ai_thinking') : '✦ ' + t('ini_ai_sum_btn'))),
        p.sampler === null ? h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('ai_unavail')) : null,
        aiBusy[0] && !ai[0] ? h('p', { className: 'ai-thinking' }, t('ai_thinking')) : null,
        ai[0] ? h('div', { className: 'ai-md', dangerouslySetInnerHTML: { __html: mdLite(ai[0]) } }) : null,
        aiE[0] ? h('p', { className: 'lor-field-error' }, aiE[0]) : null),
      list.length ? list.map(function (x) { return h(IniItem, { key: x.id, x: x, t: t, db: db, lang: p.lang, admin: true, update: p.update, say: p.say, post: p.user && p.user.post && iniTo(x).indexOf(p.user.post) >= 0 ? p.user.post : null }); })
        : h('section', { className: 'box' }, h('p', { className: 'lor-muted', style: { margin: 0 } }, t('ini_none_rows'))));
  }

  /* admin · “Fikrlar” page: initiatives + pulse surveys */
  function FeedbackAdmin(p) {
    var t = p.t, db = p.db, tb = useState(p.tab || 'ini'), tab = tb[0];
    useEffect(function () { if (p.tab) tb[1](p.tab); }, [p.tab]);
    var post = p.user.post, only = post ? function (x) { var to = iniTo(x); return !to.length || to.indexOf(post) >= 0; } : null;   // CEO, the owner: also the ideas sent to them
    var nNew = (db.initiatives || []).filter(function (x) { return (only ? only(x) : !iniTo(x).length) && x.status === 'new'; }).length;
    return h('div', { className: 'app-wrap' },
      h('div', { className: 'page-head' }, h('div', null, h('span', { className: 'lor-eyebrow' }, t('fb_eyebrow')), h('h1', { className: 'lor-title' }, t('nav_feedback'), h(PageTip, { t: t, id: 'feedback' })))),
      h('div', { className: 'lor-tabs fb-tabs', role: 'tablist' },
        [['ini', t('fb_tab_ini'), nNew], ['pulse', t('fb_tab_pulse'), (db.surveys || []).filter(function (s) { return s.at > Date.now() - 7 * DAY; }).length]].map(function (x) {
          return h('button', { key: x[0], type: 'button', role: 'tab', 'aria-selected': tab === x[0], className: cx('lor-tab', tab === x[0] && 'is-on'), onClick: function () { tb[1](x[0]); } }, x[1], h('span', { className: 'lor-count' }, x[2]));
        })),
      tab === 'pulse' ? h(PulseAdmin, p) : h(IniAdmin, only ? Object.assign({}, p, { only: only }) : p));
  }

  /* ======================= FEATURES 3: error log · AI drills · SOP updates ======================= */

  function isMentor(u) { return !!u && (u.role === 'admin' || !!u.mentor); }
  function mentorList(db) { return db.users.filter(isMentor); }
  function lessonTitle(db, id) { var l = id ? findLesson(db.course, id) : null; return l ? l.title : ''; }
  function qNotify(d, uid, kind, payload, route) { d.notifications.unshift(Object.assign({ id: nextId(d), userId: uid, kind: kind, text: '', route: route || 'tasks', at: Date.now(), read: false }, payload)); }
  function days(ms) { return Math.round(ms / DAY); }
  function dueLabel(ts, t) {
    var left = ts - Date.now();
    if (left < 0) return { cls: 'over', s: tpl(t('due_over'), { n: Math.max(1, days(-left)) }) };
    if (left < DAY) return { cls: 'soon', s: t('due_today') };
    return { cls: '', s: tpl(t('due_in'), { n: days(left) }) };
  }

  /* ======================= 1. ERROR LOG (xatolar jurnali) ======================= */
  var ERR_CATS = ['doc', 'mark', 'data', 'client', 'time', 'safety', 'damage', 'other'];
  var ERR_SEV = ['low', 'med', 'high'];
  var SEV_BADGE = { low: 'todo', med: 'question', high: 'failed' };
  function errorsOf(db, uid) { return (db.errors || []).filter(function (x) { return x.uid === uid; }); }
  function retrainOf(db, uid) { return errorsOf(db, uid).filter(function (x) { return x.status === 'assigned'; }); }
  function errStats(db, dys) {
    var from = Date.now() - dys * DAY, list = (db.errors || []).filter(function (x) { return x.at >= from; });
    var byLesson = {};
    list.forEach(function (x) { if (!x.lessonId) return; var k = byLesson[x.lessonId] = byLesson[x.lessonId] || { id: x.lessonId, n: 0, high: 0 }; k.n++; if (x.sev === 'high') k.high++; });
    var top = Object.keys(byLesson).map(function (k) { return byLesson[k]; }).sort(function (a, b) { return b.n - a.n || b.high - a.high; });
    var byCat = ERR_CATS.map(function (c) { return { c: c, n: list.filter(function (x) { return x.cat === c; }).length }; }).filter(function (x) { return x.n; }).sort(function (a, b) { return b.n - a.n; });
    return { list: list, n: list.length, top: top, byCat: byCat, open: list.filter(function (x) { return x.status === 'assigned'; }).length };
  }
  function quizFor(db, lid, n) {
    var l = lid ? findLesson(db.course, lid) : null, qs = (l && l.quiz) || [];
    return qs.slice(0, n || 3);
  }

  function ErrorForm(p) {
    var t = p.t, db = p.db, emps = employees(db).filter(function (u) { return u.id !== p.user.id; });
    var f = useState({ uid: p.uid ? String(p.uid) : '', cat: 'doc', sev: 'med', lessonId: '', text: '', impact: '' }), v = f[0], er = useState({});
    var ls = flat(db.course);
    function set(k, x) { var o = Object.assign({}, v); o[k] = x; f[1](o); if (er[0][k]) { var e = Object.assign({}, er[0]); delete e[k]; er[1](e); } }
    function save() {
      var e = {};
      if (!v.uid) e.uid = t('fill_required');
      if (v.text.trim().length < 10) e.text = t('err_text_short');
      er[1](e); if (Object.keys(e).length) return;
      var uid = +v.uid, lid = v.lessonId || null, ttl = lessonTitle(db, lid);
      p.update(function (d) {
        d.errors = d.errors || [];
        d.errors.unshift({ id: 'e' + nextId(d), uid: uid, by: p.user.id, at: Date.now(), lessonId: lid, cat: v.cat, sev: v.sev, text: v.text.trim(), impact: v.impact.trim(), status: lid ? 'assigned' : 'open' });
        qNotify(d, uid, 'err', { err: { cat: v.cat, ttl: ttl, retrain: !!lid } });
      });
      f[1]({ uid: '', cat: 'doc', sev: 'med', lessonId: '', text: '', impact: '' });
      p.say(lid ? t('err_saved_train') : t('err_saved'));
      if (p.onDone) p.onDone();
    }
    return h('section', { className: 'box err-form' },
      h('div', { className: 'err-form-h' }, h('span', { className: 'err-ico sev-med' }, h(Ico, { name: 'problem', size: 20 })),
        h('div', null, h('h2', { className: 'lor-h' }, t('err_new')), h('p', { className: 'lor-sm lor-muted' }, t('err_new_hint')))),
      h('div', { className: 'err-grid' },
        h(Field, { name: 'er-uid', label: t('th_emp'), required: true, value: v.uid, error: er[0].uid, options: [['', '—']].concat(emps.map(function (u) { return [String(u.id), u.name]; })), onChange: function (x) { set('uid', x); } }),
        h(Field, { name: 'er-cat', label: t('err_cat'), value: v.cat, options: ERR_CATS.map(function (c) { return [c, t('ec_' + c)]; }), onChange: function (x) { set('cat', x); } }),
        h(Field, { name: 'er-sev', label: t('err_sev'), value: v.sev, options: ERR_SEV.map(function (c) { return [c, t('es_' + c)]; }), onChange: function (x) { set('sev', x); } }),
        h(Field, { name: 'er-les', className: 'f-wide', label: t('err_lesson'), hint: t('err_lesson_hint'), value: v.lessonId, options: [['', t('err_no_lesson')]].concat(ls.map(function (l) { return [l.id, l.title]; })), onChange: function (x) { set('lessonId', x); } }),
        h(Field, { name: 'er-text', span: true, multiline: true, rows: 3, label: t('err_what'), required: true, value: v.text, error: er[0].text, placeholder: t('err_what_ph'), onChange: function (x) { set('text', x); } }),
        h(Field, { name: 'er-imp', span: true, label: t('err_impact'), placeholder: t('err_impact_ph'), value: v.impact, onChange: function (x) { set('impact', x); } })),
      h('div', { className: 'as-act' }, p.onCancel ? h(Btn, { variant: 'ghost', onClick: p.onCancel }, t('cancel')) : null, h(Btn, { variant: 'primary', arrow: true, onClick: save }, t('err_save'))));
  }

  function ErrorItem(p) {
    var x = p.x, t = p.t, db = p.db, u = userOf(db, x.uid), by = userOf(db, x.by), l = x.lessonId ? findLesson(db.course, x.lessonId) : null;
    return h('article', { className: cx('box err-item', 'sev-' + x.sev, x.status === 'assigned' && 'is-open') },
      h('div', { className: 'err-top' },
        h('span', { className: cx('err-ico', 'sev-' + x.sev) }, h(Ico, { name: 'problem', size: 18 })),
        h('div', { className: 'err-who' }, p.admin ? h('b', null, u.name) : h('b', null, t('ec_' + x.cat)), h('span', { className: 'lor-sm lor-muted' }, (p.admin ? t('ec_' + x.cat) + ' · ' : '') + fmt(x.at, t) + ' · ' + tpl(t('err_by'), { x: by.name }))),
        h(Badge, { status: SEV_BADGE[x.sev], lang: p.lang }, t('es_' + x.sev)),
        x.status === 'done' ? h(Badge, { status: 'passed', lang: p.lang }, t('err_st_done')) : x.status === 'assigned' ? h(Badge, { status: 'in-progress', lang: p.lang }, t('err_st_assigned')) : h(Badge, { status: 'todo', lang: p.lang }, t('err_st_open'))),
      h('p', { className: 'ini-pre' }, x.text),
      x.impact ? h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('err_impact') + ': ' + x.impact) : null,
      l ? h('div', { className: 'err-sop' }, h('span', { className: 'lor-eyebrow' }, t('err_sop')), h('span', null, l.title),
        x.status === 'done' && x.retest ? h('span', { className: 'made lor-sm' }, '✓ ' + tpl(t('err_retest_ok'), { n: x.retest.score })) : null) : null,
      p.children);
  }

  function RetestModal(p) {
    var t = p.t, db = p.db, u = p.user, x = p.err, qs = quizFor(db, x.lessonId, 3), l = findLesson(db.course, x.lessonId);
    var a = useState({}), ans = a[0], done = useState(null), er = useState(false);
    useEffect(function () { function k(e) { if (e.key === 'Escape') p.onClose(); } window.addEventListener('keydown', k); return function () { window.removeEventListener('keydown', k); }; }, []);
    function submit() {
      if (Object.keys(ans).length < qs.length) { er[1](true); return; }
      /* the employee has no right answers: the server grades and closes the error */
      SV.retest(x.id, qs.map(function (q, i) { return ans[i]; })).then(function (r) { done[1](r.score); }, function (e) { p.say(t(e.code === 'net' ? 'srv_net' : 'srv_quiz_err')); });
    }
    var sc = done[0];
    return h('div', { className: 'lor-scrim sv-scrim', onMouseDown: function (e) { if (e.target === e.currentTarget && sc != null) p.onClose(); } },
      h('div', { className: 'lor-modal rt-modal', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'rt-h' },
        h('button', { type: 'button', className: 'lor-modal-x', 'aria-label': t('close'), onClick: p.onClose }, '×'),
        h('span', { className: 'lor-eyebrow' }, t('err_retest') + ' · ' + t('pass_mark') + ' ' + PASS_MARK + '%'),
        h('h2', { className: 'lor-h', id: 'rt-h' }, l ? l.title : ''),
        sc == null ? h(F, null,
          !qs.length ? h('p', { className: 'lor-muted' }, t('err_no_quiz')) : null,
          qs.map(function (q, i) {
            return h('fieldset', { key: i, className: 'quiz-q' },
              h('legend', { className: 'lor-h' }, h('span', { className: 'lor-eyebrow' }, t('quiz_q') + ' ' + (i + 1) + ' / ' + qs.length), q.q),
              h('div', { className: 'lor-quiz-opts', role: 'radiogroup' }, q.options.map(function (o, k) {
                return h('button', { key: k, type: 'button', role: 'radio', 'aria-checked': ans[i] === k, className: cx('lor-opt', ans[i] === k && 'is-sel'), onClick: function () { var n = Object.assign({}, ans); n[i] = k; a[1](n); er[1](false); } },
                  h('span', { className: 'lor-opt-k' }, 'ABCDEF'[k]), h('span', null, o));
              })));
          }),
          h('div', { className: 'quiz-foot' }, er[0] ? h('span', { className: 'lor-field-error' }, t('answer_all')) : h('span'),
            h(Btn, { variant: 'primary', arrow: true, disabled: !qs.length, onClick: submit }, t('submit_test'))))
          : h('div', { className: cx('status-box', sc >= PASS_MARK ? 'is-info' : 'is-fail') },
            h('div', null, h('b', null, t('your_score') + ': ' + sc + '%'), h('p', null, sc >= PASS_MARK ? t('err_retest_pass') : t('err_retest_fail'))),
            sc >= PASS_MARK ? h(Btn, { variant: 'primary', onClick: p.onClose }, t('close')) : h(Btn, { variant: 'outline', onClick: function () { a[1]({}); done[1](null); } }, t('err_retry')))));
  }

  /* ======================= 3. AI SITUATION DRILL (trenajyor) ======================= */
  var SCENARIOS = [
    { id: 'client_late', ico: 'chat', pref: ['l2', 'b4-14'], kw: 'mijoz kechikish muddat xabar berish', role: 'Siz — BURAQ mijozisiz. Yukingiz kechikdi, sizga oldindan xabar berishmadi. Siz asabiysiz, aniq muddat va sabab talab qilasiz. Agar xodim aniq javob bermasa, bosimni oshiring.' },
    { id: 'client_damage', ico: 'problem', pref: ['b4-2', 'b4-7'], kw: 'yuk shikastlangan dalolatnoma qadoq', role: 'Siz — mijozsiz. Yukingiz shikastlangan holda yetib keldi, qutilar ezilgan. Siz kim javob berishini va zarar qanday qoplanishini bilmoqchisiz.' },
    { id: 'customs', ico: 'doc', pref: ['b4-18', 'b4-5'], kw: 'bojxona deklaratsiya invoys hujjat', role: 'Siz — bojxona inspektorisiz. Hujjatlarni tekshiryapsiz va yetishmayotgan hujjatlarni so‘rayapsiz. Rasmiy va qat’iy gapiring, faqat hujjatlar haqida so‘rang.' },
    { id: 'driver', ico: 'truck', pref: ['b4-2'], kw: 'haydovchi packing list yuk qabul chegara', role: 'Siz — zavod haydovchisisiz. Yukni omborga keltirdingiz, lekin Packing list qog‘ozda yo‘q, faqat telefoningizda rasm bor. Shoshyapsiz va tezroq tushirishni so‘rayapsiz.' },
    { id: 'colleague', ico: 'team', pref: ['b4-8', 'l1'], kw: 'ombor xavfsizlik jilet qoida', role: 'Siz — tajribali hamkasbsiz. Xavfsizlik qoidasini buzyapsiz (jiletsiz ishlayapsiz) va "biz doim shunday qilamiz" deb javob berasiz.' },
    { id: 'boss', ico: 'flag', pref: ['l3', 'l2'], kw: 'xato rahbar xabar berish mas’uliyat', role: 'Siz — bevosita rahbarsiz. Xodim sizga o‘z xatosi haqida aytmoqchi. Siz xotirjamsiz, lekin nima bo‘lgani, qanday tuzatilishi va kim xabardor qilinganini aniq so‘raysiz.' }
  ];
  function drillsOf(db, uid) { return (db.drills || []).filter(function (x) { return x.uid === uid; }); }
  function drillLessons(db, uid) { var o = {}; drillsOf(db, uid).forEach(function (x) { if (x.score >= 3.5 && x.lessonId) o[x.lessonId] = 1; }); return Object.keys(o).length; }
  function drillAvg(db, uid) { var v = drillsOf(db, uid).map(function (x) { return x.score; }); return mean(v); }
  var DRILL_CRIT = ['sop', 'tone', 'full', 'safe'];

  function DrillPage(p) {
    var t = p.t, db = p.db, u = p.user, sampler = p.sampler, lang = p.lang;
    var sc = useState(null), scen = sc[0];
    var ms = useState([]), msgs = ms[0], inp = useState(''), busy = useState(false), res = useState(null), err = useState('');
    var ctl = useRef(null), listRef = useRef(null), taRef = useRef(null);
    var mine = drillsOf(db, u.id).sort(function (a, b) { return b.at - a.at; });
    useEffect(function () { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [msgs]);
    useEffect(function () { return function () { if (ctl.current) ctl.current.abort(); }; }, []);
    function sopFor(s) {
      var ls = accessibleLessons(db, u), byId = {};
      ls.forEach(function (l) { byId[l.id] = l; });
      var picks = (s.pref || []).map(function (id) { return byId[id]; }).filter(Boolean).slice(0, 2);
      if (picks.length < 2) pickLessons(ls, s.kw, null, 3).forEach(function (l) { if (picks.length < 2 && picks.indexOf(l) < 0) picks.push(l); });
      return { text: picks.length ? standardsBlock(picks, 12000) : '', lid: picks.length ? picks[0].id : null };
    }
    function rules(s, sop) {
      return 'Siz BURAQ Logistics kompaniyasining o‘quv platformasidagi rolli mashq (trenajyor) uchun sun’iy intellektsiz. Siz XODIM EMAS — siz qarshi tomon rolini o‘ynaysiz.\n' +
        'ROLINGIZ: ' + s.role + '\n' +
        'Qoidalar:\n- Har bir javobingiz 1–3 gapdan oshmasin, jonli suhbat ohangida.\n- Rolingizdan chiqmang, xodimga maslahat bermang va uni baholamang.\n- Haqorat, tahdid va shaxsiy ma’lumotlarsiz. Vaziyatni real qiling: aniq savollar bering, javob noaniq bo‘lsa qayta so‘rang.\n- Suhbat tili: ' + (LANG_NAME[lang] || LANG_NAME.uz) + '.\n' +
        'Xodim: ' + u.name + ', lavozimi: ' + u.position + '.\n' +
        (sop ? '\nKOMPANIYA STANDARTI (xodim shu asosda javob berishi kerak, siz uni bilmaysiz):\n' + sop + '\n' : '') +
        '\nEndi suhbatni boshlang: rolingizdan birinchi xabarni yozing.';
    }
    function start(s) {
      if (!sampler) return;
      var sop = sopFor(s);
      sc[1](Object.assign({}, s, { lid: sop.lid, sop: sop.text }));
      ms[1]([{ role: 'assistant', content: '', streaming: true }]); res[1](null); err[1](''); busy[1](true);
      var c = new AbortController(); ctl.current = c;
      sampler([{ role: 'user', content: rules(s, sop.text) }], { signal: c.signal, onText: function (x) { patch(x.text, true); } })
        .then(function (r) { patch(r.text, false); })
        .catch(function (e) { if (e && e.code === 'cancelled') return; err[1](aiErr(e, t)); ms[1]([]); })
        .then(function () { busy[1](false); });
    }
    function patch(text, streaming) { ms[1](function (prev) { var c = prev.slice(); c[c.length - 1] = { role: 'assistant', content: text, streaming: streaming }; return c; }); }
    function send(text) {
      text = (text || '').trim(); if (!text || busy[0] || !scen) return;
      var hist = msgs.filter(function (m) { return m.content; }).map(function (m) { return { role: m.role, content: m.content }; });
      var turns = [{ role: 'user', content: rules(scen, scen.sop) }].concat(hist).concat([{ role: 'user', content: text }]);
      ms[1](msgs.concat([{ role: 'user', content: text }, { role: 'assistant', content: '', streaming: true }]));
      inp[1](''); busy[1](true);
      var c = new AbortController(); ctl.current = c;
      sampler(turns, { signal: c.signal, onText: function (x) { patch(x.text, true); } })
        .then(function (r) { patch(r.text, false); })
        .catch(function (e) { if (e && e.code === 'cancelled') return; patch('', false); err[1](aiErr(e, t)); })
        .then(function () { busy[1](false); });
    }
    function finish() {
      if (!sampler || busy[0]) return;
      var dialog = msgs.filter(function (m) { return m.content; }).map(function (m) { return (m.role === 'user' ? 'XODIM: ' : 'QARSHI TOMON: ') + m.content; }).join('\n');
      var prompt = 'Siz BURAQ Logistics SOP menejerisiz. Xodim rolli mashqni bajardi. Uning javoblarini KOMPANIYA STANDARTI asosida baholang.\n' +
        'Baholash mezonlari (har biri 1 dan 5 gacha butun son):\n- sop: javoblar standartga qanchalik mos\n- tone: ohang va muloqot madaniyati\n- full: javoblarning to‘liqligi (muddat, mas’ul, keyingi qadam aytilganmi)\n- safe: xavfsizlik va maxfiylik qoidalari buzilmaganmi\n' +
        'Qoidalar: faqat standart matniga tayaning; xodimni hurmat bilan, aniq va foydali baholang. "good" — 1–3 ta kuchli tomon, "improve" — 1–3 ta aniq tavsiya (nima deyish kerak edi). "summary" — 1–2 gapli umumiy xulosa. Til: ' + (LANG_NAME[lang] || LANG_NAME.uz) + '.\n' +
        'Faqat JSON qaytaring: {"sop":4,"tone":4,"full":3,"safe":5,"good":["..."],"improve":["..."],"summary":"..."}\n\n' +
        (scen.sop ? 'KOMPANIYA STANDARTI:\n' + scen.sop + '\n\n' : '') + 'SUHBAT:\n' + dialog;
      busy[1](true); err[1]('');
      var c = new AbortController(); ctl.current = c;
      sampler.json(prompt, { signal: c.signal }).then(function (r) {
        if (!r || typeof r !== 'object') { err[1](t('ai_bad_json')); return; }
        var cr = {}, sum = 0, n = 0;
        DRILL_CRIT.forEach(function (k) { var v = Math.max(1, Math.min(5, Math.round(+r[k] || 3))); cr[k] = v; sum += v; n++; });
        var score = Math.round(sum / n * 10) / 10;
        var out = { score: score, criteria: cr, good: (Array.isArray(r.good) ? r.good : []).map(String).slice(0, 3), improve: (Array.isArray(r.improve) ? r.improve : []).map(String).slice(0, 3), summary: String(r.summary || '').slice(0, 400) };
        res[1](out);
        var turnsN = msgs.filter(function (m) { return m.role === 'user'; }).length;
        p.update(function (d) {
          d.drills = d.drills || [];
          d.drills.unshift({ id: 'd' + nextId(d), uid: u.id, at: Date.now(), scen: scen.id, lessonId: scen.lid, turns: turnsN, score: score, criteria: cr, summary: out.summary, lang: lang });
        });
      }).catch(function (e) { if (e && e.code === 'cancelled') return; err[1](e && e.code === 'invalid_json' ? t('ai_bad_json') : aiErr(e, t)); }).then(function () { busy[1](false); });
    }
    function reset() { if (ctl.current) ctl.current.abort(); sc[1](null); ms[1]([]); res[1](null); err[1](''); busy[1](false); }
    var userTurns = msgs.filter(function (m) { return m.role === 'user'; }).length;
    return h('div', { className: 'app-wrap' },
      h('div', { className: 'page-head' },
        h('div', null, h('span', { className: 'lor-eyebrow' }, t('dr_eyebrow')), h('h1', { className: 'lor-title' }, t('dr_title'), h(PageTip, { t: t, id: 'drill' }))),
        scen ? h(Btn, { variant: 'ghost', onClick: reset }, t('dr_other')) : null),
      !scen ? h(F, null,
        h('p', { className: 'lor-muted', style: { margin: 0, maxWidth: 820 } }, t('dr_intro')),
        sampler === null ? h('section', { className: 'box' }, h('p', { className: 'lor-muted', style: { margin: 0 } }, t('ai_unavail'))) : null,
        h('div', { className: 'dr-grid' }, SCENARIOS.map(function (s) {
          var last = mine.filter(function (x) { return x.scen === s.id; })[0];
          return h('button', { key: s.id, type: 'button', className: 'dr-card', disabled: !sampler, onClick: function () { start(s); } },
            h('span', { className: 'dr-ico' }, h(Ico, { name: s.ico, size: 22 })),
            h('b', null, t('sc_' + s.id + '_t')),
            h('span', { className: 'dr-who' }, t('sc_' + s.id + '_s')),
            last ? h('span', { className: cx('dr-last', last.score >= 4 ? 'hi' : last.score < 3 ? 'low' : '') }, tpl(t('dr_last'), { n: last.score.toFixed(1) })) : h('span', { className: 'dr-last new' }, t('dr_never')));
        })),
        mine.length ? h('section', { className: 'box' },
          h('div', { className: 'chart-head' }, h('h2', { className: 'lor-h' }, t('dr_history')), h('span', { className: 'lor-sm lor-muted' }, tpl(t('dr_avg'), { n: (drillAvg(db, u.id) || 0).toFixed(1) }))),
          h('ul', { className: 'dr-hist' }, mine.slice(0, 6).map(function (x) {
            return h('li', { key: x.id },
              h('span', { className: 'dr-hist-t' }, t('sc_' + x.scen + '_t'), h('small', null, fmt(x.at, t) + (x.lessonId ? ' · ' + lessonTitle(db, x.lessonId) : ''))),
              h('span', { className: cx('dr-score', x.score >= 4 ? 'hi' : x.score < 3 ? 'low' : '') }, x.score.toFixed(1)));
          }))) : null)
        : h('section', { className: 'box dr-room' },
          h('div', { className: 'dr-room-h' },
            h('span', { className: 'dr-ico' }, h(Ico, { name: scen.ico, size: 20 })),
            h('div', null, h('b', null, t('sc_' + scen.id + '_t')), h('span', { className: 'lor-sm lor-muted' }, t('sc_' + scen.id + '_g'))),
            h('span', { className: 'lor-sm lor-muted' }, tpl(t('dr_turns'), { n: userTurns }))),
          h('div', { className: 'dr-chat', ref: listRef }, msgs.map(function (m, i) {
            return h('div', { key: i, className: cx('dr-msg', m.role === 'user' ? 'is-me' : 'is-them') },
              m.role === 'assistant' ? h('span', { className: 'dr-av' }, h(Ico, { name: scen.ico, size: 14 })) : null,
              h('div', { className: 'dr-bub' }, m.content || (m.streaming ? h('span', { className: 'sv-dots' }, h('i'), h('i'), h('i')) : null)));
          })),
          err[0] ? h('p', { className: 'lor-field-error' }, err[0]) : null,
          res[0] ? h('div', { className: 'dr-res' },
            h('div', { className: 'dr-res-h' }, h('span', { className: 'lor-eyebrow' }, t('dr_result')), h('b', { className: cx('dr-big', res[0].score >= 4 ? 'hi' : res[0].score < 3 ? 'low' : '') }, res[0].score.toFixed(1)), h('span', { className: 'lor-sm lor-muted' }, '/ 5')),
            h('ul', { className: 'hbar dr-crit' }, DRILL_CRIT.map(function (k) {
              var v = res[0].criteria[k];
              return h('li', { key: k }, h('span', { className: 'hbar-l' }, t('dc_' + k)),
                h('span', { className: 'hbar-t' }, h('i', { className: v >= 4 ? 'met' : v < 3 ? 'low' : 'mid', style: { width: ((v - 1) / 4 * 100) + '%' } })),
                h('span', { className: 'hbar-v' }, h('b', null, v)));
            })),
            res[0].summary ? h('p', { className: 'dr-sum' }, res[0].summary) : null,
            res[0].good.length ? h('div', { className: 'dr-fb ok' }, h('span', { className: 'lor-eyebrow' }, t('dr_good')), h('ul', null, res[0].good.map(function (x, i) { return h('li', { key: i }, x); }))) : null,
            res[0].improve.length ? h('div', { className: 'dr-fb imp' }, h('span', { className: 'lor-eyebrow' }, t('dr_improve')), h('ul', null, res[0].improve.map(function (x, i) { return h('li', { key: i }, x); }))) : null,
            h('div', { className: 'as-act' },
              scen.lid ? h('button', { type: 'button', className: 'app-link', onClick: function () { p.go({ name: 'lesson', id: scen.lid }); } }, t('tk_open_sop')) : null,
              h(Btn, { variant: 'primary', onClick: reset }, t('dr_again'))))
            : h('div', { className: 'dr-form' },
              h('textarea', { ref: taRef, id: 'dr-input', className: 'lor-input', rows: 2, value: inp[0], placeholder: t('dr_ph'), 'aria-label': t('dr_ph'), disabled: busy[0], onChange: function (e) { inp[1](e.target.value); }, onKeyDown: function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(inp[0]); } } }),
              h('div', { className: 'dr-form-b' },
                h(Btn, { variant: 'primary', size: 'sm', disabled: busy[0] || !inp[0].trim(), onClick: function () { send(inp[0]); } }, t('ai_send')),
                h(Btn, { variant: 'outline', size: 'sm', disabled: busy[0] || userTurns < 2, onClick: finish }, '✦ ' + t('dr_finish'))),
              userTurns < 2 ? h('span', { className: 'lor-sm lor-muted' }, t('dr_min')) : null)));
  }

  /* ======================= 4. SOP UPDATE ACKNOWLEDGEMENTS (tanishish) ======================= */
  function updatesFor(db, uid) { return (db.sopUpdates || []).filter(function (x) { return (x.required || []).indexOf(uid) >= 0 && !(x.acks || {})[uid]; }); }
  function updateForLesson(db, uid, lid) { return updatesFor(db, uid).filter(function (x) { return x.lessonId === lid; })[0]; }
  function ackUpdate(d, id, uid) { (d.sopUpdates || []).forEach(function (x) { if (x.id === id) { x.acks = Object.assign({}, x.acks || {}); x.acks[uid] = Date.now(); } }); }
  function updProgress(x) { var req = (x.required || []).length, ok = Object.keys(x.acks || {}).length; return { req: req, ok: ok, pct: req ? Math.round(ok * 100 / req) : 100 }; }

  function SopUpdateBox(p) {
    var t = p.t, x = p.x, d = dueLabel(x.due, t);
    return h('section', { className: 'sop-upd' },
      h('div', { className: 'sop-upd-h' },
        h('span', { className: 'sop-ico' }, h(Ico, { name: 'refresh', size: 20 })),
        h('div', null, h('b', null, t('sop_changed')), h('span', { className: 'lor-sm' }, tpl(t('sop_changed_sub'), { d: fmtDate(x.at) }))),
        h('span', { className: cx('sop-due', d.cls) }, d.s)),
      h('div', { className: 'sop-sum' }, h('span', { className: 'lor-eyebrow' }, t('sop_what')), h('div', { className: 'ai-md', dangerouslySetInnerHTML: { __html: mdLite(x.summary) } })),
      h('div', { className: 'as-act' },
        p.onOpen ? h('button', { type: 'button', className: 'app-link', onClick: p.onOpen }, t('tk_open_sop')) : null,
        h(Btn, { variant: 'primary', arrow: true, onClick: p.onAck }, t('sop_ack'))));
  }

  /* SOP manager: after saving a changed SOP, ask everyone who already passed it to read the changes */
  function SopNotifyPanel(p) {
    var t = p.t, db = p.db, x = p.x, sampler = p.sampler;
    var sum = useState(''), busy = useState(false), er = useState(''), dys = useState('3');
    function ai() {
      if (!sampler || busy[0]) return;
      var prompt = 'Siz BURAQ Logistics SOP menejeriga yordam beruvchi AI-muharrirsiz. Quyida kompaniya standartining ESKI va YANGI matni berilgan. Xodimlar uchun nima o‘zgarganini 2–4 ta qisqa punktda yozing.\n' +
        'Qoidalar: har bir punkt "• " bilan boshlansin va bitta aniq o‘zgarishni bildirsin (nima edi → nima bo‘ldi). Faqat haqiqatan o‘zgargan narsalarni yozing, yangi fakt o‘ylab topmang. Imlo va formatdagi mayda o‘zgarishlarni yozmang. Til: ' + (LANG_NAME[p.lang] || LANG_NAME.uz) + '. Faqat punktlarni qaytaring.\n\n' +
        'ESKI MATN:\n' + x.before.slice(0, 14000) + '\n\nYANGI MATN:\n' + x.after.slice(0, 14000);
      busy[1](true); er[1]('');
      sampler(prompt, { onText: function (r) { sum[1](r.text); } }).then(function (r) { sum[1](String(r.text || '').trim()); }).catch(function (e) { er[1](aiErr(e, t)); }).then(function () { busy[1](false); });
    }
    function send() {
      if (!sum[0].trim()) { er[1](t('sop_need_sum')); return; }
      var body = sum[0].trim(), n = +dys[0] || 3;
      p.update(function (d) {
        d.sopUpdates = d.sopUpdates || [];
        d.sopUpdates.unshift({ id: 'su' + nextId(d), lessonId: x.lessonId, at: Date.now(), by: p.user.id, due: Date.now() + n * DAY, summary: body, required: x.passers.slice(), acks: {} });
        x.passers.forEach(function (uid) { qNotify(d, uid, 'sop', { sop: { ttl: x.title } }); });
      });
      p.say(tpl(t('sop_sent'), { n: x.passers.length }));
      p.onDone();
    }
    return h('section', { className: 'box sop-panel' },
      h('div', { className: 'sop-upd-h' },
        h('span', { className: 'sop-ico' }, h(Ico, { name: 'refresh', size: 20 })),
        h('div', null, h('b', null, t('sop_panel_t')), h('span', { className: 'lor-sm lor-muted' }, tpl(t('sop_panel_s'), { n: x.passers.length, x: x.title }))),
        h('button', { type: 'button', className: 'lor-modal-x', 'aria-label': t('close'), onClick: p.onDone }, '×')),
      h('div', { className: 'sop-panel-b' },
        h(Btn, { variant: 'outline', size: 'sm', disabled: !sampler || busy[0], onClick: ai }, busy[0] ? t('ai_thinking') : '✦ ' + t('sop_ai')),
        h('label', { className: 'pulse-every' }, t('sop_due'), h('select', { className: 'lor-input slim', value: dys[0], onChange: function (e) { dys[1](e.target.value); } }, ['1', '2', '3', '5', '7'].map(function (n) { return h('option', { key: n, value: n }, tpl(t('sop_days'), { n: n })); })))),
      h(Field, { name: 'sop-sum', multiline: true, rows: 4, label: t('sop_what'), value: sum[0], placeholder: t('sop_sum_ph'), onChange: sum[1] }),
      er[0] ? h('span', { className: 'lor-field-error' }, er[0]) : null,
      h('div', { className: 'as-act' }, h(Btn, { variant: 'ghost', onClick: p.onDone }, t('sop_skip')), h(Btn, { variant: 'primary', arrow: true, onClick: send }, t('sop_send'))));
  }

  /* ======================= employee: my tasks ======================= */
  function taskList(db, u) { return { acks: updatesFor(db, u.id), retrain: retrainOf(db, u.id), xt: xtasksOf(db, u.id).filter(xtActive) }; }
  function taskCount(db, u) { var x = taskList(db, u); return x.acks.length + x.retrain.length + x.xt.length; }

  function TasksPage(p) {
    var t = p.t, db = p.db, u = p.user, x = taskList(db, u);
    var rt = useState(null);
    var errs = errorsOf(db, u.id).sort(function (a, b) { return b.at - a.at; });
    var n = x.acks.length + x.retrain.length + x.xt.length, anyXt = xtasksOf(db, u.id).length;
    return h('div', { className: 'app-wrap' },
      h('div', { className: 'page-head' }, h('div', null, h('span', { className: 'lor-eyebrow' }, t('tk_eyebrow')), h('h1', { className: 'lor-title' }, t('tk_title'), h(PageTip, { t: t, id: 'tasks' }))),
        h('span', { className: cx('tk-count', !n && 'is-zero') }, n ? tpl(t('tk_n'), { n: n }) : '✓ ' + t('tk_none'))),
      h(XtSection, p),
      x.acks.length ? h('section', { className: 'tk-sec' }, h('span', { className: 'lor-eyebrow' }, t('tk_sop') + ' · ' + x.acks.length),
        x.acks.map(function (up) {
          return h('div', { key: up.id, className: 'box tk-box' },
            h('div', { className: 'tk-h' }, h('b', null, lessonTitle(db, up.lessonId))),
            h(SopUpdateBox, { t: t, x: up, onOpen: function () { p.go({ name: 'lesson', id: up.lessonId }); }, onAck: function () { p.update(function (d) { ackUpdate(d, up.id, u.id); }); p.say(t('sop_acked')); } }));
        })) : null,
      x.retrain.length ? h('section', { className: 'tk-sec' }, h('span', { className: 'lor-eyebrow' }, t('tk_retrain') + ' · ' + x.retrain.length),
        x.retrain.map(function (e) {
          return h(ErrorItem, { key: e.id, x: e, t: t, db: db, lang: p.lang },
            h('div', { className: 'as-act' },
              h('button', { type: 'button', className: 'app-link', onClick: function () { p.go({ name: 'lesson', id: e.lessonId }); } }, t('tk_open_sop')),
              h(Btn, { variant: 'primary', size: 'sm', arrow: true, onClick: function () { rt[1](e); } }, t('err_retest'))));
        })) : null,
      !n && !anyXt ? h('section', { className: 'box tk-empty' }, h('span', { className: 'sv-done-ico' }, h(Icon, { name: 'check' })), h('p', { style: { margin: 0 } }, t('tk_empty'))) : null,
      errs.length ? h('details', { className: 'box tk-done' }, h('summary', null, t('tk_my_errors') + ' · ' + errs.length),
        h('div', { className: 'tk-done-b' }, errs.map(function (e) { return h(ErrorItem, { key: e.id, x: e, t: t, db: db, lang: p.lang }); }))) : null,
      rt[0] ? h(RetestModal, Object.assign({}, p, { key: rt[0].id, err: rt[0], onClose: function () { rt[1](null); } })) : null);
  }

  function TasksHomeCard(p) {
    var t = p.t, x = taskList(p.db, p.user), n = x.acks.length + x.retrain.length + x.xt.length;
    if (!n) return null;
    var parts = [];
    if (x.xt.length) parts.push(tpl(t('tk_c_xt'), { n: x.xt.length }));
    if (x.acks.length) parts.push(tpl(t('tk_c_sop'), { n: x.acks.length }));
    if (x.retrain.length) parts.push(tpl(t('tk_c_retrain'), { n: x.retrain.length }));
    return h('section', { className: 'lor-notice tk-notice' },
      h('span', { className: 'as-ico inv', 'aria-hidden': true }, h(Ico, { name: 'clip', size: 20 })),
      h('div', { className: 'lor-notice-body' }, h('b', null, tpl(t('tk_notice'), { n: n })), h('span', null, parts.join(' · '))),
      h(Btn, { variant: 'primary', arrow: true, onClick: function () { p.go({ name: 'tasks' }); } }, t('tk_open')));
  }
  function DrillHomeCard(p) {
    var t = p.t, avg = drillAvg(p.db, p.user.id);
    return h('section', { className: 'box dr-home' },
      h('span', { className: 'dr-home-ico', 'aria-hidden': true }, h(Ico, { name: 'chat', size: 24 })),
      h('div', { className: 'ini-card-b' }, h('span', { className: 'lor-eyebrow' }, t('dr_eyebrow')), h('h2', { className: 'lor-h' }, t('dr_home_t')), h('p', { className: 'lor-sm' }, t('dr_home_p'))),
      h('div', { className: 'ini-card-a' },
        h(Btn, { variant: 'secondary', size: 'sm', arrow: true, onClick: function () { p.go({ name: 'drill' }); } }, t('dr_start')),
        avg ? h('span', { className: 'lor-sm lor-muted' }, tpl(t('dr_avg'), { n: avg.toFixed(1) })) : null));
  }

  /* ======================= mentor panel: the mistake log ======================= */
  function MentorPanel(p) {
    var t = p.t, db = p.db, u = p.user;
    var mine = (db.errors || []).filter(function (x) { return x.by === u.id; }).sort(function (a, b) { return b.at - a.at; });
    var openN = mine.filter(function (x) { return x.status === 'assigned'; }).length;
    return h('div', { className: 'app-wrap' },
      h('div', { className: 'page-head' },
        h('div', null, h('span', { className: 'lor-eyebrow' }, t('mn_eyebrow')), h('h1', { className: 'lor-title' }, t('nav_mentor'))),
        h('div', { className: 'mn-stats' },
          h('span', null, h('b', null, mine.length), t('mn_logged')),
          h('span', null, h('b', null, openN), t('mn_open')))),
      h('p', { className: 'lor-muted', style: { margin: 0, maxWidth: 820 } }, t('mn_intro')),
      h(ErrorForm, Object.assign({}, p, { key: 'ef' + mine.length })),
      mine.length ? mine.map(function (x) { return h(ErrorItem, { key: x.id, x: x, t: t, db: db, lang: p.lang, admin: true }); })
        : h('section', { className: 'box' }, h('p', { className: 'lor-muted', style: { margin: 0 } }, t('mn_no_errors'))));
  }

  /* ======================= admin: quality (sifat) ======================= */
  function ErrorsAdmin(p) {
    var t = p.t, db = p.db, rg = useState(30), dys = rg[0], S = errStats(db, dys);
    var fu = useState(''), fs = useState('all'), form = useState(false);
    var rows = (db.errors || []).filter(function (x) { return (fs[0] === 'all' || x.status === fs[0]) && (!fu[0] || String(x.uid) === fu[0]); }).sort(function (a, b) { return b.at - a.at; });
    var emps = employees(db);
    return h(F, null,
      h('div', { className: 'seg', role: 'tablist' }, [[7, t('pulse_7d')], [30, t('pulse_30d')], [90, t('pulse_90d')]].map(function (x) { return h('button', { key: x[0], type: 'button', role: 'tab', 'aria-selected': dys === x[0], className: dys === x[0] ? 'is-on' : '', onClick: function () { rg[1](x[0]); } }, x[1]); })),
      h('div', { className: 'tiles' },
        [[t('err_t_all'), S.n], [t('err_t_open'), S.open], [t('err_t_high'), S.list.filter(function (x) { return x.sev === 'high'; }).length], [t('err_t_fixed'), S.list.filter(function (x) { return x.status === 'done'; }).length]].map(function (x) { return h('div', { key: x[0], className: 'tile' }, h('span', { className: 'lor-eyebrow' }, x[0]), h('b', null, x[1])); })),
      h('div', { className: 'home-grid' },
        h('section', { className: 'box' },
          h('h2', { className: 'lor-h', style: { margin: 0 } }, t('err_top_sop')),
          S.top.length ? h('ul', { className: 'hbar' }, S.top.slice(0, 6).map(function (x) {
            var max = S.top[0].n;
            return h('li', { key: x.id }, h('span', { className: 'hbar-l' }, lessonTitle(db, x.id)),
              h('span', { className: 'hbar-t' }, h('i', { className: x.high ? 'low' : 'mid', style: { width: (x.n * 100 / max) + '%' } })),
              h('span', { className: 'hbar-v' }, h('b', null, x.n), h('button', { type: 'button', className: 'app-link', onClick: function () { p.goCms(x.id); } }, t('edit_sop'))));
          })) : h('p', { className: 'lor-muted', style: { margin: 0 } }, t('err_none')),
          h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('err_top_hint'))),
        h('section', { className: 'box' },
          h('h2', { className: 'lor-h', style: { margin: 0 } }, t('err_by_cat')),
          S.byCat.length ? h('ul', { className: 'hbar' }, S.byCat.map(function (x) {
            var max = S.byCat[0].n;
            return h('li', { key: x.c }, h('span', { className: 'hbar-l' }, t('ec_' + x.c)),
              h('span', { className: 'hbar-t' }, h('i', { className: 'mid', style: { width: (x.n * 100 / max) + '%' } })),
              h('span', { className: 'hbar-v' }, h('b', null, x.n)));
          })) : h('p', { className: 'lor-muted', style: { margin: 0 } }, t('err_none')))),
      form[0] ? h(ErrorForm, Object.assign({}, p, { onCancel: function () { form[1](false); }, onDone: function () { form[1](false); } }))
        : h('div', null, h(Btn, { variant: 'primary', arrow: true, onClick: function () { form[1](true); } }, t('err_new'))),
      h('div', { className: 'filters' },
        h(Field, { name: 'er-fu', label: t('th_emp'), value: fu[0], options: [['', t('all')]].concat(emps.map(function (u) { return [String(u.id), u.name]; })), onChange: fu[1] }),
        h(Field, { name: 'er-fs', label: t('th_status'), value: fs[0], options: [['all', t('all')], ['assigned', t('err_st_assigned')], ['done', t('err_st_done')], ['open', t('err_st_open')], ['closed', t('err_st_closed')]], onChange: fs[1] })),
      rows.length ? rows.map(function (x) {
        return h(ErrorItem, { key: x.id, x: x, t: t, db: db, lang: p.lang, admin: true },
          x.status === 'open' || x.status === 'assigned' ? h('div', { className: 'as-act' },
            h(Btn, { variant: 'ghost', size: 'sm', onClick: function () { p.update(function (d) { (d.errors || []).forEach(function (y) { if (y.id === x.id) { y.status = 'closed'; y.closedAt = Date.now(); } }); }); } }, t('err_close')) ) : null);
      }) : h('section', { className: 'box' }, h('p', { className: 'lor-muted', style: { margin: 0 } }, t('err_none_rows'))));
  }

  function DrillsAdmin(p) {
    var t = p.t, db = p.db, all = (db.drills || []).slice().sort(function (a, b) { return b.at - a.at; });
    var emps = employees(db);
    var byScen = SCENARIOS.map(function (s) { var v = all.filter(function (x) { return x.scen === s.id; }); return { s: s, n: v.length, avg: mean(v.map(function (x) { return x.score; })) }; }).filter(function (x) { return x.n; }).sort(function (a, b) { return (a.avg || 0) - (b.avg || 0); });
    var avg = mean(all.map(function (x) { return x.score; }));
    return h(F, null,
      h('div', { className: 'tiles' },
        [[t('dr_t_all'), all.length], [t('dr_t_avg'), avg ? avg.toFixed(1) : '—'], [t('dr_t_people'), Object.keys(all.reduce(function (o, x) { o[x.uid] = 1; return o; }, {})).length + ' / ' + emps.length], [t('dr_t_low'), all.filter(function (x) { return x.score < 3; }).length]].map(function (x) { return h('div', { key: x[0], className: 'tile' }, h('span', { className: 'lor-eyebrow' }, x[0]), h('b', null, x[1])); })),
      h('section', { className: 'box' },
        h('h2', { className: 'lor-h', style: { margin: 0 } }, t('dr_by_scen')),
        byScen.length ? h('ul', { className: 'hbar' }, byScen.map(function (x) {
          return h('li', { key: x.s.id }, h('span', { className: 'hbar-l' }, t('sc_' + x.s.id + '_t')),
            h('span', { className: 'hbar-t' }, h('i', { className: x.avg >= 4 ? 'met' : x.avg < 3 ? 'low' : 'mid', style: { width: ((x.avg - 1) / 4 * 100) + '%' } })),
            h('span', { className: 'hbar-v' }, h('b', null, x.avg.toFixed(1)), h('small', null, x.n)));
        })) : h('p', { className: 'lor-muted', style: { margin: 0 } }, t('dr_none')),
        h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('dr_scen_hint'))),
      all.length ? h('section', { className: 'box' }, h('span', { className: 'lor-eyebrow' }, t('dr_history')),
        h('ul', { className: 'sv-list' }, all.slice(0, 12).map(function (x) {
          var u = userOf(db, x.uid);
          return h('li', { key: x.id, className: 'sv-item' },
            h('div', { className: 'sv-item-h' }, h(Av, { name: u.name, src: u.avatar, size: 30 }),
              h('div', null, h('b', null, u.name), h('span', { className: 'lor-sm lor-muted' }, t('sc_' + x.scen + '_t') + ' · ' + fmt(x.at, t) + (x.lessonId ? ' · ' + lessonTitle(db, x.lessonId) : ''))),
              h('span', { className: cx('dr-score', x.score >= 4 ? 'hi' : x.score < 3 ? 'low' : '') }, x.score.toFixed(1))),
            h('ul', { className: 'sv-ans' }, DRILL_CRIT.map(function (k) { return h('li', { key: k }, h('span', { className: 'sv-ans-q' }, t('dc_' + k)), h('span', { className: cx('sv-score', (x.criteria || {})[k] >= 4 ? 'hi' : (x.criteria || {})[k] < 3 ? 'low' : '') }, ((x.criteria || {})[k] || '—') + ' / 5')); })),
            x.summary ? h('p', { className: 'sv-text' }, x.summary) : null);
        }))) : null);
  }

  function UpdatesAdmin(p) {
    var t = p.t, db = p.db, list = (db.sopUpdates || []).slice().sort(function (a, b) { return b.at - a.at; });
    function remind(x) {
      var pend = (x.required || []).filter(function (uid) { return !(x.acks || {})[uid]; });
      p.update(function (d) { pend.forEach(function (uid) { qNotify(d, uid, 'sop', { sop: { ttl: lessonTitle(d, x.lessonId) } }); }); });
      p.say(tpl(t('sop_reminded'), { n: pend.length }));
    }
    return h(F, null,
      list.length ? list.map(function (x) {
        var pr = updProgress(x), pend = (x.required || []).filter(function (uid) { return !(x.acks || {})[uid]; }), d = dueLabel(x.due, t);
        return h('section', { key: x.id, className: 'box sop-row' },
          h('div', { className: 'sop-upd-h' },
            h('span', { className: 'sop-ico' }, h(Ico, { name: 'refresh', size: 20 })),
            h('div', null, h('b', null, lessonTitle(db, x.lessonId)), h('span', { className: 'lor-sm lor-muted' }, fmt(x.at, t) + ' · ' + userOf(db, x.by).name)),
            pend.length ? h('span', { className: cx('sop-due', d.cls) }, d.s) : h(Badge, { status: 'passed', lang: p.lang }, t('sop_all_ok'))),
          h('div', { className: 'ai-md sop-sum-adm', dangerouslySetInnerHTML: { __html: mdLite(x.summary) } }),
          h('div', { className: 'sop-prog' },
            h('div', { className: 'lor-progress-track' }, h('div', { className: cx('lor-progress-fill', pr.pct === 100 && 'is-done'), style: { width: pr.pct + '%' } })),
            h('span', { className: 'lor-sm' }, tpl(t('sop_progress'), { k: pr.ok, n: pr.req }))),
          pend.length ? h('div', { className: 'sop-pend' },
            h('span', { className: 'lor-eyebrow' }, t('sop_pending')),
            pend.map(function (uid) { return h('span', { key: uid, className: 'lvl-person' }, h(Av, { name: userOf(db, uid).name, src: userOf(db, uid).avatar, size: 24 }), userOf(db, uid).name); }),
            h(Btn, { variant: 'outline', size: 'sm', onClick: function () { remind(x); } }, t('sop_remind'))) : null);
      }) : h('section', { className: 'box' }, h('p', { className: 'lor-muted', style: { margin: 0 } }, t('sop_none'))));
  }

  function QualityAdmin(p) {
    var t = p.t, db = p.db, tb = useState(p.tab || 'err'), tab = tb[0];
    useEffect(function () { if (p.tab) tb[1](p.tab); }, [p.tab]);
    var tabs = [['err', t('q_tab_err'), errStats(db, 90).open], ['risk', t('q_tab_risk'), sopRisk(db, 90).filter(riskHot).length], ['drill', t('q_tab_drill'), (db.drills || []).length],
      ['sop', t('q_tab_sop'), (db.sopUpdates || []).filter(function (x) { return (x.required || []).some(function (uid) { return !(x.acks || {})[uid]; }); }).length]];
    return h('div', { className: 'app-wrap' },
      h('div', { className: 'page-head' }, h('div', null, h('span', { className: 'lor-eyebrow' }, t('q_eyebrow')), h('h1', { className: 'lor-title' }, t('nav_quality'), h(PageTip, { t: t, id: 'quality' })))),
      h('div', { className: 'lor-tabs fb-tabs', role: 'tablist' }, tabs.map(function (x) {
        return h('button', { key: x[0], type: 'button', role: 'tab', 'aria-selected': tab === x[0], className: cx('lor-tab', tab === x[0] && 'is-on'), onClick: function () { tb[1](x[0]); } }, x[1], h('span', { className: 'lor-count' }, x[2]));
      })),
      tab === 'err' ? h(ErrorsAdmin, p) : tab === 'risk' ? h(SopRiskAdmin, p) : tab === 'drill' ? h(DrillsAdmin, p) : h(UpdatesAdmin, p));
  }

  /* ======================= FEATURES 4: case studies (keys-stadi) + the AI that answers from them ======================= */

  var CASE_AREAS = ['warehouse', 'transport', 'customs', 'clients', 'office', 'it', 'other'];
  function allCases(db) { return (db.cases || []).slice().sort(function (a, b) { return b.at - a.at; }); }
  function pubCases(db) { return allCases(db).filter(function (c) { return c.status === 'published'; }); }
  function caseById(db, id) { return (db.cases || []).filter(function (c) { return c.id === id; })[0]; }
  function casesForLesson(db, lid) { return pubCases(db).filter(function (c) { return (c.lessonIds || []).indexOf(lid) >= 0; }); }
  function caseText(c) {
    return [c.title, c.situation, (c.actions || []).map(function (x, i) { return (i + 1) + '. ' + x; }).join('\n'), c.result ? 'Natija: ' + c.result : '', c.lesson ? 'Xulosa: ' + c.lesson : '', c.mistakes ? 'Xatolar: ' + c.mistakes : '', (c.tags || []).join(', ')].filter(Boolean).join('\n');
  }
  /* same keyword scoring as the lesson search, but over cases */
  function pickCases(list, q, n) {
    var qs = Object.keys(stems(q));
    var scored = list.map(function (c) {
      var st = stems(caseText(c)), ti = stems(c.title + ' ' + (c.tags || []).join(' ')), sc = 0;
      qs.forEach(function (w) { if (st[w]) sc += 1; if (ti[w]) sc += 4; });
      return { c: c, sc: sc };
    }).filter(function (x) { return x.sc > 0; }).sort(function (a, b) { return b.sc - a.sc; });
    return scored.slice(0, n || 3).map(function (x) { return x.c; });
  }
  function blankCase() { return { id: null, title: '', area: 'warehouse', lessonIds: [], tags: [], situation: '', actions: [''], result: '', lesson: '', mistakes: '', status: 'draft' }; }
  function caseErrors(c, t) {
    var e = {};
    if (!String(c.title || '').trim()) e.title = t('fill_required');
    if (String(c.situation || '').trim().length < 20) e.situation = t('cs_short');
    if (!String(c.lesson || '').trim()) e.lesson = t('fill_required');
    return e;
  }

  function CaseCard(p) {
    var c = p.c, t = p.t, db = p.db;
    return h('button', { type: 'button', className: cx('cs-card', 'ar-' + c.area, c.status === 'draft' && 'is-draft'), onClick: p.onOpen },
      h('div', { className: 'cs-card-h' },
        h('span', { className: 'cs-ico' }, h(Ico, { name: 'case', size: 18 })),
        h('span', { className: 'cs-area' }, t('ia_' + c.area)),
        c.status === 'draft' ? h(Badge, { status: 'todo', lang: p.lang }, t('cs_draft')) : null,
        h('span', { className: 'cs-date' }, fmtDate(c.at))),
      h('b', { className: 'cs-title' }, c.title),
      h('p', { className: 'cs-sit' }, String(c.situation || '').slice(0, 150) + (String(c.situation || '').length > 150 ? '…' : '')),
      h('div', { className: 'cs-tags' }, (c.tags || []).slice(0, 3).map(function (x) { return h('span', { key: x, className: 'cs-tag' }, x); }),
        (c.lessonIds || []).length ? h('span', { className: 'cs-tag is-sop' }, (c.lessonIds || []).length + ' ' + t('cs_sop_n')) : null));
  }

  function CaseView(p) {
    var c = p.c, t = p.t, db = p.db;
    return h('article', { className: 'box cs-view' },
      h('div', { className: 'cs-view-h' },
        h('button', { type: 'button', className: 'app-link', onClick: p.onBack }, '← ' + t('cs_back')),
        h('span', { className: 'cs-area' }, t('ia_' + c.area)),
        h('span', { className: 'cs-date' }, fmtDate(c.at))),
      h('h2', { className: 'cs-view-t' }, c.title),
      (c.tags || []).length ? h('div', { className: 'cs-tags' }, c.tags.map(function (x) { return h('span', { key: x, className: 'cs-tag' }, x); })) : null,
      h('div', { className: 'cs-sec' }, h('span', { className: 'lor-eyebrow' }, t('cs_situation')), h('p', { className: 'ini-pre' }, c.situation)),
      (c.actions || []).filter(Boolean).length ? h('div', { className: 'cs-sec' }, h('span', { className: 'lor-eyebrow' }, t('cs_actions')),
        h('ol', { className: 'cs-steps' }, c.actions.filter(Boolean).map(function (x, i) { return h('li', { key: i }, x); }))) : null,
      c.result ? h('div', { className: 'cs-sec is-result' }, h('span', { className: 'lor-eyebrow' }, t('cs_result')), h('p', { className: 'ini-pre' }, c.result)) : null,
      c.mistakes ? h('div', { className: 'cs-sec is-bad' }, h('span', { className: 'lor-eyebrow' }, t('cs_mistakes')), h('p', { className: 'ini-pre' }, c.mistakes)) : null,
      h('div', { className: 'cs-sec is-lesson' }, h('span', { className: 'lor-eyebrow' }, t('cs_lesson')), h('p', { className: 'ini-pre' }, c.lesson)),
      (c.lessonIds || []).length ? h('div', { className: 'cs-sec' }, h('span', { className: 'lor-eyebrow' }, t('cs_sop')),
        h('div', { className: 'cs-sops' }, c.lessonIds.map(function (id) {
          var l = findLesson(db.course, id); if (!l) return null;
          return h('button', { key: id, type: 'button', className: 'ai-chip', onClick: function () { if (p.onLesson) p.onLesson(id); } }, l.title);
        }))) : null);
  }

  /* ---------- employee: the AI that answers only from case studies ---------- */
  function CaseAI(p) {
    var t = p.t, db = p.db, u = p.user, sampler = p.sampler, lang = p.lang;
    var ms = useState([]), msgs = ms[0], inp = useState(''), busy = useState(false), ctl = useRef(null), listRef = useRef(null);
    var list = pubCases(db);
    useEffect(function () { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [msgs]);
    useEffect(function () { return function () { if (ctl.current) ctl.current.abort(); }; }, []);
    function patch(fn) { ms[1](function (prev) { var c = prev.slice(), last = Object.assign({}, c[c.length - 1]); fn(last); c[c.length - 1] = last; return c; }); }
    function send(text) {
      text = (text || '').trim(); if (!text || busy[0] || !sampler) return;
      var picks = pickCases(list, text, 3);
      if (!picks.length) picks = list.slice(0, 3);
      var rules = 'Siz BURAQ Logistics kompaniyasining o‘quv platformasidagi KEYS-MENTOR sun’iy intellektisiz. Siz faqat kompaniyaning haqiqiy keys-stadilariga (real ish holatlariga) tayanib javob berasiz.\n' +
        'Qoidalar:\n- Faqat quyida berilgan KEYSLAR matniga tayaning. Keyslarda yo‘q narsani o‘ylab topmang.\n- Javobingizni shunday tuzing: avval qaysi keys mos kelishini ayting, keyin o‘sha holatda nima qilingani va nima o‘rgatgani.\n- Agar savolga mos keys bo‘lmasa, buni ochiq ayting va AI-mentordan (standartlar bo‘yicha) so‘rashni taklif qiling.\n- Qisqa yozing: 120 so‘zgacha, kerak bo‘lsa qadamlar ro‘yxati bilan. Jadval ishlatmang.\n- Javob oxirida bitta qatorda foydalangan keys sarlavhasini yozing, masalan: "Keys: ' + (picks[0] ? picks[0].title : '…') + '".\n' +
        '- Javob tili: ' + (LANG_NAME[lang] || LANG_NAME.uz) + '.\n' +
        'Foydalanuvchi: ' + u.name + ', lavozimi: ' + u.position + '.\n\nKEYSLAR:\n' +
        picks.map(function (c) { return '=== ' + c.title + ' ===\n' + caseText(c); }).join('\n\n');
      var hist = msgs.filter(function (m) { return !m.error && m.content; }).slice(-4).map(function (m) { return { role: m.role, content: m.content }; });
      var turns = [{ role: 'user', content: rules }].concat(hist).concat([{ role: 'user', content: text }]);
      ms[1](msgs.concat([{ role: 'user', content: text }, { role: 'assistant', content: '', streaming: true, src: picks.map(function (c) { return { id: c.id, title: c.title }; }) }]));
      inp[1](''); busy[1](true);
      var ab = new AbortController(); ctl.current = ab;
      sampler(turns, { signal: ab.signal, onText: function (x) { patch(function (m) { m.content = x.text; }); } })
        .then(function (r) { patch(function (m) { m.content = r.text; m.streaming = false; }); })
        .catch(function (e) { patch(function (m) { m.streaming = false; m.error = aiErr(e, t); }); })
        .then(function () { busy[1](false); });
    }
    var sugg = t('cs_ai_sugg').split('|');
    return h('section', { className: 'box cs-ai' },
      h('div', { className: 'cs-ai-h' },
        h('span', { className: 'pb-av big' }, h(Ico, { name: 'case', size: 22 })),
        h('div', null, h('h2', { className: 'lor-h' }, t('cs_ai_t')), h('p', { className: 'lor-sm lor-muted' }, tpl(t('cs_ai_s'), { n: list.length }))),
        msgs.length ? h('button', { type: 'button', className: 'app-link', onClick: function () { if (ctl.current) ctl.current.abort(); ms[1]([]); } }, t('ai_clear')) : null),
      msgs.length ? h('div', { className: 'cs-ai-list', ref: listRef, 'aria-live': 'polite' }, msgs.map(function (m, i) {
        if (m.role === 'user') return h('div', { key: i, className: 'ai-msg is-user' }, m.content);
        return h('div', { key: i, className: 'ai-msg is-ai' },
          m.content ? h('div', { className: 'ai-md', dangerouslySetInnerHTML: { __html: mdLite(m.content) } }) : m.streaming ? h('p', { className: 'ai-thinking' }, t('ai_thinking')) : null,
          m.error ? h('p', { className: 'lor-field-error' }, m.error) : null,
          !m.streaming && !m.error && m.src && m.src.length ? h('div', { className: 'ai-src' }, h('span', null, t('cs_ai_src') + ':'), m.src.map(function (s) {
            return h('button', { key: s.id, type: 'button', className: 'ai-chip', onClick: function () { p.onOpen(s.id); } }, s.title);
          })) : null);
      })) : h('div', { className: 'cs-ai-empty' },
        h('p', { className: 'lor-sm lor-muted' }, sampler === null ? t('ai_unavail') : t('cs_ai_hint')),
        h('div', { className: 'ai-sugg' }, sugg.map(function (s) { return h('button', { key: s, type: 'button', disabled: !sampler, onClick: function () { send(s); } }, s); }))),
      h('form', { className: 'cs-ai-form', onSubmit: function (e) { e.preventDefault(); send(inp[0]); } },
        h('textarea', { id: 'cs-input', className: 'lor-input', rows: 2, value: inp[0], placeholder: t('cs_ai_ph'), disabled: !sampler, 'aria-label': t('cs_ai_ph'), onChange: function (e) { inp[1](e.target.value); }, onKeyDown: function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(inp[0]); } } }),
        busy[0] ? h(Btn, { variant: 'outline', size: 'sm', onClick: function () { if (ctl.current) ctl.current.abort(); } }, t('ai_stop'))
          : h(Btn, { variant: 'primary', size: 'sm', type: 'submit', disabled: !sampler || !inp[0].trim() }, t('ai_send'))));
  }

  function CasesPage(p) {
    var t = p.t, db = p.db, list = pubCases(db);
    var open = useState(p.caseId || null), far = useState(''), q = useState('');
    useEffect(function () { if (p.caseId) open[1](p.caseId); }, [p.caseId]);
    var cur = open[0] ? caseById(db, open[0]) : null;
    var rows = list.filter(function (c) { return (!far[0] || c.area === far[0]) && (!q[0].trim() || pickCases([c], q[0], 1).length); });
    return h('div', { className: 'app-wrap' },
      h('div', { className: 'page-head' },
        h('div', null, h('span', { className: 'lor-eyebrow' }, t('cs_eyebrow')), h('h1', { className: 'lor-title' }, t('nav_cases'), h(PageTip, { t: t, id: 'cases' }))),
        h('span', { className: 'lor-sm lor-muted' }, tpl(t('cs_count'), { n: list.length }))),
      cur ? h(CaseView, { c: cur, t: t, db: db, lang: p.lang, onBack: function () { open[1](null); }, onLesson: function (id) { p.go({ name: 'lesson', id: id }); } })
        : h(F, null,
          h(CaseAI, Object.assign({}, p, { onOpen: function (id) { open[1](id); window.scrollTo(0, 0); } })),
          h('div', { className: 'filters' },
            h(Field, { name: 'cs-q', label: t('cs_search'), value: q[0], placeholder: t('cs_search_ph'), onChange: q[1] }),
            h(Field, { name: 'cs-ar', label: t('ini_area'), value: far[0], options: [['', t('all')]].concat(CASE_AREAS.map(function (x) { return [x, t('ia_' + x)]; })), onChange: far[1] })),
          rows.length ? h('div', { className: 'cs-grid' }, rows.map(function (c) { return h(CaseCard, { key: c.id, c: c, t: t, db: db, lang: p.lang, onOpen: function () { open[1](c.id); window.scrollTo(0, 0); } }); }))
            : h('section', { className: 'box' }, h('p', { className: 'lor-muted', style: { margin: 0 } }, t('cs_none')))));
  }

  /* ---------- admin: write and publish case studies ---------- */
  function CasesAdmin(p) {
    var t = p.t, db = p.db, sampler = p.sampler, list = allCases(db);
    var ed = useState(null), draft = ed[0], er = useState({}), busy = useState(''), aiErrS = useState(''), del = useState(false), tried = useRef(false);
    var ls = flat(db.course);
    /* once a save has been attempted, errors clear as soon as the field is fixed */
    function setD(fn) { var c = clone(draft); fn(c); ed[1](c); if (tried.current) er[1](caseErrors(c, t)); }
    function startNew() { ed[1](blankCase()); er[1]({}); tried.current = false; del[1](false); window.scrollTo(0, 0); }
    function edit(c) { ed[1](clone(c)); er[1]({}); tried.current = false; del[1](false); window.scrollTo(0, 0); }
    function save(status) {
      var c = clone(draft); c.status = status;
      tried.current = true;
      var e = caseErrors(c, t); er[1](e);
      if (Object.keys(e).length) { setTimeout(function () { var el = document.querySelector('.cs-form .lor-field-error'); if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 30); return; }
      c.title = c.title.trim(); c.situation = c.situation.trim(); c.lesson = c.lesson.trim(); c.result = (c.result || '').trim(); c.mistakes = (c.mistakes || '').trim();
      c.actions = (c.actions || []).map(function (x) { return String(x).trim(); }).filter(Boolean);
      c.tags = (c.tags || []).map(function (x) { return String(x).trim(); }).filter(Boolean);
      p.update(function (d) {
        d.cases = d.cases || [];
        if (c.id) d.cases = d.cases.map(function (x) { return x.id === c.id ? Object.assign({}, x, c) : x; });
        else { c.id = 'c' + nextId(d); c.at = Date.now(); c.by = p.user.id; d.cases.unshift(c); }
      });
      ed[1](null); p.say(status === 'published' ? t('cs_published') : t('cs_saved'));
    }
    function remove() { var id = draft.id; p.update(function (d) { d.cases = (d.cases || []).filter(function (x) { return x.id !== id; }); }); ed[1](null); p.say(t('cs_deleted')); }
    function autoLink() {
      var picks = pickLessons(ls, draft.title + ' ' + draft.situation + ' ' + (draft.tags || []).join(' '), null, 3);
      setD(function (c) { c.lessonIds = picks.map(function (l) { return l.id; }); });
    }
    function aiFill() {
      if (!sampler || busy[0]) return;
      var prompt = 'Siz BURAQ Logistics kompaniyasining SOP menejeriga yordam beruvchi AI-muharrirsiz. Quyida haqiqiy ish holati (keys) haqida qisqa yozuv berilgan. Uni xodimlar o‘rganadigan to‘liq keys-stadiga aylantiring.\n' +
        'Qoidalar: faqat berilgan matndagi faktlarga tayaning, yangi raqam, ism yoki sana o‘ylab topmang. Noma’lum joyni [SOP menejeri to‘ldiradi] deb belgilang. Til: ' + (LANG_NAME[p.lang] || LANG_NAME.uz) + '.\n' +
        'Faqat JSON qaytaring: {"title":"qisqa sarlavha (70 belgigacha)","situation":"nima bo‘ldi — 2-4 gap","actions":["qadam 1","qadam 2"],"result":"natija, raqamlar bilan","lesson":"xulosa: xodim nimani o‘rganishi kerak — 1-3 gap","mistakes":"qanday xato qilingan","tags":["teg1","teg2","teg3"]}\n\n' +
        'YOZUV:\nSarlavha: ' + (draft.title || '—') + '\nHolat: ' + (draft.situation || '—') + '\nQo‘shimcha: ' + [(draft.actions || []).join('; '), draft.result, draft.lesson, draft.mistakes].filter(Boolean).join(' | ');
      busy[1]('fill'); aiErrS[1]('');
      sampler.json(prompt, {}).then(function (r) {
        if (!r || typeof r !== 'object') { aiErrS[1](t('ai_bad_json')); return; }
        setD(function (c) {
          if (r.title) c.title = String(r.title).slice(0, 90);
          if (r.situation) c.situation = String(r.situation);
          if (Array.isArray(r.actions) && r.actions.length) c.actions = r.actions.map(String).slice(0, 8);
          if (r.result) c.result = String(r.result);
          if (r.lesson) c.lesson = String(r.lesson);
          if (r.mistakes) c.mistakes = String(r.mistakes);
          if (Array.isArray(r.tags)) c.tags = r.tags.map(String).slice(0, 5);
        });
        p.say(t('cs_ai_done'));
      }).catch(function (e) { aiErrS[1](e && e.code === 'invalid_json' ? t('ai_bad_json') : aiErr(e, t)); }).then(function () { busy[1](''); });
    }
    if (draft) return h('div', { className: 'cms-case-edit' },
      h('div', { className: 'page-head' },
        h('div', null, h('span', { className: 'lor-eyebrow' }, t('cs_eyebrow')), h('h2', { className: 'lor-title' }, draft.id ? t('cs_edit') : t('cs_new'))),
        h(Btn, { variant: 'ghost', onClick: function () { ed[1](null); } }, t('cancel'))),
      h('section', { className: 'box cs-form' },
        h('div', { className: 'cs-ai-bar' },
          h(Btn, { variant: 'outline', size: 'sm', disabled: !sampler || !!busy[0] || !String(draft.situation || '').trim(), onClick: aiFill }, busy[0] === 'fill' ? t('ai_thinking') : '✦ ' + t('cs_ai_fill')),
          h('span', { className: 'lor-sm lor-muted' }, sampler === null ? t('ai_unavail') : t('cs_ai_fill_hint'))),
        aiErrS[0] ? h('p', { className: 'lor-field-error', style: { margin: 0 } }, aiErrS[0]) : null,
        h('div', { className: 'lor-form-grid' },
          h(Field, { name: 'cs-title', span: true, label: t('cs_title'), required: true, value: draft.title, error: er[0].title, placeholder: t('cs_title_ph'), onChange: function (v) { setD(function (c) { c.title = v; }); } }),
          h(Field, { name: 'cs-area', label: t('ini_area'), value: draft.area, options: CASE_AREAS.map(function (x) { return [x, t('ia_' + x)]; }), onChange: function (v) { setD(function (c) { c.area = v; }); } }),
          h(Field, { name: 'cs-tags', label: t('cs_tags'), value: (draft.tags || []).join(', '), placeholder: t('cs_tags_ph'), onChange: function (v) { setD(function (c) { c.tags = v.split(',').map(function (x) { return x.trim(); }).filter(Boolean); }); } }),
          h(Field, { name: 'cs-sit', span: true, multiline: true, rows: 4, label: t('cs_situation'), required: true, value: draft.situation, error: er[0].situation, placeholder: t('cs_situation_ph'), onChange: function (v) { setD(function (c) { c.situation = v; }); } })),
        h('h3', { className: 'cms-h' }, t('cs_actions')),
        (draft.actions || []).map(function (x, i) {
          return h('div', { key: i, className: 'cms-step' }, h('span', { className: 'lor-step-n' }, pad(i + 1)),
            h('div', { className: 'cms-step-body' },
              h(Field, { name: 'cs-a' + i, value: x, placeholder: t('cs_action_ph'), onChange: function (v) { setD(function (c) { c.actions[i] = v; }); } }),
              h('div', { className: 'cms-mini' }, h('button', { type: 'button', className: 'app-link danger', onClick: function () { setD(function (c) { c.actions.splice(i, 1); }); } }, t('remove')))));
        }),
        h('div', null, h(Btn, { variant: 'outline', size: 'sm', onClick: function () { setD(function (c) { c.actions.push(''); }); } }, '+ ' + t('cs_add_action'))),
        h('div', { className: 'lor-form-grid' },
          h(Field, { name: 'cs-res', span: true, multiline: true, rows: 2, label: t('cs_result'), value: draft.result, placeholder: t('cs_result_ph'), onChange: function (v) { setD(function (c) { c.result = v; }); } }),
          h(Field, { name: 'cs-mis', span: true, multiline: true, rows: 2, label: t('cs_mistakes'), value: draft.mistakes, placeholder: t('cs_mistakes_ph'), onChange: function (v) { setD(function (c) { c.mistakes = v; }); } }),
          h(Field, { name: 'cs-les', span: true, multiline: true, rows: 3, label: t('cs_lesson'), required: true, value: draft.lesson, error: er[0].lesson, placeholder: t('cs_lesson_ph'), onChange: function (v) { setD(function (c) { c.lesson = v; }); } })),
        h('h3', { className: 'cms-h' }, t('cs_sop')),
        h('div', { className: 'cs-sop-pick' },
          h(Field, { name: 'cs-add-sop', label: t('cs_add_sop'), value: '', options: [['', '—']].concat(ls.filter(function (l) { return (draft.lessonIds || []).indexOf(l.id) < 0; }).map(function (l) { return [l.id, l.title]; })), onChange: function (v) { if (v) setD(function (c) { c.lessonIds = (c.lessonIds || []).concat([v]); }); } }),
          h(Btn, { variant: 'outline', size: 'sm', onClick: autoLink }, '✦ ' + t('cs_autolink'))),
        (draft.lessonIds || []).length ? h('div', { className: 'cs-sops' }, draft.lessonIds.map(function (id) {
          var l = findLesson(db.course, id);
          return h('span', { key: id, className: 'cs-sop-chip' }, l ? l.title : id,
            h('button', { type: 'button', 'aria-label': t('remove'), onClick: function () { setD(function (c) { c.lessonIds = c.lessonIds.filter(function (y) { return y !== id; }); }); } }, '×'));
        })) : h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('cs_no_sop')),
        h('div', { className: 'cms-foot' },
          draft.id ? (del[0] ? h('span', { className: 'cms-confirm' }, t('confirm_del'), ' ', h(Btn, { variant: 'ghost', size: 'sm', onClick: function () { del[1](false); } }, t('cancel')), h(Btn, { variant: 'outline', size: 'sm', onClick: remove }, t('yes_del')))
            : h('button', { type: 'button', className: 'app-link danger', onClick: function () { del[1](true); } }, t('cs_delete'))) : h('span'),
          h('div', { className: 'cs-foot-b' },
            h(Btn, { variant: 'outline', onClick: function () { save('draft'); } }, t('cs_save_draft')),
            h(Btn, { variant: 'primary', arrow: true, onClick: function () { save('published'); } }, t('cs_publish'))))));

    return h('div', null,
      h('div', { className: 'cs-admin-h' },
        h('div', null, h('h2', { className: 'lor-h' }, t('cs_admin_t')), h('p', { className: 'lor-sm lor-muted', style: { margin: '4px 0 0' } }, t('cs_admin_s'))),
        h(Btn, { variant: 'primary', arrow: true, onClick: startNew }, t('cs_new'))),
      h('div', { className: 'tiles' },
        [[t('cs_t_all'), list.length], [t('cs_t_pub'), list.filter(function (c) { return c.status === 'published'; }).length], [t('cs_t_draft'), list.filter(function (c) { return c.status === 'draft'; }).length],
          [t('cs_t_sop'), list.filter(function (c) { return (c.lessonIds || []).length; }).length]].map(function (x) { return h('div', { key: x[0], className: 'tile' }, h('span', { className: 'lor-eyebrow' }, x[0]), h('b', null, x[1])); })),
      list.length ? h('div', { className: 'cs-grid' }, list.map(function (c) { return h(CaseCard, { key: c.id, c: c, t: t, db: db, lang: p.lang, onOpen: function () { edit(c); } }); }))
        : h('section', { className: 'box' }, h('p', { className: 'lor-muted', style: { margin: 0 } }, t('cs_admin_empty'))));
  }

  /* lesson page: the real situations behind this standard */
  function LessonCases(p) {
    var t = p.t, list = casesForLesson(p.db, p.lessonId);
    if (!list.length) return null;
    return h('div', { className: 'lesson-cases' },
      h('span', { className: 'lor-eyebrow' }, t('cs_for_sop') + ' · ' + list.length),
      h('ul', null, list.map(function (c) {
        return h('li', { key: c.id }, h('span', { className: 'cs-ico sm' }, h(Ico, { name: 'case', size: 14 })),
          h('button', { type: 'button', className: 'app-link', onClick: function () { p.go({ name: 'cases', id: c.id }); } }, c.title));
      })));
  }

  /* ======================= FEATURES 5: company database (journal templates) + terminology, access controlled by the SOP manager ======================= */

  var COL_TYPES = ['text', 'number', 'date', 'select', 'user'];
  var FILE_MAX = 1500000, FILES_MAX = 6;
  function fileSize(n) { return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; }
  function fileExt(name) { var m = String(name || '').split('.'); return m.length > 1 ? m.pop().toUpperCase().slice(0, 4) : 'FILE'; }
  var TERM_CATS = ['doc', 'warehouse', 'transport', 'customs', 'general'];

  /* a term can carry a translation for the interface languages; the source text stays the fallback */
  var TERM_LANGS = ['zh'];
  function tmF(x, lang, f) {
    var tr = (x.i18n || {})[lang];
    if (f === 'syn') { var v = tr && tr.syn; return v && v.length ? v : (x.syn || []); }
    return (tr && tr[f]) || x[f] || '';
  }
  function termSearchText(x, lang) { return [tmF(x, lang, 'term'), tmF(x, lang, 'short'), tmF(x, lang, 'def'), tmF(x, lang, 'syn').join(' '), x.term, x.short, (x.syn || []).join(' ')].join(' '); }

  function journalsAll(db) { return (db.journals || []).slice(); }
  function termsAll(db) { return (db.terms || []).slice(); }
  function journalById(db, id) { return (db.journals || []).filter(function (x) { return x.id === id; })[0]; }
  function emps(db) { return db.users.filter(function (u) { return u.role === 'employee'; }); }
  function uniq(a) { return a.filter(function (x, i) { return x && a.indexOf(x) === i; }); }
  function deptList(db) { return uniq(emps(db).map(function (u) { return u.department; })).sort(); }
  function posList(db) { return uniq(emps(db).map(function (u) { return u.position; })).sort(); }

  /* who may see a journal / term — the SOP manager sets this per record */
  function canSee(db, u, a) {
    if (!u) return false;
    if (u.role === 'admin') return true;
    a = a || { mode: 'all' };
    if (a.mode === 'all') return true;
    if (a.mode === 'official') return u.status === 'official';
    var hasD = (a.depts || []).length, hasP = (a.positions || []).length, hasL = (a.minLevel || 0) > 0, hasU = (a.users || []).length;
    if (hasU && a.users.indexOf(u.id) >= 0) return true;
    if (!hasD && !hasP && !hasL) return false;
    if (hasD && a.depts.indexOf(u.department) < 0) return false;
    if (hasP && a.positions.indexOf(u.position) < 0) return false;
    if (hasL && (u.level || 0) < a.minLevel) return false;
    return true;
  }
  function canAddRow(db, u, j) {
    if (!j) return false;
    if (u.role === 'admin') return true;
    return j.status === 'published' && (j.access || {}).canAdd === 'viewers' && canSee(db, u, j.access);
  }
  function journalsFor(db, u) { return journalsAll(db).filter(function (j) { return (u.role === 'admin' || j.status === 'published') && canSee(db, u, j.access); }); }
  function termsFor(db, u) { return termsAll(db).filter(function (x) { return (u.role === 'admin' || x.status === 'published') && canSee(db, u, x.access); }); }
  function seenBy(db, a) { return emps(db).filter(function (u) { return canSee(db, u, a); }).length; }

  function accessLabel(db, a, t, lang) {
    a = a || { mode: 'all' };
    if (a.mode === 'all') return t('ac_all');
    if (a.mode === 'official') return t('ac_official');
    var L = levelsOf(db), parts = [];
    if ((a.depts || []).length) parts.push(a.depts.join(', '));
    if ((a.positions || []).length) parts.push(a.positions.join(', '));
    if (a.minLevel) parts.push(lvlShort(L[a.minLevel], lang) + '+');
    if ((a.users || []).length) parts.push(tpl(t('ac_named_n'), { n: a.users.length }));
    return parts.length ? parts.join(' · ') : t('ac_nobody');
  }

  /* ---------- shared: the access rule editor (used for journals and terms) ---------- */
  function AccessEditor(p) {
    var t = p.t, db = p.db, a = p.value || acc('all'), L = levelsOf(db);
    function set(fn) { var c = clone(a); fn(c); p.onChange(c); }
    function tog(k, v) { set(function (c) { c[k] = c[k] || []; var i = c[k].indexOf(v); if (i < 0) c[k].push(v); else c[k].splice(i, 1); }); }
    return h('div', { className: 'ac-box' },
      h('div', { className: 'ac-head' },
        h('span', { className: 'lor-eyebrow' }, t('ac_title')),
        h('span', { className: 'ac-count' }, tpl(t('ac_seen_by'), { n: seenBy(db, a) }))),
      h('div', { className: 'ac-modes' }, [['all', t('ac_all'), t('ac_all_h')], ['official', t('ac_official'), t('ac_official_h')], ['custom', t('ac_custom'), t('ac_custom_h')]].map(function (m) {
        return h('label', { key: m[0], className: cx('ac-mode', a.mode === m[0] && 'is-on') },
          h('input', { type: 'radio', name: 'ac-mode-' + (p.name || 'x'), checked: a.mode === m[0], onChange: function () { set(function (c) { c.mode = m[0]; }); } }),
          h('span', null, h('b', null, m[1]), h('small', null, m[2])));
      })),
      a.mode === 'custom' ? h('div', { className: 'ac-custom' },
        h('div', { className: 'ac-grp' }, h('span', { className: 'lor-field-label' }, t('department')),
          h('div', { className: 'ac-chips' }, deptList(db).map(function (d) {
            return h('label', { key: d, className: cx('ac-chip', (a.depts || []).indexOf(d) >= 0 && 'is-on') }, h('input', { type: 'checkbox', checked: (a.depts || []).indexOf(d) >= 0, onChange: function () { tog('depts', d); } }), d);
          }))),
        h('div', { className: 'ac-grp' }, h('span', { className: 'lor-field-label' }, t('ac_positions')),
          h('div', { className: 'ac-chips' }, posList(db).map(function (d) {
            return h('label', { key: d, className: cx('ac-chip', (a.positions || []).indexOf(d) >= 0 && 'is-on') }, h('input', { type: 'checkbox', checked: (a.positions || []).indexOf(d) >= 0, onChange: function () { tog('positions', d); } }), d);
          }))),
        h('div', { className: 'ac-grp' },
          h(Field, { name: 'ac-lvl-' + (p.name || 'x'), label: t('ac_min_level'), value: String(a.minLevel || 0), options: [['0', t('ac_any_level')]].concat(L.map(function (l, i) { return [String(i), lvlShort(l, p.lang) + '+']; })), onChange: function (v) { set(function (c) { c.minLevel = +v; }); } })),
        h('div', { className: 'ac-grp' }, h('span', { className: 'lor-field-label' }, t('ac_named')),
          h('div', { className: 'ac-chips' }, emps(db).map(function (u) {
            return h('label', { key: u.id, className: cx('ac-chip', (a.users || []).indexOf(u.id) >= 0 && 'is-on') }, h('input', { type: 'checkbox', checked: (a.users || []).indexOf(u.id) >= 0, onChange: function () { tog('users', u.id); } }), u.name);
          })),
          h('span', { className: 'lor-field-hint' }, t('ac_named_h'))))
        : null,
      p.withAdd ? h('div', { className: 'ac-grp' },
        h(Field, { name: 'ac-add-' + (p.name || 'x'), label: t('ac_can_add'), value: a.canAdd || 'none', options: [['none', t('ac_add_none')], ['viewers', t('ac_add_viewers')]], hint: t('ac_can_add_h'), onChange: function (v) { set(function (c) { c.canAdd = v; }); } })) : null);
  }

  /* ---------- journal rendering ---------- */
  function cellText(db, c, v) {
    if (v == null || v === '') return '—';
    if (c.type === 'user') return userOf(db, +v).name;
    if (c.type === 'date') { var pr = String(v).split('-'); return pr.length === 3 ? pr[2] + '.' + pr[1] + '.' + pr[0] : String(v); }
    return String(v);
  }
  function rowText(db, j, r) { return (j.columns || []).map(function (c) { return cellText(db, c, (r.v || {})[c.key]); }).join(' '); }
  function blankRowV(j, u) {
    var v = {};
    (j.columns || []).forEach(function (c) { v[c.key] = c.type === 'date' ? dayKey(Date.now()) : c.type === 'user' ? String(u.id) : c.type === 'select' ? (c.options || [''])[0] : ''; });
    return v;
  }
  function rowErrors(j, v, t) {
    var e = {};
    (j.columns || []).forEach(function (c) { if (!c.opt && !String(v[c.key] == null ? '' : v[c.key]).trim()) e[c.key] = t('fill_required'); });
    return e;
  }

  function RowForm(p) {
    var t = p.t, db = p.db, j = p.j;
    var v = useState(blankRowV(j, p.user)), er = useState({}), tried = useRef(false);
    function set(k, x) { var c = Object.assign({}, v[0]); c[k] = x; v[1](c); if (tried.current) er[1](rowErrors(j, c, t)); }
    function save() {
      tried.current = true;
      var e = rowErrors(j, v[0], t); er[1](e);
      if (Object.keys(e).length) return;
      var val = clone(v[0]);
      p.update(function (d) {
        var jj = (d.journals || []).filter(function (x) { return x.id === j.id; })[0];
        if (jj) jj.rows.unshift({ id: 'r' + nextId(d), at: Date.now(), by: p.user.id, v: val });
      });
      v[1](blankRowV(j, p.user)); er[1]({}); tried.current = false;
      p.say(t('jr_row_added'));
      if (p.onDone) p.onDone();
    }
    return h('section', { className: 'box jr-form' },
      h('h3', { className: 'lor-h' }, t('jr_add_row')),
      h('div', { className: 'lor-form-grid' }, (j.columns || []).map(function (c) {
        var common = { key: c.key, name: 'jr-' + j.id + '-' + c.key, label: c.label, required: !c.opt, error: er[0][c.key], value: v[0][c.key], onChange: function (x) { set(c.key, x); } };
        if (c.type === 'select') return h(Field, Object.assign(common, { options: [['', '—']].concat((c.options || []).map(function (o) { return [o, o]; })) }));
        if (c.type === 'user') return h(Field, Object.assign(common, { options: [['', '—']].concat(db.users.map(function (u) { return [String(u.id), u.name]; })) }));
        if (c.type === 'date') return h(Field, Object.assign(common, { type: 'date' }));
        if (c.type === 'number') return h(Field, Object.assign(common, { type: 'number' }));
        return h(Field, Object.assign(common, { span: true }));
      })),
      h('div', { className: 'as-act' },
        p.onCancel ? h(Btn, { variant: 'ghost', onClick: p.onCancel }, t('cancel')) : null,
        h(Btn, { variant: 'primary', arrow: true, onClick: save }, t('jr_save_row'))));
  }

  function JournalTable(p) {
    var t = p.t, db = p.db, j = p.j, rows = p.rows;
    if (!rows.length) return h('section', { className: 'box' }, h('p', { className: 'lor-muted', style: { margin: 0 } }, t('jr_no_rows')));
    return h('div', { className: 'lor-table-wrap' }, h('table', { className: 'lor-table jr-table' },
      h('thead', null, h('tr', null,
        (j.columns || []).map(function (c) { return h('th', { key: c.key }, c.label); }),
        h('th', null, t('jr_added')),
        p.onDel ? h('th', { 'aria-label': t('remove') }) : null)),
      h('tbody', null, rows.map(function (r) {
        return h('tr', { key: r.id },
          (j.columns || []).map(function (c) { return h('td', { key: c.key, className: cx('jr-c-' + c.type) }, cellText(db, c, (r.v || {})[c.key])); }),
          h('td', { className: 'jr-meta' }, fmt(r.at, t), h('small', null, userOf(db, r.by).name)),
          p.onDel ? h('td', null, h('button', { type: 'button', className: 'app-link danger', onClick: function () { p.onDel(r.id); } }, t('remove'))) : null);
      }))));
  }

  /* document templates attached to a journal — blank forms the employee downloads */
  function TemplateList(p) {
    var t = p.t, files = p.files || [];
    if (!files.length) return p.empty ? h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('jf_none')) : null;
    return h('div', { className: 'jf-list' }, files.map(function (f) {
      return h('div', { key: f.id, className: 'jf-item' },
        h('span', { className: 'jf-ext' }, fileExt(f.name)),
        h('a', { className: 'jf-name', href: f.data, download: f.name, onClick: saveLink(f.name) }, f.name, h('small', null, fileSize(f.size || 0))),
        p.onDel ? h('button', { type: 'button', className: 'app-link danger', onClick: function () { p.onDel(f.id); } }, t('remove')) : null);
    }));
  }

  function TemplateUpload(p) {
    var t = p.t, er = useState(''), ref = useRef(null), files = p.files || [];
    function pick(e) {
      var list = Array.prototype.slice.call(e.target.files || []);
      e.target.value = '';
      if (!list.length) return;
      if (files.length + list.length > FILES_MAX) { er[1](tpl(t('jf_max_n'), { n: FILES_MAX })); return; }
      var big = list.filter(function (f) { return f.size > FILE_MAX; });
      if (big.length) { er[1](tpl(t('jf_too_big'), { name: big[0].name, n: fileSize(FILE_MAX) })); return; }
      er[1]('');
      list.forEach(function (f) {
        var rd = new FileReader();
        rd.onload = function () { p.onAdd({ id: 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: f.name, size: f.size, type: f.type || '', data: rd.result, at: Date.now() }); };
        rd.onerror = function () { er[1](t('jf_read_err')); };
        rd.readAsDataURL(f);
      });
    }
    return h('div', { className: 'jf-up' },
      h('input', { ref: ref, id: 'jf-input', type: 'file', multiple: true, className: 'jf-input', onChange: pick }),
      h('label', { className: 'lor-btn lor-btn-outline lor-btn-sm', htmlFor: 'jf-input' }, '+ ' + t('jf_add')),
      h('span', { className: 'lor-field-hint' }, tpl(t('jf_hint'), { n: fileSize(FILE_MAX), k: FILES_MAX })),
      er[0] ? h('p', { className: 'lor-field-error', style: { margin: 0 } }, er[0]) : null);
  }

  function JournalView(p) {
    var t = p.t, db = p.db, u = p.user, j = p.j, q = useState(''), add = useState(false);
    var rows = (j.rows || []).slice().sort(function (a, b) { return b.at - a.at; })
      .filter(function (r) { return !q[0].trim() || rowText(db, j, r).toLowerCase().indexOf(q[0].trim().toLowerCase()) >= 0; });
    var may = canAddRow(db, u, j);
    return h('div', { className: 'jr-view' },
      h('div', { className: 'jr-view-h' },
        h('button', { type: 'button', className: 'app-link', onClick: p.onBack }, '← ' + t('jr_back')),
        j.status === 'draft' ? h(Badge, { status: 'todo', lang: p.lang }, t('cs_draft')) : null),
      h('h2', { className: 'lor-title' }, j.title),
      j.desc ? h('p', { className: 'lor-sm lor-muted jr-desc' }, j.desc) : null,
      h('div', { className: 'jr-sub' },
        h('span', null, h(Ico, { name: 'lock', size: 14 }), ' ' + accessLabel(db, j.access, t, p.lang)),
        h('span', null, tpl(t('jr_rows_n'), { n: (j.rows || []).length })),
        may ? h('span', { className: 'jr-may' }, t('jr_may_add')) : h('span', null, t('jr_read_only'))),
      (j.files || []).length ? h('section', { className: 'box jf-box' },
        h('span', { className: 'lor-eyebrow' }, t('jf_title') + ' · ' + j.files.length),
        h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('jf_sub')),
        h(TemplateList, { t: t, files: j.files })) : null,
      h('div', { className: 'filters' }, h(Field, { name: 'jr-q-' + j.id, label: t('cs_search'), value: q[0], placeholder: t('jr_search_ph'), onChange: q[1] }),
        may ? h('div', { className: 'jr-add-btn' }, h(Btn, { variant: add[0] ? 'ghost' : 'primary', onClick: function () { add[1](!add[0]); } }, add[0] ? t('cancel') : '+ ' + t('jr_add_row'))) : null),
      add[0] && may ? h(RowForm, Object.assign({}, p, { j: j, onCancel: function () { add[1](false); }, onDone: function () { add[1](false); } })) : null,
      h(JournalTable, { t: t, db: db, j: j, rows: rows, onDel: p.onDel }));
  }

  function JournalCard(p) {
    var t = p.t, db = p.db, j = p.j;
    return h('button', { type: 'button', className: cx('jr-card', j.status === 'draft' && 'is-draft'), onClick: p.onOpen },
      h('div', { className: 'jr-card-h' }, h('span', { className: 'cs-ico' }, h(Ico, { name: 'doc', size: 18 })),
        j.status === 'draft' ? h(Badge, { status: 'todo', lang: p.lang }, t('cs_draft')) : null,
        h('span', { className: 'cs-date' }, tpl(t('jr_rows_n'), { n: (j.rows || []).length }))),
      h('b', { className: 'cs-title' }, j.title),
      h('p', { className: 'cs-sit' }, j.desc || ''),
      h('div', { className: 'jr-card-f' },
        h('span', { className: 'cs-tag' }, h(Ico, { name: 'lock', size: 12 }), ' ' + accessLabel(db, j.access, t, p.lang)),
        (j.files || []).length ? h('span', { className: 'cs-tag is-sop' }, tpl(t('jf_n'), { n: j.files.length })) : null,
        canAddRow(db, p.user, j) ? h('span', { className: 'cs-tag is-sop' }, t('jr_may_add')) : null));
  }

  /* ---------- employee: terminology ---------- */
  function TermItem(p) {
    var t = p.t, x = p.x, o = useState(false);
    return h('li', { className: cx('tm-item', o[0] && 'is-open') },
      h('button', { type: 'button', className: 'tm-head', 'aria-expanded': o[0], onClick: function () { o[1](!o[0]); } },
        h('span', { className: 'tm-term' }, tmF(x, p.lang, 'term'), x.status === 'draft' ? h('i', null, ' · ' + p.t('cs_draft')) : null),
        h('span', { className: 'tm-cat' }, t('tc_' + x.cat)),
        h('span', { className: 'tm-short' }, tmF(x, p.lang, 'short')),
        h('span', { className: 'tm-x', 'aria-hidden': true }, o[0] ? '−' : '+')),
      o[0] ? h('div', { className: 'tm-body' },
        h('p', { className: 'ini-pre' }, tmF(x, p.lang, 'def')),
        tmF(x, p.lang, 'syn').length ? h('p', { className: 'lor-sm lor-muted' }, t('tm_syn') + ': ' + tmF(x, p.lang, 'syn').join(', ')) : null,
        (x.i18n || {})[p.lang] && x.term !== tmF(x, p.lang, 'term') ? h('p', { className: 'lor-sm lor-muted tm-src' }, t('tm_source') + ': ' + x.term) : null,
        (x.lessonIds || []).length ? h('div', { className: 'cs-sops' }, x.lessonIds.map(function (id) {
          var l = findLesson(p.db.course, id); if (!l) return null;
          return h('button', { key: id, type: 'button', className: 'ai-chip', onClick: function () { if (p.onLesson) p.onLesson(id); } }, l.title);
        })) : null) : null);
  }

  function Glossary(p) {
    var t = p.t, db = p.db, list = p.list, q = useState(''), fc = useState('');
    var rows = list.filter(function (x) {
      if (fc[0] && x.cat !== fc[0]) return false;
      var s = q[0].trim().toLowerCase();
      return !s || termSearchText(x, p.lang).toLowerCase().indexOf(s) >= 0;
    }).sort(function (a, b) { return tmF(a, p.lang, 'term').localeCompare(tmF(b, p.lang, 'term'), p.lang === 'zh' ? 'zh-Hans' : undefined); });
    return h('div', null,
      h('div', { className: 'filters' },
        h(Field, { name: 'tm-q', label: t('cs_search'), value: q[0], placeholder: t('tm_search_ph'), onChange: q[1] }),
        h(Field, { name: 'tm-c', label: t('tm_cat'), value: fc[0], options: [['', t('all')]].concat(TERM_CATS.map(function (x) { return [x, t('tc_' + x)]; })), onChange: fc[1] })),
      rows.length ? h('ul', { className: 'tm-list' }, rows.map(function (x) { return h(TermItem, { key: x.id, x: x, t: t, db: db, lang: p.lang, onLesson: p.onLesson }); }))
        : h('section', { className: 'box' }, h('p', { className: 'lor-muted', style: { margin: 0 } }, t('tm_none'))));
  }

  /* ---------- employee page: Baza (journals + terminology) ---------- */
  function BasePage(p) {
    var t = p.t, db = p.db, u = p.user, tab = useState('journals'), open = useState(null);
    var js = journalsFor(db, u), ts = termsFor(db, u);
    var cur = open[0] ? js.filter(function (x) { return x.id === open[0]; })[0] : null;
    if (cur) return h('div', { className: 'app-wrap' }, h(JournalView, Object.assign({}, p, { j: cur, onBack: function () { open[1](null); } })));
    return h('div', { className: 'app-wrap' },
      h('div', { className: 'page-head' },
        h('div', null, h('span', { className: 'lor-eyebrow' }, t('db_eyebrow')), h('h1', { className: 'lor-title' }, t('nav_base'), h(PageTip, { t: t, id: 'base' }))),
        h('span', { className: 'lor-sm lor-muted' }, t('db_access_note'))),
      h('div', { className: 'lor-tabs fb-tabs', role: 'tablist' }, [['journals', t('db_tab_j'), js.length], ['terms', t('db_tab_t'), ts.length]].map(function (x) {
        return h('button', { key: x[0], type: 'button', role: 'tab', 'aria-selected': tab[0] === x[0], className: cx('lor-tab', tab[0] === x[0] && 'is-on'), onClick: function () { tab[1](x[0]); } }, x[1], h('span', { className: 'lor-count' }, x[2]));
      })),
      tab[0] === 'terms' ? h(Glossary, { t: t, db: db, lang: p.lang, list: ts, onLesson: function (id) { p.go({ name: 'lesson', id: id }); } })
        : js.length ? h('div', { className: 'jr-grid' }, js.map(function (j) { return h(JournalCard, { key: j.id, j: j, t: t, db: db, user: u, lang: p.lang, onOpen: function () { open[1](j.id); window.scrollTo(0, 0); } }); }))
          : h('section', { className: 'box' }, h('p', { className: 'lor-muted', style: { margin: 0 } }, t('jr_none_emp'))));
  }

  /* ---------- admin: journal templates ---------- */
  function blankJournal() { return { id: null, status: 'draft', title: '', desc: '', access: acc('all', { canAdd: 'none' }), columns: [{ key: 'c1', label: '', type: 'text' }], files: [], rows: [] }; }
  function journalErrors(j, t) {
    var e = {};
    if (!String(j.title || '').trim()) e.title = t('fill_required');
    if (!(j.columns || []).length) e.cols = t('jr_need_col');
    else if (j.columns.some(function (c) { return !String(c.label || '').trim(); })) e.cols = t('jr_col_label');
    return e;
  }
  function JournalsAdmin(p) {
    var t = p.t, db = p.db, list = journalsAll(db);
    var ed = useState(null), draft = ed[0], er = useState({}), del = useState(false), prev = useState(null), tried = useRef(false);
    function setD(fn) { var c = clone(draft); fn(c); ed[1](c); if (tried.current) er[1](journalErrors(c, t)); }
    function start(j) { ed[1](j ? clone(j) : blankJournal()); er[1]({}); del[1](false); tried.current = false; window.scrollTo(0, 0); }
    function save(status) {
      var c = clone(draft); c.status = status; tried.current = true;
      var e = journalErrors(c, t); er[1](e); if (Object.keys(e).length) return;
      c.title = c.title.trim(); c.desc = (c.desc || '').trim();
      c.files = c.files || [];
      c.columns = c.columns.map(function (x) { return { key: x.key, label: String(x.label).trim(), type: x.type, opt: !!x.opt, options: x.type === 'select' ? (x.options || []).map(function (o) { return String(o).trim(); }).filter(Boolean) : undefined }; });
      p.update(function (d) {
        d.journals = d.journals || [];
        if (c.id) d.journals = d.journals.map(function (x) { return x.id === c.id ? Object.assign({}, x, c) : x; });
        else { c.id = 'j' + nextId(d); d.journals.unshift(c); }
      });
      ed[1](null); p.say(status === 'published' ? t('jr_published') : t('cs_saved'));
    }
    function remove() { var id = draft.id; p.update(function (d) { d.journals = (d.journals || []).filter(function (x) { return x.id !== id; }); }); ed[1](null); p.say(t('jr_deleted')); }
    function delRow(jid, rid) { p.update(function (d) { var j = (d.journals || []).filter(function (x) { return x.id === jid; })[0]; if (j) j.rows = j.rows.filter(function (r) { return r.id !== rid; }); }); }

    if (prev[0]) {
      var pj = journalById(db, prev[0]);
      if (pj) return h(JournalView, Object.assign({}, p, { j: pj, onBack: function () { prev[1](null); }, onDel: function (rid) { delRow(pj.id, rid); } }));
    }
    if (draft) return h('div', { className: 'cms-case-edit' },
      h('div', { className: 'page-head' },
        h('div', null, h('span', { className: 'lor-eyebrow' }, t('db_eyebrow')), h('h2', { className: 'lor-title' }, draft.id ? t('jr_edit') : t('jr_new'))),
        h(Btn, { variant: 'ghost', onClick: function () { ed[1](null); } }, t('cancel'))),
      h('section', { className: 'box cs-form' },
        h('div', { className: 'lor-form-grid' },
          h(Field, { name: 'jr-title', span: true, label: t('jr_title'), required: true, value: draft.title, error: er[0].title, placeholder: t('jr_title_ph'), onChange: function (v) { setD(function (c) { c.title = v; }); } }),
          h(Field, { name: 'jr-desc', span: true, multiline: true, rows: 2, label: t('jr_desc'), value: draft.desc, placeholder: t('jr_desc_ph'), onChange: function (v) { setD(function (c) { c.desc = v; }); } })),
        h('h3', { className: 'cms-h' }, t('jr_cols')),
        er[0].cols ? h('p', { className: 'lor-field-error', style: { margin: 0 } }, er[0].cols) : null,
        h('div', { className: 'jr-cols' }, (draft.columns || []).map(function (c, i) {
          return h('div', { key: c.key, className: 'jr-col' },
            h('span', { className: 'lor-step-n' }, pad(i + 1)),
            h('div', { className: 'jr-col-body' },
              h('div', { className: 'lor-form-grid' },
                h(Field, { name: 'jc-l' + i, label: t('jr_col_name'), value: c.label, placeholder: t('jr_col_name_ph'), onChange: function (v) { setD(function (x) { x.columns[i].label = v; }); } }),
                h(Field, { name: 'jc-t' + i, label: t('jr_col_type'), value: c.type, options: COL_TYPES.map(function (x) { return [x, t('ct_' + x)]; }), onChange: function (v) { setD(function (x) { x.columns[i].type = v; if (v === 'select' && !(x.columns[i].options || []).length) x.columns[i].options = ['']; }); } }),
                c.type === 'select' ? h(Field, { name: 'jc-o' + i, span: true, label: t('jr_col_opts'), value: (c.options || []).join(', '), placeholder: t('jr_col_opts_ph'), onChange: function (v) { setD(function (x) { x.columns[i].options = v.split(',').map(function (o) { return o.trim(); }); }); } }) : null),
              h('div', { className: 'cms-mini' },
                h('label', { className: 'check' }, h('input', { type: 'checkbox', checked: !!c.opt, onChange: function (e) { var v = e.target.checked; setD(function (x) { x.columns[i].opt = v; }); } }), t('jr_col_opt')),
                h('button', { type: 'button', className: 'app-link', disabled: i === 0, onClick: function () { setD(function (x) { var y = x.columns[i - 1]; x.columns[i - 1] = x.columns[i]; x.columns[i] = y; }); } }, '↑'),
                h('button', { type: 'button', className: 'app-link', disabled: i === (draft.columns || []).length - 1, onClick: function () { setD(function (x) { var y = x.columns[i + 1]; x.columns[i + 1] = x.columns[i]; x.columns[i] = y; }); } }, '↓'),
                h('button', { type: 'button', className: 'app-link danger', onClick: function () { setD(function (x) { x.columns.splice(i, 1); }); } }, t('remove')))));
        })),
        h('div', null, h(Btn, { variant: 'outline', size: 'sm', onClick: function () { setD(function (c) { c.columns.push({ key: 'c' + (c.columns.length + 1) + Math.random().toString(36).slice(2, 5), label: '', type: 'text' }); }); } }, '+ ' + t('jr_add_col'))),
        h('h3', { className: 'cms-h' }, t('jf_title')),
        h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('jf_admin_hint')),
        h(TemplateList, { t: t, files: draft.files, empty: true, onDel: function (id) { setD(function (c) { c.files = (c.files || []).filter(function (x) { return x.id !== id; }); }); } }),
        h(TemplateUpload, { t: t, files: draft.files || [], onAdd: function (f) { setD(function (c) { c.files = (c.files || []).concat([f]); }); } }),
        h(AccessEditor, { t: t, db: db, lang: p.lang, name: 'j', withAdd: true, value: draft.access, onChange: function (v) { setD(function (c) { c.access = v; }); } }),
        h('div', { className: 'cms-foot' },
          draft.id ? (del[0] ? h('span', { className: 'cms-confirm' }, t('confirm_del'), ' ', h(Btn, { variant: 'ghost', size: 'sm', onClick: function () { del[1](false); } }, t('cancel')), h(Btn, { variant: 'outline', size: 'sm', onClick: remove }, t('yes_del')))
            : h('button', { type: 'button', className: 'app-link danger', onClick: function () { del[1](true); } }, t('jr_delete'))) : h('span'),
          h('div', { className: 'cs-foot-b' },
            h(Btn, { variant: 'outline', onClick: function () { save('draft'); } }, t('cs_save_draft')),
            h(Btn, { variant: 'primary', arrow: true, onClick: function () { save('published'); } }, t('cs_publish'))))));

    return h('div', null,
      h('div', { className: 'cs-admin-h' },
        h('div', null, h('h2', { className: 'lor-h' }, t('jr_admin_t')), h('p', { className: 'lor-sm lor-muted', style: { margin: '4px 0 0' } }, t('jr_admin_s'))),
        h(Btn, { variant: 'primary', arrow: true, onClick: function () { start(null); } }, t('jr_new'))),
      list.length ? h('div', { className: 'lor-table-wrap' }, h('table', { className: 'lor-table' },
        h('thead', null, h('tr', null, h('th', null, t('jr_title')), h('th', null, t('ac_title')), h('th', null, t('ac_can_add')), h('th', null, t('jr_rows')), h('th', null, t('jf_col')), h('th', null, t('status')), h('th', { 'aria-label': 'act' }))),
        h('tbody', null, list.map(function (j) {
          return h('tr', { key: j.id },
            h('td', null, h('b', null, j.title), h('small', { className: 'jr-td-desc' }, j.desc || '')),
            h('td', null, accessLabel(db, j.access, t, p.lang), h('small', { className: 'jr-td-desc' }, tpl(t('ac_seen_by'), { n: seenBy(db, j.access) }))),
            h('td', null, (j.access || {}).canAdd === 'viewers' ? t('ac_add_viewers') : t('ac_add_none')),
            h('td', null, (j.rows || []).length),
            h('td', null, (j.files || []).length || '—'),
            h('td', null, h(Badge, { status: j.status === 'published' ? 'passed' : 'todo', lang: p.lang }, j.status === 'published' ? t('jr_pub') : t('cs_draft'))),
            h('td', { className: 'jr-acts' },
              h('button', { type: 'button', className: 'app-link', onClick: function () { prev[1](j.id); window.scrollTo(0, 0); } }, t('jr_open')),
              h('button', { type: 'button', className: 'app-link', onClick: function () { start(j); } }, t('edit'))));
        }))))
        : h('section', { className: 'box' }, h('p', { className: 'lor-muted', style: { margin: 0 } }, t('jr_admin_empty'))));
  }

  /* ---------- admin: terminology ---------- */
  function blankTerm() { return { id: null, term: '', cat: 'general', short: '', def: '', syn: [], lessonIds: [], access: acc('all'), status: 'draft' }; }
  function termErrors(x, t) {
    var e = {};
    if (!String(x.term || '').trim()) e.term = t('fill_required');
    if (!String(x.short || '').trim()) e.short = t('fill_required');
    if (String(x.def || '').trim().length < 20) e.def = t('tm_short_def');
    return e;
  }
  function TermsAdmin(p) {
    var t = p.t, db = p.db, sampler = p.sampler, list = termsAll(db).sort(function (a, b) { return a.term.localeCompare(b.term); });
    var ed = useState(null), draft = ed[0], er = useState({}), del = useState(false), busy = useState(''), aiE = useState(''), tried = useRef(false);
    var ls = flat(db.course);
    function setD(fn) { var c = clone(draft); fn(c); ed[1](c); if (tried.current) er[1](termErrors(c, t)); }
    function start(x) { ed[1](x ? clone(x) : blankTerm()); er[1]({}); del[1](false); aiE[1](''); tried.current = false; window.scrollTo(0, 0); }
    function save(status) {
      var c = clone(draft); c.status = status; tried.current = true;
      var e = termErrors(c, t); er[1](e); if (Object.keys(e).length) return;
      c.term = c.term.trim(); c.short = c.short.trim(); c.def = c.def.trim();
      c.syn = (c.syn || []).map(function (x) { return String(x).trim(); }).filter(Boolean);
      p.update(function (d) {
        d.terms = d.terms || [];
        if (c.id) d.terms = d.terms.map(function (x) { return x.id === c.id ? Object.assign({}, x, c) : x; });
        else { c.id = 't' + nextId(d); c.at = Date.now(); d.terms.unshift(c); }
      });
      ed[1](null); p.say(status === 'published' ? t('tm_published') : t('cs_saved'));
    }
    function remove() { var id = draft.id; p.update(function (d) { d.terms = (d.terms || []).filter(function (x) { return x.id !== id; }); }); ed[1](null); p.say(t('tm_deleted')); }
    function aiFill() {
      if (!sampler || busy[0] || !String(draft.term || '').trim()) return;
      var picks = pickLessons(ls, draft.term + ' ' + (draft.short || ''), null, 2);
      var prompt = 'Siz BURAQ Logistics kompaniyasi SOP menejeriga yordam beruvchi AI-muharrirsiz. Kompaniya ichki atamalar lug‘ati uchun bitta atamani tushuntiring.\n' +
        'Qoidalar: quyidagi STANDARTLAR matniga tayaning; matnda yo‘q raqam, muddat yoki ismni o‘ylab topmang. Noma’lum joyni [SOP menejeri to‘ldiradi] deb belgilang. Til: ' + (LANG_NAME[p.lang] || LANG_NAME.uz) + '.\n' +
        'Faqat JSON qaytaring: {"short":"bir qatorli izoh (70 belgigacha)","def":"2-4 gaplik tushuntirish: nima, nima uchun kerak va xodim uchun qanday qoida bor","syn":["sinonim1","sinonim2"]}\n\n' +
        'ATAMA: ' + draft.term + '\nIzoh (agar bor bo‘lsa): ' + (draft.short || '—') + '\n\nSTANDARTLAR:\n' + (picks.length ? standardsBlock(picks, 12000) : '(mos standart topilmadi)');
      busy[1]('fill'); aiE[1]('');
      sampler.json(prompt, {}).then(function (r) {
        if (!r || typeof r !== 'object') { aiE[1](t('ai_bad_json')); return; }
        setD(function (c) {
          if (r.short) c.short = String(r.short).slice(0, 90);
          if (r.def) c.def = String(r.def);
          if (Array.isArray(r.syn)) c.syn = r.syn.map(String).slice(0, 4);
          if (!(c.lessonIds || []).length) c.lessonIds = picks.map(function (l) { return l.id; });
        });
        p.say(t('tm_ai_done'));
      }).catch(function (e) { aiE[1](e && e.code === 'invalid_json' ? t('ai_bad_json') : aiErr(e, t)); }).then(function () { busy[1](''); });
    }

    if (draft) return h('div', { className: 'cms-case-edit' },
      h('div', { className: 'page-head' },
        h('div', null, h('span', { className: 'lor-eyebrow' }, t('tm_eyebrow')), h('h2', { className: 'lor-title' }, draft.id ? t('tm_edit') : t('tm_new'))),
        h(Btn, { variant: 'ghost', onClick: function () { ed[1](null); } }, t('cancel'))),
      h('section', { className: 'box cs-form' },
        h('div', { className: 'cs-ai-bar' },
          h(Btn, { variant: 'outline', size: 'sm', disabled: !sampler || !!busy[0] || !String(draft.term || '').trim(), onClick: aiFill }, busy[0] === 'fill' ? t('ai_thinking') : '✦ ' + t('tm_ai_fill')),
          h('span', { className: 'lor-sm lor-muted' }, sampler === null ? t('ai_unavail') : t('tm_ai_fill_hint'))),
        aiE[0] ? h('p', { className: 'lor-field-error', style: { margin: 0 } }, aiE[0]) : null,
        h('div', { className: 'lor-form-grid' },
          h(Field, { name: 'tm-term', label: t('tm_term'), required: true, value: draft.term, error: er[0].term, placeholder: t('tm_term_ph'), onChange: function (v) { setD(function (c) { c.term = v; }); } }),
          h(Field, { name: 'tm-cat', label: t('tm_cat'), value: draft.cat, options: TERM_CATS.map(function (x) { return [x, t('tc_' + x)]; }), onChange: function (v) { setD(function (c) { c.cat = v; }); } }),
          h(Field, { name: 'tm-short', span: true, label: t('tm_short'), required: true, value: draft.short, error: er[0].short, placeholder: t('tm_short_ph'), onChange: function (v) { setD(function (c) { c.short = v; }); } }),
          h(Field, { name: 'tm-def', span: true, multiline: true, rows: 4, label: t('tm_def'), required: true, value: draft.def, error: er[0].def, placeholder: t('tm_def_ph'), onChange: function (v) { setD(function (c) { c.def = v; }); } }),
          h(Field, { name: 'tm-syn', span: true, label: t('tm_syn'), value: (draft.syn || []).join(', '), placeholder: t('tm_syn_ph'), onChange: function (v) { setD(function (c) { c.syn = v.split(',').map(function (x) { return x.trim(); }); }); } })),
        h('details', { className: 'perk-fold tm-tr' },
          h('summary', null, t('tm_tr') + ' · 简体中文' + ((draft.i18n || {}).zh && draft.i18n.zh.term ? ' ✓' : '')),
          h('div', { className: 'lor-form-grid' },
            h(Field, { name: 'tm-zh-term', label: t('tm_term') + ' · 中文', value: ((draft.i18n || {}).zh || {}).term || '', placeholder: draft.term, onChange: function (v) { setD(function (c) { c.i18n = c.i18n || {}; c.i18n.zh = Object.assign({}, c.i18n.zh); c.i18n.zh.term = v; }); } }),
            h(Field, { name: 'tm-zh-syn', label: t('tm_syn') + ' · 中文', value: (((draft.i18n || {}).zh || {}).syn || []).join(', '), onChange: function (v) { setD(function (c) { c.i18n = c.i18n || {}; c.i18n.zh = Object.assign({}, c.i18n.zh); c.i18n.zh.syn = v.split(',').map(function (x) { return x.trim(); }).filter(Boolean); }); } }),
            h(Field, { name: 'tm-zh-short', span: true, label: t('tm_short') + ' · 中文', value: ((draft.i18n || {}).zh || {}).short || '', placeholder: draft.short, onChange: function (v) { setD(function (c) { c.i18n = c.i18n || {}; c.i18n.zh = Object.assign({}, c.i18n.zh); c.i18n.zh.short = v; }); } }),
            h(Field, { name: 'tm-zh-def', span: true, multiline: true, rows: 3, label: t('tm_def') + ' · 中文', value: ((draft.i18n || {}).zh || {}).def || '', placeholder: draft.def, onChange: function (v) { setD(function (c) { c.i18n = c.i18n || {}; c.i18n.zh = Object.assign({}, c.i18n.zh); c.i18n.zh.def = v; }); } })),
          h('span', { className: 'lor-field-hint' }, t('tm_tr_hint'))),
        h('h3', { className: 'cms-h' }, t('cs_sop')),
        h(Field, { name: 'tm-sop', label: t('cs_add_sop'), value: '', options: [['', '—']].concat(ls.filter(function (l) { return (draft.lessonIds || []).indexOf(l.id) < 0; }).map(function (l) { return [l.id, l.title]; })), onChange: function (v) { if (v) setD(function (c) { c.lessonIds = (c.lessonIds || []).concat([v]); }); } }),
        (draft.lessonIds || []).length ? h('div', { className: 'cs-sops' }, draft.lessonIds.map(function (id) {
          var l = findLesson(db.course, id);
          return h('span', { key: id, className: 'cs-sop-chip' }, l ? l.title : id,
            h('button', { type: 'button', 'aria-label': t('remove'), onClick: function () { setD(function (c) { c.lessonIds = c.lessonIds.filter(function (y) { return y !== id; }); }); } }, '×'));
        })) : h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('tm_no_sop')),
        h(AccessEditor, { t: t, db: db, lang: p.lang, name: 't', value: draft.access, onChange: function (v) { setD(function (c) { c.access = v; }); } }),
        h('div', { className: 'cms-foot' },
          draft.id ? (del[0] ? h('span', { className: 'cms-confirm' }, t('confirm_del'), ' ', h(Btn, { variant: 'ghost', size: 'sm', onClick: function () { del[1](false); } }, t('cancel')), h(Btn, { variant: 'outline', size: 'sm', onClick: remove }, t('yes_del')))
            : h('button', { type: 'button', className: 'app-link danger', onClick: function () { del[1](true); } }, t('tm_delete'))) : h('span'),
          h('div', { className: 'cs-foot-b' },
            h(Btn, { variant: 'outline', onClick: function () { save('draft'); } }, t('cs_save_draft')),
            h(Btn, { variant: 'primary', arrow: true, onClick: function () { save('published'); } }, t('cs_publish'))))));

    return h('div', null,
      h('div', { className: 'cs-admin-h' },
        h('div', null, h('h2', { className: 'lor-h' }, t('tm_admin_t')), h('p', { className: 'lor-sm lor-muted', style: { margin: '4px 0 0' } }, t('tm_admin_s'))),
        h(Btn, { variant: 'primary', arrow: true, onClick: function () { start(null); } }, t('tm_new'))),
      list.length ? h('div', { className: 'lor-table-wrap' }, h('table', { className: 'lor-table' },
        h('thead', null, h('tr', null, h('th', null, t('tm_term')), h('th', null, t('tm_cat')), h('th', null, t('tm_short')), h('th', null, t('ac_title')), h('th', null, t('status')), h('th', { 'aria-label': 'act' }))),
        h('tbody', null, list.map(function (x) {
          return h('tr', { key: x.id },
            h('td', null, h('b', null, x.term), (x.i18n || {}).zh ? h('small', { className: 'tm-zh-tag' }, '中 ' + x.i18n.zh.term) : null),
            h('td', null, t('tc_' + x.cat)),
            h('td', null, h('small', { className: 'jr-td-desc' }, x.short)),
            h('td', null, accessLabel(db, x.access, t, p.lang)),
            h('td', null, h(Badge, { status: x.status === 'published' ? 'passed' : 'todo', lang: p.lang }, x.status === 'published' ? t('jr_pub') : t('cs_draft'))),
            h('td', { className: 'jr-acts' }, h('button', { type: 'button', className: 'app-link', onClick: function () { start(x); } }, t('edit'))));
        }))))
        : h('section', { className: 'box' }, h('p', { className: 'lor-muted', style: { margin: 0 } }, t('tm_admin_empty'))));
  }

  /* the AI mentor only ever sees the terms this user is allowed to see */
  function glossaryBlock(db, u) {
    var list = termsFor(db, u).filter(function (x) { return x.status === 'published' || u.role === 'admin'; });
    if (!list.length) return '';
    var lg = db.lang || 'uz';
    return list.slice(0, 60).map(function (x) { var syn = tmF(x, lg, 'syn'); return '- ' + tmF(x, lg, 'term') + (x.term !== tmF(x, lg, 'term') ? ' / ' + x.term : '') + (syn.length ? ' (' + syn.join(', ') + ')' : '') + ' — ' + tmF(x, lg, 'short') + '. ' + tmF(x, lg, 'def'); }).join('\n');
  }

  /* ---------- admin · staff: what the pulse survey says about each employee ---------- */
  function empSurveys(db, uid) { return (db.surveys || []).filter(function (s) { return s.uid === uid; }).sort(function (a, b) { return b.at - a.at; }); }
  function empMood(db, uid) {
    var list = empSurveys(db, uid);
    if (!list.length) return { n: 0 };
    var moods = list.map(function (s) { return s.mood; }).filter(Boolean);
    var avg = moods.length ? moods.reduce(function (a, b) { return a + b; }, 0) / moods.length : 0;
    var recent = moods.slice(0, 3), prev = moods.slice(3, 6);
    var rA = recent.length ? recent.reduce(function (a, b) { return a + b; }, 0) / recent.length : 0;
    var pA = prev.length ? prev.reduce(function (a, b) { return a + b; }, 0) / prev.length : 0;
    var low = {};
    list.slice(0, 3).forEach(function (s) { (s.answers || []).forEach(function (a) { if (a.type === 'scale' && a.v != null && a.v <= 2) low[a.topic] = Math.min(low[a.topic] == null ? 9 : low[a.topic], a.v); }); });
    var text = list.filter(function (s) { return s.text; })[0];
    return { n: list.length, avg: avg, recent: rA, trend: prev.length ? rA - pA : 0, last: list[0], low: Object.keys(low), text: text ? text.text : '', at: list[0].at };
  }
  function moodClass(v) { return !v ? '' : v < 2.5 ? 'is-low' : v < 3.5 ? 'is-mid' : 'is-ok'; }

  function PulseCell(p) {
    var t = p.t, m = p.m;
    if (!m.n) return h('span', { className: 'lor-sm lor-muted' }, '○ ' + t('sp_none'));
    return h('div', { className: cx('sp-cell', moodClass(m.recent || m.avg)) },
      h('div', { className: 'sp-top' },
        h(Face, { v: Math.max(1, Math.min(5, Math.round(m.recent || m.avg))), size: 30 }),
        h('div', null, h('b', null, (m.recent || m.avg).toFixed(1), h('span', null, ' / 5')),
          h('small', null, tpl(t('sp_n'), { n: m.n }) + ' · ' + fmtDate(m.at))),
        m.trend ? h('span', { className: cx('sp-trend', m.trend > 0 ? 'up' : 'down') }, (m.trend > 0 ? '▴' : '▾') + Math.abs(m.trend).toFixed(1)) : null),
      m.low.length ? h('div', { className: 'sp-low' }, m.low.slice(0, 3).map(function (k) { return h('span', { key: k, className: 'sp-topic' }, t('pt_' + k)); })) : null,
      m.text ? h('p', { className: 'sp-text' }, '“' + String(m.text).slice(0, 90) + (String(m.text).length > 90 ? '…' : '') + '”') : null);
  }

  function PulseDetail(p) {
    var t = p.t, list = empSurveys(p.db, p.uid);
    if (!list.length) return h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('sp_none_long'));
    return h('ul', { className: 'sv-list sp-list' }, list.slice(0, 3).map(function (s) {
      return h('li', { key: s.id, className: 'sv-item' },
        h('div', { className: 'sv-item-h' }, h(Face, { v: s.mood || 3, size: 26 }),
          h('div', null, h('b', null, t('mood_' + (s.mood || 3))), h('span', { className: 'lor-sm lor-muted' }, fmt(s.at, t)))),
        h('ul', { className: 'sv-ans' }, (s.answers || []).map(function (a, i) {
          return h('li', { key: i }, h('span', { className: 'sv-ans-q' }, h('em', null, t('pt_' + a.topic)), a.q),
            a.type === 'scale' ? h('span', { className: cx('sv-score', a.v <= 2 ? 'low' : a.v >= 4 ? 'hi' : '') }, a.v != null ? a.v + ' / 5' : '—') : h('span', { className: 'sv-choice' }, a.v || '—'));
        })),
        s.text ? h('p', { className: 'sv-text' }, '“' + s.text + '”') : null,
        s.follow ? h('p', { className: 'sv-follow' }, h('span', null, '✦ ' + s.follow.q), h('b', null, s.follow.a)) : null);
    }));
  }

  /* ======================= FEATURES 6: the manual — first-run tour, help centre and the “?” tips ======================= */

  /* each topic: id (i18n prefix), icon, how many steps, and where “show me” goes */
  var HELP = {
    employee: [
      { id: 'first', ico: 'clip', n: 5, go: { name: 'home' } },
      { id: 'lesson', ico: 'doc', n: 5, go: { name: 'home' } },
      { id: 'tasks', ico: 'flag', n: 4, go: { name: 'tasks' } },
      { id: 'base', ico: 'doc', n: 4, go: { name: 'base' } },
      { id: 'cases', ico: 'case', n: 4, go: { name: 'cases' } },
      { id: 'ask', ico: 'chat', n: 4, go: null },
      { id: 'path', ico: 'target', n: 4, go: { name: 'path' } },
      { id: 'voice', ico: 'idea', n: 4, go: { name: 'ideas' } },
      { id: 'pay', ico: 'target', n: 4, go: { name: 'pay' } },
      { id: 'profile', ico: 'team', n: 4, go: null }
    ],
    admin: [
      { id: 'astaff', ico: 'team', n: 4, go: { name: 'staff' } },
      { id: 'ainbox', ico: 'chat', n: 4, go: { name: 'inbox' } },
      { id: 'acms', ico: 'doc', n: 5, go: { name: 'cms' } },
      { id: 'acases', ico: 'case', n: 4, go: { name: 'cms' } },
      { id: 'abase', ico: 'lock', n: 5, go: { name: 'cms' } },
      { id: 'aquality', ico: 'refresh', n: 4, go: { name: 'quality' } },
      { id: 'alevels', ico: 'target', n: 4, go: { name: 'levels' } },
      { id: 'aassets', ico: 'truck', n: 4, go: { name: 'assets' } },
      { id: 'apay', ico: 'target', n: 5, go: { name: 'pay' } },
      { id: 'aexcel', ico: 'doc', n: 4, go: { name: 'staff' } },
      { id: 'aleaders', ico: 'idea', n: 3, go: { name: 'staff' } },
      { id: 'awisdom', ico: 'bulb', n: 3, go: { name: 'cms', tab: 'wisdom' } },
      { id: 'aexport', ico: 'lock', n: 3, go: null }
    ]
  };

  /* the tour points at real controls; the first selector that is actually visible wins */
  function navSel(x) { return ['.lor-header-nav a[href="#' + x + '"]', '.app-subnav a[href="#' + x + '"]']; }
  var TOUR = {
    employee: [
      { k: 'home', sel: navSel('home'), go: { name: 'home' } },
      { k: 'tree', sel: ['.app-tree', '.lor-course-tree', '.app-side'], go: { name: 'home' } },
      { k: 'tasks', sel: navSel('tasks'), go: { name: 'tasks' } },
      { k: 'cases', sel: navSel('cases'), go: { name: 'cases' } },
      { k: 'base', sel: navSel('base'), go: { name: 'base' } },
      { k: 'path', sel: navSel('path'), go: { name: 'path' } },
      { k: 'ai', sel: ['.ai-fab'], go: null },
      { k: 'help', sel: ['.help-btn', '.user-btn'], go: null }
    ],
    admin: [
      { k: 'inbox', sel: navSel('inbox'), go: { name: 'inbox' } },
      { k: 'monitor', sel: navSel('monitor'), go: { name: 'monitor' } },
      { k: 'quality', sel: navSel('quality'), go: { name: 'quality' } },
      { k: 'cms', sel: navSel('cms'), go: { name: 'cms' } },
      { k: 'staff', sel: navSel('staff'), go: { name: 'staff' } },
      { k: 'levels', sel: navSel('levels'), go: { name: 'levels' } },
      { k: 'ai', sel: ['.ai-fab'], go: null },
      { k: 'help', sel: ['.help-btn', '.user-btn'], go: null }
    ]
  };

  function seen(el) { if (!el) return false; var q = el.getBoundingClientRect(); return q.width > 4 && q.height > 4 && el.offsetParent !== null; }
  function findStep(step) {
    for (var i = 0; i < step.sel.length; i++) { var el = document.querySelector(step.sel[i]); if (seen(el)) return el; }
    return null;
  }

  function Tour(p) {
    var t = p.t, steps = TOUR[p.user.role === 'admin' ? 'admin' : 'employee'];
    var ix = useState(0), i = ix[0], box = useState(null), tries = useRef(0), tm = useRef(null);
    var step = steps[i];

    useEffect(function () {
      if (!step) return;
      if (step.go && p.go) p.go(step.go);
      tries.current = 0;
      function look() {
        var el = findStep(step);
        if (el) {
          el.scrollIntoView({ block: 'center', behavior: 'auto' });
          var q = el.getBoundingClientRect(), vh = window.innerHeight;
          /* a tall target (the course tree) can run past both edges — the card is anchored to the visible part */
          var vTop = Math.max(q.top, 8), vBot = Math.min(q.bottom, vh - 8);
          box[1]({ top: q.top - 6, left: q.left - 6, w: q.width + 12, h: q.height + 12, vTop: vTop, vBot: vBot, cx: q.left + q.width / 2 });
          return;
        }
        if (tries.current++ < 14) tm.current = setTimeout(look, 70); else box[1](null);
      }
      tm.current = setTimeout(look, 60);
      return function () { clearTimeout(tm.current); };
    }, [i]);

    useEffect(function () {
      function k(e) { if (e.key === 'Escape') p.onClose(false); if (e.key === 'ArrowRight') next(); if (e.key === 'ArrowLeft') back(); }
      window.addEventListener('keydown', k);
      return function () { window.removeEventListener('keydown', k); };
    });

    function next() { if (i + 1 < steps.length) ix[1](i + 1); else p.onClose(true); }
    function back() { if (i > 0) ix[1](i - 1); }

    var vw = window.innerWidth, vh = window.innerHeight, w = Math.min(340, vw - 24), b = box[0];
    var pos = b
      ? (function () {
        var sBelow = vh - b.vBot - 16, sAbove = b.vTop - 86, below = sBelow >= 260 || sBelow >= sAbove;
        var left = Math.max(12, Math.min(b.cx - w / 2, vw - w - 12));
        if (Math.max(sBelow, sAbove) < 200) return { left: left, top: Math.round(vh * 0.3) };   /* no room either way */
        return below ? { left: left, top: Math.round(b.vBot + 12) } : { left: left, bottom: Math.round(vh - b.vTop + 12) };
      })()
      : { left: Math.round((vw - w) / 2), top: Math.round(vh * 0.28) };

    return h('div', { className: 'tour' },
      h('div', { className: 'tour-block', onClick: function () {} }),
      b ? h('div', { className: 'tour-spot', style: { top: b.top, left: b.left, width: b.w, height: b.h } }) : null,
      h('section', { className: 'tour-card', role: 'dialog', 'aria-labelledby': 'tour-t', style: { width: w, left: pos.left, top: pos.top == null ? 'auto' : pos.top, bottom: pos.bottom == null ? 'auto' : pos.bottom } },
        h('div', { className: 'tour-top' },
          h('span', { className: 'lor-eyebrow' }, t('tour_eyebrow')),
          h('span', { className: 'tour-n' }, (i + 1) + ' / ' + steps.length)),
        h('b', { id: 'tour-t', className: 'tour-h' }, t('tr_' + step.k + '_t')),
        h('p', { className: 'tour-p' }, t('tr_' + step.k)),
        h('div', { className: 'tour-dots', 'aria-hidden': true }, steps.map(function (s, k) { return h('i', { key: s.k, className: k === i ? 'is-on' : k < i ? 'is-done' : '' }); })),
        h('div', { className: 'tour-act' },
          h('button', { type: 'button', className: 'app-link', onClick: function () { p.onClose(false); } }, t('tour_skip')),
          h('div', { className: 'tour-btns' },
            i ? h(Btn, { variant: 'ghost', size: 'sm', onClick: back }, t('back')) : null,
            h(Btn, { variant: 'primary', size: 'sm', arrow: i + 1 < steps.length, onClick: next }, i + 1 < steps.length ? t('tour_next') : t('tour_done'))))));
  }

  /* the “?” next to a page title */
  function PageTip(p) {
    var t = p.t, o = useState(false), ref = useRef(null);
    useEffect(function () {
      if (!o[0]) return;
      function off(e) { if (ref.current && !ref.current.contains(e.target)) o[1](false); }
      function k(e) { if (e.key === 'Escape') o[1](false); }
      document.addEventListener('mousedown', off); window.addEventListener('keydown', k);
      return function () { document.removeEventListener('mousedown', off); window.removeEventListener('keydown', k); };
    }, [o[0]]);
    return h('span', { className: 'tip-wrap', ref: ref },
      h('button', { type: 'button', className: cx('tip-btn', o[0] && 'is-on'), 'aria-expanded': o[0], 'aria-label': t('tip_a'), onClick: function () { o[1](!o[0]); } }, '?'),
      o[0] ? h('span', { className: 'tip-pop', role: 'tooltip' },
        h('b', null, t('tip_' + p.id + '_t')),
        h('span', { className: 'tip-txt' }, t('tip_' + p.id)),
        p.onHelp ? h('button', { type: 'button', className: 'app-link', onClick: function () { o[1](false); p.onHelp(); } }, t('help_more') + ' →') : null) : null);
  }

  function HelpCard(p) {
    var t = p.t, x = p.x, o = useState(false);
    var steps = []; for (var k = 1; k <= x.n; k++) steps.push(t('hp_' + x.id + '_' + k));
    return h('li', { className: cx('help-card', o[0] && 'is-open') },
      h('button', { type: 'button', className: 'help-head', 'aria-expanded': o[0], onClick: function () { o[1](!o[0]); } },
        h('span', { className: 'help-ico' }, h(Ico, { name: x.ico, size: 18 })),
        h('span', { className: 'help-tt' }, h('b', null, t('hp_' + x.id + '_t')), h('small', null, t('hp_' + x.id + '_s'))),
        h('span', { className: 'help-x', 'aria-hidden': true }, o[0] ? '−' : '+')),
      o[0] ? h('div', { className: 'help-body' },
        h('ol', { className: 'help-steps' }, steps.map(function (s, k) { return h('li', { key: k }, s); })),
        x.go && p.go ? h(Btn, { variant: 'outline', size: 'sm', onClick: function () { p.go(x.go); } }, t('help_show')) : null) : null);
  }

  function HelpPage(p) {
    var t = p.t, admin = p.user.role === 'admin', lv = lvlOf(p.user);
    // salary — CEO and the owner; management logins — CEO
    var list = HELP[admin ? 'admin' : 'employee'].filter(function (x) { return !(x.id === 'apay' && lv === 'sop') && !(x.id === 'aleaders' && admin && lv !== 'ceo'); });
    return h('div', { className: 'app-wrap help-page' },
      h('div', { className: 'page-head' },
        h('div', null, h('span', { className: 'lor-eyebrow' }, t('help_eyebrow')), h('h1', { className: 'lor-title' }, t('nav_help')))),
      h('section', { className: 'box help-hero' },
        h('span', { className: 'help-hero-ic' }, h(Ico, { name: 'spark', size: 26 })),
        h('div', null,
          h('h2', { className: 'lor-h' }, t(admin ? 'help_hi_admin' : 'help_hi')),
          h('p', { className: 'lor-sm lor-muted' }, t(admin ? 'help_hi_admin_s' : 'help_hi_s'))),
        h(Btn, { variant: 'primary', arrow: true, onClick: p.onTour }, t('help_tour'))),
      p.theme ? h('section', { className: 'box help-hint' }, h(ThemeBlock, { t: t, value: p.theme.v, onChange: p.theme.set }), h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('th_help_p'))) : null,
      p.hint ? h('section', { className: 'box help-hint' }, h(HintSwitch, { t: t, on: p.hint.on, onToggle: p.hint.toggle }), h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('hint_help_p'))) : null,
      h('ul', { className: 'help-list' }, list.map(function (x) { return h(HelpCard, { key: x.id, x: x, t: t, go: p.go }); })),
      h('section', { className: 'box help-foot' },
        h('span', { className: 'lor-eyebrow' }, t('help_stuck_t')),
        h('p', { className: 'lor-sm', style: { margin: 0 } }, t(admin ? 'help_stuck_admin' : 'help_stuck'))));
  }

  /* ======================= FEATURES 7: one search across the whole platform (Ctrl/⌘ + K) ======================= */

  function norm(s) { return String(s || '').toLowerCase().replace(/[‘’'`ʻʼ]/g, ''); }
  function hit(hay, q) { return norm(hay).indexOf(q) >= 0; }
  function cut(s, n) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; }

  var PAGES = {
    employee: [['home', 'nav_home'], ['tasks', 'nav_tasks'], ['cases', 'nav_cases'], ['base', 'nav_base'], ['path', 'nav_path'], ['drill', 'dr_title'], ['assets', 'as_my_title'], ['ideas', 'ini_my'], ['report', 'mr_nav'], ['pay', 'nav_pay'], ['help', 'nav_help']],
    admin: [['inbox', 'nav_inbox'], ['monitor', 'nav_monitor'], ['quality', 'nav_quality'], ['rating', 'nav_rating'], ['levels', 'nav_levels'], ['cms', 'nav_cms'], ['staff', 'nav_staff'], ['assets', 'nav_assets'], ['feedback', 'nav_feedback'], ['pay', 'nav_pay'], ['help', 'nav_help']]
  };

  /* every group knows how to open itself, so the palette stays a dumb list */
  function searchAll(db, u, raw, t, lang) {
    var q = norm(raw).trim();
    if (q.length < 2) return [];
    var admin = u.role === 'admin', out = [];
    function add(g, key, title, sub, sc, go) { out.push({ g: g, key: key, title: title, sub: sub, sc: sc, go: go }); }

    (PAGES[admin ? 'admin' : 'employee']).filter(function (x) { return !(x[0] === 'pay' && lvlOf(u) === 'sop'); }).forEach(function (x) {
      var name = t(x[1]);
      if (hit(name, q)) add('page', 'pg' + x[0], name, t('gs_g_page'), 6, { name: x[0] });
    });

    (admin ? flat(db.course) : trackFlat(db, u)).forEach(function (l) {
      var body = l._txt || (l._txt = lessonText(l));
      var inTitle = hit(l.title, q), inBody = hit(body, q);
      if (!inTitle && !inBody) return;
      add('sop', 'l' + l.id, l.title, l.sectionTitle, inTitle ? 8 : 3, admin ? { name: 'cms', lessonId: l.id } : { name: 'lesson', id: l.id });
    });

    pubCases(db).forEach(function (c) {
      var inTitle = hit(c.title, q);
      if (!inTitle && !hit(caseText(c), q)) return;
      add('case', 'c' + c.id, c.title, t('ia_' + c.area), inTitle ? 7 : 3, admin ? { name: 'cms', tab: 'cases' } : { name: 'cases', id: c.id });
    });

    termsFor(db, u).forEach(function (x) {
      var term = tmF(x, lang, 'term'), inTitle = hit(term, q) || (tmF(x, lang, 'syn') || []).some(function (s) { return hit(s, q); }) || hit(x.term, q);
      if (!inTitle && !hit(termSearchText(x, lang), q)) return;
      add('term', 'tm' + x.id, term, tmF(x, lang, 'short'), inTitle ? 7 : 3, admin ? { name: 'cms', tab: 'terms' } : { name: 'base', tab: 'terms' });
    });

    journalsFor(db, u).forEach(function (j) {
      var inTitle = hit(j.title, q);
      var row = !inTitle && (j.rows || []).filter(function (r) { return hit(rowText(db, j, r), q); })[0];
      if (!inTitle && !row) return;
      add('journal', 'j' + j.id, j.title, row ? cut(rowText(db, j, row), 70) : tpl(t('jr_rows_n'), { n: (j.rows || []).length }), inTitle ? 6 : 4, admin ? { name: 'cms', tab: 'journals' } : { name: 'base', tab: 'journals', id: j.id });
    });

    if (admin) db.users.filter(function (x) { return x.role === 'employee'; }).forEach(function (x) {
      if (!hit(x.name + ' ' + x.login + ' ' + x.position + ' ' + x.department, q)) return;
      add('people', 'u' + x.id, x.name, x.position + ' · ' + x.department, 6, { name: 'staff' });
    });

    return out.sort(function (a, b) { return b.sc - a.sc; }).slice(0, 24);
  }

  var GROUPS = ['page', 'sop', 'case', 'term', 'journal', 'people'];

  function Palette(p) {
    var t = p.t, db = p.db, u = p.user;
    var q = useState(''), sel = useState(0), inp = useRef(null), listRef = useRef(null);
    var rows = searchAll(db, u, q[0], t, p.lang);
    var ordered = [];
    GROUPS.forEach(function (g) { rows.filter(function (r) { return r.g === g; }).forEach(function (r) { ordered.push(r); }); });
    useEffect(function () { if (inp.current) inp.current.focus(); }, []);
    useEffect(function () { sel[1](0); }, [q[0]]);
    useEffect(function () {
      var el = listRef.current && listRef.current.querySelector('.gs-row.is-on');
      if (el) el.scrollIntoView({ block: 'nearest' });
    }, [sel[0]]);
    function pick(r) { if (!r) return; p.onClose(); p.go(r.go); }
    function key(e) {
      if (e.key === 'Escape') { e.preventDefault(); p.onClose(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); sel[1](Math.min(sel[0] + 1, ordered.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel[1](Math.max(sel[0] - 1, 0)); }
      else if (e.key === 'Enter') { e.preventDefault(); pick(ordered[sel[0]]); }
    }
    var i = -1;
    return h('div', { className: 'lor-scrim gs-scrim', onMouseDown: function (e) { if (e.target === e.currentTarget) p.onClose(); } },
      h('div', { className: 'gs', role: 'dialog', 'aria-label': t('gs_title'), onKeyDown: key },
        h('div', { className: 'gs-top' },
          h('span', { className: 'gs-ic', 'aria-hidden': true }, h(Ico, { name: 'search', size: 18 })),
          h('input', { ref: inp, className: 'gs-input', value: q[0], placeholder: t(u.role === 'admin' ? 'gs_ph_admin' : 'gs_ph'), 'aria-label': t('gs_title'), onChange: function (e) { q[1](e.target.value); } }),
          h('button', { type: 'button', className: 'gs-esc', onClick: p.onClose }, 'Esc')),
        q[0].trim().length < 2
          ? h('div', { className: 'gs-empty' },
            h('p', { className: 'lor-sm lor-muted' }, t('gs_hint')),
            h('div', { className: 'gs-tags' }, t('gs_examples').split('|').map(function (s) {
              return h('button', { key: s, type: 'button', onClick: function () { q[1](s); if (inp.current) inp.current.focus(); } }, s);
            })))
          : !ordered.length
            ? h('div', { className: 'gs-empty' }, h('p', { className: 'lor-muted' }, tpl(t('gs_none'), { q: q[0].trim() })))
            : h('div', { className: 'gs-list', ref: listRef }, GROUPS.map(function (g) {
              var part = rows.filter(function (r) { return r.g === g; });
              if (!part.length) return null;
              return h('div', { key: g, className: 'gs-grp' },
                h('span', { className: 'lor-eyebrow' }, t('gs_g_' + g)),
                part.map(function (r) {
                  i++; var me = i;
                  return h('button', { key: r.key, type: 'button', className: cx('gs-row', me === sel[0] && 'is-on'), onMouseEnter: function () { sel[1](me); }, onClick: function () { pick(r); } },
                    h('span', { className: 'gs-row-ic', 'aria-hidden': true }, h(Ico, { name: { page: 'flag', sop: 'doc', case: 'case', term: 'idea', journal: 'clip', people: 'team' }[g], size: 16 })),
                    h('span', { className: 'gs-row-t' }, h('b', null, r.title), r.sub ? h('small', null, r.sub) : null));
                }));
            })),
        h('div', { className: 'gs-foot' },
          h('span', null, h('kbd', null, '↑'), h('kbd', null, '↓'), ' ' + t('gs_move')),
          h('span', null, h('kbd', null, 'Enter'), ' ' + t('gs_open')),
          h('span', null, h('kbd', null, 'Esc'), ' ' + t('close')))));
  }

  /* the shortcut is global: any screen, any role */
  function usePalette(open, setOpen) {
    useEffect(function () {
      function k(e) {
        if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); setOpen(!open); }
      }
      window.addEventListener('keydown', k);
      return function () { window.removeEventListener('keydown', k); };
    }, [open]);
  }

  /* ======================= FEATURES 8: training programmes per position + the 30/60/90 adaptation plan ======================= */

  function tracksOf(db) { return db.tracks || []; }
  function trackById(db, id) { return tracksOf(db).filter(function (x) { return x.id === id; })[0]; }
  /* an explicit assignment wins; otherwise the position decides; no match = the whole course */
  function trackOf(db, u) {
    if (!u || u.role === 'admin') return null;
    if (u.trackId) return trackById(db, u.trackId) || null;
    return tracksOf(db).filter(function (t) { return (t.positions || []).indexOf(u.position) >= 0; })[0] || null;
  }
  function trackTitle(t, lang) { return !t ? '' : (typeof t.title === 'string' ? t.title : (t.title[lang] || t.title.uz || '')); }
  function trackDesc(t, lang) { return !t || !t.desc ? '' : (typeof t.desc === 'string' ? t.desc : (t.desc[lang] || t.desc.uz || '')); }
  function trackSecIds(db, u) { var t = trackOf(db, u); return t && (t.sections || []).length ? t.sections : null; }
  function courseSections(db, u) { var ids = trackSecIds(db, u); return db.course.sections.filter(function (s) { return !ids || ids.indexOf(s.id) >= 0; }); }
  /* flat(), but only the sections that belong to this employee’s programme */
  function trackFlat(db, u) {
    var out = [];
    courseSections(db, u).forEach(function (s) { s.lessons.forEach(function (l) { out.push(Object.assign({}, l, { sectionId: s.id, sectionTitle: s.title, officialOnly: s.officialOnly })); }); });
    return out;
  }
  function inTrack(db, u, lid) { return trackFlat(db, u).some(function (l) { return l.id === lid; }); }
  function trackUsers(db, id) { return db.users.filter(function (u) { return u.role === 'employee' && (trackOf(db, u) || {}).id === id; }); }

  /* ---------- adaptation plan ---------- */
  var PLAN_DAYS = [30, 60, 90];
  function planItems(db, u) {
    var tr = trackOf(db, u);
    return (db.planTpl || []).filter(function (x) { return !x.track || (tr && x.track === tr.id); });
  }
  function planText(x, lang) { return typeof x.text === 'string' ? x.text : (x.text[lang] || x.text.uz || ''); }
  function planDue(u, day) { return (u.startedAt || Date.now()) + day * DAY; }
  function planDone(u, id) { return (u.plan || {})[id]; }
  function planStat(db, u) {
    var items = planItems(db, u), now = Date.now(), done = 0, late = 0;
    items.forEach(function (x) { if (planDone(u, x.id)) done++; else if (planDue(u, x.day) < now) late++; });
    return { total: items.length, done: done, late: late, pct: items.length ? Math.round(done * 100 / items.length) : 0 };
  }
  function togglePlan(p, uid, id) {
    p.update(function (d) {
      d.users.forEach(function (x) {
        if (x.id !== uid) return;
        x.plan = Object.assign({}, x.plan);
        if (x.plan[id]) delete x.plan[id]; else x.plan[id] = { at: Date.now(), by: p.user.id };
      });
    });
  }

  function PlanBox(p) {
    var t = p.t, db = p.db, u = p.u, lang = p.lang, items = planItems(db, u), st = planStat(db, u), now = Date.now();
    if (!items.length) return null;
    var may = p.canEdit !== false;
    return h('section', { className: 'box plan-box' },
      h('div', { className: 'plan-head' },
        h('div', null,
          h('span', { className: 'lor-eyebrow' }, t('pl_eyebrow')),
          h('h2', { className: 'lor-h' }, t('pl_title'))),
        h('div', { className: 'plan-sum' },
          h('b', null, st.done + ' / ' + st.total),
          st.late ? h('span', { className: 'plan-late' }, tpl(t('pl_late'), { n: st.late })) : h('span', { className: 'lor-sm lor-muted' }, t('pl_on_track')))),
      h('div', { className: 'lor-progress-track' }, h('div', { className: 'lor-progress-fill', style: { width: st.pct + '%' } })),
      h('div', { className: 'plan-cols' }, PLAN_DAYS.map(function (day) {
        var list = items.filter(function (x) { return x.day === day; }), due = planDue(u, day);
        var allDone = list.length && list.every(function (x) { return planDone(u, x.id); });
        return h('div', { key: day, className: cx('plan-col', allDone && 'is-done', !allDone && due < now && 'is-late') },
          h('div', { className: 'plan-col-h' },
            h('b', null, tpl(t('pl_day'), { n: day })),
            h('span', { className: 'lor-sm lor-muted' }, fmtDate(due))),
          h('ul', { className: 'plan-list' }, list.map(function (x) {
            var d = planDone(u, x.id);
            return h('li', { key: x.id, className: cx(d && 'is-done', !d && due < now && 'is-late') },
              h('label', { className: 'plan-item' },
                h('input', { type: 'checkbox', checked: !!d, disabled: !may, onChange: function () { togglePlan(p, u.id, x.id); } }),
                h('span', null, planText(x, lang),
                  d ? h('small', null, t('pl_done_by') + ' ' + userOf(db, d.by).name + ' · ' + fmtDate(d.at)) : null)));
          })));
      })),
      h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t(p.admin ? 'pl_hint_admin' : 'pl_hint')));
  }

  /* ---------- admin: programmes ---------- */
  function blankTrack() { return { id: null, title: { uz: '', ru: '', en: '', zh: '' }, desc: { uz: '', ru: '', en: '', zh: '' }, positions: [], sections: [] }; }
  function TracksAdmin(p) {
    var t = p.t, db = p.db, list = tracksOf(db), ed = useState(null), draft = ed[0], er = useState(''), del = useState(false);
    var POS = uniq(db.users.filter(function (u) { return u.role === 'employee'; }).map(function (u) { return u.position; })).concat(['Ombor mudiri']).filter(function (x, i, a) { return a.indexOf(x) === i; }).sort();
    function setD(fn) { var c = clone(draft); fn(c); ed[1](c); }
    function save() {
      var c = clone(draft);
      if (!trackTitle(c, p.lang).trim() && !c.title.uz.trim()) { er[1](t('fill_required')); return; }
      if (!c.sections.length) { er[1](t('trk_need_sec')); return; }
      p.update(function (d) {
        d.tracks = d.tracks || [];
        if (c.id) d.tracks = d.tracks.map(function (x) { return x.id === c.id ? Object.assign({}, x, c) : x; });
        else { c.id = 'tr' + nextId(d); d.tracks.push(c); }
      });
      ed[1](null); p.say(t('trk_saved'));
    }
    function remove() { var id = draft.id; p.update(function (d) { d.tracks = (d.tracks || []).filter(function (x) { return x.id !== id; }); d.users.forEach(function (u) { if (u.trackId === id) delete u.trackId; }); }); ed[1](null); p.say(t('trk_deleted')); }

    if (draft) return h('div', { className: 'cms-case-edit' },
      h('div', { className: 'page-head' },
        h('div', null, h('span', { className: 'lor-eyebrow' }, t('trk_eyebrow')), h('h2', { className: 'lor-title' }, draft.id ? t('trk_edit') : t('trk_new'))),
        h(Btn, { variant: 'ghost', onClick: function () { ed[1](null); } }, t('cancel'))),
      h('section', { className: 'box cs-form' },
        er[0] ? h('p', { className: 'lor-field-error', style: { margin: 0 } }, er[0]) : null,
        h('div', { className: 'lor-form-grid' }, ['uz', 'ru', 'en', 'zh'].map(function (lg) {
          return h(Field, { key: lg, name: 'trk-t-' + lg, label: t('trk_title') + ' · ' + lg.toUpperCase(), required: lg === 'uz', value: draft.title[lg] || '', onChange: function (v) { setD(function (c) { c.title[lg] = v; }); } });
        })),
        h(Field, { name: 'trk-d', span: true, multiline: true, rows: 2, label: t('trk_desc') + ' · ' + p.lang.toUpperCase(), value: (draft.desc || {})[p.lang] || '', onChange: function (v) { setD(function (c) { c.desc = c.desc || {}; c.desc[p.lang] = v; }); } }),
        h('h3', { className: 'cms-h' }, t('trk_sections')),
        h('div', { className: 'ac-chips' }, db.course.sections.map(function (s) {
          return h('label', { key: s.id, className: cx('ac-chip', draft.sections.indexOf(s.id) >= 0 && 'is-on') },
            h('input', { type: 'checkbox', checked: draft.sections.indexOf(s.id) >= 0, onChange: function () { setD(function (c) { var i = c.sections.indexOf(s.id); if (i < 0) c.sections.push(s.id); else c.sections.splice(i, 1); }); } }),
            s.title, h('small', null, ' · ' + s.lessons.length));
        })),
        h('h3', { className: 'cms-h' }, t('trk_positions')),
        h('div', { className: 'ac-chips' }, POS.map(function (x) {
          return h('label', { key: x, className: cx('ac-chip', draft.positions.indexOf(x) >= 0 && 'is-on') },
            h('input', { type: 'checkbox', checked: draft.positions.indexOf(x) >= 0, onChange: function () { setD(function (c) { var i = c.positions.indexOf(x); if (i < 0) c.positions.push(x); else c.positions.splice(i, 1); }); } }), x);
        })),
        h('span', { className: 'lor-field-hint' }, t('trk_positions_h')),
        h('div', { className: 'cms-foot' },
          draft.id ? (del[0] ? h('span', { className: 'cms-confirm' }, t('confirm_del'), ' ', h(Btn, { variant: 'ghost', size: 'sm', onClick: function () { del[1](false); } }, t('cancel')), h(Btn, { variant: 'outline', size: 'sm', onClick: remove }, t('yes_del')))
            : h('button', { type: 'button', className: 'app-link danger', onClick: function () { del[1](true); } }, t('trk_delete'))) : h('span'),
          h(Btn, { variant: 'primary', arrow: true, onClick: save }, t('save')))));

    return h('div', null,
      h('div', { className: 'cs-admin-h' },
        h('div', null, h('h2', { className: 'lor-h' }, t('trk_admin_t')), h('p', { className: 'lor-sm lor-muted', style: { margin: '4px 0 0' } }, t('trk_admin_s'))),
        h(Btn, { variant: 'primary', arrow: true, onClick: function () { ed[1](blankTrack()); er[1](''); del[1](false); } }, t('trk_new'))),
      h('div', { className: 'trk-grid' }, list.map(function (x) {
        var ls = x.sections.reduce(function (n, id) { var s = db.course.sections.filter(function (y) { return y.id === id; })[0]; return n + (s ? s.lessons.length : 0); }, 0);
        return h('button', { key: x.id, type: 'button', className: 'trk-card', onClick: function () { ed[1](clone(x)); er[1](''); del[1](false); window.scrollTo(0, 0); } },
          h('div', { className: 'trk-card-h' }, h('span', { className: 'cs-ico' }, h(Ico, { name: 'target', size: 18 })), h('b', null, trackTitle(x, p.lang))),
          h('p', { className: 'cs-sit' }, trackDesc(x, p.lang)),
          h('div', { className: 'trk-meta' },
            h('span', null, tpl(t('trk_n_lessons'), { n: ls })),
            h('span', null, tpl(t('trk_n_people'), { n: trackUsers(db, x.id).length })),
            h('span', { className: 'cs-tag' }, (x.positions || []).join(', ') || t('trk_no_pos'))));
      })),
      h('p', { className: 'lor-sm lor-muted' }, t('trk_rest_note')));
  }

  /* ---------- admin: the plan template ---------- */
  function PlanAdmin(p) {
    var t = p.t, db = p.db, list = (db.planTpl || []), add = useState({ day: 30, track: '', text: '' });
    function save(id, fn) { p.update(function (d) { d.planTpl = (d.planTpl || []).map(function (x) { if (x.id !== id) return x; var c = clone(x); fn(c); return c; }); }); }
    function remove(id) { p.update(function (d) { d.planTpl = (d.planTpl || []).filter(function (x) { return x.id !== id; }); }); p.say(t('pl_deleted')); }
    function create() {
      var v = add[0]; if (!v.text.trim()) return;
      p.update(function (d) { var o = { id: 'pl' + nextId(d), day: +v.day, track: v.track || null, text: {} }; o.text[p.lang] = v.text.trim(); d.planTpl = (d.planTpl || []).concat([o]); });
      add[1]({ day: v.day, track: v.track, text: '' }); p.say(t('pl_added'));
    }
    return h('div', null,
      h('div', { className: 'cs-admin-h' },
        h('div', null, h('h2', { className: 'lor-h' }, t('pl_admin_t')), h('p', { className: 'lor-sm lor-muted', style: { margin: '4px 0 0' } }, t('pl_admin_s')))),
      h('div', { className: 'plan-cols' }, PLAN_DAYS.map(function (day) {
        return h('div', { key: day, className: 'plan-col' },
          h('div', { className: 'plan-col-h' }, h('b', null, tpl(t('pl_day'), { n: day })), h('span', { className: 'lor-sm lor-muted' }, list.filter(function (x) { return x.day === day; }).length)),
          h('ul', { className: 'plan-list is-admin' }, list.filter(function (x) { return x.day === day; }).map(function (x) {
            var tr = x.track ? trackById(db, x.track) : null;
            return h('li', { key: x.id },
              h(Field, { name: 'plt-' + x.id, multiline: true, rows: 2, value: planText(x, p.lang), onChange: function (v) { save(x.id, function (c) { if (typeof c.text === 'string') c.text = { uz: c.text }; c.text[p.lang] = v; }); } }),
              h('div', { className: 'cms-mini' },
                h(Field, { name: 'pltr-' + x.id, value: x.track || '', options: [['', t('pl_all_tracks')]].concat(tracksOf(db).map(function (y) { return [y.id, trackTitle(y, p.lang)]; })), onChange: function (v) { save(x.id, function (c) { c.track = v || null; }); } }),
                h('button', { type: 'button', className: 'app-link danger', onClick: function () { remove(x.id); } }, t('remove'))),
              tr ? h('span', { className: 'cs-tag' }, trackTitle(tr, p.lang)) : null);
          })));
      })),
      h('section', { className: 'box' },
        h('h3', { className: 'lor-h' }, t('pl_add')),
        h('div', { className: 'lor-form-grid' },
          h(Field, { name: 'pl-day', label: t('pl_when'), value: String(add[0].day), options: PLAN_DAYS.map(function (d) { return [String(d), tpl(t('pl_day'), { n: d })]; }), onChange: function (v) { add[1](Object.assign({}, add[0], { day: +v })); } }),
          h(Field, { name: 'pl-track', label: t('trk_title'), value: add[0].track, options: [['', t('pl_all_tracks')]].concat(tracksOf(db).map(function (y) { return [y.id, trackTitle(y, p.lang)]; })), onChange: function (v) { add[1](Object.assign({}, add[0], { track: v })); } }),
          h(Field, { name: 'pl-text', span: true, multiline: true, rows: 2, label: t('pl_text'), placeholder: t('pl_text_ph'), value: add[0].text, onChange: function (v) { add[1](Object.assign({}, add[0], { text: v })); } })),
        h('div', { className: 'as-act' }, h(Btn, { variant: 'primary', onClick: create }, '+ ' + t('pl_add')))));
  }

  /* ======================= FEATURES 9: which standards the mistakes keep pointing at ======================= */

  var SEV_W = { high: 3, med: 2, low: 1 };
  /* group the mistake log by the standard it was attached to */
  function sopRisk(db, days) {
    var since = Date.now() - (days || 90) * DAY, by = {};
    (db.errors || []).forEach(function (e) {
      if (!e.lessonId || e.at < since) return;
      var o = by[e.lessonId] || (by[e.lessonId] = { lessonId: e.lessonId, n: 0, open: 0, sev: 0, who: {}, cats: {}, texts: [], last: 0 });
      o.n++; o.who[e.uid] = 1; o.sev += SEV_W[e.sev] || 1; o.cats[e.cat] = (o.cats[e.cat] || 0) + 1;
      if (e.status !== 'done' && e.status !== 'closed') o.open++;
      if (e.at > o.last) o.last = e.at;
      if (o.texts.length < 8) o.texts.push(e.text);
    });
    return Object.keys(by).map(function (k) {
      var o = by[k];
      o.people = Object.keys(o.who).length;
      o.top = Object.keys(o.cats).sort(function (a, b) { return o.cats[b] - o.cats[a]; })[0];
      o.score = o.n * 2 + o.sev + o.people * 2 + o.open;
      return o;
    }).sort(function (a, b) { return b.score - a.score; });
  }
  function sopRiskOf(db, lessonId) { return sopRisk(db, 90).filter(function (x) { return x.lessonId === lessonId; })[0] || null; }
  /* “worth rewriting”: more than one person, more than two mistakes */
  function riskHot(r) { return !!r && r.n >= 3 && r.people >= 2; }

  function riskPrompt(db, r, lang) {
    var l = findLesson(db.course, r.lessonId), txt = l ? lessonText(l).slice(0, 12000) : '';
    return 'Siz BURAQ Logistics kompaniyasining o‘quv platformasida SOP menejeriga yordam beruvchi AI-tahlilchisiz. Quyida bitta standart matni va shu standart bo‘yicha xodimlar yo‘l qo‘ygan haqiqiy xatolar ro‘yxati berilgan.\n' +
      'Vazifa: standart matnining qaysi joyi noaniq ekanini aniqlang va uni qanday tuzatishni ayting. Faqat berilgan matn va xatolarga tayaning, yangi fakt o‘ylab topmang.\n' +
      'Javob tili: ' + (LANG_NAME[lang] || LANG_NAME.uz) + '. Qisqa yozing.\n' +
      'Format: avval “Noaniq joylar” — 2-4 ta punkt; keyin “Nima qilish kerak” — 2-4 ta aniq tahrir taklifi; oxirida bitta qatorda trenajyor uchun ssenariy g‘oyasi.\n\n' +
      'STANDART: ' + (l ? l.title : r.lessonId) + '\n' + txt + '\n\nXATOLAR (' + r.n + ' ta, ' + r.people + ' xodim):\n' +
      r.texts.map(function (x, i) { return (i + 1) + '. ' + x; }).join('\n');
  }

  function RiskAI(p) {
    var t = p.t, r = p.r, sampler = p.sampler;
    var out = useState(''), busy = useState(false), err = useState(''), ctl = useRef(null);
    useEffect(function () { return function () { if (ctl.current) ctl.current.abort(); }; }, []);
    function run() {
      if (!sampler || busy[0]) return;
      busy[1](true); err[1]('');
      var ab = new AbortController(); ctl.current = ab;
      sampler(riskPrompt(p.db, r, p.lang), { signal: ab.signal, onText: function (x) { out[1](x.text); } })
        .then(function (x) { out[1](x.text); })
        .catch(function (e) { err[1](aiErr(e, t)); })
        .then(function () { busy[1](false); });
    }
    return h('div', { className: 'risk-ai' },
      h('div', { className: 'cs-ai-bar' },
        h(Btn, { variant: 'outline', size: 'sm', disabled: !sampler || busy[0], onClick: run }, busy[0] ? t('ai_thinking') : '✦ ' + t('sr_ai')),
        h('span', { className: 'lor-sm lor-muted' }, sampler === null ? t('ai_unavail') : t('sr_ai_hint'))),
      err[0] ? h('p', { className: 'lor-field-error', style: { margin: 0 } }, err[0]) : null,
      out[0] ? h('div', { className: 'ai-md cms-ai-res', dangerouslySetInnerHTML: { __html: mdLite(out[0]) } }) : null);
  }

  /* admin: the ranked list of standards the mistakes point at */
  function SopRiskAdmin(p) {
    var t = p.t, db = p.db, list = sopRisk(db, 90), open = useState(null);
    var max = list.length ? list[0].score : 1;
    return h('div', null,
      h('div', { className: 'cs-admin-h' },
        h('div', null, h('h2', { className: 'lor-h' }, t('sr_title')), h('p', { className: 'lor-sm lor-muted', style: { margin: '4px 0 0' } }, t('sr_sub')))),
      list.length ? h('ul', { className: 'sr-list' }, list.map(function (r) {
        var l = findLesson(db.course, r.lessonId), isOpen = open[0] === r.lessonId;
        return h('li', { key: r.lessonId, className: cx('sr-item', riskHot(r) && 'is-hot', isOpen && 'is-open') },
          h('button', { type: 'button', className: 'sr-head', 'aria-expanded': isOpen, onClick: function () { open[1](isOpen ? null : r.lessonId); } },
            h('span', { className: 'sr-bar', 'aria-hidden': true }, h('i', { style: { width: Math.round(r.score * 100 / max) + '%' } })),
            h('span', { className: 'sr-t' }, h('b', null, l ? l.title : r.lessonId),
              h('small', null, tpl(t('sr_line'), { n: r.n, k: r.people }) + (r.open ? ' · ' + tpl(t('sr_open'), { n: r.open }) : ''))),
            riskHot(r) ? h('span', { className: 'sr-flag' }, t('sr_hot')) : null,
            h('span', { className: 'sr-n' }, r.n)),
          isOpen ? h('div', { className: 'sr-body' },
            h('div', { className: 'sr-facts' },
              h('span', null, h('b', null, r.people), ' ', t('sr_people')),
              h('span', null, h('b', null, r.open), ' ', t('sr_open_short')),
              r.top ? h('span', null, t('ec_' + r.top)) : null,
              h('span', null, t('sr_last') + ': ' + fmtDate(r.last))),
            h('ul', { className: 'sr-quotes' }, r.texts.slice(0, 4).map(function (x, i) { return h('li', { key: i }, '“' + x + '”'); })),
            h(RiskAI, Object.assign({}, p, { r: r })),
            h('div', { className: 'sr-act' },
              h(Btn, { variant: 'outline', size: 'sm', onClick: function () { p.goCms(r.lessonId); } }, t('sr_edit_sop')))) : null);
      })) : h('section', { className: 'box' }, h('p', { className: 'lor-muted', style: { margin: 0 } }, t('sr_none'))));
  }

  /* the same signal, shown where the standard is actually edited */
  function LessonRisk(p) {
    var t = p.t, r = sopRiskOf(p.db, p.lessonId);
    if (!r || r.n < 2) return null;
    return h('div', { className: cx('sr-note', riskHot(r) && 'is-hot') },
      h('span', { className: 'sr-note-ic', 'aria-hidden': true }, h(Ico, { name: 'problem', size: 18 })),
      h('div', null,
        h('b', null, tpl(t('sr_note_t'), { n: r.n, k: r.people })),
        h('p', { className: 'lor-sm', style: { margin: '2px 0 0' } }, t('sr_note_p')),
        h('details', { className: 'perk-fold' },
          h('summary', null, t('sr_quotes')),
          h('ul', { className: 'sr-quotes' }, r.texts.slice(0, 4).map(function (x, i) { return h('li', { key: i }, '“' + x + '”'); })),
          h(RiskAI, Object.assign({}, p, { r: r })))));
  }

  /* ======================= FEATURES 10: hint mode — hover any control and it explains itself ======================= */

  /* selector → [title key, body key]; the first match wins, so the specific ones come first */
  var HINTS = [
    /* salary (Maosh) — the employee */
    ['.pay-months', 'hint_paym_t', 'hint_paym'],
    ['.pay-input', 'hint_payin_t', 'hint_payin'],
    ['.pay-autoval', 'hint_payauto_t', 'hint_payauto'],
    ['.pay-bar', 'hint_paybar_t', 'hint_paybar'],
    ['.pay-save .lor-btn-primary', 'hint_paysave_t', 'hint_paysave'],
    ['.pay-result', 'hint_payres_t', 'hint_payres'],
    ['.pay-hrow', 'hint_payhist_t', 'hint_payhist'],
    /* salary — the SOP manager */
    ['.pay-who', 'hint_paywho_t', 'hint_paywho'],
    ['.pay-tlrow', 'hint_paytl_t', 'hint_paytl'],
    ['.pay-decide', 'hint_paydec_t', 'hint_paydec'],
    ['.pay-ed-kpi', 'hint_paykpi_t', 'hint_paykpi'],
    ['.pay-example', 'hint_payex_t', 'hint_payex'],
    ['.pay-people select, .pay-fix-in', 'hint_payppl_t', 'hint_payppl'],
    /* staff: Excel, passport scan, initiative recipients; profile; ideas */
    ['.imp-act label', 'hint_impin_t', 'hint_impin'],
    ['.imp-act .lor-btn-secondary', 'hint_impout_t', 'hint_impout'],
    ['.imp-table', 'hint_impprev_t', 'hint_impprev'],
    ['.pp-ask', 'hint_ppask_t', 'hint_ppask'],
    ['.pf-photo', 'hint_pfphoto_t', 'hint_pfphoto'],
    ['.pf-tg', 'hint_pftg_t', 'hint_pftg'],
    ['.ini-to-card', 'hint_inito_t', 'hint_inito'],
    ['.sync-chip', 'hint_sync_t', 'hint_sync'],
    ['.th-seg', 'hint_theme_t', 'hint_theme'],
    /* the user menu */
    ['.user-pop .profile', 'hint_mprofile_t', 'hint_mprofile'],
    ['.user-pop .export', 'hint_mexport_t', 'hint_mexport'],
    ['.user-pop .drill', 'tip_drill_t', 'tip_drill'],
    ['.user-pop .assets', 'tip_assets_t', 'tip_assets'],
    ['.user-pop .ideas', 'tip_ideas_t', 'tip_ideas'],
    ['.user-pop .report', 'tip_report_t', 'tip_report'],
    ['.user-pop .help', 'tr_help_t', 'tr_help'],
    ['.ini-btn', 'hint_ini_t', 'hint_ini'],
    ['.lr-bar, .lr-gate', 'hint_lr_t', 'hint_lr'],
    ['.at-drop', 'hint_atd_t', 'hint_atd'],
    ['.xt-staff-b, .xt-panel .chart-head', 'hint_xt_t', 'hint_xt'],
    ['.at-mx, .at-strip, .at-cell, .at-list', 'hint_atm_t', 'hint_atm'],
    ['.lce', 'hint_lce_t', 'hint_lce'],
    ['.mr-switch', 'hint_mrs_t', 'hint_mrs'],
    ['.mc-grid, .mx-wrap, .mr-strip', 'hint_mc_t', 'hint_mc'],
    ['.mr-scen, .cl-track', 'hint_fc_t', 'hint_fc'],
    ['.ai-fab, .ai-panel .ai-head', 'hint_ai_t', 'hint_ai'],
    ['.search-btn', 'hint_search_t', 'hint_search'],
    ['.help-btn', 'hint_help_t', 'hint_help'],
    ['.tip-btn', 'hint_tip_t', 'hint_tip'],
    ['.lor-bell', 'hint_bell_t', 'hint_bell'],
    ['.user-btn', 'hint_user_t', 'hint_user'],
    ['.lor-lang', 'hint_lang_t', 'hint_lang'],
    ['.app-menu-btn', 'hint_menu_t', 'hint_menu'],
    ['.hint-sw', 'hint_sw_t', 'hint_sw'],
    ['a[href="#home"]', 'tr_home_t', 'tr_home'],
    ['a[href="#tasks"]', 'tr_tasks_t', 'tr_tasks'],
    ['a[href="#cases"]', 'tr_cases_t', 'tr_cases'],
    ['a[href="#base"]', 'tr_base_t', 'tr_base'],
    ['a[href="#path"]', 'tr_path_t', 'tr_path'],
    ['a[href="#help"]', 'tr_help_t', 'tr_help'],
    ['a[href="#inbox"]', 'tr_inbox_t', 'tr_inbox'],
    ['a[href="#monitor"]', 'tr_monitor_t', 'tr_monitor'],
    ['a[href="#quality"]', 'tr_quality_t', 'tr_quality'],
    ['a[href="#cms"]', 'tr_cms_t', 'tr_cms'],
    ['a[href="#staff"]', 'tr_staff_t', 'tr_staff'],
    ['a[href="#levels"]', 'tr_levels_t', 'tr_levels'],
    ['a[href="#rating"]', 'hint_nrating_t', 'hint_nrating'],
    ['a[href="#assets"]', 'tip_aassets_t', 'tip_aassets'],
    ['a[href="#feedback"]', 'tip_feedback_t', 'tip_feedback'],
    ['a[href="#pay"]', 'hint_npay_t', 'hint_npay'],
    ['a[href="#mentor"]', 'hint_nmentor_t', 'hint_nmentor'],
    ['.plan-item', 'hint_plan_t', 'hint_plan'],
    ['.ladder-btn', 'hint_lvl_t', 'hint_lvl'],
    ['.jr-add-btn button', 'hint_addrow_t', 'hint_addrow'],
    ['.sp-btn', 'hint_pulse_t', 'hint_pulse'],
    ['.sr-head', 'hint_risk_t', 'hint_risk'],
    ['.trk-card', 'hint_track_t', 'hint_track'],
    ['.cs-card', 'hint_case_t', 'hint_case'],
    ['.jr-card', 'hint_journal_t', 'hint_journal'],
    ['.tm-head', 'hint_term_t', 'hint_term'],
    ['.help-head', 'hint_guide_t', 'hint_guide'],
    ['.fb-tabs .lor-tab, .lor-tabs .lor-tab', 'hint_tab_t', 'hint_tab'],
    ['.app-link.danger', 'hint_del_t', 'hint_del'],
    ['.cs-ai-bar button, .ini-ai button, .cms-ai button', 'hint_aifill_t', 'hint_aifill'],
    ['.lor-btn-primary', 'hint_save_t', 'hint_save'],
    ['.lor-btn-outline, .lor-btn-ghost, .lor-btn-secondary', 'hint_second_t', 'hint_second'],
    ['.lor-input', 'hint_field_t', 'hint_field'],
    ['.seg button', 'hint_seg_t', 'hint_seg'],
    ['.check', 'hint_check_t', 'hint_check'],
    ['.ac-chip:not(.is-static)', 'hint_chip_t', 'hint_chip'],
    ['.pay-card', 'hint_paycard_t', 'hint_paycard'],
    ['.pay-filters', 'hint_payflt_t', 'hint_payflt'],
    ['.ld-box', 'hint_ldr_t', 'hint_ldr'],
    ['.wz-admin', 'hint_wz_t', 'hint_wz']
  ];
  var HINT_ALL = HINTS.map(function (x) { return x[0]; }).join(', ');

  function hintFor(el) {
    for (var i = 0; i < HINTS.length; i++) {
      var m = el.closest(HINTS[i][0]);
      if (m) return { el: m, t: HINTS[i][1], b: HINTS[i][2] };
    }
    return null;
  }

  /* one listener for the whole app: no component has to know about hint mode */
  function HintLayer(p) {
    var t = p.t, st = useState(null), cur = st[0], curEl = useRef(null), tm = useRef(null);
    useEffect(function () {
      function place(el, keys) {
        var q = el.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
        var w = Math.min(300, vw - 20);
        var below = vh - q.bottom > 150 || q.top < 160;
        st[1]({
          t: keys.t, b: keys.b, w: w,
          left: Math.max(10, Math.min(q.left + q.width / 2 - w / 2, vw - w - 10)),
          top: below ? Math.round(q.bottom + 10) : null,
          bottom: below ? null : Math.round(vh - q.top + 10),
          ring: { top: q.top - 4, left: q.left - 4, w: q.width + 8, h: q.height + 8 }
        });
      }
      function over(e) {
        var el = e.target && e.target.closest ? e.target : null;
        if (!el) return;
        var k = hintFor(el);
        if (!k) { if (curEl.current) { curEl.current = null; clearTimeout(tm.current); st[1](null); } return; }
        if (k.el === curEl.current) return;
        curEl.current = k.el;
        clearTimeout(tm.current);
        tm.current = setTimeout(function () { if (curEl.current === k.el && document.contains(k.el)) place(k.el, k); }, 110);
      }
      function off() { curEl.current = null; clearTimeout(tm.current); st[1](null); }
      document.addEventListener('mouseover', over, true);
      document.addEventListener('focusin', over, true);
      document.addEventListener('mousedown', off, true);
      window.addEventListener('scroll', off, true);
      window.addEventListener('resize', off);
      return function () {
        clearTimeout(tm.current);
        document.removeEventListener('mouseover', over, true);
        document.removeEventListener('focusin', over, true);
        document.removeEventListener('mousedown', off, true);
        window.removeEventListener('scroll', off, true);
        window.removeEventListener('resize', off);
      };
    }, []);
    if (!cur) return null;
    return h(F, null,
      h('div', { className: 'hint-ring', style: { top: cur.ring.top, left: cur.ring.left, width: cur.ring.w, height: cur.ring.h } }),
      h('div', { className: 'hint-pop', role: 'tooltip', style: { width: cur.w, left: cur.left, top: cur.top == null ? 'auto' : cur.top, bottom: cur.bottom == null ? 'auto' : cur.bottom } },
        h('b', null, t(cur.t)),
        h('span', null, t(cur.b))));
  }

  /* the switch itself — lives in the user menu and on the guide page */
  function HintSwitch(p) {
    var t = p.t, on = !!p.on;
    return h('button', {
      type: 'button', className: cx('hint-sw', on && 'is-on'), role: 'switch', 'aria-checked': on,
      onClick: function () { p.onToggle(!on); }
    },
      h('span', { className: 'hint-sw-t' }, h('b', null, t('hint_label')), h('small', null, t(on ? 'hint_on' : 'hint_off'))),
      h('span', { className: 'sw', 'aria-hidden': true }, h('i', null)));
  }

  /* ---------- day / night ----------
     The choice lives on the device, not in the account: the same person reads
     on a bright warehouse floor in the morning and in bed at night. */
  var THEME_KEY = 'lor-theme';
  function themeRead() { try { var v = localStorage.getItem(THEME_KEY); return v === 'light' || v === 'dark' ? v : 'auto'; } catch (e) { return 'auto'; } }
  function themeDark(v) {
    v = v || themeRead();
    if (v === 'dark') return true;
    if (v === 'light') return false;
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function themePaint() {
    var m = document.querySelector('meta[name="theme-color"]');
    if (!m) { m = document.createElement('meta'); m.setAttribute('name', 'theme-color'); document.head.appendChild(m); }
    m.setAttribute('content', themeDark() ? '#071a30' : '#0e2e54');
  }
  function themeApply(v) {
    var r = document.documentElement;
    if (v === 'light' || v === 'dark') r.setAttribute('data-theme', v); else r.removeAttribute('data-theme');
    try { if (v === 'auto') localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, v); } catch (e) {}
    themePaint();
  }
  themeApply(themeRead());

  function useThemePref(say, t) {
    var s = useState(themeRead());
    useEffect(function () {
      if (!window.matchMedia) return;
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      if (mq.addEventListener) { mq.addEventListener('change', themePaint); return function () { mq.removeEventListener('change', themePaint); }; }
      if (mq.addListener) { mq.addListener(themePaint); return function () { mq.removeListener(themePaint); }; }
    }, []);
    return {
      v: s[0],
      set: function (x) { themeApply(x); s[1](x); if (say) say(t('th_said_' + x)); }
    };
  }

  function ThemeIco(p) {
    var k = p.k, s = p.size || 15;
    var c = { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': true };
    if (k === 'light') return h('svg', c, h('circle', { cx: 12, cy: 12, r: 4.2 }),
      [[12, 2.4, 12, 4.6], [12, 19.4, 12, 21.6], [2.4, 12, 4.6, 12], [19.4, 12, 21.6, 12], [5.2, 5.2, 6.8, 6.8], [17.2, 17.2, 18.8, 18.8], [5.2, 18.8, 6.8, 17.2], [17.2, 6.8, 18.8, 5.2]].map(function (l, i) {
        return h('line', { key: i, x1: l[0], y1: l[1], x2: l[2], y2: l[3] }); }));
    if (k === 'dark') return h('svg', c, h('path', { d: 'M20.2 14.4A8.6 8.6 0 0 1 9.6 3.8a8.6 8.6 0 1 0 10.6 10.6z' }));
    return h('svg', c, h('circle', { cx: 12, cy: 12, r: 8.6 }), h('path', { d: 'M12 3.4v17.2a8.6 8.6 0 0 0 0-17.2z', fill: 'currentColor', stroke: 'none' }));
  }

  /* the segmented control: same pill shape as the language switch */
  function ThemeSwitch(p) {
    var t = p.t, v = p.value;
    return h('div', { className: cx('th-seg', p.compact && 'is-compact'), role: 'radiogroup', 'aria-label': t('th_label') },
      ['light', 'auto', 'dark'].map(function (k) {
        return h('button', {
          key: k, type: 'button', role: 'radio', 'aria-checked': v === k,
          className: cx('th-opt', v === k && 'is-on'),
          title: t('th_' + k) + ' — ' + t('th_' + k + '_hint'),
          onClick: function () { p.onChange(k); }
        }, h(ThemeIco, { k: k }), p.compact ? null : h('span', null, t('th_' + k)));
      }));
  }

  function ThemeBlock(p) {
    var t = p.t;
    return h('div', { className: 'th-block' },
      h('div', { className: 'th-block-t' }, h('b', null, t('th_label')), h('small', null, t('th_' + p.value + '_hint'))),
      h(ThemeSwitch, { t: t, value: p.value, onChange: p.onChange }));
  }

  /* ======================= FEATURES 11: the level ruler (conditions set by the SOP manager) + the monthly report with a forecast ======================= */

  /* ---------- conditions for moving up: stored on the TARGET level as lv.conds ---------- */
  var COND_TYPES = ['xp', 'sec', 'course', 'avg', 'ini', 'drill', 'days', 'plan', 'tenure', 'task'];
  var COND_DEF = { xp: 300, course: 100, avg: 85, ini: 1, drill: 3, days: 10, plan: 100, tenure: 30 };
  var COND_PCT = { course: 1, avg: 1, plan: 1 };
  var COND_ICO = {
    xp: 'M12 3.5l2.5 5.2 5.7.8-4.1 4 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4.1-4 5.7-.8z',
    sec: 'M3 5.5c2.6-.9 5.6-.7 9 1.2 3.4-1.9 6.4-2.1 9-1.2v13c-2.6-.9-5.6-.7-9 1.2-3.4-1.9-6.4-2.1-9-1.2zM12 6.7v13',
    course: 'M12 3.5l8.5 4.5-8.5 4.5L3.5 8zM3.5 12.5l8.5 4.5 8.5-4.5M3.5 16.5l8.5 4.5 8.5-4.5',
    avg: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 11.6v.8',
    ini: 'M9.5 18h5M10.5 21h3M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.4 1.1 2.2h5c0-.8.4-1.6 1.1-2.2A6 6 0 0 0 12 3z',
    drill: 'M4 5h11v8H9l-5 3.5zM15 9h5v8.5L17 15h-6v-2',
    days: 'M4.5 6h15v14h-15zM4.5 10h15M8.5 3.5v4M15.5 3.5v4M8.5 14.5l2.2 2.2 4.8-4.7',
    plan: 'M10 6.5h10M10 12h10M10 17.5h10M4 6.5l1.5 1.5L8 5.5M4 12l1.5 1.5L8 11M4 17.5l1.5 1.5L8 16.5',
    tenure: 'M6.5 3.5h11M6.5 20.5h11M7.5 3.5c0 4.5 4.5 5.5 4.5 8.5s-4.5 4-4.5 8.5M16.5 3.5c0 4.5-4.5 5.5-4.5 8.5s4.5 4 4.5 8.5',
    task: 'M5.5 21V4M5.5 4.5h11.5l-2.5 4 2.5 4H5.5',
    xtask: 'M13.5 2.5L5 13.5h6l-1 8 8.5-11h-6z',
    lock: 'M6.5 11h11v9h-11zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
    unlock: 'M6.5 11h11v9h-11zM8.5 11V8a3.5 3.5 0 0 1 6.8-1.2'
  };
  function CondIco(p) { return h('svg', { width: p.size || 16, height: p.size || 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: 'false' }, h('path', { d: COND_ICO[p.type] || COND_ICO.task })); }
  function condId() { return 'c' + Math.random().toString(36).slice(2, 8); }
  function condsOf(lv) { return (lv && lv.conds) || []; }
  /* XP asked to move on from level i (the xp condition of the next level), or null */
  function stepXp(L, i) { var c = condsOf(L[i + 1]).filter(function (x) { return x.type === 'xp'; })[0]; return c ? +c.n || 0 : null; }
  function levelSince(u) { return u.levelAt || u.startedAt || Date.now(); }
  function txtOf(x, lang) { return !x ? '' : typeof x === 'string' ? x : (x[lang] || x.uz || x.ru || x.en || x.zh || ''); }
  function goalDaysSince(db, uid, since) { var st = (db.study || {})[uid] || {}, k0 = dayKey(since), n = 0; for (var k in st) if (k >= k0 && st[k] >= GOAL) n++; return n; }
  function okDrills(db, uid) { return drillsOf(db, uid).filter(function (x) { return x.score >= 3.5; }).length; }
  function trackPct(db, u) { var ls = trackFlat(db, u), pr = prog(db, u.id); if (!ls.length) return 100; return Math.round(ls.filter(function (l) { return (pr[l.id] || {}).status === 'passed'; }).length * 100 / ls.length); }
  function condState(db, u, c, inLevel) {
    var n = Math.max(0, +c.n || 0), cur = 0, max = n, q = { key: c.type, id: c.id, c: c, n: n };
    if (c.type === 'xp') cur = inLevel;
    else if (c.type === 'sec') {
      var sec = db.course.sections.filter(function (x) { return x.id === c.sid; })[0];
      if (!sec) return null;
      q.s = sec.title; var ids = trackSecIds(db, u);
      if (!sec.lessons.length || (ids && ids.indexOf(sec.id) < 0)) { q.na = true; cur = max = 1; }
      else { max = sec.lessons.length; cur = sec.lessons.filter(function (l) { return (prog(db, u.id)[l.id] || {}).status === 'passed'; }).length; }
    }
    else if (c.type === 'course') cur = trackPct(db, u);
    else if (c.type === 'avg') cur = Math.round(avgScoreOf(db, u));
    else if (c.type === 'ini') cur = acceptedIni(db, u);
    else if (c.type === 'drill') cur = okDrills(db, u.id);
    else if (c.type === 'days') cur = goalDaysSince(db, u.id, levelSince(u));
    else if (c.type === 'plan') cur = planStat(db, u).pct;
    else if (c.type === 'tenure') cur = Math.max(0, Math.floor((Date.now() - levelSince(u)) / DAY));
    else if (c.type === 'task') { max = 1; q.mark = (u.levelTasks || {})[c.id] || null; cur = q.mark ? 1 : 0; }
    else return null;
    q.cur = cur; q.max = max; q.frac = max > 0 ? Math.max(0, Math.min(1, cur / max)) : 1; q.ok = q.frac >= 1;
    return q;
  }
  var COND_KEY = { xp: 'req_xp', course: 'req_course', avg: 'req_avg', ini: 'req_ini', drill: 'req_drill', days: 'req_days', plan: 'req_plan', tenure: 'req_tenure' };
  function condText(q, t, lang) {
    var k = q.key || q.type, c = q.c || q;
    if (k === 'task') return txtOf(c.title, lang) || t('lc_task_untitled');
    if (k === 'xtask') return c.title || '';
    if (k === 'sec') return tpl(t('req_section'), { s: q.s || '—' });
    return tpl(t(COND_KEY[k] || 'req_xp'), { n: q.n != null ? q.n : c.n });
  }
  function condValue(q, t) {
    if (q.na) return t('lc_na');
    if (q.key === 'task') return q.ok ? t('lc_task_done') : t('lc_task_wait');
    if (q.key === 'xtask') return t('xt_st_' + q.x.status);
    var cur = Math.min(q.cur, 99999);
    if (COND_PCT[q.key]) return cur + ' / ' + q.max + '%';
    if (q.key === 'xp') return cur + ' / ' + q.max + ' XP';
    if (q.key === 'sec') return tpl(t('lc_v_lessons'), { k: cur, n: q.max });
    if (q.key === 'days' || q.key === 'tenure') return tpl(t('lc_v_days'), { k: cur, n: q.max });
    return cur + ' / ' + q.max;
  }
  function condUnit(type, t) { return type === 'xp' ? 'XP' : COND_PCT[type] ? '%' : type === 'days' || type === 'tenure' ? t('lc_u_days') : t('lc_u_pcs'); }

  /* the ruler: one cell per condition, each fills on its own; the pin under it is the overall share */
  function LevelRuler(p) {
    var t = p.t, db = p.db, u = p.u || p.user, r = p.rank || rankOf(db, u), hv = useState(-1), hot = hv[0];
    if (!r.next) return null;
    var reqs = r.reqs, n = reqs.length, uid = 'lr' + u.id + (p.tag || '');
    function mark(q) {
      var on = !q.ok, title = q.c.title;
      p.update(function (d) {
        patchUser(d, u.id, function (x) { x.levelTasks = Object.assign({}, x.levelTasks); if (on) x.levelTasks[q.id] = { at: Date.now(), by: p.user.id }; else delete x.levelTasks[q.id]; });
        if (on) d.notifications.unshift({ id: nextId(d), userId: u.id, kind: 'ltask', lt: { x: title }, path: true, text: '', at: Date.now(), read: false });
      });
      p.say(on ? t('lc_marked_said') : t('lc_unmarked_said'));
    }
    function hover(i) { return { onMouseEnter: function () { hv[1](i); }, onMouseLeave: function () { hv[1](-1); } }; }
    return h('div', { className: cx('lr', r.eligible && 'is-full', p.compact && 'is-compact') },
      h('div', { className: 'lr-ends' },
        h('span', { className: 'lr-end' }, h(LevelEmblem, { n: r.li + 1, size: 30, uid: uid + 'a', className: 'lvl-mini' }), h('span', null, h('small', null, t('lr_from')), h('b', null, lvlShort(r.level, p.lang)))),
        h('span', { className: 'lr-pct' }, h('b', null, r.pct + '%'), h('small', null, n ? tpl(t('lr_done_of'), { k: r.done, n: n }) : t('lr_no_conds'))),
        h('span', { className: 'lr-end is-next' }, h('span', null, h('small', null, t('lr_to')), h('b', null, lvlShort(r.next, p.lang))), h(LevelEmblem, { n: r.li + 2, size: 30, uid: uid + 'b', className: 'lvl-mini' }))),
      h('div', { className: 'lr-scale' },
        h('div', { className: 'lr-bar', role: 'progressbar', 'aria-valuenow': r.pct, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': t('lr_aria') + ' ' + lvlName(r.next, p.lang) },
          n ? reqs.map(function (q, i) {
            return h('span', Object.assign({ key: q.id || i, className: cx('lr-cell', q.ok ? 'is-ok' : q.frac > 0 && 'is-part', hot === i && 'is-hot'), title: (i + 1) + '. ' + condText(q, t, p.lang) + ' · ' + condValue(q, t) }, hover(i)),
              h('i', { style: { width: Math.round(q.frac * 1000) / 10 + '%', animationDelay: (120 + i * 110) + 'ms' } }),
              h('em', null, q.ok ? '✓' : h('span', null, i + 1)));
          }) : h('span', { className: 'lr-cell is-ok' }, h('i', { style: { width: '100%' } }))),
        h('span', { className: cx('lr-gate', r.eligible && 'is-open', r.pending && 'is-wait'), title: t('req_method') }, h(CondIco, { type: r.eligible ? 'unlock' : 'lock', size: 15 }))),
      h('div', { className: 'lr-ruler', 'aria-hidden': true },
        [0, 25, 50, 75, 100].map(function (v) { return h('span', { key: v, style: { left: v + '%' } }, v + (v === 100 ? '%' : '')); }),
        h('b', { className: 'lr-pin', style: { left: r.pct + '%' } })),
      p.list === false ? null : h('ol', { className: 'lr-list' }, reqs.map(function (q, i) {
        var task = q.key === 'task';
        return h('li', Object.assign({ key: q.id || i, className: cx(q.ok && 'is-ok', hot === i && 'is-hot') }, hover(i)),
          h('span', { className: 'lr-ico' }, h(CondIco, { type: q.key }), h('sup', null, q.ok ? '✓' : i + 1)),
          h('span', { className: 'lr-txt' }, h('b', null, condText(q, t, p.lang)),
            task ? h('small', null, q.mark ? tpl(t('lc_marked_by'), { who: userOf(db, q.mark.by).name, d: fmtDate(q.mark.at) }) : t('lc_task_hint')) : q.key === 'xtask' ? h('small', null, t('xt_cell') + (q.x.due && !q.ok ? ' · ' + tpl(t('xt_due_to'), { d: fmtK(q.x.due) }) : '') + (+q.x.xp ? ' · +' + q.x.xp + ' XP' : '')) : q.na ? h('small', null, t('lc_na_hint')) : null),
          h('span', { className: 'lr-val' }, task ? null : h('span', { className: 'lr-mini' }, h('i', { style: { width: q.frac * 100 + '%' } })), h('small', null, condValue(q, t))),
          p.admin && task ? h('button', { type: 'button', className: cx('lr-tick', q.ok && 'is-on'), 'aria-pressed': q.ok, onClick: function () { mark(q); } }, q.ok ? t('lc_unmark') : '✓ ' + t('lc_mark')) : null);
      }).concat([h('li', { key: 'gate', className: cx('lr-final', r.eligible && 'is-open', r.pending && 'is-wait') },
        h('span', { className: 'lr-ico' }, h(CondIco, { type: r.eligible ? 'unlock' : 'lock' })),
        h('span', { className: 'lr-txt' }, h('b', null, t('req_method')), h('small', null, r.pending ? t('level_pending') : r.eligible ? t('lr_ready') : t('lr_gate_hint'))))])));
  }

  /* SOP manager: the list of conditions for one level */
  function CondEditor(p) {
    var t = p.t, cs = p.conds || [], secs = p.db.course.sections;
    function blank(type, id) { var c = { id: id || condId(), type: type }; if (type === 'sec') c.sid = (secs[0] || {}).id; else if (type === 'task') c.title = ''; else c.n = COND_DEF[type]; return c; }
    function put(i, c) { p.onChange(cs.map(function (x, k) { return k === i ? c : x; })); }
    return h('div', { className: 'lce' },
      h('div', { className: 'lce-h' }, h('span', { className: 'lor-field-label' }, t('lc_title')), h('span', { className: 'lor-sm lor-muted' }, tpl(t('lc_count'), { n: cs.length }))),
      cs.length ? h('ol', { className: 'lce-list' }, cs.map(function (c, i) {
        var val;
        if (c.type === 'sec') val = h('select', { className: 'lor-input slim lce-val', 'aria-label': t('lct_sec'), value: c.sid || '', onChange: function (e) { put(i, Object.assign({}, c, { sid: e.target.value })); } }, secs.map(function (s) { return h('option', { key: s.id, value: s.id }, s.title); }));
        else if (c.type === 'task') val = h('input', { className: 'lor-input slim lce-val', placeholder: t('lc_task_ph'), 'aria-label': t('lct_task'), value: txtOf(c.title, p.lang), onChange: function (e) { var v = e.target.value, ti = c.title && typeof c.title === 'object' ? Object.assign({}, c.title) : v; if (typeof ti === 'object') ti[p.lang] = v; put(i, Object.assign({}, c, { title: ti })); } });
        else val = h('span', { className: 'lce-num' }, h('input', { type: 'number', min: 0, className: 'lor-input slim', 'aria-label': t('lct_' + c.type), value: c.n == null ? '' : c.n, onChange: function (e) { put(i, Object.assign({}, c, { n: e.target.value })); } }), h('span', { className: 'lor-sm lor-muted' }, condUnit(c.type, t)));
        return h('li', { key: c.id, className: 'lce-row' },
          h('span', { className: 'lce-ico' }, h(CondIco, { type: c.type }), h('sup', null, i + 1)),
          h('select', { className: 'lor-input slim lce-type', 'aria-label': t('lc_type'), value: c.type, onChange: function (e) { put(i, blank(e.target.value, c.id)); } }, COND_TYPES.map(function (ty) { return h('option', { key: ty, value: ty }, t('lct_' + ty)); })),
          val,
          h('button', { type: 'button', className: 'lce-x', 'aria-label': t('remove'), title: t('remove'), onClick: function () { p.onChange(cs.filter(function (_, k) { return k !== i; })); } }, '×'));
      })) : h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('lc_empty')),
      h('div', { className: 'lce-add' },
        h('select', { className: 'lor-input slim', 'aria-label': t('lc_add'), value: '', onChange: function (e) { if (e.target.value) p.onChange(cs.concat([blank(e.target.value)])); } },
          h('option', { value: '' }, '+ ' + t('lc_add')), COND_TYPES.map(function (ty) { return h('option', { key: ty, value: ty }, t('lct_' + ty)); })),
        h('span', { className: 'lor-sm lor-muted' }, t('lc_add_hint'))));
  }
  function normConds(cs) {
    return (cs || []).map(function (c) { var x = Object.assign({}, c); if (x.type !== 'sec' && x.type !== 'task') x.n = Math.max(0, Math.round(+x.n || 0)); return x; })
      .filter(function (c) { return c.type === 'task' ? !!txtOf(c.title, 'uz').trim() || (typeof c.title === 'object' && Object.keys(c.title).some(function (k) { return String(c.title[k] || '').trim(); })) : c.type === 'sec' ? !!c.sid : true; });
  }

  /* ---------- monthly report: attendance, results and “what if you keep this pace” ---------- */
  var ADAPT_DAYS = 90;
  function workWeek(db) { var w = ((db.settings || {}).report || {}).week; return +w === 5 ? 5 : 6; }
  function isWorkDay(dt, week) { var g = dt.getDay(); return week === 5 ? g >= 1 && g <= 5 : g !== 0; }
  function ymOf(ts) { return dayKey(ts).slice(0, 7); }
  function ymParts(ym) { var a = ym.split('-'); return [+a[0], +a[1] - 1]; }
  function ymStart(ym) { var a = ymParts(ym); return new Date(a[0], a[1], 1).getTime(); }
  function ymShift(ym, k) { var a = ymParts(ym), d = new Date(a[0], a[1] + k, 1); return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
  function ymDays(ym) { var a = ymParts(ym); return new Date(a[0], a[1] + 1, 0).getDate(); }
  function ymEndTs(ym) { return ymStart(ymShift(ym, 1)) - 1; }
  function ymLabel(ym, lang, low) { var a = ymParts(ym); if (lang === 'zh') return a[0] + '年' + (a[1] + 1) + '月'; var n = (MONTHS[lang] || MONTHS.uz)[a[1]] || ''; return (low ? n : n.charAt(0).toUpperCase() + n.slice(1)) + ' ' + a[0]; }
  function fmtH(m, t) { var x = Math.round(m / 6) / 10; return (x % 1 ? x.toFixed(1) : String(x)) + ' ' + t('h'); }
  function heatLvl(m) { return m <= 0 ? 0 : m < 60 ? 1 : m < GOAL ? 2 : 3; }

  function monthStats(db, u, ym) {
    var week = workWeek(db), now = Date.now(), today = dayKey(now), a = ymParts(ym), nd = ymDays(ym);
    var st = (db.study || {})[u.id] || {}, begin = dayKey(u.startedAt || now);
    var days = [], expected = 0, active = 0, activeWork = 0, minutes = 0, goal = 0, streak = 0, best = 0;
    for (var i = 1; i <= nd; i++) {
      var dt = new Date(a[0], a[1], i), k = dayKey(dt.getTime()), m = st[k] || 0, work = isWorkDay(dt, week);
      var before = k < begin, future = k > today, isToday = k === today, live = !before && !future;
      if (live && work && !(isToday && !m)) expected++;
      if (live) {
        minutes += m;
        if (m > 0) { active++; if (work) activeWork++; }
        if (m >= GOAL) { goal++; streak++; if (streak > best) best = streak; } else if (work && !isToday) streak = 0;
      }
      days.push({ k: k, d: i, dow: (dt.getDay() + 6) % 7, m: live ? m : 0, work: work, before: before, future: future, today: isToday });
    }
    var s0 = ymStart(ym), e1 = ymStart(ymShift(ym, 1)), pr = prog(db, u.id), lessons = 0, top = 0, fails = 0, sc = [];
    for (var lid in pr) {
      var x = pr[lid]; if (!x || !x.at || x.at < s0 || x.at >= e1) continue;
      if (x.status === 'passed') { lessons++; if (x.score != null) sc.push(x.score); if (x.score >= 90) top++; }
      else if (x.status === 'failed') fails++;
    }
    var dr = drillsOf(db, u.id).filter(function (x) { return x.at >= s0 && x.at < e1; });
    var ini = (db.initiatives || []).filter(function (x) { return x.uid === u.id && x.at >= s0 && x.at < e1; });
    var xp = lessons * XP_LESSON + top * XP_TOP_SCORE + goal * XP_GOAL_DAY + dr.filter(function (x) { return x.score >= 3.5; }).length * XP_DRILL;
    ini.forEach(function (x) { if (x.status === 'accepted' || x.status === 'done') xp += XP_INI_OK; if (x.status === 'done') xp += XP_INI_DONE; });
    return { ym: ym, days: days, expected: expected, active: active, activeWork: activeWork, weekend: active - activeWork,
      att: expected ? Math.min(100, Math.round(activeWork * 100 / expected)) : null, minutes: minutes, perActive: active ? minutes / active : 0,
      goal: goal, goalPct: expected ? Math.min(100, Math.round(goal * 100 / expected)) : 0, best: best, lessons: lessons, avg: sc.length ? Math.round(sc.reduce(function (s, v) { return s + v; }, 0) / sc.length) : null,
      fails: fails, drills: dr.length, inis: ini.length, xp: xp, live: ymOf(now) === ym, empty: !expected && !active };
  }

  /* pace over the last 4 weeks (or since the start), projected forward from T */
  function forecastOf(db, u, T) {
    var start = u.startedAt || T, W = Math.max(1, Math.min(28, Math.ceil((T - start) / DAY))), from = T - W * DAY;
    var st = (db.study || {})[u.id] || {}, mins = 0, goalD = 0, allMin = 0, endK = dayKey(T);
    for (var i = 0; i < W; i++) { var m = st[dayKey(T - i * DAY)] || 0; mins += m; if (m >= GOAL) goalD++; }
    for (var k in st) if (k <= endK) allMin += st[k];
    var ls = trackFlat(db, u), pr = prog(db, u.id), passed = 0, inWin = 0, xpWin = goalD * XP_GOAL_DAY;
    ls.forEach(function (l) { var x = pr[l.id]; if (x && x.status === 'passed' && (x.at || 0) <= T) { passed++; if (x.at > from) { inWin++; xpWin += XP_LESSON + (x.score >= 90 ? XP_TOP_SCORE : 0); } } });
    drillsOf(db, u.id).forEach(function (x) { if (x.at > from && x.at <= T && x.score >= 3.5) xpWin += XP_DRILL; });
    var total = ls.length, left = Math.max(0, total - passed), lpd = inWin / W, mpd = mins / W;
    var rate = mins > 0 && inWin > 0 ? inWin / mins : allMin > 0 && passed > 0 ? passed / allMin : 0;
    var deadline = start + ADAPT_DAYS * DAY, eta = left === 0 ? 0 : lpd > 0 ? Math.ceil(left / lpd) : null, etaAt = eta != null ? T + eta * DAY : null;
    var v = left === 0 ? 'done' : W < 7 ? 'early' : eta == null ? 'behind' : T > deadline ? (eta <= 30 ? 'risk' : 'behind') : etaAt <= deadline ? 'ok' : etaAt <= deadline + 21 * DAY ? 'risk' : 'behind';
    var sc = [];
    if (left > 0) {
      sc.push({ k: 'now', m: mpd, days: eta, at: etaAt });
      if (rate > 0) [['plus', mpd + 30]].concat(mpd + 35 < GOAL ? [['goal', GOAL]] : []).forEach(function (x) { var d = Math.ceil(left / (rate * x[1])); sc.push({ k: x[0], m: x[1], days: d, at: T + d * DAY }); });
    }
    var nd = ymDays(ymShift(ymOf(T), 1));
    return { T: T, W: W, short: W < 7, mins: mins, mpd: mpd, lpd: lpd, xpd: xpWin / W, goalShare: goalD / W, passed: passed, total: total, left: left, eta: eta, etaAt: etaAt, deadline: deadline, start: start, v: v, scen: sc,
      next: { min: Math.round(mpd * nd), lessons: Math.min(left, Math.round(lpd * nd)), goal: Math.round(goalD / W * nd) } };
  }
  var V_RANK = { done: -1, early: 0, ok: 0, risk: 1, behind: 2 };
  function verdictOf(ms, fc) {
    if (fc.left === 0) return 'done';
    if (fc.short) return 'early';
    var a = ms ? ms.att : null, av = a == null ? 'ok' : a >= 80 ? 'ok' : a >= 60 ? 'risk' : 'behind';
    return V_RANK[av] > V_RANK[fc.v] ? av : fc.v;
  }
  function verdictNotes(ms, fc, t) {
    var out = [];
    if (fc.left === 0) out.push(t('mv_done_p'));
    else if (fc.short) out.push(t('mr_r_short'));
    else if (fc.eta == null) out.push(t('mr_r_stall'));
    else out.push(tpl(t(fc.etaAt <= fc.deadline ? 'mr_r_eta_ok' : fc.T > fc.deadline ? 'mr_r_eta_past' : 'mr_r_eta_late'), { d: fmtDate(fc.etaAt), dl: fmtDate(fc.deadline) }));
    if (ms.att != null && ms.att < 80) out.push(tpl(t('mr_r_att'), { a: ms.att }));
    return out;
  }
  /* when the next level could come at this pace: only the measurable conditions get a date */
  function levelEta(db, u, fc) {
    var r = rankOf(db, u); if (!r.next) return null;
    var days = 0, blocked = [];
    r.reqs.forEach(function (q) {
      if (q.ok) return;
      var need = q.max - q.cur, d = null;
      if (q.key === 'xp') d = fc.xpd > 0 ? need / fc.xpd : null;
      else if (q.key === 'tenure') d = need;
      else if (q.key === 'days') d = fc.goalShare > 0 ? need / fc.goalShare : null;
      else if (q.key === 'sec') d = fc.lpd > 0 ? need / fc.lpd : null;
      else if (q.key === 'course') d = fc.lpd > 0 && fc.total ? need / 100 * fc.total / fc.lpd : null;
      if (d == null) { blocked.push(q); return; }
      days = Math.max(days, Math.ceil(d));
    });
    return { r: r, days: days, at: Date.now() + days * DAY, blocked: blocked };
  }

  /* monthly run: on the first open of a new month the closed month is “issued” to everyone who worked in it */
  function monthlyDue(db, now) { var ym = ymShift(ymOf(now), -1); return (db.monthly || {})[ym] ? null : ym; }
  function issueMonthly(d, ym) {
    var e1 = ymStart(ymShift(ym, 1)), emps = d.users.filter(function (u) { return u.role === 'employee' && (u.startedAt || 0) < e1; }), risk = 0, sent = 0;
    emps.forEach(function (u) {
      var ms = monthStats(d, u, ym); if (ms.empty) return;
      var fc = forecastOf(d, u, e1 - 1), v = verdictOf(ms, fc); if (v === 'risk' || v === 'behind') risk++;
      sent++;
      d.notifications.unshift({ id: nextId(d), userId: u.id, kind: 'month', month: { ym: ym, att: ms.att, min: ms.minutes, v: v }, route: 'report', ym: ym, text: '', at: Date.now(), read: false });
    });
    d.users.filter(function (u) { return u.role === 'admin'; }).forEach(function (a) {
      d.notifications.unshift({ id: nextId(d), userId: a.id, kind: 'month', month: { ym: ym, n: sent, risk: risk, admin: true }, route: 'monitor', tab: 'month', ym: ym, text: '', at: Date.now(), read: false });
    });
    d.monthly = d.monthly || {}; d.monthly[ym] = { at: Date.now(), n: sent, risk: risk };
  }
  function monthNotif(n, lang, t) {
    var m = n.month || {}, ml = ymLabel(m.ym || ymOf(n.at), lang, true);
    var x = m.admin ? tpl(t('n_month_adm'), { m: ml, n: m.n || 0, r: m.risk || 0 }) : tpl(t('n_month'), { m: ml, a: m.att == null ? '—' : m.att, h: fmtH(m.min || 0, t) });
    return x.charAt(0).toUpperCase() + x.slice(1);
  }

  function VerdictChip(p) { return h('span', { className: cx('mv-chip', 'mv-' + p.v) }, p.t('mv_' + p.v)); }
  function Delta(p) {
    if (p.cur == null || p.prev == null) return null;
    var d = Math.round((p.cur - p.prev) * 10) / 10; if (!d) return h('span', { className: 'mr-d' }, '= ' + p.t('mr_same'));
    return h('span', { className: cx('mr-d', (p.lowGood ? d < 0 : d > 0) ? 'is-up' : 'is-down') }, (d > 0 ? '▲ +' : '▼ −') + Math.abs(d) + (p.unit || ''));
  }
  function MonthSwitch(p) {
    var t = p.t, ym = p.ym;
    return h('div', { className: 'mr-switch' },
      h('button', { type: 'button', className: 'mr-arrow', disabled: ym <= p.min, 'aria-label': t('mr_prev'), onClick: function () { p.onChange(ymShift(ym, -1)); } }, h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', 'aria-hidden': true }, h('path', { d: 'M15 5l-7 7 7 7' }))),
      h('b', { className: 'mr-month', 'aria-live': 'polite' }, ymLabel(ym, p.lang)),
      h('button', { type: 'button', className: 'mr-arrow', disabled: ym >= p.max, 'aria-label': t('mr_next'), onClick: function () { p.onChange(ymShift(ym, 1)); } }, h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', 'aria-hidden': true }, h('path', { d: 'M9 5l7 7-7 7' }))),
      ym === ymOf(Date.now()) ? h('span', { className: 'mr-live' }, t('mr_live')) : null);
  }
  function dayTip(d, t) { return pad(d.d) + ' · ' + (d.before ? t('mr_before') : d.future ? '—' : d.m ? fmtMin(d.m, t) : d.work ? t('mr_absent') : t('mr_dayoff')); }
  function MonthCal(p) {
    var t = p.t, ms = p.ms, wd = t('mr_wd').split('|'), lead = ms.days.length ? ms.days[0].dow : 0, cells = [];
    for (var i = 0; i < lead; i++) cells.push(h('span', { key: 'b' + i, className: 'mc-cell is-blank', 'aria-hidden': true }));
    ms.days.forEach(function (d) {
      var tip = dayTip(d, t);
      cells.push(h('span', { key: d.k, className: cx('mc-cell', 'h' + heatLvl(d.m), !d.work && 'is-off', d.before && 'is-before', d.future && 'is-future', d.today && 'is-today'), title: tip, 'aria-label': tip },
        h('b', null, d.d), !d.before && !d.future && d.m ? h('small', null, hm(d.m)) : null));
    });
    return h('div', { className: 'mc' },
      h('div', { className: 'mc-grid' }, wd.map(function (x, i) { return h('span', { key: 'w' + i, className: cx('mc-wd', (i === 6 || (p.week === 5 && i === 5)) && 'is-off'), 'aria-hidden': true }, x); }).concat(cells)),
      h(HeatLegend, { t: t }));
  }
  function HeatLegend(p) {
    var t = p.t;
    return h('div', { className: 'mc-legend' }, [[0, t('mr_l0')], [1, t('mr_l1')], [2, t('mr_l2')], [3, t('mr_l3')]].map(function (x) { return h('span', { key: x[0] }, h('i', { className: 'mc-sw h' + x[0] }), x[1]); }),
      h('span', null, h('i', { className: 'mc-sw is-off' }), t('mr_dayoff')));
  }
  function MiniStrip(p) {
    return h('div', { className: 'mr-strip', 'aria-hidden': true }, p.ms.days.map(function (d) { return h('i', { key: d.k, className: cx('h' + heatLvl(d.m), !d.work && 'is-off', (d.before || d.future) && 'is-void', d.today && 'is-today') }); }));
  }

  /* timeline of the programme: start → today (or month end) → end of adaptation, and where this pace finishes */
  function CourseLine(p) {
    var t = p.t, fc = p.fc, a = fc.start, T = fc.T, fin = fc.left && fc.etaAt ? fc.etaAt : null;
    var end = Math.max(fc.deadline, T, fin || 0); end = end + (end - a) * 0.04;
    function x(ts) { return Math.max(0, Math.min(100, (ts - a) * 100 / (end - a))); }
    var marks = [['now', T, p.live ? t('mr_today') : t('mr_month_end')], ['dl', fc.deadline, t('mr_deadline')]];
    if (fin) marks.push(['eta', fin, t('mr_finish')]);
    return h('div', { className: 'cl' },
      h('div', { className: 'cl-head' }, h('b', null, tpl(t('mr_course_n'), { k: fc.passed, n: fc.total })), h('span', { className: 'lor-sm lor-muted' }, fc.left ? tpl(t('mr_left_n'), { n: fc.left }) : '✓ ' + t('mv_done'))),
      h('div', { className: 'cl-track', role: 'img', 'aria-label': marks.map(function (m) { return m[2] + ' ' + fmtDate(m[1]); }).join(', ') },
        h('i', { className: 'cl-past', style: { width: x(T) + '%' } }),
        fin ? h('i', { className: cx('cl-proj', 'mv-' + p.v), style: { left: x(T) + '%', width: Math.max(0, x(fin) - x(T)) + '%' } }) : null,
        marks.map(function (m) { return h('span', { key: m[0], className: cx('cl-mark', 'is-' + m[0], m[0] === 'eta' && 'mv-' + p.v), style: { left: x(m[1]) + '%' } }); })),
      h('ul', { className: 'cl-legend' },
        h('li', null, h('i', { className: 'cl-sw is-start' }), t('mr_start') + ' ', h('b', null, fmtDate(a))),
        marks.map(function (m) { return h('li', { key: m[0] }, h('i', { className: cx('cl-sw', 'is-' + m[0], m[0] === 'eta' && 'mv-' + p.v) }), m[2] + ' ', h('b', null, fmtDate(m[1]))); })));
  }

  function MonthBody(p) {
    var t = p.t, db = p.db, u = p.u, ym = p.ym, lang = p.lang, ms = monthStats(db, u, ym), pv = monthStats(db, u, ymShift(ym, -1));
    if (ms.empty) return h('section', { className: 'box' }, h('p', { className: 'lor-muted', style: { margin: 0 } }, t('mr_empty')));
    var T = Math.min(Date.now(), ymEndTs(ym)), fc = forecastOf(db, u, T), v = verdictOf(ms, fc), le = levelEta(db, u, fc), hasPrev = !pv.empty;
    var tiles = [
      { k: 'att', ico: 'days', label: t('mr_att'), big: ms.att == null ? '—' : ms.att + '%', sub: tpl(t('mr_att_sub'), { k: ms.activeWork, n: ms.expected }) + (ms.weekend ? ' · ' + tpl(t('mr_weekend'), { n: ms.weekend }) : ''), d: hasPrev ? h(Delta, { t: t, cur: ms.att, prev: pv.att, unit: '%' }) : null },
      { k: 'time', ico: 'tenure', label: t('mr_time'), big: fmtH(ms.minutes, t), sub: ms.active ? tpl(t('mr_per_day'), { x: fmtMin(ms.perActive, t) }) : '—', d: hasPrev ? h(Delta, { t: t, cur: Math.round(ms.minutes / 6) / 10, prev: Math.round(pv.minutes / 6) / 10, unit: ' ' + t('h') }) : null },
      { k: 'goal', ico: 'avg', label: t('mr_goal'), big: String(ms.goal), sub: tpl(t('mr_goal_sub'), { p: ms.goalPct, s: ms.best }), d: hasPrev ? h(Delta, { t: t, cur: ms.goal, prev: pv.goal }) : null },
      { k: 'les', ico: 'sec', label: t('mr_lessons'), big: String(ms.lessons), sub: (ms.avg != null ? t('r_avg') + ' ' + ms.avg + '%' : t('mr_no_tests')) + (ms.fails ? ' · ' + tpl(t('mr_fails'), { n: ms.fails }) : ''), d: hasPrev ? h(Delta, { t: t, cur: ms.lessons, prev: pv.lessons }) : null },
      { k: 'xp', ico: 'xp', label: t('mr_xp'), big: '+' + ms.xp, sub: tpl(t('mr_xp_sub'), { d: ms.drills, i: ms.inis }), d: hasPrev ? h(Delta, { t: t, cur: ms.xp, prev: pv.xp }) : null }];
    return h('div', { className: 'mr-body' },
      h('section', { className: cx('box mr-verdict', 'mv-' + v) },
        h('span', { className: 'mr-v-ico', 'aria-hidden': true }, v === 'ok' || v === 'done' ? '✓' : v === 'early' ? '…' : '!'),
        h('div', { className: 'mr-v-main' },
          h('span', { className: 'lor-eyebrow' }, ms.live ? tpl(t('mr_asof'), { d: fmtDate(Date.now()) }) : tpl(t('mr_closed'), { d: fmtDate(ymEndTs(ym)) })),
          h('h2', { className: 'lor-h' }, t('mv_' + v + '_t')),
          verdictNotes(ms, fc, t).map(function (x, i) { return h('p', { key: i, className: 'lor-sm' }, x); })),
        h(VerdictChip, { t: t, v: v })),
      h('div', { className: 'mr-tiles' }, tiles.map(function (x) {
        return h('div', { key: x.k, className: 'tile mr-tile' },
          h('span', { className: 'lor-eyebrow' }, h(CondIco, { type: x.ico, size: 14 }), ' ', x.label),
          h('b', null, x.big), h('span', { className: 'lor-sm lor-muted' }, x.sub), x.d);
      })),
      h('section', { className: 'box mr-cal' },
        h('div', { className: 'chart-head' }, h('div', null, h('h2', { className: 'lor-h' }, t('mr_cal')), h('p', { className: 'lor-sm lor-muted', style: { margin: '4px 0 0' } }, tpl(t('mr_cal_s'), { w: workWeek(db) === 5 ? t('mr_w5') : t('mr_w6') })))),
        h(MonthCal, { t: t, ms: ms, week: workWeek(db) })),
      h(AttSection, { t: t, db: db, u: u, ym: ym, lang: lang, onEdit: p.onAttEdit }),
      h('section', { className: 'box mr-fc' },
        h('div', { className: 'chart-head' }, h('div', null, h('span', { className: 'lor-eyebrow' }, t('mr_fc_e')), h('h2', { className: 'lor-h' }, t('mr_fc_t')),
          h('p', { className: 'lor-sm lor-muted', style: { margin: '4px 0 0' } }, tpl(t('mr_fc_s'), { w: fc.W, m: fmtMin(fc.mpd, t), l: (Math.round(fc.lpd * 70) / 10).toString() })))),
        h(CourseLine, { t: t, fc: fc, v: v, live: ms.live }),
        fc.scen.length ? h('div', { className: 'mr-scen' },
          h('span', { className: 'lor-eyebrow' }, t('mr_scen_t')),
          h('ul', null, fc.scen.map(function (s) {
            var good = s.at != null && s.at <= Math.max(fc.deadline, fc.T + 30 * DAY);
            return h('li', { key: s.k, className: cx(s.k === 'now' && 'is-now', s.at == null ? 'is-never' : good ? 'is-ok' : 'is-late') },
              h('span', { className: 'mr-sc-k' }, t('mr_sc_' + s.k)),
              h('span', { className: 'mr-sc-m' }, tpl(t('mr_sc_pace'), { m: fmtMin(s.m, t) })),
              h('b', { className: 'mr-sc-d' }, s.at ? fmtDate(s.at) : t('mr_never')),
              h('span', { className: 'mr-sc-n lor-sm lor-muted' }, s.days != null ? tpl(t('mr_in_days'), { n: s.days }) : ''));
          }))) : null,
        h('div', { className: 'mr-next' },
          h('span', { className: 'lor-eyebrow' }, tpl(t('mr_next_t'), { m: ymLabel(ymShift(ymOf(T), 1), lang, true) })),
          h('div', { className: 'mr-next-grid' }, [[fmtH(fc.next.min, t), t('mr_n_hours')], [String(fc.next.lessons), t('mr_n_lessons')], [String(fc.next.goal), t('mr_n_goal')]].map(function (x) { return h('div', { key: x[1] }, h('b', null, x[0]), h('span', null, x[1])); }))),
        le ? h('div', { className: 'mr-lvl' },
          h('span', { className: 'lor-eyebrow' }, tpl(t('mr_lvl_t'), { x: lvlName(le.r.next, lang) })),
          h(LevelRuler, Object.assign({}, p, { u: u, rank: le.r, list: false, compact: true, tag: 'mr' + ym })),
          h('p', { className: 'lor-sm', style: { margin: 0 } }, le.r.eligible ? t('lr_ready') : le.days > 0 && !le.blocked.length ? tpl(t('mr_lvl_eta'), { n: le.days, d: fmtDate(le.at) }) : le.days > 0 ? tpl(t('mr_lvl_eta_part'), { n: le.days, d: fmtDate(le.at) }) : t('mr_lvl_measured')),
          le.blocked.length ? h('ul', { className: 'mr-blocked' }, le.blocked.map(function (q) { return h('li', { key: q.id }, h(CondIco, { type: q.key, size: 14 }), h('span', null, condText(q, t, lang)), h('small', null, condValue(q, t))); })) : null) : null));
  }

  function reportData(db, u, ym) {
    var ms = monthStats(db, u, ym), at = Math.min(Date.now(), ymEndTs(ym)), fc = forecastOf(db, u, at), le = levelEta(db, u, fc);
    return { name: u.name, position: u.position, status: u.status, month: ym, workWeekDays: workWeek(db), attendancePct: ms.att, activeWorkDays: ms.activeWork, expectedWorkDays: ms.expected, weekendDays: ms.weekend,
      studyHours: Math.round(ms.minutes / 6) / 10, goalDays2h: ms.goal, bestGoalStreak: ms.best, lessonsPassed: ms.lessons, avgTestScore: ms.avg, failedTests: ms.fails, xpEarned: ms.xp,
      verdict: verdictOf(ms, fc), pace: { windowDays: fc.W, minutesPerDay: Math.round(fc.mpd), lessonsPerWeek: Math.round(fc.lpd * 70) / 10 }, course: { passed: fc.passed, total: fc.total, finishDateAtThisPace: fc.etaAt ? fmtDate(fc.etaAt) : null, adaptationEnds: fmtDate(fc.deadline) },
      scenarios: fc.scen.map(function (s) { return { pace: s.k, minutesPerDay: Math.round(s.m), finish: s.at ? fmtDate(s.at) : null }; }),
      workAttendance: (function () { var c = attMonth(db, u, ym); return c.has ? { schedule: schedOf(db, u).start + '-' + schedOf(db, u).end, daysAtWork: c.present, onTimePct: c.onTimePct, lateDays: c.late, lateMinutesTotal: c.lateMin, absentDays: c.absent, excusedDays: c.excused, avgArrival: m2hm(c.avgIn), avgDeparture: m2hm(c.avgOut) } : null; })(),
      nextLevel: le ? { name: lvlName(le.r.next, 'en'), progressPct: le.r.pct, daysAtThisPace: le.days || null, needsAction: le.blocked.map(function (q) { return condText(q, T('uz'), 'uz'); }) } : null };
  }

  /* employee page */
  function MonthReport(p) {
    var t = p.t, db = p.db, u = p.user, sampler = p.sampler, cur = ymOf(Date.now()), min = ymOf(u.startedAt || Date.now());
    var fresh = db.notifications.filter(function (n) { return n.userId === u.id && n.kind === 'month' && !n.read; })[0];
    var s = useState(function () { var y = p.ym || (fresh && fresh.ym) || (new Date().getDate() <= 7 ? ymShift(cur, -1) : cur); return y < min ? min : y > cur ? cur : y; }), ym = s[0];
    var an = useState(''), busy = useState(false), err = useState('');
    useEffect(function () { an[1](''); err[1](''); }, [ym]);
    useEffect(function () {
      if (db.notifications.some(function (n) { return n.userId === u.id && n.kind === 'month' && n.ym === ym && !n.read; }))
        p.update(function (d) { d.notifications.forEach(function (n) { if (n.userId === u.id && n.kind === 'month' && n.ym === ym) n.read = true; }); });
    }, [ym]);
    function analyse() {
      if (!sampler || busy[0]) return;
      var prompt = 'Siz BURAQ Logistics kompaniyasining o‘quv platformasidagi murabbiysiz. Xodimning oylik hisobotini tahlil qiling va unga shaxsan murojaat qilib yozing (siz deb). Javob tili: ' + (LANG_NAME[p.lang] || LANG_NAME.uz) + '.\n' +
        'Tuzilma (markdown sarlavhalar bilan, jami 170 so‘zdan oshmasin):\n## Oy natijasi\n## Shu tempda nima bo‘ladi\n## Keyingi oy uchun 3 qadam\nKunlik maqsad — 2 soat. Faqat berilgan raqamlarga tayaning, o‘ylab topmang; sanalarni o‘zgartirmang.\n\nMA’LUMOTLAR (JSON):\n' + JSON.stringify(reportData(db, u, ym));
      an[1](''); err[1](''); busy[1](true);
      sampler(prompt, { onText: function (x) { an[1](x.text); } }).then(function (r) { an[1](r.text); }).catch(function (e) { if (e && e.text) an[1](e.text); err[1](aiErr(e, t)); }).then(function () { busy[1](false); });
    }
    return h('div', { className: 'app-wrap mr-page' },
      h('div', { className: 'page-head' },
        h('div', null, h('span', { className: 'lor-eyebrow' }, t('mr_eyebrow')), h('h1', { className: 'lor-title' }, t('mr_title'), h(PageTip, { t: t, id: 'report' }))),
        h('div', { className: 'mr-tools' }, h(MonthSwitch, { t: t, lang: p.lang, ym: ym, min: min, max: cur, onChange: s[1] }),
          h(Btn, { variant: 'ghost', size: 'sm', className: 'no-print', onClick: function () { window.print(); } }, t('mr_print')))),
      h(MonthBody, Object.assign({}, p, { u: u, ym: ym })),
      h('section', { className: 'box ai-box no-print' },
        h('div', { className: 'chart-head' }, h('div', null, h('h2', { className: 'lor-h' }, t('mr_ai_t')), h('p', { className: 'lor-sm lor-muted', style: { margin: '4px 0 0' } }, t('mr_ai_s'))),
          h(Btn, { variant: 'secondary', size: 'sm', disabled: !sampler || busy[0], onClick: analyse }, busy[0] ? t('ai_thinking') : t('mr_ai_btn'))),
        sampler === null ? h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('ai_unavail')) : null,
        busy[0] && !an[0] ? h('p', { className: 'ai-thinking' }, t('ai_thinking')) : null,
        an[0] ? h('div', { className: 'ai-md', dangerouslySetInnerHTML: { __html: mdLite(an[0]) } }) : null,
        err[0] ? h('p', { className: 'lor-field-error' }, err[0]) : null),
      h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('mr_note')));
  }

  /* home: the closed month while its report is fresh, otherwise the month so far */
  function MonthTeaser(p) {
    var t = p.t, db = p.db, u = p.user, cur = ymOf(Date.now());
    var fresh = db.notifications.filter(function (n) { return n.userId === u.id && n.kind === 'month' && !n.read && n.ym; })[0];
    var ym = fresh ? fresh.ym : cur, ms = monthStats(db, u, ym);
    if (ms.empty) return null;
    var fc = forecastOf(db, u, Math.min(Date.now(), ymEndTs(ym))), v = verdictOf(ms, fc);
    return h('section', { className: cx('box mr-teaser', fresh && 'is-fresh') },
      h('div', { className: 'mr-t-main' },
        h('div', { className: 'mr-t-head' }, h('span', { className: 'lor-eyebrow' }, fresh ? t('mr_t_ready') : t('mr_t_live')), h(VerdictChip, { t: t, v: v })),
        h('b', { className: 'mr-t-month' }, ymLabel(ym, p.lang)),
        h('div', { className: 'mr-t-stats' }, [[ms.att == null ? '—' : ms.att + '%', t('mr_att')], [fmtH(ms.minutes, t), t('mr_time')], [String(ms.lessons), t('mr_lessons')]].map(function (x) { return h('div', { key: x[1] }, h('b', null, x[0]), h('span', null, x[1])); }))),
      h('div', { className: 'mr-t-side' },
        h(MiniStrip, { ms: ms }),
        h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, fc.left ? (fc.etaAt ? tpl(t('mr_t_eta'), { d: fmtDate(fc.etaAt) }) : t('mr_r_stall')) : t('mv_done_p')),
        h('div', null, h(Btn, { variant: fresh ? 'primary' : 'outline', size: 'sm', arrow: true, onClick: function () { p.go({ name: 'report', ym: ym }); } }, fresh ? t('mr_open_fresh') : t('mr_open')))));
  }

  /* SOP manager: Monitoring → Monthly report */
  function MonthAdmin(p) {
    var t = p.t, db = p.db, lang = p.lang, sampler = p.sampler, cur = ymOf(Date.now());
    var emps = db.users.filter(function (u) { return u.role === 'employee'; });
    var minYm = emps.reduce(function (m, u) { var y = ymOf(u.startedAt || Date.now()); return y < m ? y : m; }, cur);
    var s = useState(function () { var y = p.ym || ymShift(cur, -1); return y < minYm ? minYm : y > cur ? cur : y; }), ym = s[0];
    var ex = useState(null), an = useState(''), busy = useState(false), err = useState('');
    useEffect(function () { an[1](''); err[1](''); ex[1](null); }, [ym]);
    var e1 = ymStart(ymShift(ym, 1)), T = Math.min(Date.now(), ymEndTs(ym)), week = workWeek(db);
    var rows = emps.filter(function (u) { return (u.startedAt || 0) < e1; }).map(function (u) {
      var ms = monthStats(db, u, ym), pv = monthStats(db, u, ymShift(ym, -1)), fc = forecastOf(db, u, T);
      return { u: u, ms: ms, pv: pv, fc: fc, v: verdictOf(ms, fc), rk: rankOf(db, u), at: attMonth(db, u, ym) };
    }).filter(function (r) { return !r.ms.empty; });
    function agg(list, k) { var xs = list.map(k).filter(function (x) { return x != null; }); return xs.length ? xs.reduce(function (a, b) { return a + b; }, 0) : null; }
    function team(key) { var lst = rows.map(function (r) { return r[key]; }).filter(function (m) { return !m.empty; }); var n = lst.filter(function (m) { return m.att != null; }).length;
      return { att: n ? Math.round(agg(lst, function (m) { return m.att; }) / n) : null, min: agg(lst, function (m) { return m.minutes; }) || 0, les: agg(lst, function (m) { return m.lessons; }) || 0, goal: agg(lst, function (m) { return m.goal; }) || 0, exp: agg(lst, function (m) { return m.expected; }) || 0, n: lst.length }; }
    var tm = team('ms'), tp = team('pv');
    var risk = rows.filter(function (r) { return r.v === 'risk' || r.v === 'behind' || r.at.flag; }).sort(function (a, b) { return V_RANK[b.v] - V_RANK[a.v] || (b.at.late - a.at.late) || (a.ms.att || 0) - (b.ms.att || 0); });
    var atRows = rows.filter(function (r) { return r.at.has; }), atPres = atRows.reduce(function (s, r) { return s + r.at.present; }, 0), atOn = atRows.reduce(function (s, r) { return s + r.at.onTime; }, 0), atLate = atRows.reduce(function (s, r) { return s + r.at.late; }, 0);
    var gen = (db.monthly || {})[ym], wd = t('mr_wd').split('|');
    function teamAI() {
      if (!sampler || busy[0]) return;
      var data = { month: ym, team: { employees: rows.length, avgAttendancePct: tm.att, studyHours: Math.round(tm.min / 6) / 10, lessonsPassed: tm.les, goalDays2h: tm.goal, expectedWorkDays: tm.exp }, previousMonth: tp.n ? { avgAttendancePct: tp.att, studyHours: Math.round(tp.min / 6) / 10, lessonsPassed: tp.les } : null, people: rows.map(function (r) { return reportData(db, r.u, ym); }) };
      var prompt = 'Siz BURAQ Logistics kompaniyasining SOP menejeriga yordam beruvchi tahlilchisiz. Quyida jamoaning oylik hisoboti (davomat, o‘qish vaqti, natijalar va shu tempdagi prognoz). SOP menejeri uchun qisqa xulosa yozing. Javob tili: ' + (LANG_NAME[lang] || LANG_NAME.uz) + '.\n' +
        'Tuzilma (markdown sarlavhalar, jami 220 so‘zdan oshmasin):\n## Jamoa bo‘yicha xulosa\n## Kimga e’tibor kerak (ism bilan, sababi bilan)\n## SOP menejeri uchun 3–4 aniq qadam\nFaqat berilgan raqamlarga tayaning, o‘ylab topmang.\n\nMA’LUMOTLAR (JSON):\n' + JSON.stringify(data);
      an[1](''); err[1](''); busy[1](true);
      sampler(prompt, { onText: function (x) { an[1](x.text); } }).then(function (r) { an[1](r.text); }).catch(function (e) { if (e && e.text) an[1](e.text); err[1](aiErr(e, t)); }).then(function () { busy[1](false); });
    }
    var days = rows.length ? rows[0].ms.days : [], pick = rows.filter(function (r) { return r.u.id === ex[0]; })[0];
    function openP(id) { ex[1](id); setTimeout(function () { var el = document.getElementById('mr-person'); if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 40); }
    return h('div', { className: 'mr-admin' },
      h('div', { className: 'mr-bar' },
        h(MonthSwitch, { t: t, lang: lang, ym: ym, min: minYm, max: cur, onChange: s[1] }),
        h('label', { className: 'mr-week' }, h('span', { className: 'lor-sm lor-muted' }, t('mr_week')),
          h('select', { className: 'lor-input slim', value: week, onChange: function (e) { var v = +e.target.value; p.update(function (d) { d.settings = d.settings || {}; d.settings.report = Object.assign({}, d.settings.report, { week: v }); }); } },
            h('option', { value: 6 }, t('mr_w6')), h('option', { value: 5 }, t('mr_w5')))),
        h(Btn, { variant: 'ghost', size: 'sm', className: 'no-print', onClick: function () { window.print(); } }, t('mr_print'))),
      h('p', { className: 'lor-sm lor-muted mr-gen' }, ym === cur ? tpl(t('mr_adm_live'), { d: fmtDate(ymEndTs(ym) + 1) }) : gen ? tpl(t('mr_adm_sent'), { d: fmtDate(gen.at), n: gen.n }) : t('mr_adm_old')),
      !rows.length ? h('section', { className: 'box' }, h('p', { className: 'lor-muted', style: { margin: 0 } }, t('mr_adm_empty'))) : h(F, null,
        h('div', { className: 'mr-tiles' }, [
          [t('mr_att'), tm.att == null ? '—' : tm.att + '%', t('mr_adm_att_sub'), tp.n ? h(Delta, { t: t, cur: tm.att, prev: tp.att, unit: '%' }) : null],
          [t('mr_time'), fmtH(tm.min, t), tpl(t('mr_adm_time_sub'), { x: fmtH(tm.min / Math.max(1, tm.n), t) }), tp.n ? h(Delta, { t: t, cur: Math.round(tm.min / 6) / 10, prev: Math.round(tp.min / 6) / 10, unit: ' ' + t('h') }) : null],
          [t('mr_goal'), tm.exp ? Math.round(tm.goal * 100 / tm.exp) + '%' : '—', tpl(t('mr_adm_goal_sub'), { n: tm.goal }), null],
          [t('mr_lessons'), String(tm.les), tpl(t('mr_adm_les_sub'), { n: rows.length }), tp.n ? h(Delta, { t: t, cur: tm.les, prev: tp.les }) : null],
          atRows.length ? [t('at_ontime_work'), atPres ? Math.round(atOn * 100 / atPres) + '%' : '—', tpl(t('at_adm_late_sub'), { n: atLate }), null] : null,
          [t('mr_adm_risk'), String(risk.length), t('mr_adm_risk_sub'), null]].filter(Boolean).map(function (x) {
          return h('div', { key: x[0], className: cx('tile mr-tile', x[0] === t('mr_adm_risk') && risk.length && 'is-alert') }, h('span', { className: 'lor-eyebrow' }, x[0]), h('b', null, x[1]), h('span', { className: 'lor-sm lor-muted' }, x[2]), x[3]);
        })),
        risk.length ? h('section', { className: 'box mr-risk' },
          h('span', { className: 'lor-eyebrow' }, t('mr_adm_risk_t')),
          h('ul', null, risk.map(function (r) {
            return h('li', { key: r.u.id },
              h('button', { type: 'button', className: 'mr-risk-p', onClick: function () { openP(r.u.id); } },
                h(Av, { name: r.u.name, src: r.u.avatar, size: 30 }),
                h('span', null, h('b', null, r.u.name), h('small', null, (r.v === 'risk' || r.v === 'behind' ? verdictNotes(r.ms, r.fc, t) : []).concat(r.at.flag ? [attNote(r.at, t)] : []).join(' '))),
                r.v === 'risk' || r.v === 'behind' ? h(VerdictChip, { t: t, v: r.v }) : h('span', { className: 'at-chip a-late' }, t('at_disc'))));
          }))) : null,
        h('section', { className: 'box mr-mx' },
          h('div', { className: 'chart-head' }, h('div', null, h('h2', { className: 'lor-h' }, t('mr_mx_t')), h('p', { className: 'lor-sm lor-muted', style: { margin: '4px 0 0' } }, tpl(t('mr_cal_s'), { w: week === 5 ? t('mr_w5') : t('mr_w6') })))),
          h('div', { className: 'mx-wrap', tabIndex: 0, role: 'region', 'aria-label': t('mr_mx_t') }, h('table', { className: 'mx' },
            h('thead', null, h('tr', null, h('th', { className: 'mx-name', scope: 'col' }, t('th_emp')),
              days.map(function (d) { return h('th', { key: d.k, scope: 'col', className: cx(!d.work && 'is-off', d.today && 'is-today') }, h('span', null, d.d), h('small', null, wd[d.dow])); }),
              h('th', { className: 'mx-sum', scope: 'col' }, '%'), h('th', { className: 'mx-sum', scope: 'col' }, t('h')))),
            h('tbody', null, rows.map(function (r) {
              return h('tr', { key: r.u.id },
                h('th', { className: 'mx-name', scope: 'row' }, h('span', null, r.u.name)),
                r.ms.days.map(function (d) { return h('td', { key: d.k, className: cx('mx-c', 'h' + heatLvl(d.m), !d.work && 'is-off', (d.before || d.future) && 'is-void', d.today && 'is-today'), title: r.u.name + ' · ' + dayTip(d, t) }); }),
                h('td', { className: cx('mx-sum num', r.ms.att != null && r.ms.att < 80 && 'warn-txt') }, r.ms.att == null ? '—' : r.ms.att + '%'),
                h('td', { className: 'mx-sum num' }, Math.round(r.ms.minutes / 6) / 10));
            })))),
          h(HeatLegend, { t: t })),
        h('section', { className: 'box mr-people' },
          h('h2', { className: 'lor-h' }, t('mr_people_t')),
          h('div', { className: 'lor-table-wrap' }, h('table', { className: 'lor-table mr-table' },
            h('thead', null, h('tr', null, [t('th_emp'), t('mr_att'), t('mr_time'), t('mr_goal'), t('mr_lessons'), 'XP', t('mr_fc_col'), t('mr_lvl_col')].map(function (x, i) { return h('th', { key: i }, x); }))),
            h('tbody', null, rows.map(function (r) {
              var open = ex[0] === r.u.id;
              return h(F, { key: r.u.id },
                h('tr', { id: 'mr-row-' + r.u.id, className: cx('row-click', open && 'is-open'), 'aria-expanded': open, tabIndex: 0, onClick: function () { if (open) ex[1](null); else openP(r.u.id); }, onKeyDown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (open) ex[1](null); else openP(r.u.id); } } },
                  h('td', null, h('div', { className: 'lor-emp' }, h(Av, { name: r.u.name, src: r.u.avatar, size: 32 }), h('span', null, r.u.name, h('small', null, r.u.position)))),
                  h('td', { className: 'num' }, h('b', { className: r.ms.att != null && r.ms.att < 80 ? 'warn-txt' : '' }, r.ms.att == null ? '—' : r.ms.att + '%'), h('div', { className: 'lor-sm lor-muted' }, r.ms.activeWork + '/' + r.ms.expected), r.pv.empty ? null : h(Delta, { t: t, cur: r.ms.att, prev: r.pv.att, unit: '%' })),
                  h('td', { className: 'num' }, fmtH(r.ms.minutes, t), h('div', { className: 'lor-sm lor-muted' }, r.ms.active ? fmtMin(r.ms.perActive, t) + ' / ' + t('mr_day') : '—')),
                  h('td', { className: 'num' }, r.ms.goal, h('div', { className: 'lor-sm lor-muted' }, r.ms.goalPct + '%')),
                  h('td', { className: 'num' }, r.ms.lessons, h('div', { className: 'lor-sm lor-muted' }, r.ms.avg == null ? '—' : t('r_avg') + ' ' + r.ms.avg + '%')),
                  h('td', { className: 'num' }, '+' + r.ms.xp),
                  h('td', null, h(VerdictChip, { t: t, v: r.v }), h('div', { className: 'lor-sm lor-muted', style: { marginTop: 4 } }, r.fc.left ? (r.fc.etaAt ? '→ ' + fmtDate(r.fc.etaAt) : r.v === 'early' ? '' : t('mr_never')) : '✓')),
                  h('td', { style: { minWidth: 120 } }, r.rk.next ? h('div', { className: 'mr-lvl-mini' }, h('span', null, lvlShort(r.rk.level, lang) + ' → ' + lvlShort(r.rk.next, lang)), h('i', null, h('b', { style: { width: r.rk.pct + '%' } })), h('small', null, r.rk.pct + '%')) : h('span', { className: 'lor-sm lor-muted' }, t('top_level')))),
                null);
            }))))),
        pick ? h('section', { className: 'mr-person', id: 'mr-person' },
          h('div', { className: 'mr-person-h' }, h(Av, { name: pick.u.name, src: pick.u.avatar, size: 40 }), h('div', null, h('span', { className: 'lor-eyebrow' }, t('mr_eyebrow') + ' · ' + ymLabel(ym, lang)), h('h2', { className: 'lor-h' }, pick.u.name), h('span', { className: 'lor-sm lor-muted' }, pick.u.position + ' · ' + pick.u.department)),
            h('button', { type: 'button', className: 'lor-modal-x mr-person-x no-print', 'aria-label': t('close'), onClick: function () { ex[1](null); } }, '×')),
          h(MonthBody, Object.assign({}, p, { u: pick.u, ym: ym, admin: true }))) : null,
        h('section', { className: 'box ai-box no-print' },
          h('div', { className: 'chart-head' }, h('div', null, h('h2', { className: 'lor-h' }, t('mr_adm_ai_t')), h('p', { className: 'lor-sm lor-muted', style: { margin: '4px 0 0' } }, t('mr_adm_ai_s'))),
            h(Btn, { variant: 'secondary', size: 'sm', disabled: !sampler || busy[0], onClick: teamAI }, busy[0] ? t('ai_thinking') : t('mr_ai_btn'))),
          sampler === null ? h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('ai_unavail')) : null,
          busy[0] && !an[0] ? h('p', { className: 'ai-thinking' }, t('ai_thinking')) : null,
          an[0] ? h('div', { className: 'ai-md', dangerouslySetInnerHTML: { __html: mdLite(an[0]) } }) : null,
          err[0] ? h('p', { className: 'lor-field-error' }, err[0]) : null)));
  }

  /* ======================= FEATURES 12: work attendance from the turnstile — arrival, lateness, departure ======================= */

  var ATT_REASONS = ['sick', 'vac', 'trip', 'other'];
  function hm2m(s) { var m = /^(\d{1,2}):(\d{2})/.exec(String(s || '')); return m ? +m[1] * 60 + +m[2] : null; }
  function m2hm(m) { if (m == null || isNaN(m)) return '—'; m = Math.round(m); return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
  function keyDate(k) { var a = k.split('-'); return new Date(+a[0], +a[1] - 1, +a[2]); }
  function fmtK(k) { var a = k.split('-'); return a[2] + '.' + a[1] + '.' + a[0]; }
  function fmtKs(k) { var a = k.split('-'); return a[2] + '.' + a[1]; }
  function shiftK(k, n) { var d = keyDate(k); d.setDate(d.getDate() + n); return dayKey(d.getTime()); }
  function schedOf(db, u) { var s = (db.settings || {}).schedule || {}; return Object.assign({ start: '09:00', end: '18:00', grace: 10 }, s.def || {}, ((s.dept || {})[u.department]) || {}); }
  function attRec(db, uid, k) { return ((db.attend || {})[uid] || {})[k] || null; }
  function attCovered(db, u, k) { return (((db.attendCover || {})[u.department]) || []).some(function (r) { return k >= r[0] && k <= r[1]; }); }
  function attHas(db, u) { return !!(((db.attendCover || {})[u.department]) || []).length || !!Object.keys((db.attend || {})[u.id] || {}).length; }

  /* one day for one person: ok · late · absent · excused · off · extra (came on a day off) · nodata · pending · before · future · noin */
  function attDay(db, u, k, week) {
    var rec = attRec(db, u.id, k), work = isWorkDay(keyDate(k), week || workWeek(db)), sc = schedOf(db, u), today = dayKey(Date.now());
    var o = { k: k, rec: rec, work: work, sc: sc, late: 0, early: 0, worked: null, in: null, out: null };
    if (k < dayKey(u.startedAt || 0)) { o.st = 'before'; return o; }
    if (k > today) { o.st = 'future'; return o; }
    if (rec) { o.in = hm2m(rec.in); o.out = hm2m(rec.out); if (o.in != null && o.out != null && o.out > o.in) o.worked = o.out - o.in; }
    if (rec && rec.reason) { o.st = 'excused'; o.reason = rec.reason; return o; }
    if (rec && (o.in != null || o.out != null)) {
      var s = hm2m(sc.start), e = hm2m(sc.end), g = +sc.grace || 0;
      if (!work) { o.st = 'extra'; return o; }
      if (o.in == null) { o.st = 'noin'; return o; }
      o.late = o.in > s + g ? o.in - s : 0;
      o.early = o.out != null && o.out < e - g ? e - o.out : 0;
      o.st = o.late ? 'late' : 'ok'; return o;
    }
    if (!work) { o.st = 'off'; return o; }
    if (!attCovered(db, u, k)) { o.st = 'nodata'; return o; }
    if (k === today) { var d = new Date(); if (d.getHours() * 60 + d.getMinutes() <= hm2m(sc.start) + (+sc.grace || 0)) { o.st = 'pending'; return o; } }
    o.st = 'absent'; return o;
  }
  function attMonth(db, u, ym) {
    var week = workWeek(db), a = ymParts(ym), nd = ymDays(ym), days = [];
    var c = { ym: ym, exp: 0, present: 0, onTime: 0, late: 0, lateMin: 0, absent: 0, excused: 0, early: 0, extra: 0, worked: 0, wDays: 0, inSum: 0, inN: 0, outSum: 0, outN: 0 };
    for (var i = 1; i <= nd; i++) {
      var o = attDay(db, u, dayKey(new Date(a[0], a[1], i).getTime()), week); o.d = i; o.dow = (keyDate(o.k).getDay() + 6) % 7; days.push(o);
      if (o.st === 'ok' || o.st === 'late' || o.st === 'noin') {
        c.exp++; c.present++;
        if (o.st === 'late') { c.late++; c.lateMin += o.late; } else c.onTime++;
        if (o.early) c.early++;
      } else if (o.st === 'absent') { c.exp++; c.absent++; }
      else if (o.st === 'excused') c.excused++;
      else if (o.st === 'extra') c.extra++;
      if (o.in != null && o.st !== 'excused') { c.inSum += o.in; c.inN++; }
      if (o.out != null && o.st !== 'excused') { c.outSum += o.out; c.outN++; }
      if (o.worked != null) { c.worked += o.worked; c.wDays++; }
    }
    c.days = days; c.onTimePct = c.present ? Math.round(c.onTime * 100 / c.present) : null; c.presPct = c.exp ? Math.round(c.present * 100 / c.exp) : null;
    c.avgIn = c.inN ? c.inSum / c.inN : null; c.avgOut = c.outN ? c.outSum / c.outN : null; c.has = !!(c.exp || c.excused || c.extra);
    c.flag = c.late >= 3 || c.absent >= 2;
    return c;
  }
  function attNote(c, t) {
    var x = [];
    if (c.late) x.push(tpl(t('at_note_late'), { n: c.late, m: c.lateMin }));
    if (c.absent) x.push(tpl(t('at_note_abs'), { n: c.absent }));
    return x.join(' · ');
  }

  /* ---------- reading the turnstile export: CSV (UTF-8 / Windows-1251, ; , tab) and Excel .xlsx ---------- */
  function decodeText(buf) {
    var b = new Uint8Array(buf);
    if (b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder('utf-16le').decode(b);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(b).replace(/^﻿/, ''); } catch (e) { return new TextDecoder('windows-1251').decode(b); }
  }
  function parseCSV(txt) {
    var lines = txt.split(/\r\n|\n|\r/).filter(function (l) { return l.trim(); }).slice(0, 8), best = ';', bc = -1;
    [';', ',', '\t', '|'].forEach(function (d) { var c = lines.reduce(function (s, l) { return s + l.split(d).length - 1; }, 0); if (c > bc) { bc = c; best = d; } });
    var rows = [], row = [], cur = '', q = false;
    function end() { row.push(cur); cur = ''; if (row.some(function (x) { return String(x).trim(); })) rows.push(row.map(function (x) { return x.trim(); })); row = []; }
    for (var i = 0; i < txt.length; i++) {
      var ch = txt[i];
      if (q) { if (ch === '"') { if (txt[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"' && !cur.trim()) { q = true; cur = ''; }
      else if (ch === best) { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && txt[i + 1] === '\n') i++; end(); }
      else cur += ch;
    }
    if (cur || row.length) end();
    return rows;
  }
  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
  function isZip(buf) { var b = new Uint8Array(buf, 0, Math.min(4, buf.byteLength)); return b[0] === 0x50 && b[1] === 0x4B; }
  function inflateRaw(data) {
    if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('nodecomp'));
    return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
  }
  /* just enough of a zip reader for an .xlsx: the central directory, stored or deflated entries */
  function unzipXl(buf) {
    var b = new Uint8Array(buf), e = -1, files = {}, jobs = [];
    for (var i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (u32(b, i) === 0x06054b50) { e = i; break; }
    if (e < 0) return Promise.reject(new Error('zip'));
    var n = u16(b, e + 10), off = u32(b, e + 16);
    for (var k = 0; k < n && u32(b, off) === 0x02014b50; k++) {
      var method = u16(b, off + 10), csize = u32(b, off + 20), nl = u16(b, off + 28), xl = u16(b, off + 30), cl = u16(b, off + 32), lho = u32(b, off + 42);
      var name = new TextDecoder().decode(b.subarray(off + 46, off + 46 + nl));
      off += 46 + nl + xl + cl;
      if (!/^xl\/(sharedStrings\.xml|workbook\.xml|worksheets\/sheet\d+\.xml|_rels\/workbook\.xml\.rels)$/.test(name)) continue;
      var st = lho + 30 + u16(b, lho + 26) + u16(b, lho + 28), data = b.subarray(st, st + csize);
      jobs.push((function (nm, mt, dt) { return (mt === 0 ? Promise.resolve(dt) : inflateRaw(dt)).then(function (x) { files[nm] = new TextDecoder().decode(x); }); })(name, method, data));
    }
    return Promise.all(jobs).then(function () { return files; });
  }
  function colIdx(ref) { var m = /^([A-Z]+)/.exec(ref || ''); if (!m) return -1; var n = 0; for (var i = 0; i < m[1].length; i++) n = n * 26 + m[1].charCodeAt(i) - 64; return n - 1; }
  function parseXLSX(buf) {
    return unzipXl(buf).then(function (f) {
      var P = new DOMParser(), shared = [], sheet = null;
      if (f['xl/sharedStrings.xml']) Array.prototype.forEach.call(P.parseFromString(f['xl/sharedStrings.xml'], 'application/xml').getElementsByTagName('si'), function (si) {
        var ts = si.getElementsByTagName('t'), s = ''; for (var i = 0; i < ts.length; i++) if (!ts[i].parentNode || ts[i].parentNode.nodeName !== 'rPh') s += ts[i].textContent; shared.push(s); });
      try {
        var first = P.parseFromString(f['xl/workbook.xml'], 'application/xml').getElementsByTagName('sheet')[0], rid = first && first.getAttribute('r:id');
        Array.prototype.forEach.call(P.parseFromString(f['xl/_rels/workbook.xml.rels'], 'application/xml').getElementsByTagName('Relationship'), function (r) {
          if (r.getAttribute('Id') === rid) sheet = f['xl/' + r.getAttribute('Target').replace(/^\/?(xl\/)?/, '')]; });
      } catch (e) {}
      if (!sheet) { var nm = Object.keys(f).filter(function (x) { return /^xl\/worksheets\/sheet\d+\.xml$/.test(x); }).sort()[0]; sheet = nm && f[nm]; }
      if (!sheet) throw new Error('nosheet');
      var rows = [];
      Array.prototype.forEach.call(P.parseFromString(sheet, 'application/xml').getElementsByTagName('row'), function (r) {
        var out = [];
        Array.prototype.forEach.call(r.getElementsByTagName('c'), function (c) {
          var col = colIdx(c.getAttribute('r')), ty = c.getAttribute('t'), v = c.getElementsByTagName('v')[0], val = '';
          if (ty === 's') val = shared[+(v ? v.textContent : 0)] || '';
          else if (ty === 'inlineStr') { var it = c.getElementsByTagName('t')[0]; val = it ? it.textContent : ''; }
          else if (ty === 'str' || ty === 'e' || ty === 'b') val = v ? v.textContent : '';
          else val = v && v.textContent !== '' ? +v.textContent : '';
          if (col < 0) col = out.length;
          while (out.length < col) out.push('');
          out[col] = typeof val === 'string' ? val.trim() : val;
        });
        if (out.some(function (x) { return String(x).trim() !== ''; })) rows.push(out);
      });
      return rows;
    });
  }

  /* values: Excel serials, 2026-10-09, 09.10.2026, 10/09/2026, 8:57, 08:57:12, 8:57 PM */
  function ymdK(y, m, d) { if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null; return y + '-' + pad(m) + '-' + pad(d); }
  function pDate(v) {
    if (typeof v === 'number') { if (v > 20000 && v < 80000) { var dt = new Date(Math.round((Math.floor(v) - 25569) * 864e5)); return ymdK(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()); } return null; }
    var s = String(v || '').trim(), m;
    if ((m = /(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(s))) return ymdK(+m[1], +m[2], +m[3]);
    if ((m = /(\d{1,2})[-./](\d{1,2})[-./](\d{2,4})/.exec(s))) { var a = +m[1], b = +m[2], y = +m[3]; if (y < 100) y += 2000; if (b > 12 && a <= 12) { var x = a; a = b; b = x; } return ymdK(y, b, a); }
    return null;
  }
  function pTime(v) {
    if (typeof v === 'number') { var fr = v - Math.floor(v); return v >= 0 && (v < 1 || fr > 1e-7) ? Math.round(fr * 1440) % 1440 : null; }
    var s = String(v || '').trim().replace(/\d{4}[-./]\d{1,2}[-./]\d{1,2}|\d{1,2}[-./]\d{1,2}[-./]\d{2,4}/, ' ');
    var m = /(\d{1,2})[:.](\d{2})(?:[:.]\d{2})?\s*([ap]\.?m\.?)?/i.exec(s);
    if (!m) return null;
    var hh = +m[1], mm = +m[2];
    if (m[3]) { if (hh === 12) hh = 0; if (/p/i.test(m[3])) hh += 12; }
    return hh > 23 || mm > 59 ? null : hh * 60 + mm;
  }
  function pDir(v) {
    var s = String(v == null ? '' : v).toLowerCase().trim(); if (!s) return null;
    if (/(выход|уход|exit|\bout\b|check.?out|chiqish|ketdi|出|下班|签退)/.test(s)) return 'out';
    if (/(вход|приход|entry|enter|\bin\b|check.?in|kirish|keldi|进|入|上班|签到)/.test(s)) return 'in';
    return null;
  }
  var ATT_ROLES = ['', 'name', 'id', 'dt', 'date', 'time', 'dir', 'in', 'out'];
  var ATT_HEAD = [
    ['dt', /(дата\s*и\s*время|дата\s*\/\s*время|date\s*\/?\s*time|datetime|timestamp|время\s*событ|event\s*time|sana\s*va\s*vaqt|日期时间|打卡时间|记录时间)/i],
    ['in', /(приход|первый\s*вход|время\s*вход|first\s*in|check.?in|arrival|clock.?in|kirish\s*vaqti|kelgan|上班|签到)/i],
    ['out', /(уход|последний\s*выход|время\s*выход|last\s*out|check.?out|departure|clock.?out|chiqish\s*vaqti|ketgan|下班|签退)/i],
    ['dir', /(направлен|событ|вход\s*\/\s*выход|direction|event|\btype\b|тип|status|in\s*\/\s*out|yo.?nalish|holat|状态|进出|方向)/i],
    ['id', /(таб|№|номер|\bid\b|card|карт|badge|personnel|\bcode\b|код|raqam|工号|卡号|编号)/i],
    ['name', /(ф\.?\s*и\.?\s*о|сотрудник|работник|имя|фамил|name|employee|person|staff|xodim|ism|familiya|姓名|员工|人员|用户)/i],
    ['date', /(дата|date|sana|kun|日期)/i],
    ['time', /(время|time|vaqt|时间)/i]];
  function guessCol(vals, used) {
    vals = vals.filter(function (v) { return v !== '' && v != null; }); if (!vals.length) return '';
    function share(f) { return vals.filter(f).length / vals.length; }
    if (!used.dir && share(function (v) { return !!pDir(v); }) >= .6) return 'dir';
    if (!used.dt && share(function (v) { return pDate(v) && pTime(v) != null && (typeof v !== 'number' || v % 1); }) >= .6) return 'dt';
    if (!used.date && share(function (v) { return !!pDate(v); }) >= .6) return 'date';
    if (share(function (v) { return pTime(v) != null && !pDate(v); }) >= .6) return !used.time ? 'time' : !used.out ? 'out' : '';
    if (!used.name && share(function (v) { return typeof v === 'string' && /[A-Za-zА-Яа-яЁёЎўҚқҒғҲҳ一-鿿]{2,}/.test(v) && !pDir(v); }) >= .6) return 'name';
    if (!used.id && share(function (v) { return /^\s*[A-Za-z]?\d{2,}\s*$/.test(String(v)); }) >= .6) return 'id';
    return '';
  }
  function detectRoles(rows) {
    var head = rows[0] || [], ncol = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
    var hasHead = head.some(function (c) { return typeof c === 'string' && ATT_HEAD.some(function (x) { return x[1].test(c); }); }) && !head.some(function (c) { return pDate(c) || pTime(c) != null; });
    var body = hasHead ? rows.slice(1) : rows, roles = [], used = {};
    for (var c = 0; c < ncol; c++) {
      var r = '', smp = body.slice(0, 40).map(function (x) { return x[c]; });
      if (hasHead) { var hc = String(head[c] || ''); for (var j = 0; j < ATT_HEAD.length; j++) if (ATT_HEAD[j][1].test(hc) && !used[ATT_HEAD[j][0]]) { r = ATT_HEAD[j][0]; break; } }
      if (r === 'date' || r === 'time') { var ne = smp.filter(function (v) { return v !== '' && v != null; }); if (ne.length && ne.filter(function (v) { return pDate(v) && pTime(v) != null && (typeof v !== 'number' || v % 1); }).length >= ne.length * .6) r = used.dt ? r : 'dt'; }
      if (!r) r = guessCol(smp, used);
      if (r) used[r] = 1; roles.push(r);
    }
    /* “Time” + a second time column and no direction column reads as a daily in/out report */
    if (!used.dir && !used['in'] && used.time && used.out) roles = roles.map(function (x) { return x === 'time' ? 'in' : x; });
    return { hasHead: hasHead, roles: roles, ncol: ncol };
  }
  function rolesOk(map) { var R = {}; map.roles.forEach(function (r) { if (r) R[r] = 1; }); return (R.name || R.id) && (R.dt || R.date) && (R.dt || R.time || R['in'] || R.out); }
  function buildEvents(rows, map) {
    var body = map.hasHead ? rows.slice(1) : rows, R = {}, ev = [], bad = 0, empty = 0;
    map.roles.forEach(function (r, i) { if (r && R[r] == null) R[r] = i; });
    body.forEach(function (row) {
      var who = { name: R.name != null ? String(row[R.name] == null ? '' : row[R.name]).trim() : '', id: R.id != null ? String(row[R.id] == null ? '' : row[R.id]).trim() : '' };
      if (!who.name && !who.id) { bad++; return; }
      var k = null, tm = null;
      if (R.dt != null) { k = pDate(row[R.dt]); tm = pTime(row[R.dt]); }
      if (R.date != null) k = pDate(row[R.date]) || k;
      if (R.time != null) { var t2 = pTime(row[R.time]); if (t2 != null) tm = t2; }
      if (!k) { bad++; return; }
      if (R['in'] != null || R.out != null) {
        var a = R['in'] != null ? pTime(row[R['in']]) : null, b = R.out != null ? pTime(row[R.out]) : null;
        if (a == null && b == null) { if (tm == null) { empty++; ev.push({ who: who, k: k, m: null, dir: null }); return; } ev.push({ who: who, k: k, m: tm, dir: null }); return; }
        if (a != null) ev.push({ who: who, k: k, m: a, dir: 'in' });
        if (b != null) ev.push({ who: who, k: k, m: b, dir: 'out' });
        return;
      }
      if (tm == null) { bad++; return; }
      ev.push({ who: who, k: k, m: tm, dir: R.dir != null ? pDir(row[R.dir]) : null });
    });
    return { ev: ev, bad: bad, empty: empty, rows: body.length };
  }

  /* who is who: alias saved earlier → personnel number / ID → the name in any word order, Latin or Cyrillic */
  var CYR = { 'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo', 'ж': 'j', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'sh', 'ъ': '', 'ы': 'i', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya', 'ў': 'o', 'қ': 'q', 'ғ': 'g', 'ҳ': 'h' };
  function nameKey(s) {
    return String(s || '').toLowerCase().replace(/[а-яёўқғҳ]/g, function (c) { return CYR[c] != null ? CYR[c] : c; })
      .replace(/[‘’'`ʻʼ]/g, '').replace(/x/g, 'h').replace(/iy/g, 'i').replace(/ye/g, 'e').replace(/[^a-z0-9一-鿿 ]+/g, ' ').split(/\s+/).filter(Boolean);
  }
  function whoKey(who) { return who.id ? 'id:' + who.id.toLowerCase() : 'n:' + nameKey(who.name).sort().join(' '); }
  function whoLabel(who) { return [who.name, who.id ? '№ ' + who.id : ''].filter(Boolean).join(' · '); }
  function matchWho(db, who, alias) {
    var k1 = who.id ? 'id:' + who.id.toLowerCase() : null, nk = nameKey(who.name), k2 = nk.length ? 'n:' + nk.slice().sort().join(' ') : null;
    if (k1 && alias[k1]) return alias[k1]; if (k2 && alias[k2]) return alias[k2];
    var emps = db.users.filter(function (u) { return u.role === 'employee'; });
    if (who.id) { var byId = emps.filter(function (u) { return String(u.id) === who.id || (u.badge && String(u.badge) === who.id); })[0]; if (byId) return byId.id; }
    if (nk.length) { var hit = emps.filter(function (u) { var uk = nameKey(u.name); return uk.length && uk.every(function (w) { return nk.indexOf(w) >= 0; }); }); if (hit.length === 1) return hit[0].id; }
    return null;
  }
  function planImport(db, ev, alias) {
    var per = {}, un = {}, from = null, to = null;
    ev.forEach(function (e) {
      var key = whoKey(e.who); if (alias[key] === 'skip') return;
      var uid = matchWho(db, e.who, alias);
      if (!uid) { un[key] = un[key] || { who: e.who, n: 0 }; un[key].n++; return; }
      if (!from || e.k < from) from = e.k; if (!to || e.k > to) to = e.k;
      var day = (per[uid] = per[uid] || {})[e.k] = per[uid][e.k] || []; if (e.m != null) day.push({ m: e.m, dir: e.dir });
    });
    return { per: per, un: un, from: from, to: to };
  }
  /* arrival = first pass in; departure = the last pass only when it is a way out (a last “in” means still inside) */
  function aggDay(list) {
    var ev = list.slice().sort(function (p, q) { return p.m - q.m; }), ins = ev.filter(function (x) { return x.dir !== 'out'; }), last = ev[ev.length - 1];
    var a = ins.length ? ins[0].m : null, b = null;
    if (last && last.dir === 'out') b = last.m;
    else if (last && last.dir == null && ev.length > 1 && a != null && last.m > a + 30) b = last.m;
    if (a != null && b != null && b <= a) b = null;
    return { a: a, b: b };
  }
  function commitImport(d, plan, meta) {
    var id = 'imp' + Date.now().toString(36), depts = {}, nrec = 0, week = workWeek(d);
    d.attend = d.attend || {}; d.attendCover = d.attendCover || {}; d.attendAlias = Object.assign({}, d.attendAlias, meta.alias || {});
    Object.keys(plan.per).forEach(function (uid) {
      var u = d.users.filter(function (x) { return x.id === +uid; })[0]; if (!u) return; depts[u.department] = 1;
      var A = d.attend[uid] = d.attend[uid] || {};
      Object.keys(plan.per[uid]).forEach(function (k) {
        var cur = A[k]; if (cur && cur.src === 'manual') return;
        var g = aggDay(plan.per[uid][k]); if (g.a == null && g.b == null) return;
        var rec = { in: g.a != null ? m2hm(g.a) : null, out: g.b != null ? m2hm(g.b) : null, src: id };
        if (cur) { rec.prev = Object.assign({}, cur); delete rec.prev.prev; }
        A[k] = rec; nrec++;
      });
    });
    if (plan.from) Object.keys(depts).forEach(function (dp) { (d.attendCover[dp] = d.attendCover[dp] || []).push([plan.from, plan.to, id]); });
    d.attendImports = [{ id: id, at: Date.now(), by: meta.by, file: meta.file, rows: meta.rows, recs: nrec, emps: Object.keys(plan.per).length, from: plan.from, to: plan.to }].concat(d.attendImports || []);
    if (meta.notify) Object.keys(plan.per).forEach(function (uid) {
      var u = d.users.filter(function (x) { return x.id === +uid; })[0]; if (!u) return;
      var list = Object.keys(plan.per[uid]).sort().map(function (k) { return attDay(d, u, k, week); }).filter(function (o) { return o.st === 'late' && o.rec && o.rec.src === id; }).map(function (o) { return [o.k, o.late]; });
      if (list.length) d.notifications.unshift({ id: nextId(d), userId: u.id, kind: 'late', late: { n: list.length, list: list.slice(-3) }, route: 'report', ym: list[list.length - 1][0].slice(0, 7), text: '', at: Date.now(), read: false });
    });
    return { id: id, nrec: nrec, emps: Object.keys(plan.per).length };
  }
  function undoImport(d, id) {
    Object.keys(d.attend || {}).forEach(function (uid) { var A = d.attend[uid]; Object.keys(A).forEach(function (k) { var r = A[k]; if (r && r.src === id) { if (r.prev) A[k] = r.prev; else delete A[k]; } }); });
    Object.keys(d.attendCover || {}).forEach(function (dp) { d.attendCover[dp] = d.attendCover[dp].filter(function (r) { return r[2] !== id; }); });
    d.attendImports = (d.attendImports || []).map(function (x) { return x.id === id ? Object.assign({}, x, { undone: Date.now() }) : x; });
  }
  function lateNotif(n, t) {
    var L = n.late || {}, list = (L.list || []).map(function (x) { return fmtKs(x[0]) + ' (+' + x[1] + ' ' + t('min') + ')'; }).join(', ');
    return tpl(t('n_late'), { n: L.n || 0, x: list });
  }

  /* a demo export: today's turnstile log in the shape most access-control systems produce */
  function sampleCSV(db) {
    var k = dayKey(Date.now()), a = k.split('-'), date = a[2] + '.' + a[1] + '.' + a[0], now = new Date(), nowM = now.getHours() * 60 + now.getMinutes();
    var CY = { 10391: 'Юсупова Азиза', 10288: 'Рахимов Сардор', 10205: 'Эргашева Малика' };
    var rows = [['Табельный №', 'ФИО', 'Дата', 'Время', 'Событие', 'Точка доступа']];
    db.users.filter(function (u) { return u.role === 'employee'; }).forEach(function (u, i) {
      var sc = schedOf(db, u), s = hm2m(sc.start), e = hm2m(sc.end), r = prand(u.id + 7);
      var tin = s - 22 + Math.round(r * 30) + (i === 1 ? 26 : 0), tout = e + Math.round(prand(u.id + 3) * 40) - 5;
      var nm = CY[u.id] || u.name.split(' ').reverse().join(' '), id = u.id === 10462 ? '' : String(u.id);
      var hms = function (m) { return pad(Math.floor(m / 60)) + ':' + pad(m % 60) + ':' + pad(Math.floor(prand(u.id + m) * 60)); };
      rows.push([id, nm, date, hms(tin), 'Вход', u.department.indexOf('Ombor') >= 0 ? 'Склад — проходная' : 'Офис — турникет 1']);
      rows.push([id, nm, date, hms(tin + 185), 'Выход', 'Офис — турникет 1']);
      rows.push([id, nm, date, hms(tin + 238), 'Вход', 'Офис — турникет 1']);
      if (tout <= nowM || nowM < tin) rows.push([id, nm, date, hms(tout), 'Выход', 'Офис — турникет 1']);
    });
    rows.push(['', 'Каримов Бобур', date, '08:47:10', 'Вход', 'Офис — турникет 2']);
    return '﻿' + rows.map(function (r) { return r.map(function (x) { return /[;"\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; }).join(';'); }).join('\r\n');
  }
  /* inside the claude.ai viewer files go out through the downloads capability; the offline file uses a plain link */
  var DL = null;
  (function () { try { if (window.claude && typeof window.claude.use === 'function') window.claude.use('downloads').then(function (x) { DL = x || null; }, function () {}); } catch (e) {} })();
  function downloadText(name, text, mime) {
    if (DL) { DL.save({ filename: name, data: text }).catch(function () {}); return; }
    var url = URL.createObjectURL(new Blob([text], { type: mime || 'text/csv;charset=utf-8' })), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 400);
  }
  /* onClick for <a href="data:…" download>: hands the file to the viewer's save prompt when the link alone cannot */
  function b64Blob(b64, type) { var s = atob(b64), a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return new Blob([a], { type: type || 'application/octet-stream' }); }
  function saveLink(name) {
    return function (e) {
      var ref = e.currentTarget.getAttribute('href') || '';
      /* a file on the server’s Drive: the data holds lmsfile:<id>, the file itself comes on request if you may see it */
      if (SV && ref.indexOf('lmsfile:') === 0) {
        e.preventDefault();
        SV.file(ref.slice(8)).then(function (f) {
          var url = URL.createObjectURL(b64Blob(f.data, f.type)), a = document.createElement('a');
          a.href = url; a.download = name || f.name; document.body.appendChild(a); a.click();
          setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
        }, function (x) { SAY(x.code === 'net' ? 'srv_net' : 'srv_file_err'); });
        return;
      }
      if (!DL) return;
      e.preventDefault();
      var href = e.currentTarget.getAttribute('href');
      fetch(href).then(function (r) { return r.blob(); }).then(function (bl) { return DL.save({ filename: name, data: bl }); }).catch(function () {});
    };
  }

  /* ---------- small pieces ---------- */
  function AttChip(p) {
    var t = p.t, o = p.o, txt;
    if (o.st === 'late') txt = tpl(t('at_late_n'), { n: o.late });
    else if (o.st === 'excused') txt = t('at_r_' + (o.reason || 'other'));
    else txt = t('at_st_' + o.st);
    return h('span', { className: cx('at-chip', 'a-' + o.st) }, txt);
  }
  function AttLegend(p) {
    var t = p.t;
    return h('div', { className: 'mc-legend at-legend' }, ['ok', 'late', 'absent', 'excused', 'off', 'nodata'].map(function (s) { return h('span', { key: s }, h('i', { className: 'mc-sw a-' + s }), t('at_lg_' + s)); }));
  }
  function attTip(o, t) {
    var x = fmtKs(o.k) + ' · ';
    if (o.st === 'ok' || o.st === 'late' || o.st === 'extra' || o.st === 'noin') x += (o.in != null ? m2hm(o.in) : '—') + '–' + (o.out != null ? m2hm(o.out) : '…') + (o.late ? ' · ' + tpl(t('at_late_n'), { n: o.late }) : '') + (o.early ? ' · ' + tpl(t('at_early_n'), { n: o.early }) : '');
    else if (o.st === 'excused') x += t('at_r_' + (o.reason || 'other'));
    else x += t('at_st_' + o.st);
    return x;
  }
  /* calendar of arrivals for one person and one month */
  function AttCal(p) {
    var t = p.t, c = p.c, wd = t('mr_wd').split('|'), lead = c.days.length ? c.days[0].dow : 0, cells = [];
    for (var i = 0; i < lead; i++) cells.push(h('span', { key: 'b' + i, className: 'mc-cell is-blank', 'aria-hidden': true }));
    c.days.forEach(function (o) {
      var tip = attTip(o, t), click = p.onEdit && o.st !== 'future' && o.st !== 'before';
      cells.push(h(click ? 'button' : 'span', { key: o.k, type: click ? 'button' : undefined, className: cx('mc-cell at-cell', 'a-' + o.st, !o.work && 'is-off', o.k === dayKey(Date.now()) && 'is-today'), title: tip, 'aria-label': tip, onClick: click ? function () { p.onEdit(o.k); } : undefined },
        h('b', null, o.d),
        o.in != null && o.st !== 'excused' ? h('small', null, m2hm(o.in)) : o.st === 'excused' ? h('small', null, t('at_rs_' + (o.reason || 'other'))) : null,
        o.late ? h('em', null, '+' + o.late) : null));
    });
    return h('div', { className: 'mc' }, h('div', { className: 'mc-grid' }, wd.map(function (x, i) { return h('span', { key: 'w' + i, className: 'mc-wd', 'aria-hidden': true }, x); }).concat(cells)), h(AttLegend, { t: t }));
  }
  function attTiles(c, t) {
    return [
      { k: 'on', label: t('at_ontime'), big: c.onTimePct == null ? '—' : c.onTimePct + '%', sub: tpl(t('at_ontime_sub'), { k: c.onTime, n: c.present }) },
      { k: 'late', label: t('at_lates'), big: String(c.late), sub: c.late ? tpl(t('at_lates_sub'), { m: c.lateMin, a: Math.round(c.lateMin / c.late) }) : t('at_lates_none'), alert: c.late >= 3 },
      { k: 'in', label: t('at_avg_in'), big: m2hm(c.avgIn), sub: c.avgOut != null ? tpl(t('at_avg_out'), { x: m2hm(c.avgOut) }) : '—' },
      { k: 'h', label: t('at_hours'), big: fmtH(c.worked, t), sub: c.wDays ? tpl(t('at_hours_sub'), { x: fmtMin(c.worked / c.wDays, t) }) + (c.early ? ' · ' + tpl(t('at_early_days'), { n: c.early }) : '') : '—' },
      { k: 'abs', label: t('at_absent'), big: String(c.absent), sub: tpl(t('at_absent_sub'), { e: c.excused, p: c.presPct == null ? '—' : c.presPct }), alert: c.absent >= 2 }];
  }

  /* section inside the monthly report (employee and SOP manager) */
  function AttSection(p) {
    var t = p.t, db = p.db, u = p.u, c = attMonth(db, u, p.ym), sc = schedOf(db, u);
    if (!c.has) return null;
    return h('section', { className: 'box at-sec' },
      h('div', { className: 'chart-head' }, h('div', null, h('span', { className: 'lor-eyebrow' }, t('at_eyebrow')), h('h2', { className: 'lor-h' }, t('at_sec_t')),
        h('p', { className: 'lor-sm lor-muted', style: { margin: '4px 0 0' } }, tpl(t('at_sched_line'), { s: sc.start, e: sc.end, g: sc.grace, d: u.department })))),
      h('div', { className: 'mr-tiles' }, attTiles(c, t).map(function (x) { return h('div', { key: x.k, className: cx('tile mr-tile', x.alert && 'is-alert') }, h('span', { className: 'lor-eyebrow' }, x.label), h('b', null, x.big), h('span', { className: 'lor-sm lor-muted' }, x.sub)); })),
      h(AttCal, { t: t, c: c, onEdit: p.onEdit }));
  }

  /* employee home: today at the door, and the month so far */
  function AttHome(p) {
    var t = p.t, db = p.db, u = p.user, k = dayKey(Date.now()), week = workWeek(db), o = attDay(db, u, k, week), c = attMonth(db, u, ymOf(Date.now())), sc = schedOf(db, u);
    var last = null; for (var i = 1; i < 40 && !last; i++) { var x = attDay(db, u, shiftK(k, -i), week); if (x.in != null || x.st === 'absent' || x.st === 'excused') last = x; }
    var shown = o.in != null || o.st === 'absent' || o.st === 'excused' ? o : null;
    return h('section', { className: 'box at-home' },
      h('div', { className: 'at-home-h' }, h('span', { className: 'lor-eyebrow' }, t('at_home_t')), h('span', { className: 'lor-sm lor-muted' }, sc.start + '–' + sc.end)),
      shown ? h('div', { className: 'at-today' }, h('b', null, shown.in != null ? m2hm(shown.in) : '—'), h('span', null, t('at_today')), h(AttChip, { t: t, o: shown }))
        : h('div', { className: 'at-today is-wait' }, h('span', null, o.st === 'pending' ? t('at_today_pending') : t('at_today_none')),
          last ? h('small', null, tpl(t('at_last'), { d: fmtKs(last.k), x: last.in != null ? m2hm(last.in) : t('at_st_' + last.st) }), ' ', h(AttChip, { t: t, o: last })) : null),
      c.has ? h('div', { className: 'at-home-stats' },
        h('div', null, h('b', null, c.onTimePct == null ? '—' : c.onTimePct + '%'), h('span', null, t('at_ontime'))),
        h('div', null, h('b', { className: c.late >= 3 ? 'warn-txt' : '' }, c.late), h('span', null, t('at_lates'))),
        h('div', null, h('b', null, m2hm(c.avgIn)), h('span', null, t('at_avg_in')))) : null,
      c.has ? h('div', { className: 'at-strip', 'aria-hidden': true }, c.days.map(function (x) { return h('i', { key: x.k, className: cx('a-' + x.st, x.k === k && 'is-today') }); })) : null,
      h('div', null, h('button', { type: 'button', className: 'app-link', onClick: function () { p.go({ name: 'report', ym: ymOf(Date.now()) }); } }, t('at_home_more'))));
  }

  /* ---------- SOP manager ---------- */
  function AttEdit(p) {
    var t = p.t, u = p.u, k = p.k, rec = attRec(p.db, u.id, k) || {}, a = useState(rec.in || ''), b = useState(rec.out || ''), r = useState(rec.reason || ''), n = useState(rec.note || '');
    useEffect(function () { function esc(e) { if (e.key === 'Escape') p.onClose(); } window.addEventListener('keydown', esc); return function () { window.removeEventListener('keydown', esc); }; }, []);
    function save() {
      p.update(function (d) {
        d.attend = d.attend || {}; var A = d.attend[u.id] = d.attend[u.id] || {}, cur = A[k];
        var nr = { in: a[0] || null, out: b[0] || null, reason: r[0] || null, note: n[0].trim() || null, src: 'manual', by: p.user.id, at: Date.now() };
        if (cur) { nr.prev = Object.assign({}, cur); delete nr.prev.prev; }
        A[k] = nr;
      });
      p.say(t('at_saved')); p.onClose();
    }
    function clear() { p.update(function (d) { if (d.attend && d.attend[u.id]) delete d.attend[u.id][k]; }); p.say(t('at_cleared')); p.onClose(); }
    var sc = schedOf(p.db, u);
    return h('div', { className: 'lor-scrim', onMouseDown: function (e) { if (e.target === e.currentTarget) p.onClose(); } },
      h('div', { className: 'lor-modal at-edit', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'at-ed-h' },
        h('button', { type: 'button', className: 'lor-modal-x', 'aria-label': t('close'), onClick: p.onClose }, '×'),
        h('span', { className: 'lor-eyebrow' }, fmtK(k) + ' · ' + tpl(t('at_sched_short'), { s: sc.start, e: sc.end })),
        h('h2', { className: 'lor-h', id: 'at-ed-h' }, u.name),
        rec.src && rec.src !== 'manual' ? h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('at_ed_from_file')) : rec.src === 'manual' && rec.by ? h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, tpl(t('at_ed_by'), { who: userOf(p.db, rec.by).name, d: fmt(rec.at, t) })) : null,
        h('div', { className: 'at-ed-grid' },
          h(Field, { name: 'at-in', type: 'time', label: t('at_in'), value: a[0], onChange: a[1] }),
          h(Field, { name: 'at-out', type: 'time', label: t('at_out'), value: b[0], onChange: b[1] }),
          h(Field, { name: 'at-r', label: t('at_reason'), value: r[0], onChange: r[1], options: [['', t('at_reason_none')]].concat(ATT_REASONS.map(function (x) { return [x, t('at_r_' + x)]; })) })),
        h(Field, { name: 'at-note', label: t('at_note'), value: n[0], onChange: n[1], placeholder: t('at_note_ph') }),
        h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('at_ed_hint')),
        h('div', { className: 'lor-modal-actions' },
          rec.src ? h(Btn, { variant: 'ghost', size: 'sm', onClick: clear }, t('at_clear')) : h('span'),
          h(Btn, { variant: 'primary', size: 'sm', disabled: !a[0] && !b[0] && !r[0], onClick: save }, t('save')))));
  }

  function AttSched(p) {
    var t = p.t, db = p.db, s0 = (db.settings || {}).schedule || {}, st = useState(function () { return clone({ def: Object.assign({ start: '09:00', end: '18:00', grace: 10 }, s0.def || {}), dept: s0.dept || {} }); }), S = st[0];
    var depts = db.users.filter(function (u) { return u.role === 'employee'; }).map(function (u) { return u.department; }).filter(function (x, i, a) { return x && a.indexOf(x) === i; }).sort();
    function set(dp, k, v) { var c = clone(S); if (dp == null) c.def[k] = v; else { c.dept[dp] = Object.assign({}, c.dept[dp] || {}); if (v === '' || v == null) delete c.dept[dp][k]; else c.dept[dp][k] = v; if (!Object.keys(c.dept[dp]).length) delete c.dept[dp]; } st[1](c); }
    function save() { p.update(function (d) { d.settings = d.settings || {}; var c = clone(S); c.def.grace = Math.max(0, +c.def.grace || 0); Object.keys(c.dept).forEach(function (k) { if (c.dept[k].grace != null) c.dept[k].grace = Math.max(0, +c.dept[k].grace || 0); }); d.settings.schedule = c; }); p.say(t('at_sched_saved')); p.onClose(); }
    function row(label, dp) {
      var v = dp == null ? S.def : (S.dept[dp] || {}), ph = S.def;
      return h('tr', { key: dp || '__def' },
        h('th', { scope: 'row' }, label, dp != null && !S.dept[dp] ? h('small', null, t('at_sched_inherit')) : null),
        h('td', null, h('input', { type: 'time', className: 'lor-input slim', 'aria-label': label + ' · ' + t('at_start'), value: v.start || (dp != null ? '' : ''), placeholder: ph.start, onChange: function (e) { set(dp, 'start', e.target.value); } }), dp != null && !v.start ? h('small', { className: 'at-inh' }, ph.start) : null),
        h('td', null, h('input', { type: 'time', className: 'lor-input slim', 'aria-label': label + ' · ' + t('at_end'), value: v.end || '', onChange: function (e) { set(dp, 'end', e.target.value); } }), dp != null && !v.end ? h('small', { className: 'at-inh' }, ph.end) : null),
        h('td', null, h('input', { type: 'number', min: 0, max: 120, className: 'lor-input slim at-grace', 'aria-label': label + ' · ' + t('at_grace'), value: v.grace == null ? '' : v.grace, placeholder: String(ph.grace), onChange: function (e) { set(dp, 'grace', e.target.value === '' ? null : e.target.value); } })));
    }
    return h('section', { className: 'box at-sched' },
      h('div', { className: 'chart-head' }, h('div', null, h('h2', { className: 'lor-h' }, t('at_sched_t')), h('p', { className: 'lor-sm lor-muted', style: { margin: '4px 0 0' } }, t('at_sched_s'))),
        h('button', { type: 'button', className: 'lor-modal-x at-x', 'aria-label': t('close'), onClick: p.onClose }, '×')),
      h('div', { className: 'lor-table-wrap' }, h('table', { className: 'lor-table at-sched-t' },
        h('thead', null, h('tr', null, [t('department'), t('at_start'), t('at_end'), t('at_grace')].map(function (x) { return h('th', { key: x }, x); }))),
        h('tbody', null, [row(t('at_sched_def'), null)].concat(depts.map(function (dp) { return row(dp, dp); }))))),
      h('div', { className: 'box-row' }, h('span', { className: 'lor-sm lor-muted' }, t('at_sched_note')), h(Btn, { variant: 'primary', size: 'sm', onClick: save }, t('save'))));
  }

  function AttImport(p) {
    var t = p.t, db = p.db, st = useState(null), S = st[0], busy = useState(false), err = useState(''), drag = useState(false), inp = useRef(null), notify = useState(true), done = useState(null);
    var emps = db.users.filter(function (u) { return u.role === 'employee'; });
    function load(file) {
      err[1](''); done[1](null); if (!file) return;
      if (/\.xls$/i.test(file.name)) { err[1](t('at_err_xls')); return; }
      busy[1](true);
      file.arrayBuffer().then(function (buf) { return isZip(buf) ? parseXLSX(buf) : parseCSV(decodeText(buf)); })
        .then(function (rows) { if (!rows.length) throw new Error('empty'); st[1]({ file: file.name, rows: rows, map: detectRoles(rows), alias: {} }); })
        .catch(function (e) { err[1](e && e.message === 'nodecomp' ? t('at_err_browser') : e && e.message === 'empty' ? t('at_err_empty') : t('at_err_read')); })
        .then(function () { busy[1](false); });
    }
    function setRole(i, r) { var c = Object.assign({}, S, { map: Object.assign({}, S.map, { roles: S.map.roles.map(function (x, k) { return k === i ? r : (r && x === r ? '' : x); }) }) }); st[1](c); }
    function setAlias(key, v) { var a = Object.assign({}, S.alias); if (v) a[key] = v === 'skip' ? 'skip' : +v; else delete a[key]; st[1](Object.assign({}, S, { alias: a })); }
    var ok = S && rolesOk(S.map), res = ok ? buildEvents(S.rows, S.map) : null, plan = res ? planImport(db, res.ev, Object.assign({}, db.attendAlias || {}, S.alias)) : null;
    var unK = plan ? Object.keys(plan.un) : [], matched = plan ? Object.keys(plan.per) : [];
    function go() {
      var meta = { by: p.user.id, file: S.file, rows: res.rows, notify: notify[0], alias: S.alias }, out = null;
      p.update(function (d) { out = commitImport(d, plan, meta); });
      done[1]({ recs: Object.keys(plan.per).reduce(function (s, uid) { return s + Object.keys(plan.per[uid]).length; }, 0), emps: matched.length, from: plan.from, to: plan.to });
      st[1](null); p.say(t('at_imp_done_said'));
      if (p.onDone) p.onDone(plan.to);
    }
    var preview = S ? (S.map.hasHead ? S.rows.slice(1) : S.rows).slice(0, 5) : [];
    return h('section', { className: 'box at-imp' },
      h('div', { className: 'chart-head' }, h('div', null, h('h2', { className: 'lor-h' }, t('at_imp_t')), h('p', { className: 'lor-sm lor-muted', style: { margin: '4px 0 0' } }, t('at_imp_s'))),
        h('button', { type: 'button', className: 'lor-modal-x at-x', 'aria-label': t('close'), onClick: p.onClose }, '×')),
      done[0] ? h('div', { className: 'lor-notice at-done' }, h('div', { className: 'lor-notice-body' }, h('b', null, '✓ ' + tpl(t('at_imp_done'), { n: done[0].recs, e: done[0].emps })), h('span', null, done[0].from ? fmtK(done[0].from) + ' — ' + fmtK(done[0].to) : ''))) : null,
      !S ? h('div', { className: cx('at-drop', drag[0] && 'is-drag', busy[0] && 'is-busy'), onDragOver: function (e) { e.preventDefault(); drag[1](true); }, onDragLeave: function () { drag[1](false); }, onDrop: function (e) { e.preventDefault(); drag[1](false); load(e.dataTransfer.files[0]); } },
        h('svg', { width: 34, height: 34, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: 'M12 15V4M7.5 8.5L12 4l4.5 4.5M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15' })),
        h('b', null, busy[0] ? t('at_reading') : t('at_drop')),
        h('span', { className: 'lor-sm lor-muted' }, t('at_formats')),
        h('input', { ref: inp, type: 'file', accept: '.csv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', className: 'sr-only', id: 'at-file', onChange: function (e) { load(e.target.files[0]); e.target.value = ''; } }),
        h('div', { className: 'box-row' },
          h(Btn, { variant: 'primary', size: 'sm', disabled: busy[0], onClick: function () { inp.current && inp.current.click(); } }, t('at_pick')),
          h('button', { type: 'button', className: 'app-link', onClick: function () { downloadText('skud_' + dayKey(Date.now()) + '.csv', sampleCSV(db)); } }, t('at_sample')))) : null,
      err[0] ? h('p', { className: 'lor-field-error', role: 'alert' }, err[0]) : null,
      S ? h(F, null,
        h('div', { className: 'at-file' }, h('b', null, S.file), h('span', { className: 'lor-sm lor-muted' }, tpl(t('at_rows'), { n: S.rows.length - (S.map.hasHead ? 1 : 0) })),
          h('label', { className: 'check' }, h('input', { type: 'checkbox', checked: S.map.hasHead, onChange: function (e) { st[1](Object.assign({}, S, { map: Object.assign({}, S.map, { hasHead: e.target.checked }) })); } }), t('at_has_head')),
          h('button', { type: 'button', className: 'app-link', onClick: function () { st[1](null); } }, t('at_other_file'))),
        h('span', { className: 'lor-eyebrow' }, t('at_map_t')),
        h('div', { className: 'lor-table-wrap at-map' }, h('table', { className: 'lor-table' },
          h('thead', null, h('tr', null, Array.apply(null, { length: S.map.ncol }).map(function (_, i) {
            return h('th', { key: i }, S.map.hasHead ? h('small', { className: 'at-colname' }, String(S.rows[0][i] == null ? '' : S.rows[0][i]) || '—') : null,
              h('select', { className: cx('lor-input slim', S.map.roles[i] && 'is-set'), 'aria-label': t('at_col') + ' ' + (i + 1), value: S.map.roles[i] || '', onChange: function (e) { setRole(i, e.target.value); } },
                ATT_ROLES.map(function (r) { return h('option', { key: r, value: r }, r ? t('at_role_' + r) : t('at_role_skip')); })));
          }))),
          h('tbody', null, preview.map(function (r, i) { return h('tr', { key: i }, Array.apply(null, { length: S.map.ncol }).map(function (_, c) { var v = r[c]; return h('td', { key: c, className: S.map.roles[c] ? '' : 'is-off' }, typeof v === 'number' && S.map.roles[c] && /dt|date|time|in|out/.test(S.map.roles[c]) ? (pDate(v) ? fmtK(pDate(v)) + ' ' : '') + (pTime(v) != null && (v < 1 || v % 1) ? m2hm(pTime(v)) : '') : String(v == null ? '' : v)); })); })))),
        !ok ? h('p', { className: 'lor-field-error' }, t('at_need_roles')) : h(F, null,
          h('div', { className: 'at-sum' },
            h('div', null, h('b', null, res.ev.filter(function (e) { return e.m != null; }).length), h('span', null, t('at_sum_ev'))),
            h('div', null, h('b', null, matched.length), h('span', null, t('at_sum_emp'))),
            h('div', null, h('b', null, plan.from ? fmtKs(plan.from) + (plan.to !== plan.from ? '–' + fmtKs(plan.to) : '') : '—'), h('span', null, t('at_sum_range'))),
            h('div', { className: unK.length ? 'is-warn' : '' }, h('b', null, unK.length), h('span', null, t('at_sum_un'))),
            res.bad ? h('div', { className: 'is-warn' }, h('b', null, res.bad), h('span', null, t('at_sum_bad'))) : null),
          matched.length ? h('div', { className: 'at-matched' }, matched.map(function (uid) { var u = userOf(db, +uid); return h('span', { key: uid, className: 'lvl-person' }, '✓ ' + u.name, h('small', null, tpl(t('at_days_n'), { n: Object.keys(plan.per[uid]).length }))); })) : null,
          unK.length ? h('div', { className: 'at-un' }, h('span', { className: 'lor-eyebrow' }, t('at_un_t')), h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('at_un_s')),
            h('ul', null, unK.map(function (key) { var x = plan.un[key]; return h('li', { key: key }, h('span', null, h('b', null, whoLabel(x.who)), h('small', null, tpl(t('at_un_rows'), { n: x.n }))),
              h('select', { className: 'lor-input slim', 'aria-label': whoLabel(x.who), value: S.alias[key] || '', onChange: function (e) { setAlias(key, e.target.value); } },
                h('option', { value: '' }, t('at_un_pick')), h('option', { value: 'skip' }, t('at_un_skip')), emps.map(function (u) { return h('option', { key: u.id, value: u.id }, u.name + ' · ' + u.department); }))); }))) : null,
          h('label', { className: 'check' }, h('input', { type: 'checkbox', checked: notify[0], onChange: function (e) { notify[1](e.target.checked); } }), t('at_notify')),
          h('div', { className: 'box-row' }, h('span', { className: 'lor-sm lor-muted' }, t('at_manual_kept')), h(Btn, { variant: 'primary', arrow: true, disabled: !matched.length, onClick: go }, tpl(t('at_import_btn'), { n: matched.length }))))) : null);
  }

  function AttHistory(p) {
    var t = p.t, db = p.db, list = (db.attendImports || []).slice(0, 8);
    if (!list.length) return null;
    return h('section', { className: 'box at-hist' },
      h('span', { className: 'lor-eyebrow' }, t('at_hist_t')),
      h('ul', { className: 'hist' }, list.map(function (x) {
        return h('li', { key: x.id, className: x.undone ? 'is-undone' : '' },
          h('b', null, x.file), h('span', { className: 'lor-muted' }, fmt(x.at, t) + ' · ' + userOf(db, x.by).name + (x.from ? ' · ' + fmtKs(x.from) + '–' + fmtKs(x.to) : '')),
          h('span', null, x.undone ? t('at_hist_undone') : tpl(t('at_hist_n'), { n: x.recs, e: x.emps }),
            !x.undone && x.id !== 'seed' ? h('button', { type: 'button', className: 'app-link danger at-undo', onClick: function () { if (window.confirm(t('at_undo_q'))) { p.update(function (d) { undoImport(d, x.id); }); p.say(t('at_undo_done')); } } }, t('at_undo')) : null));
      })));
  }

  /* Monitoring → Attendance */
  function AttAdmin(p) {
    var t = p.t, db = p.db, lang = p.lang, today = dayKey(Date.now()), week = workWeek(db);
    var emps = db.users.filter(function (u) { return u.role === 'employee'; });
    var latest = (function () { var m = null; Object.keys(db.attendCover || {}).forEach(function (dp) { (db.attendCover[dp] || []).forEach(function (r) { if (!m || r[1] > m) m = r[1]; }); }); m = m && m > today ? today : m || today; for (var i = 0; i < 7 && !isWorkDay(keyDate(m), week); i++) m = shiftK(m, -1); return m; })();
    var panel = useState(null), dk = useState(null), day = dk[0] || latest, ms = useState(ymOf(Date.now())), ym = ms[0], ed = useState(null);
    var minYm = emps.reduce(function (m, u) { var y = ymOf(u.startedAt || Date.now()); return y < m ? y : m; }, ymOf(Date.now()));
    var onDay = emps.filter(function (u) { return dayKey(u.startedAt || 0) <= day; }).map(function (u) { return { u: u, o: attDay(db, u, day, week) }; });
    var cnt = {}; onDay.forEach(function (x) { cnt[x.o.st] = (cnt[x.o.st] || 0) + 1; });
    var rows = emps.filter(function (u) { return ymOf(u.startedAt || 0) <= ym; }).map(function (u) { return { u: u, c: attMonth(db, u, ym) }; });
    var days = rows.length ? rows[0].c.days : [], wd = t('mr_wd').split('|');
    var any = Object.keys(db.attendCover || {}).some(function (dp) { return (db.attendCover[dp] || []).length; });
    function edit(u, k) { ed[1]({ u: u, k: k }); }
    return h('div', { className: 'at-admin' },
      h('div', { className: 'mr-bar' },
        h(Btn, { variant: panel[0] === 'import' ? 'secondary' : 'primary', size: 'sm', onClick: function () { panel[1](panel[0] === 'import' ? null : 'import'); } }, '⇪ ' + t('at_imp_btn')),
        h(Btn, { variant: 'outline', size: 'sm', onClick: function () { panel[1](panel[0] === 'sched' ? null : 'sched'); } }, '◷ ' + t('at_sched_btn')),
        h(Btn, { variant: 'ghost', size: 'sm', className: 'no-print', onClick: function () { window.print(); } }, t('mr_print'))),
      panel[0] === 'import' ? h(AttImport, Object.assign({}, p, { onClose: function () { panel[1](null); }, onDone: function (to) { if (to) { dk[1](to > today ? today : to); ms[1](to.slice(0, 7)); } } })) : null,
      panel[0] === 'sched' ? h(AttSched, Object.assign({}, p, { key: 'sch', onClose: function () { panel[1](null); } })) : null,
      !any ? h('section', { className: 'box' }, h('p', { className: 'lor-muted', style: { margin: 0 } }, t('at_empty'))) : null,
      h('section', { className: 'box at-board' },
        h('div', { className: 'chart-head' },
          h('div', null, h('span', { className: 'lor-eyebrow' }, t('at_board_e')), h('h2', { className: 'lor-h' }, t('at_board_t'))),
          h('div', { className: 'mr-switch' },
            h('button', { type: 'button', className: 'mr-arrow', 'aria-label': t('at_prev_day'), onClick: function () { dk[1](shiftK(day, -1)); } }, h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', 'aria-hidden': true }, h('path', { d: 'M15 5l-7 7 7 7' }))),
            h('b', { className: 'mr-month', 'aria-live': 'polite' }, (wd[(keyDate(day).getDay() + 6) % 7] || '') + ', ' + fmtK(day)),
            h('button', { type: 'button', className: 'mr-arrow', disabled: day >= today, 'aria-label': t('at_next_day'), onClick: function () { dk[1](shiftK(day, 1)); } }, h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', 'aria-hidden': true }, h('path', { d: 'M9 5l7 7-7 7' }))))),
        h('div', { className: 'at-counts' }, ['ok', 'late', 'absent', 'excused', 'pending', 'nodata', 'off'].filter(function (s) { return cnt[s]; }).map(function (s) { return h('span', { key: s, className: cx('at-chip', 'a-' + s) }, t('at_cnt_' + s) + ': ' + cnt[s]); })),
        h('ul', { className: 'at-list' }, onDay.map(function (x) {
          var o = x.o;
          return h('li', { key: x.u.id, className: 'a-' + o.st },
            h(Av, { name: x.u.name, src: x.u.avatar, size: 34 }),
            h('span', { className: 'at-who' }, h('b', null, x.u.name), h('small', null, x.u.department + ' · ' + o.sc.start + '–' + o.sc.end)),
            h('span', { className: 'at-in' }, h('b', null, o.in != null ? m2hm(o.in) : '—'), h('small', null, t('at_in'))),
            h(AttChip, { t: t, o: o }),
            h('span', { className: 'at-out' }, h('b', null, o.out != null ? m2hm(o.out) : '—'), h('small', null, o.early ? tpl(t('at_early_n'), { n: o.early }) : t('at_out'))),
            h('span', { className: 'at-wk' }, o.worked != null ? fmtMin(o.worked, t) : ''),
            h('button', { type: 'button', className: 'at-ed-btn', 'aria-label': t('at_edit') + ' · ' + x.u.name, title: t('at_edit'), onClick: function () { edit(x.u, day); } }, h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4' }))));
        }))),
      h('section', { className: 'box at-month' },
        h('div', { className: 'chart-head' },
          h('div', null, h('h2', { className: 'lor-h' }, t('at_month_t')), h('p', { className: 'lor-sm lor-muted', style: { margin: '4px 0 0' } }, t('at_month_s'))),
          h(MonthSwitch, { t: t, lang: lang, ym: ym, min: minYm, max: ymOf(Date.now()), onChange: ms[1] })),
        h('div', { className: 'mx-wrap', tabIndex: 0, role: 'region', 'aria-label': t('at_month_t') }, h('table', { className: 'mx at-mx' },
          h('thead', null, h('tr', null, h('th', { className: 'mx-name', scope: 'col' }, t('th_emp')),
            days.map(function (d) { return h('th', { key: d.k, scope: 'col', className: cx(!d.work && 'is-off', d.k === today && 'is-today') }, h('span', null, d.d), h('small', null, wd[d.dow])); }),
            h('th', { className: 'mx-sum', scope: 'col' }, t('at_ontime_s')), h('th', { className: 'mx-sum', scope: 'col' }, t('at_lates_s')))),
          h('tbody', null, rows.map(function (r) {
            return h('tr', { key: r.u.id },
              h('th', { className: 'mx-name', scope: 'row' }, h('span', null, r.u.name)),
              r.c.days.map(function (o) {
                var tip = r.u.name + ' · ' + attTip(o, t), can = o.st !== 'future' && o.st !== 'before';
                return h('td', { key: o.k, className: cx('at-c', 'a-' + o.st, o.k === today && 'is-today') },
                  can ? h('button', { type: 'button', title: tip, 'aria-label': tip, onClick: function () { edit(r.u, o.k); } }, o.in != null && o.st !== 'excused' ? m2hm(o.in).replace(/^0/, '') : o.st === 'excused' ? t('at_rs_' + (o.reason || 'other')) : o.st === 'absent' ? '×' : '') : null);
              }),
              h('td', { className: cx('mx-sum num', r.c.onTimePct != null && r.c.onTimePct < 80 && 'warn-txt') }, r.c.onTimePct == null ? '—' : r.c.onTimePct + '%'),
              h('td', { className: cx('mx-sum num', r.c.late >= 3 && 'warn-txt') }, r.c.late));
          })))),
        h(AttLegend, { t: t })),
      h('section', { className: 'box' },
        h('h2', { className: 'lor-h' }, (function (x) { return x.charAt(0).toUpperCase() + x.slice(1); })(tpl(t('at_tbl_t'), { m: ymLabel(ym, lang, true) }))),
        h('div', { className: 'lor-table-wrap' }, h('table', { className: 'lor-table at-tbl' },
          h('thead', null, h('tr', null, [t('th_emp'), t('at_ontime'), t('at_lates'), t('at_avg_in'), t('at_avg_out_h'), t('at_hours'), t('at_absent'), t('at_excused')].map(function (x, i) { return h('th', { key: i }, x); }))),
          h('tbody', null, rows.filter(function (r) { return r.c.has; }).map(function (r) {
            var c = r.c, sc = schedOf(db, r.u);
            return h('tr', { key: r.u.id },
              h('td', null, h('div', { className: 'lor-emp' }, h(Av, { name: r.u.name, src: r.u.avatar, size: 32 }), h('span', null, r.u.name, h('small', null, r.u.department + ' · ' + sc.start)))),
              h('td', { className: 'num' }, h('b', { className: c.onTimePct != null && c.onTimePct < 80 ? 'warn-txt' : '' }, c.onTimePct == null ? '—' : c.onTimePct + '%'), h('div', { className: 'lor-sm lor-muted' }, c.onTime + '/' + c.present)),
              h('td', { className: 'num' }, h('b', { className: c.late >= 3 ? 'warn-txt' : '' }, c.late), c.late ? h('div', { className: 'lor-sm lor-muted' }, tpl(t('at_min_total'), { m: c.lateMin })) : null),
              h('td', { className: 'num' }, m2hm(c.avgIn)),
              h('td', { className: 'num' }, m2hm(c.avgOut), c.early ? h('div', { className: 'lor-sm lor-muted' }, tpl(t('at_early_days'), { n: c.early })) : null),
              h('td', { className: 'num' }, fmtH(c.worked, t)),
              h('td', { className: 'num' }, h('b', { className: c.absent >= 2 ? 'warn-txt' : '' }, c.absent), h('div', { className: 'lor-sm lor-muted' }, c.presPct == null ? '' : tpl(t('at_pres'), { p: c.presPct }))),
              h('td', { className: 'num' }, c.excused));
          }))))),
      h(AttHistory, p),
      ed[0] ? h(AttEdit, Object.assign({}, p, { key: ed[0].u.id + ed[0].k, u: ed[0].u, k: ed[0].k, onClose: function () { ed[1](null); } })) : null);
  }

  /* ======================= FEATURES 13: extra tasks (сверхзадачи) — set by the SOP manager for one employee, handed in, accepted ======================= */

  var XT_XP = 50;
  function xtasksOf(db, uid) { return (db.xtasks || []).filter(function (x) { return x.uid === uid && x.status !== 'cancel'; }); }
  function xtActive(x) { return x.status === 'open' || x.status === 'returned'; }
  function xtDueTs(x) { return x.due ? keyDate(x.due).getTime() + DAY - 1 : null; }
  function xtXp(db, uid) { return xtasksOf(db, uid).reduce(function (s, x) { return s + (x.status === 'done' ? (+x.xp || 0) : 0); }, 0); }
  function xtReview(db) { return (db.xtasks || []).filter(function (x) { return x.status === 'review'; }); }
  function xtNotif(n, t) { var x = n.xt || {}; return tpl(t('n_xt_' + (x.k || 'new')), { x: x.ttl || '', name: x.name || '' }) + (x.xp && (x.k === 'new' || x.k === 'ok') ? ' (+' + x.xp + ' XP)' : '') + (x.note ? ' — ' + x.note : ''); }
  function lvIndex(db, u) { return Math.min(u.level || 0, Math.max(0, levelsOf(db).length - 1)); }
  /* the level-scale cells this person's extra tasks add (only those set on the current level) */
  function xtConds(db, u, li) {
    return xtasksOf(db, u.id).filter(function (x) { return x.scale && x.li === li; }).map(function (x) {
      var fr = x.status === 'done' ? 1 : x.status === 'review' ? 0.5 : 0;
      return { key: 'xtask', id: x.id, c: { title: x.title }, x: x, cur: fr, max: 1, n: 1, frac: fr, ok: fr >= 1 };
    });
  }
  function xtStatusText(x, t) { return t('xt_st_' + x.status); }

  function XtChip(p) {
    var x = p.x, t = p.t, due = xtDueTs(x), d = due && xtActive(x) ? dueLabel(due, t) : null;
    return h('span', { className: 'xt-chips' },
      h('span', { className: cx('xt-st', 'x-' + x.status) }, xtStatusText(x, t)),
      d ? h('span', { className: cx('xt-due', d.cls) }, d.s) : x.due && x.status !== 'done' ? h('span', { className: 'xt-due' }, tpl(t('xt_due_to'), { d: fmtK(x.due) })) : null,
      +x.xp ? h('span', { className: 'xt-xp' }, '+' + x.xp + ' XP') : null,
      x.scale ? h('span', { className: 'xt-scale', title: t('xt_scale_hint') }, h(CondIco, { type: 'xtask', size: 12 }), t('xt_scale')) : null);
  }
  function XtFile(p) {
    var f = p.f; if (!f) return null;
    return h('a', { className: 'xt-file', href: f.data, download: f.name, target: '_blank', rel: 'noopener', onClick: saveLink(f.name) }, h(Ico, { name: 'clip', size: 14 }), f.name, h('small', null, fileSize(f.size || 0)));
  }

  /* accept / send back — the same block in the inbox and in the employee panel */
  function XtReview(p) {
    var t = p.t, x = p.x, note = useState(''), err = useState('');
    function decide(ok) {
      if (!ok && !note[0].trim()) { err[1](t('xt_back_need')); return; }
      var u = userOf(p.db, x.uid);
      p.update(function (d) {
        var y = (d.xtasks || []).filter(function (z) { return z.id === x.id; })[0]; if (!y) return;
        y.status = ok ? 'done' : 'returned'; y.review = { at: Date.now(), by: p.user.id, note: note[0].trim() || null }; if (ok) y.doneAt = Date.now();
        qNotify(d, x.uid, 'xt', { xt: { k: ok ? 'ok' : 'back', ttl: x.title, xp: ok ? +x.xp || 0 : 0, note: note[0].trim() || null } }, 'tasks');
      });
      p.say(ok ? tpl(t('xt_ok_said'), { name: firstName(u) }) : t('xt_back_said'));
    }
    return h('div', { className: 'xt-review' },
      h(Field, { name: 'xtn' + x.id, label: t('xt_review_note'), value: note[0], onChange: function (v) { note[1](v); err[1](''); }, placeholder: t('xt_review_ph'), error: err[0] }),
      h('div', { className: 'lor-req-act' },
        h(Btn, { variant: 'ghost', size: 'sm', onClick: function () { decide(false); } }, '↺ ' + t('xt_back')),
        h(Btn, { variant: 'secondary', size: 'sm', onClick: function () { decide(true); } }, '✓ ' + tpl(t('xt_accept'), { n: +x.xp || 0 }))));
  }
  function XtItem(p) {
    var t = p.t, x = p.x, db = p.db;
    return h('li', { className: cx('xt-item', 'x-' + x.status) },
      h('div', { className: 'xt-item-h' },
        h('span', { className: 'xt-ico', 'aria-hidden': true }, h(CondIco, { type: 'xtask', size: 16 })),
        h('div', { className: 'xt-item-t' }, h('b', null, x.title), h(XtChip, { t: t, x: x })),
        p.admin && x.status !== 'done' ? h('button', { type: 'button', className: 'app-link danger xt-del', onClick: function () { if (window.confirm(t('xt_cancel_q'))) { p.update(function (d) { (d.xtasks || []).forEach(function (z) { if (z.id === x.id) { z.status = 'cancel'; z.cancelAt = Date.now(); } }); }); p.say(t('xt_cancelled')); } } }, t('xt_cancel')) : null),
      x.desc ? h('p', { className: 'xt-desc' }, x.desc) : null,
      h('span', { className: 'lor-sm lor-muted' }, tpl(t('xt_set_by'), { who: userOf(db, x.by).name, d: fmtDate(x.at) })),
      x.sub ? h('div', { className: 'xt-sub' }, h('span', { className: 'lor-eyebrow' }, tpl(t('xt_sub_t'), { d: fmt(x.sub.at, t) })), x.sub.text ? h('p', null, x.sub.text) : null, h(XtFile, { f: x.sub.file })) : null,
      x.review && x.review.note && x.status !== 'review' ? h('div', { className: cx('xt-note', x.status === 'returned' && 'is-back') }, h('span', { className: 'lor-eyebrow' }, tpl(t(x.status === 'returned' ? 'xt_back_t' : 'xt_ok_t'), { who: userOf(db, x.review.by).name })), h('p', null, x.review.note)) : null,
      p.admin && x.status === 'review' ? h(XtReview, Object.assign({}, p, { x: x })) : null,
      p.children);
  }

  /* SOP manager: one employee's extra tasks + the form to add more (to this person and, optionally, to others) */
  function XtPanel(p) {
    var t = p.t, db = p.db, u = p.u, L = levelsOf(db), li = lvIndex(db, u), next = L[li + 1];
    var open = useState(!!p.startOpen), f = useState(function () { return { title: '', desc: '', due: '', xp: String(XT_XP), scale: !!next, who: [u.id] }; }), F2 = f[0], err = useState('');
    var list = xtasksOf(db, u.id).sort(function (a, b) { var r = { review: 0, returned: 1, open: 2, done: 3 }; return (r[a.status] - r[b.status]) || (b.at - a.at); });
    var emps = db.users.filter(function (x) { return x.role === 'employee'; });
    function set(k, v) { var c = Object.assign({}, F2); c[k] = v; f[1](c); }
    function save() {
      if (!F2.title.trim()) { err[1](t('xt_need_title')); return; }
      var title = F2.title.trim(), n = F2.who.length;
      p.update(function (d) {
        d.xtasks = d.xtasks || [];
        F2.who.forEach(function (uid) {
          var w = d.users.filter(function (x) { return x.id === uid; })[0]; if (!w) return;
          var wli = Math.min(w.level || 0, Math.max(0, (d.levels || []).length - 1)), hasNext = !!(d.levels || [])[wli + 1];
          var x = { id: 'xt' + nextId(d), uid: uid, title: title, desc: F2.desc.trim(), due: F2.due || null, xp: Math.max(0, Math.round(+F2.xp || 0)), scale: !!F2.scale && hasNext, li: wli, by: p.user.id, at: Date.now(), status: 'open' };
          d.xtasks.unshift(x);
          qNotify(d, uid, 'xt', { xt: { k: 'new', ttl: title, xp: x.xp } }, 'tasks');
        });
      });
      p.say(tpl(t('xt_added'), { n: n })); f[1]({ title: '', desc: '', due: '', xp: String(XT_XP), scale: !!next, who: [u.id] }); open[1](false); err[1]('');
    }
    return h('section', { className: 'box xt-panel', id: 'xt-' + u.id },
      h('div', { className: 'chart-head' },
        h('div', null, h('span', { className: 'lor-eyebrow' }, t('xt_eyebrow')), h('h2', { className: 'lor-h' }, tpl(t('xt_for'), { name: u.name }))),
        !open[0] ? h(Btn, { variant: 'primary', size: 'sm', onClick: function () { open[1](true); } }, '+ ' + t('xt_new')) : null),
      open[0] ? h('div', { className: 'xt-form' },
        h(Field, { name: 'xt-t' + u.id, label: t('xt_title'), required: true, value: F2.title, error: err[0], placeholder: t('xt_title_ph'), onChange: function (v) { set('title', v); err[1](''); } }),
        h(Field, { name: 'xt-d' + u.id, label: t('xt_desc'), multiline: true, rows: 3, value: F2.desc, placeholder: t('xt_desc_ph'), onChange: function (v) { set('desc', v); } }),
        h('div', { className: 'xt-form-row' },
          h(Field, { name: 'xt-due' + u.id, type: 'date', label: t('xt_due'), value: F2.due, onChange: function (v) { set('due', v); } }),
          h(Field, { name: 'xt-xp' + u.id, type: 'number', label: t('xt_xp'), value: F2.xp, onChange: function (v) { set('xp', v); } })),
        h('label', { className: cx('check xt-scale-check', !next && 'is-off') }, h('input', { type: 'checkbox', checked: !!F2.scale && !!next, disabled: !next, onChange: function (e) { set('scale', e.target.checked); } }),
          h('span', null, next ? tpl(t('xt_scale_q'), { x: lvlName(next, p.lang) }) : t('xt_scale_top'), h('small', null, t('xt_scale_sub')))),
        h('div', { className: 'xt-who' }, h('span', { className: 'lor-field-label' }, t('xt_who')),
          h('div', { className: 'xt-who-list' }, emps.map(function (e) {
            var on = F2.who.indexOf(e.id) >= 0;
            return h('button', { key: e.id, type: 'button', className: cx('xt-who-b', on && 'is-on'), 'aria-pressed': on, onClick: function () { set('who', on ? F2.who.filter(function (z) { return z !== e.id; }) : F2.who.concat([e.id])); } }, on ? '✓ ' : '+ ', e.name);
          }))),
        h('div', { className: 'box-row' },
          h(Btn, { variant: 'ghost', size: 'sm', onClick: function () { open[1](false); err[1](''); } }, t('cancel')),
          h(Btn, { variant: 'primary', size: 'sm', arrow: true, disabled: !F2.who.length, onClick: save }, F2.who.length > 1 ? tpl(t('xt_give_n'), { n: F2.who.length }) : t('xt_give')))) : null,
      list.length ? h('ul', { className: 'xt-list' }, list.map(function (x) { return h(XtItem, Object.assign({}, p, { key: x.id, x: x, admin: true })); }))
        : !open[0] ? h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('xt_none_admin')) : null);
  }

  /* inbox tab: everything handed in and waiting for the SOP manager */
  function XtInbox(p) {
    var t = p.t, db = p.db, list = xtReview(db).sort(function (a, b) { return ((a.sub || {}).at || 0) - ((b.sub || {}).at || 0); });
    var hist = (db.xtasks || []).filter(function (x) { return x.review && (x.status === 'done' || x.status === 'returned'); }).sort(function (a, b) { return b.review.at - a.review.at; }).slice(0, 8);
    return h(F, null,
      list.length ? h('ul', { className: 'lor-inbox-list' }, list.map(function (x) {
        var u = userOf(db, x.uid);
        return h('li', { key: x.id, className: 'lor-req-item inbox-item' },
          h(Av, { name: u.name, src: u.avatar }),
          h('div', { className: 'lor-req-main' },
            h('div', { className: 'lor-req-top' }, h('b', null, u.name), h('span', { className: 'lor-sm lor-muted' }, u.position)),
            h('ul', { className: 'xt-list' }, h(XtItem, Object.assign({}, p, { x: x, admin: true })))));
      })) : h('p', { className: 'empty' }, t('xt_inbox_empty')),
      hist.length ? h('section', { className: 'box' }, h('span', { className: 'lor-eyebrow' }, t('history')),
        h('ul', { className: 'hist' }, hist.map(function (x) { return h('li', { key: x.id }, h('b', null, userOf(db, x.uid).name), h('span', { className: 'lor-muted' }, x.title + ' · ' + fmt(x.review.at, t)), h('span', null, x.status === 'done' ? '✓ ' + t('xt_st_done') + (x.xp ? ' · +' + x.xp + ' XP' : '') : '↺ ' + t('xt_st_returned'))); }))) : null);
  }

  /* employee: the card with the hand-in form */
  function XtCard(p) {
    var t = p.t, x = p.x, u = p.user, open = useState(false), txt = useState(''), file = useState(null), err = useState(''), inp = useRef(null);
    function pick(fl) {
      err[1](''); if (!fl) return;
      if (fl.size > 2 * 1048576) { err[1](t('xt_file_big')); return; }
      var rd = new FileReader(); rd.onload = function () { file[1]({ name: fl.name, size: fl.size, type: fl.type, data: rd.result }); }; rd.readAsDataURL(fl);
    }
    function send() {
      if (!txt[0].trim() && !file[0]) { err[1](t('xt_sub_need')); return; }
      p.update(function (d) {
        var y = (d.xtasks || []).filter(function (z) { return z.id === x.id; })[0]; if (!y) return;
        y.status = 'review'; y.sub = { at: Date.now(), text: txt[0].trim() || null, file: file[0] || null };
        d.users.filter(function (a) { return a.role === 'admin'; }).forEach(function (a) { qNotify(d, a.id, 'xt', { xt: { k: 'sub', ttl: x.title, name: u.name } }, 'inbox'); d.notifications[0].tab = 'xt'; });
      });
      p.say(t('xt_sent')); open[1](false); txt[1](''); file[1](null);
    }
    return h('ul', { className: 'xt-list' }, h(XtItem, Object.assign({}, p, { x: x, admin: false }),
      xtActive(x) ? (open[0] ? h('div', { className: 'xt-hand' },
        h(Field, { name: 'xts' + x.id, multiline: true, rows: 3, label: t('xt_sub_text'), value: txt[0], placeholder: t('xt_sub_ph'), onChange: function (v) { txt[1](v); err[1](''); } }),
        h('div', { className: 'xt-hand-file' },
          h('input', { ref: inp, type: 'file', className: 'sr-only', onChange: function (e) { pick(e.target.files[0]); e.target.value = ''; } }),
          file[0] ? h('span', { className: 'xt-file' }, h(Ico, { name: 'clip', size: 14 }), file[0].name, h('small', null, fileSize(file[0].size)), h('button', { type: 'button', className: 'lor-modal-x xt-file-x', 'aria-label': t('remove'), onClick: function () { file[1](null); } }, '×'))
            : h('button', { type: 'button', className: 'app-link', onClick: function () { inp.current && inp.current.click(); } }, '📎 ' + t('xt_attach'))),
        err[0] ? h('span', { className: 'lor-field-error' }, err[0]) : null,
        h('div', { className: 'box-row' }, h(Btn, { variant: 'ghost', size: 'sm', onClick: function () { open[1](false); } }, t('cancel')), h(Btn, { variant: 'primary', size: 'sm', arrow: true, onClick: send }, t('xt_send'))))
        : h('div', { className: 'box-row xt-act' }, h('span', { className: 'lor-sm lor-muted' }, x.status === 'returned' ? t('xt_fix_hint') : t('xt_do_hint')), h(Btn, { variant: 'primary', size: 'sm', arrow: true, onClick: function () { open[1](true); } }, x.status === 'returned' ? t('xt_resend') : t('xt_hand_in'))))
        : x.status === 'review' ? h('p', { className: 'lor-sm xt-wait' }, '◔ ' + t('xt_wait')) : null));
  }
  function XtSection(p) {
    var t = p.t, list = xtasksOf(p.db, p.user.id), act = list.filter(function (x) { return x.status !== 'done'; }).sort(function (a, b) { return (xtDueTs(a) || 9e15) - (xtDueTs(b) || 9e15); }), done = list.filter(function (x) { return x.status === 'done'; });
    if (!list.length) return null;
    return h('section', { className: 'tk-sec xt-sec' },
      h('span', { className: 'lor-eyebrow' }, t('xt_my_t') + (act.length ? ' · ' + act.length : '')),
      h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('xt_my_s')),
      act.map(function (x) { return h('div', { key: x.id, className: 'box xt-box' }, h(XtCard, Object.assign({}, p, { x: x }))); }),
      done.length ? h('details', { className: 'box tk-done' }, h('summary', null, t('xt_done_t') + ' · ' + done.length + ' · +' + done.reduce(function (s, x) { return s + (+x.xp || 0); }, 0) + ' XP'),
        h('div', { className: 'tk-done-b' }, done.map(function (x) { return h(XtCard, Object.assign({}, p, { key: x.id, x: x })); }))) : null);
  }


  /* ---------------- small UI pieces ---------------- */
  function Field(p) {
    var id = 'f-' + p.name;
    var common = { id: id, name: p.name, className: cx('lor-input', p.error && 'is-error'), value: p.value == null ? '' : p.value, placeholder: p.placeholder, type: p.type, autoComplete: p.autoComplete || 'off', 'aria-invalid': !!p.error, onChange: function (e) { p.onChange(e.target.value); } };
    var control = p.multiline ? h('textarea', Object.assign({}, common, { type: undefined, rows: p.rows || 3 })) : p.options ? h('select', Object.assign({}, common, { type: undefined }), p.options.map(function (o) { var v = Array.isArray(o) ? o : [o, o]; return h('option', { key: v[0], value: v[0] }, v[1]); })) : h('input', common);
    return h('div', { className: cx('lor-field', p.span && 'lor-span', p.className) },
      p.label ? h('label', { className: 'lor-field-label', htmlFor: id }, p.label, p.required ? h('span', { className: 'lor-req', 'aria-hidden': true }, '*') : null) : null,
      control, p.error ? h('span', { className: 'lor-field-error' }, p.error) : p.hint ? h('span', { className: 'lor-field-hint' }, p.hint) : null);
  }
  function Av(p) {
    var st = p.size ? { width: p.size, height: p.size, fontSize: p.size < 36 ? 12 : 13 } : null;
    return p.src ? h('img', { className: 'lor-req-av av-img', src: p.src, alt: '', style: st }) : h('span', { className: 'lor-req-av', style: st }, initials(p.name));
  }

  /* ---------------- profile: photo, name, login; the password — the SOP manager only ---------------- */
  var AVATAR_MAX = 16000;   /* the server keeps a photo of up to this many characters in the data (tools/lms-gs/Server.gs) */
  var STAFF_POS = ['Omborchi', 'Mijozlar menejeri', 'Logistika menejeri', 'Bojxona deklaranti', 'Ombor mudiri'];
  var STAFF_DEP = ['Logistika bo‘limi', 'Bojxona bo‘limi', 'Savdo bo‘limi', 'Ombor (Yiwu)', 'Ombor (Zhongshan)'];
  var LOGIN_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
  function withCur(list, v) { return v && list.indexOf(v) < 0 ? [v].concat(list) : list; }
  /* a photo file → a square 128×128 JPEG (data: URL) small enough for the data */
  function pickAvatar(file, ok, fail) {
    if (!file || !/^image\//.test(file.type)) { fail(); return; }
    var fr = new FileReader();
    fr.onerror = fail;
    fr.onload = function () {
      var img = new Image();
      img.onerror = fail;
      img.onload = function () {
        var S = 128, c = document.createElement('canvas'), g = c.getContext('2d'), m = Math.min(img.width, img.height);
        c.width = c.height = S;
        g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S);
        g.drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, S, S);
        var q = 0.86, url = c.toDataURL('image/jpeg', q);
        while (url.length > AVATAR_MAX && q > 0.4) { q -= 0.12; url = c.toDataURL('image/jpeg', q); }
        if (url.length > AVATAR_MAX) fail(); else ok(url);
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  }
  function PhotoPicker(p) {
    var t = p.t, er = useState(false);
    function pick(e) { var f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return; er[1](false); pickAvatar(f, function (u) { p.onChange(u); }, function () { er[1](true); }); }
    return h('div', { className: 'pf-photo' },
      h(Av, { name: p.name, src: p.value, size: 88 }),
      h('div', { className: 'pf-photo-act' },
        h('input', { id: p.id, type: 'file', accept: 'image/jpeg,image/png,image/webp', className: 'sr-only', onChange: pick }),
        h('label', { className: 'lor-btn lor-btn-outline lor-btn-sm', htmlFor: p.id }, t('pf_photo_up')),
        p.value ? h('button', { type: 'button', className: 'app-link danger', onClick: function () { p.onChange(null); } }, t('pf_photo_del')) : null,
        er[0] ? h('span', { className: 'lor-field-error' }, t('pf_photo_bad')) : h('span', { className: 'lor-sm lor-muted' }, t('pf_photo_hint'))));
  }
  function Modal(p) {
    useEffect(function () { function k(e) { if (e.key === 'Escape') p.onClose(); } window.addEventListener('keydown', k); return function () { window.removeEventListener('keydown', k); }; }, []);
    return h('div', { className: 'lor-scrim', onMouseDown: function (e) { if (e.target === e.currentTarget) p.onClose(); } },
      h('div', { className: cx('lor-modal pf-modal', p.className), role: 'dialog', 'aria-modal': true, 'aria-labelledby': p.hid },
        h('button', { type: 'button', className: 'lor-modal-x', 'aria-label': p.t('close'), onClick: p.onClose }, '×'),
        p.children));
  }
  /* «Mening profilim»: everyone — photo, name, login (with the current password); the SOP manager also the own password */
  function ProfileModal(p) {
    var t = p.t, u = p.user, admin = u.role === 'admin';
    var nm = useState(u.name || ''), av = useState(u.avatar || null), ne = useState('');
    var lg = useState(u.login || ''), cur = useState(''), p1 = useState(''), p2 = useState(''), ae = useState({}), busy = useState(false);
    function savePersonal() {
      var n = nm[0].trim();
      if (n.length < 2 || n.length > 60) { ne[1](t('pf_name_bad')); return; }
      ne[1]('');
      p.update(function (d) { d.users.forEach(function (x) { if (x.id === u.id) { x.name = n; if (av[0]) x.avatar = av[0]; else delete x.avatar; } }); });
      p.say(t('pf_saved'));
    }
    function saveAccount() {
      var l = lg[0].trim().toLowerCase(), e = {}, body = { old: cur[0] };
      if (l !== (u.login || '')) { if (!LOGIN_RE.test(l)) e.login = t('pf_login_bad'); else body.login = l; }
      if (admin && (p1[0] || p2[0])) { if (p1[0].length < 8) e.p1 = t('pf_pw_short'); else if (p1[0] !== p2[0]) e.p2 = t('pf_pw_mismatch'); else body.password = p1[0]; }
      if (!e.login && !e.p1 && !e.p2 && !body.login && !body.password) e.cur = t('pf_nothing');
      else if (!cur[0]) e.cur = t('fill_required');
      ae[1](e); if (Object.keys(e).length) return;
      busy[1](true);
      SV.account(body).then(function () {
        busy[1](false); cur[1](''); p1[1](''); p2[1](''); p.say(t('pf_acc_saved')); SV.sync().catch(function () {});
      }, function (x) {
        busy[1](false);
        var m = { login: ['cur', 'pf_cur_bad'], taken: ['login', 'login_taken'], login_format: ['login', 'pf_login_bad'], weak: ['p1', 'pf_pw_short'], forbidden: ['p1', 'pf_pw_admin'] }[x.code] || ['cur', x.code === 'net' ? 'srv_net' : 'srv_script'];
        var o = {}; o[m[0]] = t(m[1]); ae[1](o);
      });
    }
    return h(Modal, { t: t, hid: 'pf-h', onClose: p.onClose },
      h('span', { className: 'lor-eyebrow' }, t('app_full')),
      h('h2', { className: 'lor-h', id: 'pf-h' }, t('nav_profile')),
      h('section', { className: 'pf-sec' },
        h(PhotoPicker, { t: t, id: 'pf-photo', name: nm[0] || u.name, value: av[0], onChange: av[1] }),
        h(Field, { name: 'pf-name', label: t('pf_name'), required: true, value: nm[0], error: ne[0], onChange: nm[1], autoComplete: 'name' }),
        u.role === 'employee' ? h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, [u.position, u.department].filter(Boolean).join(' · ') + ' — ' + t('pf_pos_hint')) : null,
        h('div', { className: 'lor-modal-actions' }, h(Btn, { variant: 'primary', size: 'sm', onClick: savePersonal }, t('save')))),
      h('section', { className: 'pf-sec' },
        h('h3', { className: 'lor-h pf-sub' }, t('pf_acc_t')),
        h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t(admin ? 'pf_acc_hint_admin' : 'pf_acc_hint')),
        h('div', { className: 'lor-form-grid' },
          h(Field, { name: 'pf-login', label: t('login'), value: lg[0], error: ae[0].login, onChange: lg[1], autoComplete: 'username' }),
          admin ? h(Field, { name: 'pf-pw1', label: t('pf_pw_new'), type: 'password', value: p1[0], error: ae[0].p1, onChange: p1[1], autoComplete: 'new-password' }) : null,
          admin ? h(Field, { name: 'pf-pw2', label: t('pf_pw_rep'), type: 'password', value: p2[0], error: ae[0].p2, onChange: p2[1], autoComplete: 'new-password' }) : null,
          h(Field, { name: 'pf-cur', label: t('pf_pw_cur'), type: 'password', value: cur[0], error: ae[0].cur, onChange: cur[1], autoComplete: 'current-password' })),
        h('div', { className: 'lor-modal-actions' }, h(Btn, { variant: 'secondary', size: 'sm', disabled: busy[0], onClick: saveAccount }, t('pf_acc_save')))),
      h(TgBox, { t: t, user: u }));
  }
  /* Telegram: a link to the bot; after «Start» there the card gets tg: true (the server) */
  function TgBox(p) {
    var t = p.t, u = p.user, ls = useState(null), link = ls[0], er = useState(''), busy = useState(false);
    useEffect(function () { if (!link || u.tg) return; var id = setInterval(function () { SV.sync().catch(function () {}); }, 4000); return function () { clearInterval(id); }; }, [link, u.tg]);
    function connect() {
      busy[1](true); er[1]('');
      SV.tgLink().then(function (x) { busy[1](false); ls[1](x.url); window.open(x.url, '_blank', 'noopener'); },
        function (e) { busy[1](false); er[1](t(e.code === 'net' ? 'srv_net' : 'tg_off')); });
    }
    function unlink() { busy[1](true); SV.tgUnlink().then(function () { busy[1](false); ls[1](null); SV.sync().catch(function () {}); }, function (e) { busy[1](false); er[1](t(e.code === 'net' ? 'srv_net' : 'tg_off')); }); }
    return h('section', { className: 'pf-sec' },
      h('h3', { className: 'lor-h pf-sub' }, t('tg_t')),
      h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('tg_hint')),
      u.tg ? h('div', { className: 'pf-tg' }, h('span', { className: 'made' }, t('tg_on')), h(Btn, { variant: 'ghost', size: 'sm', disabled: busy[0], onClick: unlink }, t('tg_unlink')))
        : h('div', { className: 'pf-tg' },
          h(Btn, { variant: 'secondary', size: 'sm', disabled: busy[0], onClick: connect }, t('tg_link')),
          link ? h('a', { className: 'app-link', href: link, target: '_blank', rel: 'noopener' }, t('tg_open')) : null),
      link && !u.tg ? h('p', { className: 'lor-sm', style: { margin: 0 } }, t('tg_wait')) : null,
      er[0] ? h('p', { className: 'lor-field-error', style: { margin: 0 } }, er[0]) : null);
  }
  /* the SOP manager edits someone's card: name, login, photo, position and department, a new password */
  function UserEditModal(p) {
    var t = p.t, u = p.u, emp = u.role === 'employee';
    var f = useState({ name: u.name || '', login: u.login || '', position: u.position || '', department: u.department || '', avatar: u.avatar || null, password: '' }), v = f[0], er = useState({});
    function set(k, x) { var o = Object.assign({}, f[0]); o[k] = x; f[1](o); }
    function save() {
      var e = {}, l = v.login.trim().toLowerCase(), n = v.name.trim();
      if (n.length < 2 || n.length > 60) e.name = t('pf_name_bad');
      if (!LOGIN_RE.test(l)) e.login = t('pf_login_bad');
      else if (p.db.users.some(function (x) { return x.id !== u.id && String(x.login || '').toLowerCase() === l; })) e.login = t('login_taken');
      if (v.password && v.password.length < 8) e.password = t('pf_pw_short');
      er[1](e); if (Object.keys(e).length) return;
      p.update(function (d) { d.users.forEach(function (x) {
        if (x.id !== u.id) return;
        x.name = n; x.login = l;
        if (v.avatar) x.avatar = v.avatar; else delete x.avatar;
        if (emp) { x.position = v.position; x.department = v.department; }
        if (v.password) x.password = v.password;   // the server moves it into the account and drops it from the data
      }); });
      p.say(v.password ? tpl(t('ue_saved_pw'), { pw: v.password }) : t('saved'));
      p.onClose();
    }
    return h(Modal, { t: t, hid: 'ue-h', onClose: p.onClose },
      h('span', { className: 'lor-eyebrow' }, t('ue_eyebrow')),
      h('h2', { className: 'lor-h', id: 'ue-h' }, u.name),
      h(PhotoPicker, { t: t, id: 'ue-photo', name: v.name || u.name, value: v.avatar, onChange: function (x) { set('avatar', x); } }),
      h('div', { className: 'lor-form-grid' },
        h(Field, { name: 'ue-name', label: t('pf_name'), required: true, value: v.name, error: er[0].name, onChange: function (x) { set('name', x); } }),
        h(Field, { name: 'ue-login', label: t('login'), required: true, value: v.login, error: er[0].login, onChange: function (x) { set('login', x); } }),
        emp ? h(Field, { name: 'ue-pos', label: t('position'), value: v.position, options: withCur(STAFF_POS, u.position), onChange: function (x) { set('position', x); } }) : null,
        emp ? h(Field, { name: 'ue-dep', label: t('department'), value: v.department, options: withCur(STAFF_DEP, u.department), onChange: function (x) { set('department', x); } }) : null,
        h(Field, { name: 'ue-pw', label: t('ue_pw'), value: v.password, error: er[0].password, hint: t('ue_pw_hint'), onChange: function (x) { set('password', x); } })),
      h('div', { className: 'lor-modal-actions' },
        h(Btn, { variant: 'ghost', onClick: p.onClose }, t('cancel')),
        h(Btn, { variant: 'primary', arrow: true, onClick: save }, t('save'))));
  }
  function Burger() { return h('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', 'aria-hidden': true }, h('path', { d: 'M4 7h16M4 12h16M4 17h16' })); }

  function Toast(p) {
    if (!p.toast) return null;
    return h('div', { className: 'toast-host', role: 'status', 'aria-live': 'polite' }, h('div', { className: 'lor-toast' }, h('span', { className: 'lor-toast-dot' }), h('div', { className: 'lor-toast-body' }, p.toast.msg)));
  }

  function Foot(p) {
    var t = p.t;
    useEffect(function () { if (GS && p.admin) loadServerCode(); }, []);
    return h('footer', { className: 'app-foot' },
      h('span', null, t('srv_note'), p.admin && SV.build ? ' · v' + SV.SERVER_V + ' · ' + SV.build : '', p.onTerms ? ' · ' : null, p.onTerms ? h('button', { type: 'button', className: 'app-link', onClick: p.onTerms }, t('terms_link')) : null),
      GS && p.admin ? h('button', { type: 'button', className: 'app-link', onClick: function () { copyServerCode(p.say, t); } }, t('srv_code')) : null);
  }

  /* ---------------- header ---------------- */
  function Header(p) {
    var t = p.t, u = p.user, o = useState(false), open = o[0], setOpen = o[1];
    var mine = (p.notifs || []), unread = mine.filter(function (n) { return !n.read; }).length;
    var ref = useRef(null);
    useEffect(function () { if (!open) return; function off(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); } document.addEventListener('mousedown', off); return function () { document.removeEventListener('mousedown', off); }; }, [open]);
    function navLinks(cls) { return p.nav ? h('nav', { className: cls, 'aria-label': 'Menu' }, p.nav.map(function (n) { return h('a', { key: n.key, href: '#' + n.key, className: n.active ? 'is-on' : '', 'aria-current': n.active ? 'page' : null, onClick: function (e) { e.preventDefault(); n.onClick(); } }, n.label, n.count ? h('span', { className: 'app-navcount' }, n.count) : null); })) : null; }
    return h('header', { className: cx('lor-header app-header', p.wide && 'is-wide') },
      h('div', { className: 'lor-header-in' },
        p.onMenu ? h('button', { type: 'button', className: 'app-menu-btn', onClick: p.onMenu, 'aria-label': t('contents') }, h(Burger)) : null,
        h('img', { className: 'lor-header-logo', src: LOGO_W, alt: 'BURAQ logistics', width: 87, height: 30 }),
        h('span', { className: 'lor-header-app' }, t('app')),
        navLinks('lor-header-nav'),
        h('span', { className: 'lor-header-sp' }),
        p.extra || null,
        p.onSearch ? h('button', { type: 'button', className: 'search-btn', 'aria-label': t('gs_title'), title: t('gs_title') + ' · Ctrl+K', onClick: p.onSearch }, h(Ico, { name: 'search', size: 17 })) : null,
        p.onHelp ? h('button', { type: 'button', className: 'help-btn', 'aria-label': t('nav_help'), title: t('nav_help'), onClick: p.onHelp }, '?') : null,
        h(LOR.LangSwitch, { value: p.lang, onChange: p.setLang, inverse: true }),
        p.notifs ? h('div', { className: 'bell-wrap', ref: ref },
          h('button', { type: 'button', className: 'lor-bell', 'aria-label': t('notifications'), 'aria-expanded': open, onClick: function () { setOpen(!open); } }, h(Icon, { name: 'bell' }), unread ? h('span', { className: 'lor-bell-n' }, unread) : null),
          open ? h('div', { className: 'notif-pop' },
            h('div', { className: 'notif-pop-h' }, h('b', null, t('notifications')), unread ? h('button', { type: 'button', className: 'app-link', onClick: p.onReadAll }, t('mark_read')) : null),
            mine.length ? h('ul', { className: 'notif-list' }, mine.slice(0, 12).map(function (n) {
              return h('li', { key: n.id }, h('button', { type: 'button', className: cx('notif-item', !n.read && 'is-new'), onClick: function () { setOpen(false); p.onNotif(n); } },
                h('span', { className: 'notif-dot' }), h('span', null, p.fmtNotif ? p.fmtNotif(n) : n.text, h('small', null, fmt(n.at, t)))));
            })) : h('p', { className: 'notif-empty' }, t('no_notif'))) : null) : null,
        h(UserMenu, { t: t, lang: p.lang, user: u, rank: p.rank, isNew: p.medalNew, onSeen: p.onMedalSeen, hint: p.hint, theme: p.theme, subtitle: p.subtitle || (u.role === 'admin' ? u.position : t('s_' + u.status)), onPath: p.onPath, links: p.links, onTerms: p.onTerms, onLogout: p.onLogout, onProfile: p.onProfile })),
      navLinks('app-subnav'));
  }

  /* ---------------- login ---------------- */
  /* server error codes → strings */
  var SRV_ERR = { login: 'bad_login', locked: 'srv_locked', busy: 'srv_busy', net: 'srv_net', html: 'srv_html', setup: 'srv_setup' };
  /* login intro: a line-drawn container truck drives the route <city> → Toshkent (brand: thin white lines on navy).
     The container side is Uzbek atlas (ikat) with the BURAQ logo on a navy plate, the cab door has a red girih star.
     Plays once on load; with reduced motion the page shows the final frame. */
  var INTRO_FROM = ['YIWU', 'ZHONGSHAN', 'ISTANBUL', 'MOSKVA'];
  /* every visit — another city than the last one */
  function introFrom() {
    var last = null; try { last = localStorage.getItem('lor-intro-from'); } catch (e) {}
    var list = INTRO_FROM.filter(function (x) { return x !== last; }), x = list[Math.floor(Math.random() * list.length)];
    try { localStorage.setItem('lor-intro-from', x); } catch (e) {}
    return x;
  }
  function star8(cx, cy, R) {
    var d = '';
    for (var k = 0; k < 16; k++) { var a = Math.PI * k / 8 - Math.PI / 2, r = k % 2 ? R * .7654 : R; d += (k ? 'L' : 'M') + (cx + r * Math.cos(a)).toFixed(2) + ' ' + (cy + r * Math.sin(a)).toFixed(2); }
    return d + 'Z';
  }
  /* the container side in atlas (Margilan ikat) — in the brand colours: white ground, red, blue and navy «flames»
     (zigzag bands with ragged thread edges — the filter ir-ikat), straight thin stripes; a 50-unit repeat over 200×55 */
  var ATLAS = (function () {
    function tri(x) { x -= Math.floor(x); return x < .5 ? 4 * x - 1 : 3 - 4 * x; }
    function rnd(i) { var s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
    function flame(cx, w, A, per, ph, sk, seed) {
      var R = [], L = [];
      for (var y = 0, i = 0; y <= 55.01; y += 1.2, i++) {
        var t = y / per + ph, ww = Math.max(.4, w + A * tri(t)), c = cx + sk * tri(t + .25);
        R.push((c + ww + (rnd(seed + i) - .5) * 1.6).toFixed(2) + ' ' + y.toFixed(1));
        L.unshift((c - ww + (rnd(seed + i + 50) - .5) * 1.6).toFixed(2) + ' ' + y.toFixed(1));
      }
      return 'M' + R.join('L') + 'L' + L.join('L') + 'Z';
    }
    var unit = [[9, 6, 4, 26, 0, 1.2, 'r'], [29, 6, 4.5, 22, .3, 1.6, 'b'], [29, 1.8, 1.8, 22, .3, 0, 'w'], [40, 3, 3, 30, .6, 1, 'n']];
    var lines = [[18.2, .7, 'r'], [19.8, .7, 'b'], [45.8, .6, 'r'], [47.4, .6, 'r']], out = { flames: [], lines: [] };
    for (var k = 0; k < 4; k++) {
      unit.forEach(function (u, j) { out.flames.push({ d: flame(u[0] + 50 * k, u[1], u[2], u[3], u[4] + k * .37, u[5], (k * 4 + j) * 97), c: u[6] }); });
      lines.forEach(function (l) { out.lines.push({ x: l[0] + 50 * k, w: l[1], c: l[2] }); });
    }
    return out;
  })();
  function IntroRoad(p) {
    var ring = function (cx, cy, r) { return 'M' + (cx - r) + ' ' + cy + 'a' + r + ' ' + r + ' 0 1 0 ' + 2 * r + ' 0a' + r + ' ' + r + ' 0 1 0 ' + -2 * r + ' 0'; };
    var wheel = function (cx) { return ring(cx, 96, 9) + ring(cx, 96, 5.2) + ring(cx, 96, 1.6); };
    var ln = function (d, c) { return h('path', { d: d, pathLength: 1, className: c }); };
    return h('div', { className: 'intro-road', 'aria-hidden': true },
      h('span', { className: 'ir-line' }),
      h('span', { className: 'ir-pt is-from' }, h('i'), p.from),
      h('span', { className: 'ir-pt is-to' }, h('i'), 'TOSHKENT'),
      h('div', { className: 'ir-truck' },
        h('span', { className: 'ir-trail' }),
        h('svg', { viewBox: '-60 0 332 106', width: 330, height: 105 },
          h('defs', null,
            h('filter', { id: 'ir-ikat', x: '-5%', y: 0, width: '110%', height: '100%' },
              h('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.03 0.7', numOctaves: 2, seed: 3, result: 'n' }),
              h('feColorMatrix', { 'in': 'n', type: 'matrix', values: '1 0 0 0 0  0 0 0 0 .5  0 0 0 0 0  0 0 0 0 1', result: 'm' }),
              h('feDisplacementMap', { 'in': 'SourceGraphic', in2: 'm', scale: 3, xChannelSelector: 'R', yChannelSelector: 'G' })),
            h('clipPath', { id: 'ir-side' }, h('rect', { width: 200, height: 55 }))),
          h('g', { className: 'ir-wind' }, ln('M-40 34H-12M-56 52H-20M-34 68H-10')),
          h('g', { className: 'ir-body' },
            /* container: the atlas side, the logo on a navy plate (clear field around it), frame, rails, corner castings */
            h('g', { className: 'ir-atlas', transform: 'translate(6 19)', clipPath: 'url(#ir-side)' },
              h('rect', { className: 'a-w', width: 200, height: 55 }),
              h('g', { filter: 'url(#ir-ikat)' }, ATLAS.flames.map(function (f, i) { return h('path', { key: i, d: f.d, className: 'a-' + f.c }); })),
              ATLAS.lines.map(function (l, i) { return h('rect', { key: i, x: l.x, width: l.w, height: 55, className: 'a-' + l.c }); }),
              h('rect', { className: 'a-n', x: 63, y: 11, width: 74, height: 33 })),
            ln('M6 14H206V80H6Z'), ln('M6 19H206M6 74H206'), ln('M6 14h5v4h-5zM201 14h5v4h-5zM6 76h5v4h-5zM201 76h5v4h-5z'),
            h('image', { href: LOGO_W, x: 76, y: 36.2, width: 60, height: 20.65 }),
            /* semi-trailer: frame and landing gear */
            ln('M8 80V86H204V80M150 86V95M146 95H154'),
            /* cab-over tractor: cab, roof deflector, window, door, mirror, lights, fender, fuel tank, rosette */
            ln('M204 84H235M261 84H267'),
            ln('M214 80V26Q214 18 222 18H254Q262 18 263 26L265 80Z'), ln('M217 18L222 11H250Q254 11 255 14L257 18'),
            ln('M239 25H255Q258.5 25 259 28.5L260 46H235Z'), ln('M232 24V78M237 52H242M263 30H268V44H265M260 70H265M265 74H268V86H261'),
            ln('M234 92A14.6 14.6 0 0 1 262 92'), ln('M211 86H229Q231 86 231 88V92Q231 94 229 94H211Q209 94 209 92V88Q209 86 211 86Z'),
            ln(star8(247, 61, 6) + ring(247, 61, 2.2), 'ir-red')),
          ln([28, 48, 68, 174, 196, 248].map(wheel).join('')))));
  }
  /* «Kun hikmati» on the login page: Uzbek proverbs and a BURAQ slogan (strings.js wz_1…; under the Uzbek original —
     its meaning in ru/en/zh) + the SOP manager's own sayings (Kontent → settings.wisdom; the server gives them before
     sign-in, action wisdom). One a day, the arrow shows the next. */
  var WZ_N = 13, WZ_MAQOL = 12;
  function wzStd(t, lang) {
    var uz = T('uz'), out = [];
    for (var i = 1; i <= WZ_N; i++) out.push({ text: uz('wz_' + i), tr: lang !== 'uz' ? t('wz_' + i) : '', by: t(i <= WZ_MAQOL ? 'wz_src_maqol' : 'wz_src_buraq') });
    return out;
  }
  function Wisdom(p) {
    var t = p.t, srv = useState(null), off = useState(0);
    useEffect(function () { var live = true; (SV ? SV.wisdom() : Promise.resolve({ std: true, list: [] })).then(function (x) { if (live) srv[1](x); }, function () { if (live) srv[1]({ std: true, list: [] }); }); return function () { live = false; }; }, []);
    if (!srv[0]) return h('div', { className: 'wz is-wait', 'aria-hidden': true });
    var list = (srv[0].std !== false ? wzStd(t, p.lang) : []).concat((srv[0].list || []).map(function (x) { return { text: x.text, by: x.by }; }));
    if (!list.length) return h('div', { className: 'wz is-none', 'aria-hidden': true });
    var day = Math.floor((Date.now() - new Date().getTimezoneOffset() * 6e4) / 864e5), i = (day + off[0]) % list.length, q = list[i];
    /* the words come in one by one: on the first show after the intro, on «next» at once */
    var d0 = off[0] ? 0 : 2400, words = q.text.split(/\s+/);
    return h('figure', { className: 'wz' },
      h('span', { className: 'wz-mark', 'aria-hidden': true }, '“'),
      h('div', { className: 'wz-head' }, h('span', { className: 'lor-eyebrow' }, t('wz_title')),
        list.length > 1 ? h('span', { className: 'wz-nav' },
          h('span', { className: 'wz-n' }, (i + 1) + ' / ' + list.length),
          h('button', { type: 'button', className: 'wz-next', 'aria-label': t('wz_next'), title: t('wz_next'), onClick: function () { off[1](off[0] + 1); } }, h(Arrow, { length: 20 }))) : null),
      h('div', { key: i, className: 'wz-body' },
        h('blockquote', { lang: 'uz' }, words.map(function (w, k) {
          return h(F, { key: k }, k ? ' ' : null, h('span', { className: 'wz-w', style: { animationDelay: (d0 + k * 55) + 'ms' } }, w));
        })),
        q.tr ? h('p', { className: 'wz-tr', style: { animationDelay: (d0 + words.length * 55 + 120) + 'ms' } }, q.tr) : null,
        q.by ? h('figcaption', { style: { animationDelay: (d0 + words.length * 55 + 220) + 'ms' } }, q.by) : null));
  }
  /* greeting by the time of day on this device */
  function Hello(p) {
    var hr = new Date().getHours(), k = hr >= 5 && hr < 12 ? 'morning' : hr >= 12 && hr < 18 ? 'day' : 'evening', sun = k !== 'evening';
    return h('p', { className: 'hello is-' + k },
      h('svg', { width: 22, height: 22, viewBox: '0 0 24 24', 'aria-hidden': true, className: 'hello-ico' },
        sun ? h('g', null, h('circle', { cx: 12, cy: 12, r: 4.2 }), h('path', { className: 'hello-rays', d: 'M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8' }))
          : h('path', { d: 'M19.5 14.6A8 8 0 0 1 9.4 4.5a8 8 0 1 0 10.1 10.1z' })),
      p.t('hi_' + k));
  }
  /* Kontent → «Kun hikmati»: own sayings for the login page and the standard proverbs switch (settings.wisdom) */
  function WisdomAdmin(p) {
    var t = p.t, w = (p.db.settings && p.db.settings.wisdom) || {}, list = w.list || [];
    var f = useState({ text: '', by: '' }), v = f[0], er = useState('');
    function save(fn) { p.update(function (d) { d.settings = d.settings || {}; var x = Object.assign({ std: true }, d.settings.wisdom || {}); x.list = (x.list || []).slice(); fn(x); d.settings.wisdom = x; }); }
    function add() {
      var text = v.text.trim().replace(/\s+/g, ' ');
      if (text.length < 3) { er[1](t('fill_required')); return; }
      save(function (x) { x.list.push({ id: 'w' + Date.now().toString(36), text: text.slice(0, 240), by: v.by.trim().slice(0, 80), at: Date.now() }); });
      f[1]({ text: '', by: '' }); er[1](''); p.say(t('wz_added'));
    }
    return h('div', { className: 'wz-admin' },
      h('section', { className: 'box' },
        h('h2', { className: 'lor-h' }, t('wz_title')),
        h('p', { className: 'lor-sm lor-muted', style: { margin: '0 0 16px' } }, t('wz_admin_hint')),
        h('div', { className: 'wz-form' },
          h(Field, { name: 'wz-text', label: t('wz_text'), multiline: true, rows: 3, value: v.text, error: er[0], onChange: function (x) { f[1](Object.assign({}, v, { text: x })); } }),
          h(Field, { name: 'wz-by', label: t('wz_by'), value: v.by, placeholder: t('wz_by_ph'), onChange: function (x) { f[1](Object.assign({}, v, { by: x })); } }),
          h('div', null, h(Btn, { variant: 'primary', size: 'sm', arrow: true, onClick: add }, t('wz_add')))),
        h('h3', { className: 'wz-sub' }, t('wz_mine')),
        list.length ? h('ul', { className: 'wz-list' }, list.map(function (x) {
          return h('li', { key: x.id }, h('div', null, h('p', null, x.text), x.by ? h('small', null, '— ' + x.by) : null),
            h('button', { type: 'button', className: 'app-link', onClick: function () { save(function (y) { y.list = y.list.filter(function (z) { return z.id !== x.id; }); }); } }, t('remove')));
        })) : h('p', { className: 'lor-sm lor-muted' }, t('wz_none'))),
      h('section', { className: 'box' },
        h('label', { className: 'check' }, h('input', { type: 'checkbox', checked: w.std !== false, onChange: function (e) { var on = e.target.checked; save(function (x) { x.std = on; }); } }), tpl(t('wz_std'), { n: WZ_N })),
        h('ul', { className: cx('wz-list is-std', w.std === false && 'is-off') }, wzStd(t, p.lang).map(function (x, i) {
          return h('li', { key: i }, h('div', null, h('p', { lang: 'uz' }, x.text), x.tr ? h('small', null, x.tr) : null, h('small', null, '— ' + x.by)));
        }))));
  }
  function Login(p) {
    var t = p.t, a = useState(''), b = useState(''), e = useState(''), th = useThemePref(), busy = useState(false), from = useState(introFrom)[0];
    function submit(ev) {
      ev.preventDefault();
      if (!a[0].trim() || !b[0]) { e[1]('bad_login'); return; }
      e[1](''); busy[1](true);
      SV.login(a[0].trim(), b[0]).then(function () { busy[1](false); }, function (x) { busy[1](false); e[1](SRV_ERR[x.code] || 'srv_script'); });
    }
    return h('div', { className: 'login-page' },
      h('div', { className: 'lor-login' },
        h('div', { className: 'lor-login-hero intro' },
          h('span', { className: 'ir-glow', 'aria-hidden': true }),
          h('img', { className: 'ir-logo', src: LOGO_W, alt: 'BURAQ logistics', width: 116, height: 40 }),
          h('div', { className: 'lor-ladder', 'aria-label': 'Samaradorlik, ishonchlilik, mukammallik' },
            h('span', null, h('span', { className: 'ir-m' }, h('span', null, 'Samaradorlik'))),
            h('span', null, h(Arrow, { dir: 'left', length: 88, tone: 'red' }), h('span', { className: 'ir-m' }, h('span', null, 'Ishonchlilik'))),
            h('span', null, h('span', { className: 'ir-m' }, h('span', null, 'Mukammallik')), h(LOR.RegMark))),
          h(Wisdom, { t: t, lang: p.lang }),
          h(IntroRoad, { from: from }),
          h('div', { className: 'lor-login-foot' }, h('span', null, t('app_full')), h('span', null, 'BIRGALIKDA MUVAFFAQIYATGA'))),
        h('div', { className: 'lor-login-side' },
          h('div', { className: 'login-col' },
            h('form', { className: 'lor-login-card lg-card', onSubmit: submit, noValidate: true },
              h('div', { className: 'lor-login-top' }, h('span', { className: 'lor-eyebrow' }, t('app_full')), h('span', { className: 'login-prefs' }, h(ThemeSwitch, { t: t, value: th.v, onChange: th.set, compact: true }), h(LOR.LangSwitch, { value: p.lang, onChange: p.setLang }))),
              h(Hello, { t: t }),
              h('h1', { className: 'lor-title' }, t('login_title')),
              h(Field, { name: 'login', label: t('login'), value: a[0], onChange: a[1], placeholder: 'd.karimova', required: true, autoComplete: 'username' }),
              h(Field, { name: 'password', label: t('password'), type: 'password', value: b[0], onChange: b[1], placeholder: '••••••••', required: true, autoComplete: 'current-password', error: e[0] ? t(e[0]) : null }),
              h(Btn, { variant: 'primary', block: true, arrow: true, type: 'submit', disabled: busy[0] }, t(busy[0] ? 'srv_signing' : 'sign_in')),
              h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('login_hint')))))),
      h(Foot, { t: t, onTerms: p.showTerms }));
  }

  /* ---------------- profile (anketa) ---------------- */
  var PROFILE_STEPS = [
    { key: 'step_personal', passportFile: true, fields: [['lastName', 'Familiya', 1], ['firstName', 'Ism', 1], ['middleName', 'Otasining ismi', 0], ['birth', 'Tug‘ilgan sana', 1, { type: 'date' }], ['passport', 'Pasport seriyasi va raqami', 1, { placeholder: 'AA 1234567' }], ['address', 'Yashash manzili', 1, { placeholder: 'Toshkent sh., …' }]] },
    { key: 'step_contact', fields: [['phone', 'Telefon', 1, { placeholder: '+998 __ ___ __ __', type: 'tel' }], ['phone2', 'Qo‘shimcha telefon', 0, { type: 'tel' }], ['telegram', 'Telegram', 1, { placeholder: '@username' }], ['email', 'E-mail', 0, { type: 'email' }], ['emgName', 'Favqulodda aloqa: ism', 1], ['emgPhone', 'Favqulodda aloqa: telefon', 1, { type: 'tel' }]] },
    { key: 'step_exp', fields: [['education', 'Ma’lumoti', 1, { options: ['', 'O‘rta maxsus', 'Oliy (bakalavr)', 'Oliy (magistr)'] }], ['prevJob', 'Oldingi ish joyi', 0], ['years', 'Logistikadagi tajriba (yil)', 1, { type: 'number' }], ['languages', 'Tillar', 1, { langs: true }], ['about', 'O‘zingiz haqingizda qisqacha', 0, { multiline: true, span: true }]] },
    { key: 'step_assets', assets: true }];
  var LAST_STEP = PROFILE_STEPS.length - 1;
  /* the passport scan in the profile — the SOP manager can switch it off (settings.passportScan: false) */
  function askPassport(db) { return !(db.settings && db.settings.passportScan === false); }
  /* «Tillar»: several at once + «Boshqa» with own text. Kept as one line («O‘zbek, Rus, Ingliz») — the profile view shows it as is */
  var LANG_OPTS = ['O‘zbek', 'Rus', 'Xitoy', 'Turk'];
  function langSplit(v) {
    var known = [], other = [];
    String(v || '').split(/\s*[,;]\s*/).filter(Boolean).forEach(function (x) {
      var k = LANG_OPTS.filter(function (o) { return o.toLowerCase().replace(/[‘’']/g, '') === x.toLowerCase().replace(/[‘’']/g, ''); })[0];
      if (k) { if (known.indexOf(k) < 0) known.push(k); } else other.push(x);
    });
    return { known: known, other: other.join(', ') };
  }
  function LangPick(p) {
    var t = p.t, cur = langSplit(p.value), oo = useState(!!cur.other), otherOn = oo[0] || !!cur.other;
    function emit(known, other, on) { p.onChange(LANG_OPTS.filter(function (o) { return known.indexOf(o) >= 0; }).concat(on && other.trim() ? [other.trim()] : []).join(', ')); }
    function tog(o) { var k = cur.known.indexOf(o) >= 0 ? cur.known.filter(function (x) { return x !== o; }) : cur.known.concat([o]); emit(k, cur.other, otherOn); }
    return h('div', { className: 'lor-field lor-span' },
      h('span', { className: 'lor-field-label', id: 'f-languages-l' }, p.label, p.required ? h('span', { className: 'lor-req', 'aria-hidden': true }, '*') : null),
      h('div', { className: 'ac-chips', role: 'group', 'aria-labelledby': 'f-languages-l' },
        LANG_OPTS.map(function (o) { var on = cur.known.indexOf(o) >= 0; return h('label', { key: o, className: cx('ac-chip', on && 'is-on') }, h('input', { type: 'checkbox', checked: on, onChange: function () { tog(o); } }), o); }),
        h('label', { className: cx('ac-chip', otherOn && 'is-on') }, h('input', { type: 'checkbox', checked: otherOn, onChange: function () { oo[1](!otherOn); emit(cur.known, cur.other, !otherOn); } }), t('lang_other'))),
      otherOn ? h('input', { id: 'f-languages-other', className: 'lor-input', value: cur.other, placeholder: t('lang_other_ph'), 'aria-label': t('lang_other'), onChange: function (e) { emit(cur.known, e.target.value, true); } }) : null,
      p.error ? h('span', { className: 'lor-field-error' }, p.error) : null);
  }
  var PP_MAX = 4000000;   /* a passport PDF from My.gov.uz is small; a phone photo can be bigger */
  /* the passport file the employee downloads from My.gov.uz — attached in the personal step */
  function PassportBox(p) {
    var t = p.t, er = useState(''), f = p.value;
    function pick(e) {
      var file = (e.target.files || [])[0]; e.target.value = '';
      if (!file) return;
      if (file.size > PP_MAX) { er[1](tpl(t('jf_too_big'), { name: file.name, n: fileSize(PP_MAX) })); return; }
      er[1]('');
      var rd = new FileReader();
      rd.onload = function () { p.onChange({ name: file.name, size: file.size, type: file.type || '', data: rd.result, at: Date.now() }); };
      rd.onerror = function () { er[1](t('jf_read_err')); };
      rd.readAsDataURL(file);
    }
    return h('div', { className: 'lor-field lor-span pp-box' },
      h('span', { className: 'lor-field-label' }, t('pp_file'), h('span', { className: 'lor-req', 'aria-hidden': true }, '*')),
      f ? h('div', { className: 'pp-file' },
        h('span', { className: 'jf-ico' }, fileExt(f.name)),
        h('span', { className: 'pp-file-t' }, h('b', null, f.name), h('small', null, fileSize(f.size))),
        h('a', { className: 'app-link', href: f.data, download: f.name, target: '_blank', rel: 'noopener', onClick: saveLink(f.name) }, t('pp_open')),
        h('label', { className: 'app-link', htmlFor: 'f-pp' }, t('pp_replace')),
        h('button', { type: 'button', className: 'app-link danger', onClick: function () { p.onChange(null); } }, t('remove')))
        : h('label', { className: 'lor-btn lor-btn-outline lor-btn-sm pp-add', htmlFor: 'f-pp' }, '+ ' + t('pp_add')),
      h('input', { id: 'f-pp', type: 'file', className: 'jf-input', accept: '.pdf,.jpg,.jpeg,.png,application/pdf,image/*', onChange: pick }),
      er[0] || p.error ? h('span', { className: 'lor-field-error' }, er[0] || p.error) : h('span', { className: 'lor-field-hint' }, t('pp_file_hint')));
  }

  function ProfilePage(p) {
    var t = p.t, u = p.user, only = !!u.profileComplete;   /* profile already filled earlier → only the new property step is left */
    var sv = useState(function () { var n = u.name.split(' '); return Object.assign({ firstName: n[0] || '', lastName: n[1] || '' }, u.profile || {}); }), vals = sv[0];
    var ss = useState(only ? LAST_STEP : 0), step = ss[0]; var se = useState({}), errs = se[0];
    var as = useState({ rows: [], hr: {}, none: false, ack: false }), tried = useRef(null);
    var cur = PROFILE_STEPS[step];
    function set(k, v) { var o = Object.assign({}, vals); o[k] = v; sv[1](o); if (errs[k]) { var e = Object.assign({}, errs); delete e[k]; se[1](e); } }
    /* after the first submit, errors update live — but a row added later is only checked on the next submit */
    function setAssets(v) {
      as[1](v); if (!tried.current) return;
      var e = assetsStepErrors(p.db, u, v, t);
      Object.keys(e).forEach(function (k) { if (k.indexOf('row-') === 0 && !tried.current[k.slice(4)]) delete e[k]; });
      se[1](e);
    }
    function next() {
      if (cur.assets) {
        tried.current = {}; as[0].rows.forEach(function (r) { tried.current[r.key] = 1; });
        var ae = assetsStepErrors(p.db, u, as[0], t); se[1](ae);
        if (Object.keys(ae).length) { setTimeout(function () { var el = document.querySelector('.assets-step .lor-field-error'); if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 30); return; }
        var A = as[0];
        p.update(function (d) { var x = d.users.filter(function (y) { return y.id === u.id; })[0]; if (!only) x.profile = vals; saveAssetsStep(d, u.id, A); x.profileComplete = true; notify(d, u.id, only ? t('n_assets_saved') : t('n_profile')); });
        p.say(only ? t('assets_saved') : t('profile_saved'));
        return;
      }
      var e = {}; cur.fields.forEach(function (f) { if (f[2] && !String(vals[f[0]] || '').trim()) e[f[0]] = t('fill_required'); });
      if (cur.passportFile && askPassport(p.db) && !vals.passportFile) e.passportFile = t('pp_file_req');
      se[1](e);
      if (Object.keys(e).length) { setTimeout(function () { var el = document.querySelector('.app-profile .lor-field-error'); if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 30); return; }
      ss[1](step + 1); window.scrollTo(0, 0);
    }
    return h('section', { className: 'lor-profile app-profile' },
      h('div', null, h('span', { className: 'lor-eyebrow' }, (only ? t('as_new_section') : (step + 1) + ' / ' + PROFILE_STEPS.length) + ' · ' + u.position + ' · ' + u.department), h('h1', { className: 'lor-title', style: { marginTop: 4 } }, t('profile_title'))),
      h('div', { className: 'lor-lock', role: 'note' }, h(Icon, { name: 'lock' }), only ? t('as_lock_only') : t('profile_lock')),
      h('ol', { className: 'lor-stepper' }, PROFILE_STEPS.map(function (s, i) { return h('li', { key: i, className: i < step ? 'is-done' : i === step ? 'is-on' : '' }, t(s.key)); })),
      cur.assets ? h(AssetsStep, { t: t, db: p.db, user: u, lang: p.lang, value: as[0], errors: errs, onChange: setAssets })
        : h('div', { className: 'lor-form-grid' },
          cur.fields.map(function (f) { var o = f[3] || {}; if (o.langs) return h(LangPick, { key: f[0], t: t, label: f[1], required: !!f[2], value: vals[f[0]], error: errs[f[0]], onChange: function (v) { set(f[0], v); } }); return h(Field, Object.assign({ key: f[0], name: f[0], label: f[1], required: !!f[2], value: vals[f[0]], error: errs[f[0]], onChange: function (v) { set(f[0], v); } }, o)); }),
          cur.passportFile && askPassport(p.db) ? h(PassportBox, { key: 'pp', t: t, value: vals.passportFile, error: errs.passportFile, onChange: function (v) { set('passportFile', v); } }) : null),
      h('div', { className: 'lor-form-foot' },
        h('span', { className: 'lor-sm lor-muted' }, t('required_note')),
        h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
          only ? null : h(Btn, { variant: 'ghost', disabled: step === 0, onClick: function () { se[1]({}); ss[1](step - 1); window.scrollTo(0, 0); } }, t('back')),
          h(Btn, { variant: 'primary', arrow: true, onClick: next }, step < LAST_STEP ? t('save_next') : t('finish_profile')))));
  }

  /* ---------------- video (mock player; real one = HLS + DRM) ---------------- */
  function parseDur(s) { var m = String(s || '0:0').split(':'); return (+m[0] || 0) * 60 + (+m[1] || 0); }
  function mmss(n) { return pad(Math.floor(n / 60)) + ':' + pad(Math.floor(n % 60)); }
  /* the lesson video: a YouTube link («unlisted» on the company channel) is embedded, otherwise the placeholder player */
  function ytId(src) { var m = /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([\w-]{11})/.exec(String(src || '')); return m ? m[1] : null; }
  function Player(p) { return ytId(p.video && p.video.src) ? h(YtPlayer, p) : h(MockPlayer, p); }
  function YtPlayer(p) {
    var t = p.t, id = ytId(p.video.src);
    return h('div', { className: 'lor-video' },
      h('div', { className: 'lor-video-frame is-embed' },
        h('iframe', { src: 'https://www.youtube-nocookie.com/embed/' + id + '?rel=0&modestbranding=1&playsinline=1', title: p.video.title || 'Video', loading: 'lazy',
          allow: 'accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen', allowFullScreen: true, referrerPolicy: 'strict-origin-when-cross-origin' })),
      h('div', { className: 'lor-video-meta' }, h('span', { className: 'lor-sm' }, p.video.title), h('span', { className: 'lor-video-lock' }, h(Icon, { name: 'shield', size: 14 }), t('video_yt'))));
  }
  function MockPlayer(p) {
    var t = p.t, total = parseDur(p.video.duration) || 1, s = useState(0), pos = s[0], pl = useState(false), playing = pl[0];
    useEffect(function () { if (!playing) return; var id = setInterval(function () { s[1](function (x) { if (x + 2 >= total) { pl[1](false); return total; } return x + 2; }); }, 250); return function () { clearInterval(id); }; }, [playing, total]);
    useEffect(function () { s[1](0); pl[1](false); }, [p.video.title]);
    return h('div', { className: 'lor-video' },
      h('div', { className: 'lor-video-frame', onContextMenu: function (e) { e.preventDefault(); } },
        h('svg', { className: 'lor-video-art', viewBox: '0 0 320 180', preserveAspectRatio: 'xMidYMid slice', 'aria-hidden': true },
          h('line', { x1: 0, y1: 138, x2: 320, y2: 138 }), h('rect', { x: 40 - (pos / total) * 30, y: 88, width: 120, height: 42, rx: 2 }), h('rect', { x: 160 - (pos / total) * 30, y: 100, width: 36, height: 30, rx: 2 }),
          h('circle', { cx: 70 - (pos / total) * 30, cy: 134, r: 8 }), h('circle', { cx: 176 - (pos / total) * 30, cy: 134, r: 8 }),
          h('rect', { x: 216, y: 70, width: 72, height: 60, rx: 1 }), [228, 240, 252, 264, 276].map(function (x) { return h('line', { key: x, x1: x, y1: 70, x2: x, y2: 130 }); }),
          h('path', { d: 'M20 40 H120 M112 34 L120 40 L112 46' })),
        h('button', { type: 'button', className: 'lor-video-play', 'aria-label': playing ? 'Pause' : 'Play', onClick: function () { if (pos >= total) s[1](0); pl[1](!playing); } },
          playing ? h('svg', { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': true }, h('rect', { x: 7, y: 6, width: 3.5, height: 12, rx: 1 }), h('rect', { x: 13.5, y: 6, width: 3.5, height: 12, rx: 1 })) : h(Icon, { name: 'play', fill: true, size: 26 }))),
      h('div', { className: 'lor-video-bar' }, h('span', null, mmss(pos)), h('div', { className: 'lor-video-track' }, h('i', { style: { width: (pos * 100 / total) + '%' } })), h('span', null, mmss(total))),
      h('div', { className: 'lor-video-meta' }, h('span', { className: 'lor-sm' }, p.video.title), h('span', { className: 'lor-video-lock' }, h(Icon, { name: 'shield', size: 14 }), t('video_lock'))));
  }

  /* ---------------- feedback modal (A / B) ---------------- */
  function Feedback(p) {
    var t = p.t, s = useState(p.step || 'ask'), step = s[0], tx = useState(''), er = useState(false);
    var taRef = useRef(null);
    useEffect(function () { if (step === 'question' && taRef.current) taRef.current.focus(); }, [step]);
    useEffect(function () { function k(e) { if (e.key === 'Escape') p.onClose(); } window.addEventListener('keydown', k); return function () { window.removeEventListener('keydown', k); }; }, []);
    var body;
    if (step === 'ask') body = [
      h('span', { key: 'e', className: 'lor-eyebrow' }, p.lessonTitle),
      h('h3', { key: 'h', className: 'lor-h', id: 'fb-h' }, t('modal_q')),
      h('div', { key: 'c', className: 'lor-choice' },
        h('button', { type: 'button', className: 'lor-choice-a', onClick: function () { s[1]('question'); } }, h('span', { className: 'lor-choice-tag' }, 'A'), h('b', null, t('opt_a')), h('span', null, t('opt_a_sub'))),
        h('button', { type: 'button', className: 'lor-choice-b', onClick: function () { s[1]('confirm'); } }, h('span', { className: 'lor-choice-tag' }, 'B'), h('b', null, t('opt_b')), h('span', null, t('opt_b_sub')))),
      p.canLater ? h('div', { key: 'l', className: 'lor-modal-actions' }, h(Btn, { variant: 'ghost', size: 'sm', onClick: p.onClose }, t('later'))) : null];
    else if (step === 'question') body = [
      h('h3', { key: 'h', className: 'lor-h', id: 'fb-h' }, t('opt_a')),
      h('div', { key: 'f', className: 'lor-field' },
        h('label', { className: 'lor-field-label', htmlFor: 'fb-q' }, t('q_label'), h('span', { className: 'lor-req' }, '*')),
        h('textarea', { id: 'fb-q', ref: taRef, className: cx('lor-input', er[0] && 'is-error'), rows: 4, value: tx[0], placeholder: t('q_placeholder'), onChange: function (e) { tx[1](e.target.value); er[1](false); } }),
        er[0] ? h('span', { className: 'lor-field-error' }, t('fill_required')) : null),
      h('div', { key: 'a', className: 'lor-modal-actions' },
        h(Btn, { variant: 'ghost', onClick: function () { s[1]('ask'); } }, t('back')),
        h(Btn, { variant: 'primary', arrow: true, onClick: function () { if (!tx[0].trim()) { er[1](true); return; } p.onQuestion(tx[0].trim()); s[1]('sent-q'); } }, t('send')))];
    else if (step === 'confirm') body = [
      h('h3', { key: 'h', className: 'lor-h', id: 'fb-h' }, t('confirm_title')),
      h('p', { key: 'p', className: 'lor-muted' }, t('confirm_text')),
      h('div', { key: 'a', className: 'lor-modal-actions' },
        h(Btn, { variant: 'outline', onClick: function () { s[1]('ask'); } }, t('no')),
        h(Btn, { variant: 'primary', arrow: true, onClick: function () { p.onExam(); s[1]('sent-exam'); } }, t('yes')))];
    else body = [
      h('div', { key: 'd', className: 'lor-done' }, h('span', { className: 'lor-done-ico' }, h(Icon, { name: 'check' })),
        h('div', null, h(Badge, { status: step === 'sent-q' ? 'question' : 'exam-ready', lang: p.lang }), h('p', { style: { marginTop: 8 } }, t(step === 'sent-q' ? 'sent_q' : 'sent_exam')))),
      h('div', { key: 'a', className: 'lor-modal-actions' }, h(Btn, { variant: 'outline', onClick: p.onClose }, t('close')))];
    return h('div', { className: 'lor-scrim', onMouseDown: function (e) { if (e.target === e.currentTarget) p.onClose(); } },
      h('div', { className: 'lor-modal', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'fb-h' },
        h('button', { type: 'button', className: 'lor-modal-x', 'aria-label': t('close'), onClick: p.onClose }, '×'), body));
  }

  /* ---------------- lesson view ---------------- */
  function LessonView(p) {
    var t = p.t, db = p.db, u = p.user, l = findLesson(db.course, p.id);
    var st = l ? lessonStatus(db, u, l.id) : 'locked', pr = l ? (prog(db, u.id)[l.id] || {}) : {};
    var m = useState(null), modal = m[0], setModal = m[1];
    var asked = useRef(false), sentinel = useRef(null);
    var needsAsk = st === 'in-progress' || st === 'updated' || st === 'failed';
    useEffect(function () { asked.current = false; setModal(null); if (l && st === 'todo') p.update(function (d) { setProg(d, u.id, l.id, { status: 'in-progress' }); }); }, [p.id]);
    useEffect(function () {
      if (!sentinel.current || !needsAsk || !('IntersectionObserver' in window)) return;
      var io = new IntersectionObserver(function (en) { if (en[0].isIntersecting && !asked.current) { asked.current = true; setModal({ step: 'ask' }); } }, { threshold: 1 });
      io.observe(sentinel.current); return function () { io.disconnect(); };
    }, [p.id, needsAsk]);
    p.leaveRef.current = function (r) { if (needsAsk && !asked.current) { asked.current = true; setModal({ step: 'ask', pending: r }); return true; } return false; };
    useEffect(function () { return function () { p.leaveRef.current = null; }; }, []);

    if (!l) return null;
    if (st === 'locked') return h('div', { className: 'box locked-box' }, h(Icon, { name: 'lock', size: 28 }), h('h2', { className: 'lor-h' }, l.title), h('p', { className: 'lor-muted' }, l.officialOnly && u.status !== 'official' ? t('official_locked') : t('lesson_locked')));

    function sendQuestion(text) {
      p.update(function (d) { setProg(d, u.id, l.id, { status: 'question' }); d.requests.unshift({ id: nextId(d), type: 'question', userId: u.id, lessonId: l.id, text: text, at: Date.now(), state: 'open', unread: true }); });
    }
    function requestExam() {
      p.update(function (d) {
        setProg(d, u.id, l.id, { status: 'exam-ready', score: null, comment: null });
        d.requests.forEach(function (r) { if (r.type === 'exam' && r.userId === u.id && r.lessonId === l.id && r.state === 'open') r.state = 'closed'; });
        d.requests.unshift({ id: nextId(d), type: 'exam', userId: u.id, lessonId: l.id, score: null, at: Date.now(), state: 'open', unread: true });
      });
    }
    function closeModal() { var pend = modal && modal.pending; setModal(null); if (pend) p.forceGo(pend); }

    var ls = flat(db.course), idx = ls.findIndex(function (x) { return x.id === l.id; }), nxt = ls[idx + 1];
    var statusBox = null;
    if (st === 'exam-ready') statusBox = pr.score == null
      ? h('div', { className: 'status-box is-info' }, h('div', null, h('b', null, t('test_stage')), h('p', null, t('test_stage_sub'))), h(Btn, { variant: 'primary', arrow: true, onClick: function () { p.go({ name: 'quiz', id: l.id }); } }, t('start_test')))
      : h('div', { className: 'status-box is-info' }, h('div', null, h('b', null, t('test_done') + ': ' + pr.score + '%'), h('p', null, t('wait_oral'))), h(Badge, { status: 'exam-ready', lang: p.lang }));
    else if (st === 'passed') statusBox = h('div', { className: 'status-box is-info' }, h('div', null, h('b', null, '✓ ' + t('st_passed')), pr.comment ? h('p', null, t('comment') + ': ' + pr.comment) : null), nxt && lessonStatus(db, u, nxt.id) !== 'locked' ? h(Btn, { variant: 'primary', arrow: true, onClick: function () { p.go({ name: 'lesson', id: nxt.id }); } }, t('go_next')) : null);
    else if (st === 'failed') statusBox = h('div', { className: 'status-box is-fail' }, h('div', null, h('b', null, '✕ ' + t('st_failed')), pr.comment ? h('p', null, t('comment') + ': ' + pr.comment) : null, h('p', null, t('st_failed_sub'))));
    else if (st === 'question') statusBox = h('div', { className: 'status-box' }, h('div', null, h('b', null, '? ' + t('st_question')), h('p', null, t('st_question_sub'))));
    else if (st === 'updated') statusBox = h('div', { className: 'status-box is-info' }, h('div', null, h('b', null, '↻ ' + t('st_updated')), h('p', null, t('st_updated_sub'))));
    var canFinish = st !== 'passed' && st !== 'exam-ready';

    return h(F, null,
      h(LOR.Protected, { watermark: wmText(u), hideOnBlur: true, lang: p.lang, onViolation: function (k) { p.update(function (d) { d.audit.unshift({ id: nextId(d), userId: u.id, key: k, lessonId: l.id, at: Date.now() }); if (!SV) d.audit = d.audit.slice(0, 200); }); } },
        h('div', { className: 'lor-lesson app-lesson' },
          h('article', { className: 'lor-pane' },
            h('div', { className: 'lor-crumb' }, h('span', null, l.sectionTitle), h(Arrow, { length: 16 }), h(Badge, { status: st, lang: p.lang })),
            h('h1', { className: 'lor-lesson-title' }, l.title),
            (function () {
              var up = updateForLesson(db, u.id, l.id);
              return up ? h(SopUpdateBox, { t: t, x: up, onAck: function () { p.update(function (d) { ackUpdate(d, up.id, u.id); }); p.say(t('sop_acked')); } }) : null;
            })(),
            l.intro ? h('p', { className: 'lor-sop', style: { margin: 0 } }, l.intro) : null,
            l.html ? h(SopBody, { html: l.html }) : null,
            l.steps && l.steps.length ? h('ol', { className: 'lor-steps' }, l.steps.map(function (s, i) {
              return h('li', { key: i, className: 'lor-step' }, h('span', { className: 'lor-step-n' }, pad(i + 1)),
                h('div', null, h('p', null, s.text), s.who && s.who.length ? h('span', { className: 'lor-who' }, t('who') + ':', s.who.map(function (w, k) { return h(F, { key: k }, k ? h(Arrow, { length: 18 }) : null, h('b', null, w)); })) : null));
            })) : null,
            l.limit ? h('div', { className: 'lor-limit' }, h('span', { className: 'lor-eyebrow' }, t('limit')), l.limit) : null,
            h(LessonCases, { t: t, db: db, lessonId: l.id, go: p.go }),
            h('div', { ref: sentinel, className: 'sentinel', 'aria-hidden': true }),
            statusBox ? h('div', { style: { marginTop: 24 } }, statusBox) : null,
            canFinish ? h('div', { className: 'lor-lesson-foot' }, h(Btn, { variant: 'primary', arrow: true, onClick: function () { asked.current = true; setModal({ step: 'ask' }); } }, t('finish'))) : null),
          h('div', { className: 'lor-pane lor-pane-media' }, h(Player, { t: t, video: l.video || { title: '', duration: '00:00' } }), h('p', { className: 'lor-sm lor-muted protect-note' }, h(Icon, { name: 'shield', size: 14 }), t('protected_note'))))),
      modal ? h(Feedback, { key: 'fb', t: t, lang: p.lang, step: modal.step, lessonTitle: l.sectionTitle + ' · ' + l.title, canLater: !!modal.pending, onQuestion: sendQuestion, onExam: requestExam, onClose: closeModal }) : null);
  }

  /* ---------------- quiz ---------------- */
  function QuizView(p) {
    var t = p.t, u = p.user, l = findLesson(p.db.course, p.id), pr = prog(p.db, u.id)[p.id] || {};
    var a = useState({}), ans = a[0], done = useState(pr.score != null), er = useState(false), res = useState(null), busy = useState(false);
    if (!l) return null;
    var qs = l.quiz || [], score = res[0] ? res[0].score : pr.score;
    /* the right answer: with the server — only after submitting, from the server’s reply */
    function right(q, i) { return res[0] ? res[0].answers[i] : -1; }
    function submit() {
      if (Object.keys(ans).length < qs.length) { er[1](true); return; }
      if (busy[0]) return;
      busy[1](true);
      SV.quiz(l.id, qs.map(function (q, i) { return ans[i]; })).then(function (r) { busy[1](false); res[1](r); done[1](true); window.scrollTo(0, 0); },
        function (x) { busy[1](false); p.say(t(x.code === 'net' ? 'srv_net' : 'srv_quiz_err')); });
    }
    var checked = done[0];
    return h('section', { className: 'box quiz-page' },
      h('div', { className: 'quiz-head' },
        h('div', null, h('span', { className: 'lor-eyebrow' }, t('quiz_title') + ' · ' + l.sectionTitle), h('h1', { className: 'lor-h', style: { marginTop: 4 } }, l.title)),
        h('span', { className: 'lor-sm lor-muted' }, t('pass_mark') + ': ' + PASS_MARK + '%')),
      checked && score != null ? h('div', { className: cx('status-box', score >= PASS_MARK ? 'is-info' : 'is-fail') }, h('div', null, h('b', null, t('your_score') + ': ' + score + '%'), h('p', null, t('wait_oral')))) : null,
      qs.map(function (q, i) {
        return h('fieldset', { key: i, className: 'quiz-q' },
          h('legend', { className: 'lor-h' }, h('span', { className: 'lor-eyebrow' }, t('quiz_q') + ' ' + (i + 1) + ' / ' + qs.length), q.q),
          h('div', { className: 'lor-quiz-opts', role: 'radiogroup' }, q.options.map(function (o, k) {
            var ok = right(q, i), sel = ans[i] === k, right_ = checked && Object.keys(ans).length && k === ok, wrong = checked && sel && k !== ok;
            return h('button', { key: k, type: 'button', role: 'radio', 'aria-checked': sel, disabled: checked, className: cx('lor-opt', sel && 'is-sel', right_ && 'is-right', wrong && 'is-wrong'), onClick: function () { var n = Object.assign({}, ans); n[i] = k; a[1](n); er[1](false); } },
              h('span', { className: 'lor-opt-k' }, 'ABCDEF'[k]), h('span', null, o), right_ ? h('span', { className: 'lor-opt-res' }, '✓ ' + t('correct')) : wrong ? h('span', { className: 'lor-opt-res' }, '✕ ' + t('wrong')) : null);
          })));
      }),
      h('div', { className: 'quiz-foot' },
        er[0] ? h('span', { className: 'lor-field-error' }, t('answer_all')) : h('span'),
        checked ? h(Btn, { variant: 'outline', onClick: function () { p.go({ name: 'lesson', id: l.id }); } }, t('back_lesson')) : h(Btn, { variant: 'primary', arrow: true, onClick: submit, disabled: busy[0] }, t('submit_test'))));
  }

  /* ---------------- employee home ---------------- */
  function AccessBanner(p) {
    var t = p.t, db = p.db, u = p.user;
    var open = db.requests.filter(function (r) { return r.type === 'access' && r.userId === u.id && r.state === 'open'; })[0];
    function req() { p.update(function (d) { d.requests.unshift({ id: nextId(d), type: 'access', userId: u.id, text: APP_ACCESS_TEXT, at: Date.now(), state: 'open', unread: true }); }); }
    return h('section', { className: 'lor-notice' },
      h('div', { className: 'lor-notice-body' }, h('b', null, t('access_title')), h('span', null, '“' + t('access_text') + '”')),
      open ? h('span', { className: 'lor-notice-state' }, '◔ ', t('access_pending')) : h(Btn, { variant: 'primary', arrow: true, onClick: req }, t('access_btn')));
  }
  var APP_ACCESS_TEXT = 'Sinov muddatidan o‘tganligim munosabati bilan keyingi yo‘riqnomalarga ruxsat ochishingizni so‘rayman.';

  function Home(p) {
    var t = p.t, db = p.db, u = p.user, m = mastery(db, u), cur = currentLesson(db, u);
    var mine = db.requests.filter(function (r) { return r.userId === u.id && r.state === 'open'; });
    var nots = db.notifications.filter(function (n) { return n.userId === u.id; }).slice(0, 5);
    return h('div', { className: 'app-wrap' },
      h('div', { className: 'page-head' },
        h('div', null, h('span', { className: 'lor-eyebrow' }, u.position + ' · ' + u.department), h('h1', { className: 'lor-title' }, t('welcome') + ', ' + firstName(u), h(PageTip, { t: t, id: 'home' }))),
        h(Badge, { status: u.status, lang: p.lang })),
      (function () {
        var iss = assetsOf(db, u.id).filter(function (a) { return a.status === 'issued'; });
        return iss.length ? h('section', { className: 'lor-notice as-notice' },
          h('span', { className: 'as-ico inv', 'aria-hidden': true }, h(Ico, { name: iss[0].type, size: 20 })),
          h('div', { className: 'lor-notice-body' }, h('b', null, tpl(t('as_notice_t'), { n: iss.length })), h('span', null, iss.map(function (a) { return a.name; }).join(' · '))),
          h(Btn, { variant: 'primary', arrow: true, onClick: function () { p.go({ name: 'assets' }); } }, t('as_notice_btn'))) : null;
      })(),
      h(TasksHomeCard, p),
      p.pulseDue ? h(PulseCard, { t: t, db: db, onStart: p.openSurvey }) : null,
      h('div', { className: 'home-grid' },
        h('section', { className: 'box box-next' },
          h('span', { className: 'lor-eyebrow' }, cur ? t('continue') : t('next_lesson')),
          cur ? h(F, null, h('h2', { className: 'lor-h' }, cur.title), h('span', { className: 'lor-sm lor-muted' }, cur.sectionTitle), h('div', { className: 'box-row' }, h(Badge, { status: cur.status, lang: p.lang }), h(Btn, { variant: 'primary', arrow: true, onClick: function () { p.go({ name: 'lesson', id: cur.id }); } }, t('continue'))))
            : h('p', { className: 'lor-muted', style: { margin: 0 } }, t('all_done'))),
        h('section', { className: 'box' },
          h(Progress, { value: m.pct, lang: p.lang }),
          h('div', { className: 'mini-stats' },
            h('div', null, h('b', null, m.passed + '/' + m.total), h('span', null, t('passed_n'))),
            h('div', null, h('b', null, mine.filter(function (r) { return r.type === 'exam'; }).length), h('span', null, t('waiting_exam'))),
            h('div', null, h('b', null, mine.filter(function (r) { return r.type === 'question'; }).length), h('span', null, t('open_q')))))),
      attHas(db, u) ? h('div', { className: 'home-grid at-pair' }, h(DailyGoal, p), h(AttHome, p)) : h(DailyGoal, p),
      h(MonthTeaser, p),
      h('div', { className: 'home-grid three' },
        h(IniHomeCard, { t: t, db: db, user: u, onNew: p.openIni, onList: function () { p.go({ name: 'ideas' }); } }),
        h(DrillHomeCard, p),
        (function () {
          var mineA = assetsOf(db, u.id), live = mineA.filter(function (a) { return a.status !== 'returned'; });
          return h('section', { className: 'box as-mini' },
            h('span', { className: 'lor-eyebrow' }, t('as_my_title')),
            h('div', { className: 'as-mini-n' }, h('b', null, live.length), h('span', null, t('as_mini_items'))),
            h('div', { className: 'as-mini-ico', 'aria-hidden': true }, live.slice(0, 6).map(function (a) { return h('span', { key: a.id, className: 'as-ico', title: a.name }, h(Ico, { name: a.type, size: 16 })); })),
            mineA.some(assetAttn) ? h('span', { className: 'lor-sm lor-muted' }, t('as_mini_attn')) : null,
            h('div', null, h('button', { type: 'button', className: 'app-link', onClick: function () { p.go({ name: 'assets' }); } }, t('as_mini_open'))));
        })()),
      h(LevelCard, p),
      u.status === 'probation' ? h(AccessBanner, p) : null,
      h('section', { className: 'box' },
        h('span', { className: 'lor-eyebrow' }, t('notifications')),
        nots.length ? h('ul', { className: 'notif-list flat' }, nots.map(function (n) { return h('li', { key: n.id }, h('button', { type: 'button', className: cx('notif-item', !n.read && 'is-new'), onClick: function () { p.openNotif(n); } }, h('span', { className: 'notif-dot' }), h('span', null, notifText(n, db, p.lang, t), h('small', null, fmt(n.at, t))))); }))
          : h('p', { className: 'lor-muted', style: { margin: 0 } }, t('no_notif'))));
  }

  /* ---------------- employee shell ---------------- */
  function EmployeeApp(p) {
    var t = p.t, db = p.db, u = p.user;
    var r = useState({ name: 'home' }), route = r[0], dr = useState(false), ai = useState(false);
    var ini = useState(false), sv = useState(false), pHide = useState(false), tour = useState(false);
    var pal = useState(false); usePalette(pal[0], pal[1]);
    var hintOn = !!u.hints;
    var theme = useThemePref(p.say, t);
    var hint = { on: hintOn, toggle: function (v) { p.update(function (d) { d.users.forEach(function (x) { if (x.id === u.id) x.hints = v; }); }); p.say(t(v ? 'hint_said_on' : 'hint_said_off')); } };

    var leaveRef = useRef(null), dbRef = useRef(db); dbRef.current = db;
    var filled = !!(u.profileComplete && u.assetsDeclaredAt);
    var ready = !!(u.termsAcceptedAt && filled);
    function forceGo(x) { r[1](x); dr[1](false); window.scrollTo(0, 0); }
    function go(x) { if (route.name === 'lesson' && leaveRef.current && leaveRef.current(x)) { dr[1](false); return; } forceGo(x); }
    function openNotif(n) {
      p.update(function (d) { d.notifications.forEach(function (x) { if (x.id === n.id) x.read = true; }); });
      if (n.lessonId) go({ name: 'lesson', id: n.lessonId });
      else if (n.route === 'pulse') { if (pulseDue(db, u)) sv[1](true); else go({ name: 'home' }); }
      else if (n.route) go({ name: n.route, ym: n.ym || null });
      else if (n.path) go({ name: 'path' }); else go({ name: 'home' });
    }

    /* study-time tracker: counts only active, visible time on lesson / quiz pages or with the AI mentor open */
    var activeRef = useRef(false); activeRef.current = ready && (route.name === 'lesson' || route.name === 'quiz' || ai[0]);
    var lastAct = useRef(Date.now()), acc = useRef(0), prevMin = useRef(studyMin(db, u.id));
    useEffect(function () {
      function act() { lastAct.current = Date.now(); }
      var evs = ['mousemove', 'keydown', 'scroll', 'touchstart', 'click'];
      evs.forEach(function (e) { window.addEventListener(e, act, { passive: true }); });
      var id = setInterval(function () {
        if (!activeRef.current || document.visibilityState !== 'visible' || Date.now() - lastAct.current > 5 * 60e3) return;
        acc.current += 15;
        if (acc.current >= 60) {
          var add = Math.floor(acc.current / 60); acc.current -= add * 60;
          p.update(function (d) { d.study = d.study || {}; var st = d.study[u.id] = d.study[u.id] || {}, k = todayKey(), before = st[k] || 0; st[k] = before + add; if (before < GOAL && st[k] >= GOAL) notify(d, u.id, t('goal_done') + ' ✓'); });
        }
      }, 15000);
      return function () { clearInterval(id); evs.forEach(function (e) { window.removeEventListener(e, act); }); };
    }, []);
    var todayMin = studyMin(db, u.id);
    useEffect(function () { if (prevMin.current < GOAL && todayMin >= GOAL) p.say('✓ ' + t('goal_done')); prevMin.current = todayMin; }, [todayMin]);

    /* reminders: once a day on first open, at the chosen reminder time, and every 30 min of an unmet goal while the app is open */
    var nudge = useRef({ at: Date.now(), timeDay: null });
    useEffect(function () {
      if (!ready) return;
      var k = todayKey(); if ((db.reminded || {})[u.id] === k) return;
      p.update(function (d) {
        d.reminded = d.reminded || {}; d.reminded[u.id] = k;
        var y = studyMin(d, u.id, dayKey(Date.now() - DAY));
        if (u.startedAt && Date.now() - u.startedAt > DAY && y < GOAL) d.notifications.unshift({ id: nextId(d), userId: u.id, text: t('remind_yesterday').replace('{m}', fmtMin(y, t)), path: true, at: Date.now() - 1000, read: false });
        var m = studyMin(d, u.id); if (m < GOAL) d.notifications.unshift({ id: nextId(d), userId: u.id, text: t('remind_title') + ': ' + t('remind_text') + fmtMin(GOAL - m, t), path: true, at: Date.now(), read: false });
      });
    }, [ready]);
    useEffect(function () {
      if (!ready) return;
      var id = setInterval(function () {
        var d = dbRef.current, me = d.users.filter(function (x) { return x.id === u.id; })[0] || u, m = studyMin(d, u.id); if (m >= GOAL) return;
        var now = new Date(), hhmm = pad(now.getHours()) + ':' + pad(now.getMinutes()), k = todayKey();
        if (hhmm >= (me.reminderTime || '19:00') && nudge.current.timeDay !== k) {
          nudge.current.timeDay = k; nudge.current.at = Date.now();
          var msg = t('remind_time_hit').replace('{m}', fmtMin(GOAL - m, t)); p.say(msg);
          p.update(function (dd) { notify(dd, u.id, msg); dd.notifications[0].path = true; });
        } else if (Date.now() - nudge.current.at > 30 * 60e3) { nudge.current.at = Date.now(); p.say(t('remind_title') + ': ' + t('remind_text') + fmtMin(GOAL - m, t)); }
      }, 60e3);
      return function () { clearInterval(id); };
    }, [ready]);

    /* level changes: congratulate on a new level, tell once when the next level's requirements are met */
    var rk = rankOf(db, u), rkKey = String(rk.li);
    useEffect(function () {
      if (!ready) return;
      if (u.lastRank == null) { p.update(function (d) { d.users.forEach(function (x) { if (x.id === u.id) x.lastRank = rkKey; }); }); return; }
      if (u.lastRank !== rkKey) {
        var prevLi = +String(u.lastRank).split('-')[0] || 0;
        if (prevLi >= rk.li) p.update(function (d) { d.users.forEach(function (x) { if (x.id === u.id) x.lastRank = rkKey; }); });
        else p.update(function (d) { markPromotion(d, u.id, rk.li, prevLi, true); });
      }
    }, [rkKey, ready]);
    useEffect(function () {
      if (!ready || !rk.eligible || rk.pending || u.eligNotified === rk.li) return;
      p.update(function (d) { d.users.forEach(function (x) { if (x.id === u.id) x.eligNotified = rk.li; }); notify(d, u.id, tpl(t('level_req_text'), { x: lvlName(rk.next, p.lang) })); d.notifications[0].path = true; });
    }, [rk.eligible, rk.li, ready]);

    /* pulse survey: one notification per cycle; the AI bubble appears until answered or postponed */
    var due = ready && pulseDue(db, u);
    useEffect(function () {
      if (!due) return;
      var cyc = pulseCycle(db, u); if ((u.pulse || {}).notified === cyc) return;
      p.update(function (d) { patchUser(d, u.id, function (x) { x.pulse = Object.assign({}, x.pulse || {}, { notified: cyc }); }); d.notifications.unshift({ id: nextId(d), userId: u.id, kind: 'pulse', text: '', route: 'pulse', at: Date.now(), read: false }); });
    }, [due]);
    function snoozePulse() { p.update(function (d) { patchUser(d, u.id, function (x) { x.pulse = Object.assign({}, x.pulse || {}, { snooze: dayKey(Date.now()) }); }); }); pHide[1](true); p.say(t('pulse_snoozed')); }

    if (!u.termsAcceptedAt) return h(Welcome, p);

    var mine = db.notifications.filter(function (n) { return n.userId === u.id; });
    var sections = courseSections(db, u).map(function (s) {
      return { title: s.title, officialOnly: s.officialOnly && u.status !== 'official', lessons: s.lessons.map(function (l) { var st = lessonStatus(db, u, l.id); return { id: l.id, title: l.title, status: st === 'question' || st === 'updated' ? 'in-progress' : st, active: (route.name === 'lesson' || route.name === 'quiz') && route.id === l.id }; }) };
    });
    var q = Object.assign({}, p, { go: go, openNotif: openNotif, pulseDue: due, openSurvey: function () { sv[1](true); }, openIni: function () { ini[1](true); } });
    var main = !filled ? h(ProfilePage, p)
      : route.name === 'lesson' ? h(LessonView, Object.assign({}, q, { id: route.id, forceGo: forceGo, leaveRef: leaveRef, key: route.id }))
      : route.name === 'quiz' ? h(QuizView, Object.assign({}, q, { id: route.id, key: 'q' + route.id }))
      : route.name === 'path' ? h(MyPath, q)
      : route.name === 'assets' ? h(MyAssets, q)
      : route.name === 'ideas' ? h(MyIdeas, Object.assign({}, q, { onNew: function () { ini[1](true); } }))
      : route.name === 'tasks' ? h(TasksPage, q)
      : route.name === 'drill' ? h(DrillPage, q)
      : route.name === 'cases' ? h(CasesPage, Object.assign({}, q, { caseId: route.id, key: 'cs' + (route.id || '') }))
      : route.name === 'base' ? h(BasePage, q)
      : route.name === 'report' ? h(MonthReport, Object.assign({}, q, { ym: route.ym }))
      : route.name === 'pay' ? h(PayPage, q)
      : route.name === 'mentor' && isMentor(u) ? h(MentorPanel, q)
      : route.name === 'help' ? h(HelpPage, Object.assign({}, q, { hint: hint, theme: theme, onTour: function () { tour[1](true); } }))
      : h(Home, q);
    var tkN = taskCount(db, u);
    var navItems = [['home', t('nav_home')], ['tasks', t('nav_tasks'), tkN], ['cases', t('nav_cases')], ['base', t('nav_base')], ['path', t('nav_path')]];
    if (isMentor(u)) navItems.push(['mentor', t('nav_mentor')]);
    if (LmsPay.schemeFor(db.pay, u) || (db.payCalcs || []).some(function (c) { return c.uid === u.id; })) navItems.push(['pay', t('nav_pay')]);
    var nav = filled ? navItems.map(function (n) { return { key: n[0], label: n[1], count: n[2], active: route.name === n[0], onClick: function () { go({ name: n[0] }); } }; }) : null;
    var issuedN = assetsOf(db, u.id).filter(function (a) { return a.status === 'issued'; }).length;
    var links = filled ? [{ key: 'drill', label: t('dr_title'), onClick: function () { go({ name: 'drill' }); } }, { key: 'assets', label: t('as_my_title'), count: issuedN, onClick: function () { go({ name: 'assets' }); } }, { key: 'ideas', label: t('ini_my'), onClick: function () { go({ name: 'ideas' }); } }, { key: 'report', label: t('mr_nav'), onClick: function () { go({ name: 'report' }); } }, { key: 'help', label: t('nav_help'), onClick: function () { go({ name: 'help' }); } }] : null;
    return h(F, null,
      h(Header, { t: t, lang: p.lang, setLang: p.setLang, onProfile: p.openProfile, user: u, notifs: mine, onNotif: openNotif, onReadAll: function () { p.update(function (d) { d.notifications.forEach(function (n) { if (n.userId === u.id) n.read = true; }); }); }, onLogout: p.logout, onMenu: filled ? function () { dr[1](!dr[0]); } : null,
        nav: nav, links: links, hint: filled ? hint : null, theme: theme, onSearch: filled ? function () { pal[1](true); } : null, onHelp: filled ? function () { go({ name: 'help' }); } : null, medalNew: !!u.medalNew, onMedalSeen: function () { p.update(function (d) { d.users.forEach(function (x) { if (x.id === u.id) x.medalNew = false; }); }); }, rank: filled ? rankOf(db, u) : null, fmtNotif: function (n) { return notifText(n, db, p.lang, t); }, onPath: filled ? function () { go({ name: 'path' }); } : null, onTerms: p.showTerms,
        extra: filled ? h(F, null, h(TodayChip, { db: db, user: u, t: t, onClick: function () { go({ name: 'path' }); } }), h(IniButton, { t: t, onClick: function () { ini[1](true); } })) : null }),
      h('div', { className: cx('app-body', !filled && 'no-side') },
        filled ? h('div', { className: cx('app-side', dr[0] && 'is-open') }, h(LOR.CourseTree, { sections: sections, progress: mastery(db, u).pct, lang: p.lang, onSelect: function (l) { go({ name: 'lesson', id: l.id }); } })) : null,
        h('main', { className: 'app-main', id: 'main' }, h('div', { className: 'page-anim', key: route.name + (route.id || route.uid || route.lessonId || '') + (route.ym || '') }, main), h(Foot, { t: t, onTerms: p.showTerms }))),
      u.celebrate && filled ? h(Celebration, Object.assign({}, p, { go: go, key: 'cel' + (u.celebrate.at || 0) + (u.celebrate.replay ? 'r' : '') })) : null,
      due && !pHide[0] && !sv[0] && !ai[0] && !ini[0] && !u.celebrate && route.name !== 'lesson' && route.name !== 'quiz' && route.name !== 'drill' ? h(PulseBubble, { t: t, db: db, user: u, onStart: function () { sv[1](true); }, onLater: snoozePulse, onClose: function () { pHide[1](true); } }) : null,
      sv[0] ? h(SurveyModal, Object.assign({}, p, { key: 'sv', onClose: function () { sv[1](false); pHide[1](true); }, openIni: function () { ini[1](true); } })) : null,
      ini[0] ? h(IniModal, Object.assign({}, p, { key: 'ini', onClose: function () { ini[1](false); }, onList: function () { go({ name: 'ideas' }); } })) : null,
      filled ? h(AIMentor, Object.assign({}, p, { open: ai[0], setOpen: ai[1], lessonId: route.name === 'lesson' ? route.id : null, openLesson: function (id) { go({ name: 'lesson', id: id }); } })) : null,
      hintOn && !tour[0] && u.tourDone ? h(HintLayer, { t: t }) : null,
      pal[0] ? h(Palette, Object.assign({}, q, { onClose: function () { pal[1](false); }, go: function (x) { go(x); } })) : null,
      ready && (tour[0] || !u.tourDone) ? h(Tour, { t: t, user: u, go: forceGo, onClose: function () { tour[1](false); p.update(function (d) { d.users.forEach(function (x) { if (x.id === u.id) x.tourDone = true; }); }); } }) : null);
  }

  /* ---------------- admin: inbox ---------------- */
  function InboxItem(p) {
    var t = p.t, db = p.db, r = p.r, u = userOf(db, r.userId), l = r.lessonId ? findLesson(db.course, r.lessonId) : null;
    var rep = useState(''), v = useState(null), c = useState(''), dbusy = useState(false), derr = useState('');
    function draftAI() {
      if (!p.sampler || !l) return;
      var prompt = 'Siz BURAQ Logistics SOP menejerisiz. Yangi xodim standart bo‘yicha savol berdi. Faqat standart matniga tayanib, xodimga yuboriladigan qisqa javob loyihasini yozing (o‘zbek tilida, lotin, 3–6 gap, "siz" deb murojaat). Oxirida standart bandini ko‘rsating. Markdown belgilarisiz (yulduzcha, #) oddiy matn yozing. Agar standartda javob bo‘lmasa, buni ayting va standartga qanday aniqlik kiritish kerakligini bir gapda taklif qiling (bu gap "[SOP menejeri uchun]" bilan boshlansin).\n\nXODIM: ' + u.name + ' (' + u.position + ')\nSAVOL: ' + r.text + '\n\nSTANDART: ' + l.title + '\n' + lessonText(l).slice(0, 20000);
      dbusy[1](true); derr[1]('');
      p.sampler(prompt, { onText: function (x) { rep[1](x.text); } }).then(function (res) { rep[1](res.text); }).catch(function (e) { if (e && e.text) rep[1](e.text); derr[1](aiErr(e, t)); }).then(function () { dbusy[1](false); });
    }
    function close(d) { var x = d.requests.filter(function (y) { return y.id === r.id; })[0]; x.state = 'closed'; x.unread = false; x.closedAt = Date.now(); return x; }
    var actions;
    if (r.type === 'question') actions = h('div', { className: 'inbox-act' },
      h(Field, { name: 'rep' + r.id, label: t('reply'), multiline: true, rows: 2, value: rep[0], onChange: rep[1], placeholder: t('reply_ph') }),
      h('div', { className: 'lor-req-act' },
        h(Btn, { variant: 'outline', size: 'sm', disabled: !rep[0].trim(), onClick: function () { p.update(function (d) { var x = close(d); x.reply = rep[0].trim(); setProg(d, u.id, r.lessonId, { status: 'in-progress' }); notify(d, u.id, t('n_reply') + ' · ' + (l ? l.title : '') + ': ' + rep[0].trim(), r.lessonId); }); p.say(t('send_reply') + ' ✓'); } }, t('send_reply')),
        p.sampler ? h(Btn, { variant: 'ghost', size: 'sm', disabled: dbusy[0], onClick: draftAI }, dbusy[0] ? t('ai_thinking') : '✦ ' + t('ai_draft')) : null,
        h(Btn, { variant: 'secondary', size: 'sm', onClick: function () { p.goCms(r.lessonId); } }, t('edit_sop'))),
      derr[0] ? h('span', { className: 'lor-field-error' }, derr[0]) : null);
    else if (r.type === 'exam') actions = h('div', { className: 'inbox-act' },
      h('div', { className: 'lor-review-grid' },
        h('div', { className: 'lor-review-cell' }, h('span', { className: 'lor-eyebrow' }, t('auto_test')), r.score != null ? h(F, null, h('span', { className: 'lor-score' }, r.score + '%'), h('div', { className: 'lor-review-mark' }, h('span', { className: 'lor-sm lor-muted' }, t('pass_mark') + ' ' + PASS_MARK + '%'), h(Badge, { status: r.score >= PASS_MARK ? 'passed' : 'failed', lang: p.lang }))) : h('span', { className: 'lor-sm lor-muted' }, t('no_test'))),
        h('div', { className: 'lor-review-cell' }, h('span', { className: 'lor-eyebrow' }, t('oral')),
          h('div', { className: 'lor-verdict' },
            h('button', { type: 'button', className: v[0] === 'pass' ? 'is-pass' : '', 'aria-pressed': v[0] === 'pass', onClick: function () { v[1]('pass'); } }, '✓ ', t('pass')),
            h('button', { type: 'button', className: v[0] === 'fail' ? 'is-fail' : '', 'aria-pressed': v[0] === 'fail', onClick: function () { v[1]('fail'); } }, '✕ ', t('fail'))))),
      h(Field, { name: 'cm' + r.id, label: t('comment'), multiline: true, rows: 2, value: c[0], onChange: c[1] }),
      h('div', { className: 'lor-req-act' }, h(Btn, { variant: 'primary', size: 'sm', arrow: true, disabled: !v[0], onClick: function () {
        var pass = v[0] === 'pass', cm = c[0].trim();
        p.update(function (d) { var x = close(d); x.verdict = v[0]; setProg(d, u.id, r.lessonId, { status: pass ? 'passed' : 'failed', comment: cm || null }); notify(d, u.id, (pass ? t('n_pass') : t('n_fail')) + ' · ' + (l ? l.title : '') + (cm ? ' — ' + cm : ''), r.lessonId); });
        p.say(t('save_result') + ' ✓');
      } }, t('save_result'))));
    else if (r.type === 'level') {
      var rk = rankOf(db, u), L = levelsOf(db), to = L[r.toLevel];
      actions = h('div', { className: 'inbox-act' },
        h('div', { className: 'lvl-move' }, h(LevelBadge, { t: t, name: lvlShort(L[r.fromLevel], p.lang), n: r.fromLevel }), h(Arrow, { length: 40, tone: 'red' }), h('b', null, to ? lvlName(to, p.lang) : '—'), h('span', { className: 'lor-sm lor-muted' }, rk.xp + ' XP')),
        h(LevelRuler, Object.assign({}, p, { u: u, rank: rk, admin: true, tag: 'ib' + r.id })),
        h('div', { className: 'lor-req-act' },
          h(Btn, { variant: 'ghost', size: 'sm', onClick: function () { p.update(function (d) { var x = close(d); x.verdict = 'declined'; notify(d, u.id, t('level_declined')); }); } }, t('decline')),
          h(Btn, { variant: 'secondary', size: 'sm', disabled: !to, onClick: function () {
            p.update(function (d) { var x = close(d); x.verdict = 'approved'; var xp = rankOf(d, u).xp; d.users.forEach(function (y) { if (y.id === u.id) { y.level = r.toLevel; y.levelXpBase = xp; } }); markPromotion(d, u.id, r.toLevel, r.fromLevel); });
            p.say(t('promo_admin_note'));
            } }, t('approve'))));
    }
    else actions = h('div', { className: 'lor-req-act' },
      h(Btn, { variant: 'ghost', size: 'sm', onClick: function () { p.update(function (d) { var x = close(d); x.verdict = 'declined'; notify(d, u.id, t('n_access_no')); }); } }, t('decline')),
      h(Btn, { variant: 'secondary', size: 'sm', onClick: function () { p.update(function (d) { var x = close(d); x.verdict = 'approved'; d.users.forEach(function (y) { if (y.id === u.id) y.status = 'official'; }); notify(d, u.id, t('n_access_ok')); }); p.say(t('approve') + ' ✓'); } }, t('approve')));
    return h('li', { className: 'lor-req-item inbox-item' },
      h(Av, { name: u.name, src: u.avatar }),
      h('div', { className: 'lor-req-main' },
        h('div', { className: 'lor-req-top' }, r.unread ? h('span', { className: 'lor-unread', 'aria-label': 'new' }) : null, h('b', null, u.name), (function () { if (r.type === 'level') { var k = rankOf(db, u); return h(LevelBadge, { t: t, small: true, name: lvlShort(k.level, p.lang), n: k.li }); } return h(Badge, { status: r.type === 'exam' ? 'exam-ready' : u.status, lang: p.lang }); })()),
        h('span', { className: 'lor-sm lor-muted' }, u.position + (l ? ' · ' + l.sectionTitle + ' · ' + l.title : '') + ' · ' + fmt(r.at, t)),
        r.text ? h('p', { className: 'lor-req-text' }, r.text) : null,
        actions));
  }
  function Inbox(p) {
    var t = p.t, db = p.db, s = useState(p.tab || 'question'), tab = s[0];
    var tabs = [['question', t('tab_q')], ['exam', t('tab_exam')], ['access', t('tab_access')], ['level', t('tab_level')], ['xt', t('tab_xt')]];
    var open = db.requests.filter(function (r) { return r.type === tab && r.state === 'open'; });
    var closed = db.requests.filter(function (r) { return r.type === tab && r.state === 'closed'; }).sort(function (a, b) { return (b.closedAt || 0) - (a.closedAt || 0); }).slice(0, 8);
    function res(r) { if (r.type === 'question') return r.reply ? t('n_reply') + ': ' + r.reply : t('edit_sop') + ' ✓'; if (r.type === 'exam') return (r.verdict === 'pass' ? '✓ ' + t('pass') : '✕ ' + t('fail')) + (r.score != null ? ' · ' + r.score + '%' : ''); return r.verdict === 'approved' ? '✓ ' + t('approve') + (r.type === 'level' && levelsOf(db)[r.toLevel] ? ' · ' + lvlName(levelsOf(db)[r.toLevel], p.lang) : '') : '✕ ' + t('decline'); }
    return h('div', { className: 'app-wrap' },
      h('div', { className: 'page-head' }, h('div', null, h('span', { className: 'lor-eyebrow' }, 'Bildirishnomalar markazi'), h('h1', { className: 'lor-title' }, t('nav_inbox'), h(PageTip, { t: t, id: 'inbox' })))),
      h('section', { className: 'lor-inbox' },
        h('div', { className: 'lor-tabs', role: 'tablist' }, tabs.map(function (tb) {
          var n = tb[0] === 'xt' ? xtReview(db).length : db.requests.filter(function (r) { return r.type === tb[0] && r.state === 'open'; }).length;
          return h('button', { key: tb[0], type: 'button', role: 'tab', 'aria-selected': tab === tb[0], className: cx('lor-tab', tab === tb[0] && 'is-on'), onClick: function () { s[1](tb[0]); } }, tb[1], h('span', { className: 'lor-count' }, n));
        })),
        tab === 'xt' ? h(XtInbox, p) : open.length ? h('ul', { className: 'lor-inbox-list' }, open.map(function (r) { return h(InboxItem, Object.assign({}, p, { key: r.id, r: r })); }))
          : h('p', { className: 'empty' }, t('empty_tab'))),
      tab !== 'xt' && closed.length ? h('section', { className: 'box' }, h('span', { className: 'lor-eyebrow' }, t('history')),
        h('ul', { className: 'hist' }, closed.map(function (r) { var u = userOf(db, r.userId), l = r.lessonId ? findLesson(db.course, r.lessonId) : null; return h('li', { key: r.id }, h('b', null, u.name), h('span', { className: 'lor-muted' }, (l ? l.title + ' · ' : '') + fmt(r.closedAt, t)), h('span', null, res(r))); }))) : null);
  }

  /* ---------------- admin: monitoring ---------------- */
  function Monitor(p) {
    var t = p.t, tb = useState(p.tab === 'month' || p.tab === 'att' ? p.tab : 'list'), tab = tb[0];
    return h('div', { className: 'app-wrap' },
      h('div', { className: 'page-head' }, h('div', null, h('span', { className: 'lor-eyebrow' }, tab === 'month' ? t('mr_eyebrow') : tab === 'att' ? t('at_eyebrow') : 'Progress tracking'), h('h1', { className: 'lor-title' }, t('nav_monitor'), h(PageTip, { t: t, id: tab === 'month' ? 'month' : tab === 'att' ? 'att' : 'monitor' })))),
      h('div', { className: 'seg mon-seg no-print', role: 'tablist' }, [['list', t('mon_tab_list')], ['month', t('mon_tab_month')], ['att', t('mon_tab_att')]].map(function (x) {
        return h('button', { key: x[0], type: 'button', role: 'tab', 'aria-selected': tab === x[0], className: tab === x[0] ? 'is-on' : '', onClick: function () { tb[1](x[0]); } }, x[1]);
      })),
      tab === 'month' ? h(MonthAdmin, p) : tab === 'att' ? h(AttAdmin, p) : h(MonitorList, p));
  }
  function MonitorList(p) {
    var t = p.t, db = p.db, fs = useState('all'), fd = useState(''), ex = useState(null);
    var emps = db.users.filter(function (u) { return u.role === 'employee'; });
    var deps = [''].concat(emps.map(function (u) { return u.department; }).filter(function (x, i, a) { return a.indexOf(x) === i; }));
    var rows = emps.filter(function (u) { return (fs[0] === 'all' || u.status === fs[0]) && (!fd[0] || u.department === fd[0]); });
    var all = flat(db.course);
    var rr = ratingRows(db);
    var avg = emps.length ? Math.round(emps.reduce(function (s, u) { return s + mastery(db, u).pct; }, 0) / emps.length) : 0;
    var waiting = db.requests.filter(function (r) { return r.type === 'exam' && r.state === 'open'; }).length;
    return h(F, null,
      h('div', { className: 'tiles' },
        [[t('m_total'), emps.length], [t('m_prob'), emps.filter(function (u) { return u.status === 'probation'; }).length], [t('m_exam'), waiting], [t('m_avg'), avg + '%']].map(function (x) { return h('div', { key: x[0], className: 'tile' }, h('span', { className: 'lor-eyebrow' }, x[0]), h('b', null, x[1])); })),
      h('div', { className: 'filters' },
        h(Field, { name: 'fs', label: t('th_status'), value: fs[0], onChange: fs[1], options: [['all', t('all')], ['probation', t('s_probation')], ['official', t('s_official')]] }),
        h(Field, { name: 'fd', label: t('department'), value: fd[0], onChange: fd[1], options: deps.map(function (x) { return [x, x || t('all')]; }) })),
      h('div', { className: 'lor-table-wrap' }, h('table', { className: 'lor-table' },
        h('thead', null, h('tr', null, [t('th_emp'), t('level'), t('th_status'), t('th_lesson'), t('th_exams'), t('th_today'), t('th_avgday'), t('th_rating'), t('th_prog')].map(function (x) { return h('th', { key: x }, x); }))),
        h('tbody', null, rows.map(function (u) {
          var cur = currentLesson(db, u), m = mastery(db, u), open = ex[0] === u.id;
          var dots = all.filter(function (l) { return !l.officialOnly || u.status === 'official'; }).map(function (l) { var s = lessonStatus(db, u, l.id); return s === 'passed' ? 'p' : s === 'failed' ? 'f' : s === 'exam-ready' ? 'r' : ''; });
          return h(F, { key: u.id },
            h('tr', { className: 'row-click', onClick: function () { ex[1](open ? null : u.id); }, 'aria-expanded': open },
              h('td', null, h('div', { className: 'lor-emp' }, h(Av, { name: u.name, src: u.avatar, size: 32 }), h('span', null, u.name, h('small', null, u.position + ' · ID ' + u.id)))),
              (function () { var k = rankOf(db, u); return h('td', null, h(LevelBadge, { t: t, small: true, name: lvlShort(k.level, p.lang), n: k.li }), h('div', { className: 'lor-sm lor-muted', style: { marginTop: 4 } }, k.xp + ' XP')); })(),
              h('td', null, h(Badge, { status: u.status, lang: p.lang }), !u.profileComplete ? h('div', { className: 'lor-sm lor-muted', style: { marginTop: 4 } }, t('profile') + ': ' + t('not_filled')) : null),
              h('td', null, cur ? h(F, null, cur.title, h('div', { style: { marginTop: 4 } }, h(Badge, { status: cur.status, lang: p.lang }))) : '—'),
              h('td', null, h('span', { className: 'lor-exams' }, dots.map(function (d, k) { return h('i', { key: k, className: d }); }))),
              h('td', { className: 'num' }, studyMin(db, u.id) >= GOAL ? h('span', { className: 'made' }, '✓ ' + hm(studyMin(db, u.id))) : h('span', { className: 'lor-muted' }, hm(studyMin(db, u.id)))),
              h('td', { className: 'num' }, avgMinutes(db, u) < GOAL ? h('span', { className: 'warn-txt' }, '▾ ' + hm(avgMinutes(db, u))) : hm(avgMinutes(db, u))),
              h('td', { className: 'num' }, (rr.filter(function (x) { return x.id === u.id; })[0] || {}).score),
              h('td', { style: { minWidth: 160 } }, h(Progress, { value: m.pct, label: false }))),
            open ? h('tr', { className: 'row-detail' }, h('td', { colSpan: 9 }, h('span', { className: 'lor-eyebrow' }, t('lessons_of')),
              h('ul', { className: 'detail-list' }, all.map(function (l) { var s = lessonStatus(db, u, l.id), pr = prog(db, u.id)[l.id] || {}; return h('li', { key: l.id }, h('span', null, l.title), h('span', { className: 'detail-r' }, pr.score != null ? h('span', { className: 'lor-sm lor-muted' }, pr.score + '%') : null, h(Badge, { status: s, lang: p.lang }))); })))) : null);
        })))));
  }

  /* ---------------- admin: content (CMS) ---------------- */
  function CMS(p) {
    var t = p.t, db = p.db, first = flat(db.course)[0];
    var sel = useState(p.lessonId || (first && first.id)), id = sel[0];
    var lesson = findLesson(db.course, id);
    var dr = useState(null), draft = dr[0], cf = useState(false), notif = useState(null), baseRef = useRef(''), tab = useState(p.tab || 'lessons');
    useEffect(function () { if (p.tab) tab[1](p.tab); }, [p.tab]);
    useEffect(function () {
      var l = findLesson(db.course, id);
      dr[1](l ? clone({ id: l.id, title: l.title, intro: l.intro || '', html: l.html || '', steps: l.steps || [], limit: l.limit || '', video: l.video || { title: '', duration: '' }, quiz: l.quiz || [] }) : null);
      baseRef.current = l ? lessonText(l) : ''; cf[1](false); notif[1](null);
    }, [id]);
    useEffect(function () { if (p.lessonId) sel[1](p.lessonId); }, [p.lessonId]);
    /* the course appeared (import, another device): open its first lesson */
    useEffect(function () { if (!lesson && first) sel[1](first.id); }, [first && first.id]);
    function setD(fn) { var d = clone(draft); fn(d); dr[1](d); }
    function secUpdate(sid, fn) { p.update(function (d) { d.course.sections.forEach(function (s) { if (s.id === sid) fn(s); }); }); }
    function addLesson(sid) { var nid = 'l' + Date.now().toString(36); p.update(function (d) { d.course.sections.forEach(function (s) { if (s.id === sid) s.lessons.push({ id: nid, title: 'Yangi dars', intro: '', html: '<p></p>', steps: [], limit: '', video: { title: '', duration: '05:00' }, quiz: [] }); }); }); sel[1](nid); }
    function addSection() { p.update(function (d) { d.course.sections.push({ id: 's' + Date.now().toString(36), title: 'Yangi bo‘lim', officialOnly: false, lessons: [] }); }); }
    function save() {
      var n = 0, clean = clone(draft); delete clean._v;
      clean.html = sanitize(clean.html); clean.steps = clean.steps.filter(function (x) { return x.text && x.text.trim(); });
      var before = baseRef.current, after = lessonText(clean);
      /* everyone who already passed this standard has to read what changed */
      var passers = db.users.filter(function (x) { return x.role === 'employee' && (prog(db, x.id)[clean.id] || {}).status === 'passed'; }).map(function (x) { return x.id; });
      p.update(function (d) {
        d.course.sections.forEach(function (s) { s.lessons = s.lessons.map(function (l) { return l.id === draft.id ? Object.assign({}, l, clean) : l; }); });
        d.requests.forEach(function (r) { if (r.type === 'question' && r.lessonId === draft.id && r.state === 'open') { r.state = 'closed'; r.unread = false; r.closedAt = Date.now(); setProg(d, r.userId, r.lessonId, { status: 'updated' }); notify(d, r.userId, t('n_updated') + ' · ' + draft.title, draft.id); n++; } });
      });
      baseRef.current = after;
      if (plain(before) !== plain(after) && passers.length) notif[1]({ lessonId: clean.id, title: clean.title, before: before, after: after, passers: passers });
      setTimeout(function () { p.say(n ? t('saved_notified') + ' (' + n + ')' : t('saved')); }, 0);
    }
    function del() { p.update(function (d) { d.course.sections.forEach(function (s) { s.lessons = s.lessons.filter(function (l) { return l.id !== id; }); }); }); var nx = flat(db.course).filter(function (l) { return l.id !== id; })[0]; sel[1](nx && nx.id); }
    function move(arr, i, dlt) { var j = i + dlt; if (j < 0 || j >= arr.length) return; var x = arr[i]; arr[i] = arr[j]; arr[j] = x; }
    var openQ = db.requests.filter(function (r) { return r.type === 'question' && r.lessonId === id && r.state === 'open'; });

    return h('div', { className: 'app-wrap' },
      h('div', { className: 'page-head' }, h('div', null, h('span', { className: 'lor-eyebrow' }, t('srv_cms_hint')), h('h1', { className: 'lor-title' }, t('nav_cms'), h(PageTip, { t: t, id: 'cms' })))),
      h('div', { className: 'lor-tabs fb-tabs', role: 'tablist' }, [['lessons', t('cms_tab_lessons'), flat(db.course).length], ['cases', t('nav_cases'), (db.cases || []).length], ['journals', t('db_tab_j'), (db.journals || []).length], ['terms', t('db_tab_t'), (db.terms || []).length], ['tracks', t('trk_tab'), (db.tracks || []).length], ['plan', t('pl_tab'), (db.planTpl || []).length], ['wisdom', t('wz_title'), ((db.settings && db.settings.wisdom && db.settings.wisdom.list) || []).length]].map(function (x) {
        return h('button', { key: x[0], type: 'button', role: 'tab', 'aria-selected': tab[0] === x[0], className: cx('lor-tab', tab[0] === x[0] && 'is-on'), onClick: function () { tab[1](x[0]); } }, x[1], h('span', { className: 'lor-count' }, x[2]));
      })),
      tab[0] === 'cases' ? h(CasesAdmin, p) :
      tab[0] === 'journals' ? h(JournalsAdmin, p) :
      tab[0] === 'terms' ? h(TermsAdmin, p) :
      tab[0] === 'tracks' ? h(TracksAdmin, p) :
      tab[0] === 'plan' ? h(PlanAdmin, p) :
      tab[0] === 'wisdom' ? h(WisdomAdmin, p) :
      h('div', { className: 'cms' },
        h('aside', { className: 'cms-tree' },
          db.course.sections.map(function (s, si) {
            return h('div', { key: s.id, className: 'cms-sec' },
              h('input', { className: 'lor-input cms-sec-title', 'aria-label': t('sec_title'), value: s.title, onChange: function (e) { var v = e.target.value; secUpdate(s.id, function (x) { x.title = v; }); } }),
              h('label', { className: 'check' }, h('input', { type: 'checkbox', checked: !!s.officialOnly, onChange: function (e) { var v = e.target.checked; secUpdate(s.id, function (x) { x.officialOnly = v; }); } }), t('official_only')),
              h('ul', null, s.lessons.map(function (l) { return h('li', { key: l.id }, h('button', { type: 'button', className: cx('cms-l', l.id === id && 'is-on'), onClick: function () { sel[1](l.id); } }, l.title || '—')); })),
              h('button', { type: 'button', className: 'app-link', onClick: function () { addLesson(s.id); } }, '+ ' + t('add_lesson')));
          }),
          h(Btn, { variant: 'outline', size: 'sm', onClick: addSection }, '+ ' + t('add_section')),
          h(CourseImport, { t: t, db: p.db, update: p.update, say: p.say })),
        draft && lesson ? h('section', { className: 'box cms-edit' },
          openQ.length ? h('div', { className: 'status-box is-fail' }, h('div', null, h('b', null, '? ' + openQ.length + ' · ' + t('tab_q')), openQ.map(function (r) { return h('p', { key: r.id }, userOf(db, r.userId).name + ': ' + r.text); }))) : null,
          notif[0] ? h(SopNotifyPanel, Object.assign({}, p, { key: notif[0].lessonId + notif[0].title, x: notif[0], onDone: function () { notif[1](null); } })) : null,
          h(LessonRisk, Object.assign({}, p, { lessonId: draft.id })),
          h(CmsAI, { t: t, lang: p.lang, sampler: p.sampler, say: p.say, draft: draft, setD: setD, questions: openQ.map(function (r) { return r.text; }) }),
          h(Field, { name: 'title', label: t('l_title'), required: true, value: draft.title, onChange: function (v) { setD(function (d) { d.title = v; }); } }),
          h(Field, { name: 'intro', label: t('l_intro'), multiline: true, rows: 2, value: draft.intro, onChange: function (v) { setD(function (d) { d.intro = v; }); } }),
          h('h2', { className: 'cms-h' }, t('body')),
          h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('rte_hint')),
          h(RichEditor, { t: t, value: draft.html, docKey: draft.id + ':' + (draft._v || 0), onChange: function (v) { setD(function (d) { d.html = v; }); } }),
          h('h2', { className: 'cms-h' }, t('steps')),
          draft.steps.map(function (s, i) {
            return h('div', { key: i, className: 'cms-step' },
              h('span', { className: 'lor-step-n' }, pad(i + 1)),
              h('div', { className: 'cms-step-body' },
                h(Field, { name: 'st' + i, label: t('step_text'), multiline: true, rows: 2, value: s.text, onChange: function (v) { setD(function (d) { d.steps[i].text = v; }); } }),
                h(Field, { name: 'sw' + i, label: t('step_who'), value: (s.who || []).join(', '), onChange: function (v) { setD(function (d) { d.steps[i].who = v.split(',').map(function (x) { return x.trim(); }).filter(Boolean); }); } }),
                h('div', { className: 'cms-mini' },
                  h('button', { type: 'button', className: 'app-link', onClick: function () { setD(function (d) { move(d.steps, i, -1); }); } }, '↑ ' + t('up')),
                  h('button', { type: 'button', className: 'app-link', onClick: function () { setD(function (d) { move(d.steps, i, 1); }); } }, '↓ ' + t('down')),
                  h('button', { type: 'button', className: 'app-link danger', onClick: function () { setD(function (d) { d.steps.splice(i, 1); }); } }, t('remove')))));
          }),
          h('div', null, h(Btn, { variant: 'outline', size: 'sm', onClick: function () { setD(function (d) { d.steps.push({ text: '', who: [] }); }); } }, '+ ' + t('add_step'))),
          h(Field, { name: 'limit', label: t('l_limit'), multiline: true, rows: 2, value: draft.limit, onChange: function (v) { setD(function (d) { d.limit = v; }); } }),
          h('h2', { className: 'cms-h' }, t('video')),
          h('div', { className: 'lor-form-grid' },
            h(Field, { name: 'vt', label: t('v_title'), value: draft.video.title, onChange: function (v) { setD(function (d) { d.video.title = v; }); } }),
            h(Field, { name: 'vd', label: t('v_dur'), value: draft.video.duration, placeholder: '08:40', onChange: function (v) { setD(function (d) { d.video.duration = v; }); } }),
            h(Field, { name: 'vs', span: true, label: t('v_src'), value: draft.video.src, placeholder: 'https://youtu.be/…', onChange: function (v) { setD(function (d) { d.video.src = v; }); } })),
          h('h2', { className: 'cms-h' }, t('quiz')),
          draft.quiz.map(function (q, i) {
            return h('fieldset', { key: i, className: 'cms-q' },
              h(Field, { name: 'q' + i, label: t('q_text') + ' ' + (i + 1), value: q.q, onChange: function (v) { setD(function (d) { d.quiz[i].q = v; }); } }),
              q.options.map(function (o, k) {
                return h('div', { key: k, className: 'cms-opt' },
                  h('input', { type: 'radio', name: 'ans' + i, id: 'ans' + i + '-' + k, checked: q.answer === k, onChange: function () { setD(function (d) { d.quiz[i].answer = k; }); }, 'aria-label': 'ABCD'[k] + ' — ' + t('correct_opt') }),
                  h('input', { className: 'lor-input', value: o, 'aria-label': 'ABCD'[k], onChange: function (e) { var v = e.target.value; setD(function (d) { d.quiz[i].options[k] = v; }); } }));
              }),
              h('div', { className: 'cms-mini' }, h('span', { className: 'lor-sm lor-muted' }, '◉ = ' + t('correct_opt')), h('button', { type: 'button', className: 'app-link danger', onClick: function () { setD(function (d) { d.quiz.splice(i, 1); }); } }, t('remove'))));
          }),
          h('div', null, h(Btn, { variant: 'outline', size: 'sm', onClick: function () { setD(function (d) { d.quiz.push({ q: '', options: ['', '', '', ''], answer: 0 }); }); } }, '+ ' + t('add_q'))),
          h('div', { className: 'cms-foot' },
            cf[0] ? h('span', { className: 'cms-confirm' }, t('confirm_del'), ' ', h(Btn, { variant: 'ghost', size: 'sm', onClick: function () { cf[1](false); } }, t('cancel')), h(Btn, { variant: 'outline', size: 'sm', onClick: del }, t('yes_del')))
              : h('button', { type: 'button', className: 'app-link danger', onClick: function () { cf[1](true); } }, t('del_lesson')),
            h(Btn, { variant: 'primary', arrow: true, disabled: !draft.title.trim(), onClick: save }, t('save')))) : h('section', { className: 'box' }, h('p', { className: 'lor-muted' }, '—'))));
  }

  /* ---------------- admin: staff ---------------- */
  /* staff page: logins of those who receive initiatives (CEO, Project Manager, Boss) — they see only the initiatives sent to them */
  /* management logins — CEO: SOP managers, CEO, the owner, Project Manager (create, edit, password, remove);
     first — the SOP manager makes the first CEO login while there is none */
  var ACC_KINDS = ['sop', 'ceo', 'boss', 'pm'];
  var ACC_ROLE = { sop: { role: 'admin' }, ceo: { role: 'admin', post: 'ceo' }, boss: { role: 'admin', post: 'boss' }, pm: { role: 'leader', post: 'pm' } };
  function LeadersBox(p) {
    var t = p.t, db = p.db, me = p.user.id, kinds = p.first ? ['ceo'] : ACC_KINDS;
    var list = p.first ? [] : db.users.filter(function (u) { return u.role !== 'employee'; });
    var blank = function () { return { kind: kinds[0], name: '', login: '', password: genPw() }; };
    var f = useState(blank), form = f[0], er = useState({}), made = useState(null), pw = useState({}), del = useState(null), ed = useState(null);
    function set(k, v) { var o = Object.assign({}, form); o[k] = v; f[1](o); }
    function create() {
      var e = {}; ['name', 'login', 'password'].forEach(function (k) { if (!String(form[k]).trim()) e[k] = t('fill_required'); });
      if (!e.login && db.users.some(function (u) { return u.login === form.login.trim().toLowerCase(); })) e.login = t('login_taken');
      er[1](e); if (Object.keys(e).length) return;
      var nid = Math.max.apply(null, db.users.map(function (u) { return u.id; })) + 1;
      p.update(function (d) { d.users.push(Object.assign({ id: nid, login: form.login.trim().toLowerCase(), password: form.password, name: form.name.trim(), position: t('lvl_' + form.kind), department: '', status: 'official', profileComplete: true, tourDone: form.kind === 'pm', createdAt: Date.now() }, ACC_ROLE[form.kind])); });
      made[1]({ login: form.login.trim().toLowerCase(), password: form.password }); f[1](blank());
    }
    function resetPw(u) { var np = genPw(); p.update(function (d) { d.users.forEach(function (x) { if (x.id === u.id) x.password = np; }); }); var o = Object.assign({}, pw[0]); o[u.id] = np; pw[1](o); }
    function remove(u) { del[1](null); p.update(function (d) { d.users = d.users.filter(function (x) { return x.id !== u.id; }); }); }
    return h('section', { className: 'box ld-box' },
      h('h2', { className: 'lor-h' }, t(p.first ? 'acc_first_t' : 'acc_title')),
      h('p', { className: 'lor-sm lor-muted', style: { margin: '0 0 12px' } }, t(p.first ? 'acc_first_hint' : 'acc_hint')),
      p.first ? null : list.length ? h('div', { className: 'lor-table-wrap' }, h('table', { className: 'lor-table ld-table' },
        h('thead', null, h('tr', null, [t('ld_post'), t('fio'), t('login'), ''].map(function (x, i) { return h('th', { key: i }, x); }))),
        h('tbody', null, list.map(function (u) {
          var self = u.id === me;
          return h('tr', { key: u.id },
            h('td', null, t('lvl_' + lvlOf(u))),
            h('td', null, u.name, self ? h('small', { className: 'lor-muted' }, ' · ' + t('acc_you')) : null),
            h('td', null, h('code', null, u.login), pw[0][u.id] ? h('div', { className: 'lor-sm made' }, t('new_pw') + ': ', h('code', null, pw[0][u.id])) : null),
            h('td', { className: 'nowrap' }, h(Btn, { variant: 'ghost', size: 'sm', onClick: function () { ed[1](u.id); } }, t('ue_edit')), self ? null : h(Btn, { variant: 'ghost', size: 'sm', onClick: function () { resetPw(u); } }, t('reset_pw')),
              self ? null : del[0] === u.id ? h(F, null, ' ', h(Btn, { variant: 'outline', size: 'sm', onClick: function () { remove(u); } }, t('ld_del_yes')), h(Btn, { variant: 'ghost', size: 'sm', onClick: function () { del[1](null); } }, t('cancel')))
                : h('button', { type: 'button', className: 'app-link danger', onClick: function () { del[1](u.id); } }, t('remove'))));
        })))) : h('p', { className: 'lor-sm lor-muted' }, t('ld_empty')),
      h('div', { className: 'staff-form ld-form' },
        p.first ? null : h(Field, { name: 'ld-post', label: t('ld_post'), value: form.kind, onChange: function (v) { set('kind', v); }, options: kinds.map(function (x) { return [x, t('lvl_' + x)]; }) }),
        h(Field, { name: 'ld-name', label: t('fio'), required: true, value: form.name, error: er[0].name, onChange: function (v) { set('name', v); }, placeholder: 'Ism Familiya' }),
        h(Field, { name: 'ld-login', label: t('login'), required: true, value: form.login, error: er[0].login, onChange: function (v) { set('login', v); }, placeholder: form.kind === 'sop' ? 'metodist2' : form.kind }),
        h(Field, { name: 'ld-pw', label: t('password'), required: true, value: form.password, error: er[0].password, onChange: function (v) { set('password', v); } })),
      h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, p.first ? null : t('acc_kind_' + form.kind)),
      h('div', { className: 'box-row' },
        made[0] ? h('span', { className: 'lor-sm made' }, '✓ ' + t('created') + ': ', h('code', null, made[0].login + ' / ' + made[0].password)) : h('span'),
        h(Btn, { variant: 'secondary', arrow: true, onClick: create }, t(p.first ? 'acc_first_add' : 'ld_add'))),
      ed[0] && userOf(db, ed[0]).id ? h(UserEditModal, Object.assign({}, p, { key: 'le' + ed[0], u: userOf(db, ed[0]), onClose: function () { ed[1](null); } })) : null);
  }

  /* ---------------- staff from Excel / CSV: name, position, department, login, password (empty — made up) ---------------- */
  var TRANSLIT = { а: 'a', б: 'b', в: 'v', г: 'g', ғ: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', қ: 'q', л: 'l', м: 'm', н: 'n', о: 'o', ў: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ҳ: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya' };
  function latin(s) { return String(s || '').toLowerCase().split('').map(function (c) { return TRANSLIT[c] != null ? TRANSLIT[c] : c; }).join('').replace(/[‘’'`ʻʼ]/g, '').replace(/[^a-z0-9]/g, ''); }
  /* «Dilnoza Karimova» → d.karimova (as the logins made by hand) */
  function autoLogin(name) { var w = String(name || '').trim().split(/\s+/).map(latin).filter(Boolean); return w.length > 1 ? w[0][0] + '.' + w[w.length - 1] : (w[0] || 'xodim'); }
  var IMP_COLS = { id: /^id$/i, name: /f\.?\s*i\.?\s*sh|^ism|familiya|фио|имя|^name|full\s*name/i, position: /lavozim|должност|position/i, department: /bo.?lim|отдел|department/i, login: /login|логин/i, password: /parol|пароль|password/i, phone: /^telefon|^телефон|^phone/i, telegram: /telegram|телеграм/i };
  function importRows(rows, db) {
    var head = (rows[0] || []).map(function (x) { return String(x || ''); }), col = {};
    Object.keys(IMP_COLS).forEach(function (k) { head.forEach(function (hv, i) { if (col[k] == null && IMP_COLS[k].test(hv.trim())) col[k] = i; }); });
    var body = rows;
    if (col.name != null) body = rows.slice(1); else col = { name: 0, position: 1, department: 2, login: 3, password: 4 };
    var owner = {}; db.users.forEach(function (u) { if (u.login) owner[String(u.login).toLowerCase()] = u.id; });
    var used = {};
    return body.map(function (r) {
      var g = function (k) { return col[k] == null ? '' : String(r[col[k]] == null ? '' : r[col[k]]).trim(); };
      var id = +g('id'), cur = id ? db.users.filter(function (u) { return u.id === id && u.role === 'employee'; })[0] : null;
      var x = { name: g('name').replace(/\s+/g, ' '), position: g('position'), department: g('department'), login: g('login').toLowerCase(), password: g('password'), phone: g('phone'), telegram: g('telegram'), err: '' };
      if (!x.name) return null;
      if (x.name.length < 2) x.err = 'imp_x_err_name';
      var free = function (l) { return !used[l] && (owner[l] == null || (cur && owner[l] === cur.id)); };
      if (cur) {
        /* an existing employee (by ID): only what changed; an empty cell keeps the old value */
        x.id = cur.id; x.login = x.login || cur.login;
        if (!LOGIN_RE.test(x.login)) x.err = x.err || 'imp_x_err_login'; else if (!free(x.login)) x.err = x.err || 'imp_x_err_taken';
        var pf = cur.profile || {}, ch = [];
        [['name', cur.name, 'fio'], ['login', cur.login, 'login'], ['position', cur.position, 'position'], ['department', cur.department, 'department'], ['phone', pf.phone, 'imp_x_phone'], ['telegram', pf.telegram, 'imp_x_tg']].forEach(function (f) {
          if (x[f[0]] && x[f[0]] !== (f[1] || '')) ch.push(f[2]);
        });
        if (x.password) ch.push('password');
        x.changes = ch;
      } else {
        x.position = x.position || STAFF_POS[0]; x.department = x.department || STAFF_DEP[0];
        if (x.login) { if (!LOGIN_RE.test(x.login)) x.err = x.err || 'imp_x_err_login'; else if (!free(x.login)) x.err = x.err || 'imp_x_err_taken'; }
        else { var base = autoLogin(x.name), l = base, n = 2; while (!free(l) || !LOGIN_RE.test(l)) { l = (LOGIN_RE.test(base) ? base : 'xodim') + n; n++; } x.login = l; x.auto = true; }
        if (!x.password) x.password = genPw();
      }
      if (!x.err) used[x.login] = 1;
      return x;
    }).filter(Boolean);
  }
  /* ---------- a small .xlsx writer: sheets of rows, the first row bold and frozen — opens in Excel and Google Sheets ---------- */
  var CRC_T = (function () { var t = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { var c = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zipStore(files) {
    var enc = new TextEncoder(), parts = [], central = [], off = 0, d0 = new Date();
    var dosDate = ((d0.getFullYear() - 1980) << 9) | ((d0.getMonth() + 1) << 5) | d0.getDate();
    files.forEach(function (f) {
      var nm = enc.encode(f.name), d = f.data, crc = crc32(d), lh = new Uint8Array(30 + nm.length), v = new DataView(lh.buffer);
      v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true); v.setUint16(12, dosDate, true);
      v.setUint32(14, crc, true); v.setUint32(18, d.length, true); v.setUint32(22, d.length, true); v.setUint16(26, nm.length, true); lh.set(nm, 30);
      var ch = new Uint8Array(46 + nm.length), w = new DataView(ch.buffer);
      w.setUint32(0, 0x02014b50, true); w.setUint16(4, 20, true); w.setUint16(6, 20, true); w.setUint16(8, 0x0800, true); w.setUint16(14, dosDate, true);
      w.setUint32(16, crc, true); w.setUint32(20, d.length, true); w.setUint32(24, d.length, true); w.setUint16(28, nm.length, true); w.setUint32(42, off, true); ch.set(nm, 46);
      parts.push(lh, d); central.push(ch); off += lh.length + d.length;
    });
    var cs = central.reduce(function (a, c) { return a + c.length; }, 0), end = new Uint8Array(22), e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cs, true); e.setUint32(16, off, true);
    return new Blob(parts.concat(central, [end]), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  function xmlEsc(v) { return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''); }
  function colName(i) { var s = ''; i++; while (i) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function makeXlsx(sheets) {
    var enc = new TextEncoder(), f = [], NS = 'http://schemas.openxmlformats.org/', REL = NS + 'officeDocument/2006/relationships/';
    function add(name, xml) { f.push({ name: name, data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + xml) }); }
    add('[Content_Types].xml', '<Types xmlns="' + NS + 'package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + sheets.map(function (x, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join('') + '</Types>');
    add('_rels/.rels', '<Relationships xmlns="' + NS + 'package/2006/relationships"><Relationship Id="rId1" Type="' + REL + 'officeDocument" Target="xl/workbook.xml"/></Relationships>');
    add('xl/workbook.xml', '<workbook xmlns="' + NS + 'spreadsheetml/2006/main" xmlns:r="' + NS + 'officeDocument/2006/relationships"><sheets>'
      + sheets.map(function (x, i) { return '<sheet name="' + xmlEsc(x.name.slice(0, 31)) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') + '</sheets></workbook>');
    add('xl/_rels/workbook.xml.rels', '<Relationships xmlns="' + NS + 'package/2006/relationships">'
      + sheets.map(function (x, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="' + REL + 'worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('')
      + '<Relationship Id="rId' + (sheets.length + 1) + '" Type="' + REL + 'styles" Target="styles.xml"/></Relationships>');
    add('xl/styles.xml', '<styleSheet xmlns="' + NS + 'spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
      + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
      + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');
    sheets.forEach(function (x, i) {
      var wid = [];
      x.rows.forEach(function (r) { r.forEach(function (v, c) { wid[c] = Math.min(50, Math.max(wid[c] || 6, String(v == null ? '' : v).length + 2)); }); });
      add('xl/worksheets/sheet' + (i + 1) + '.xml', '<worksheet xmlns="' + NS + 'spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
        + '<cols>' + wid.map(function (w, c) { return '<col min="' + (c + 1) + '" max="' + (c + 1) + '" width="' + w + '" customWidth="1"/>'; }).join('') + '</cols><sheetData>'
        + x.rows.map(function (r, ri) {
          return '<row r="' + (ri + 1) + '">' + r.map(function (v, ci) {
            if (v == null || v === '') return '';
            var ref = colName(ci) + (ri + 1), st = ri === 0 ? ' s="1"' : '';
            return typeof v === 'number' && isFinite(v) ? '<c r="' + ref + '"' + st + '><v>' + v + '</v></c>' : '<c r="' + ref + '"' + st + ' t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(v) + '</t></is></c>';
          }).join('') + '</row>';
        }).join('') + '</sheetData></worksheet>');
    });
    return zipStore(f);
  }
  function downloadBlob(name, blob) {
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 400);
  }
  /* the staff table: «Xodimlar» (back in through the import — by ID), «Natijalar» (lessons), «Rahbarlar» */
  function staffWorkbook(db) {
    var tu = T('uz'), L = levelsOf(db), emps = db.users.filter(function (u) { return u.role === 'employee'; });
    var xod = [['ID', 'F.I.Sh.', 'Login', 'Lavozim', 'Bo‘lim', 'Telefon', 'Telegram', 'Status', 'Daraja', 'Dastur', 'XP', 'Topshirilgan darslar', 'Ishga kirgan', 'E-mail', 'Tug‘ilgan sana', 'Pasport', 'Manzil', 'Ma’lumoti', 'Tajriba (yil)', 'Tillar', 'Anketa']];
    var nat = [['ID', 'F.I.Sh.', 'Dars', 'Holat', 'Ball', 'Sana']];
    emps.forEach(function (u) {
      var pf = u.profile || {}, pr = prog(db, u.id), passed = Object.keys(pr).filter(function (k) { return pr[k] && pr[k].status === 'passed'; }).length;
      xod.push([u.id, u.name, u.login || '', u.position || '', u.department || '', pf.phone || '', pf.telegram || '', tu('s_' + u.status), lvlName(L[Math.min(u.level || 0, L.length - 1)], 'uz'), trackTitle(trackOf(db, u), 'uz'),
        rankOf(db, u).xp, passed, u.startedAt ? dayKey(u.startedAt) : '', pf.email || '', pf.birth || '', pf.passport || '', pf.address || '', pf.education || '', pf.years || '', pf.languages || '', u.profileComplete ? '✓' : '']);
      Object.keys(pr).forEach(function (lid) {
        var x = pr[lid] || {}, l = findLesson(db.course, lid);
        if (!x.status) return;
        nat.push([u.id, u.name, l ? l.title : lid, tu('s_' + x.status.replace(/-/g, '_')) !== 's_' + x.status.replace(/-/g, '_') ? tu('s_' + x.status.replace(/-/g, '_')) : x.status, x.score != null ? x.score : '', x.at ? dayKey(x.at) : '']);
      });
    });
    var rah = [['ID', 'F.I.Sh.', 'Login', 'Kim']].concat(db.users.filter(function (u) { return u.role !== 'employee'; }).map(function (u) { return [u.id, u.name, u.login || '', tu('lvl_' + lvlOf(u))]; }));
    return makeXlsx([{ name: 'Xodimlar', rows: xod }, { name: 'Natijalar', rows: nat }, { name: 'Rahbarlar', rows: rah }]);
  }
  function csvLine(a) { return a.map(function (v) { v = String(v == null ? '' : v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(';'); }
  function StaffImport(p) {
    var t = p.t, rs = useState(null), rows = rs[0], er = useState(''), done = useState(null), inp = useRef(null);
    function tpl_() { downloadText('xodimlar-namuna.csv', '\ufeff' + [csvLine(['F.I.Sh.', 'Lavozim', 'Bo‘lim', 'Login', 'Parol']), csvLine(['Dilnoza Karimova', STAFF_POS[1], STAFF_DEP[0], '', ''])].join('\r\n'), 'text/csv;charset=utf-8'); }
    function pick(e) {
      var f = e.target.files && e.target.files[0]; e.target.value = '';
      if (!f) return;
      er[1](''); done[1](null);
      f.arrayBuffer().then(function (buf) { return isZip(buf) ? parseXLSX(buf) : parseCSV(decodeText(buf)); })
        .then(function (r) { var x = importRows(r || [], p.db); if (!x.length) { er[1](t('imp_x_none')); rs[1](null); } else rs[1](x); }, function () { er[1](t('imp_x_bad')); rs[1](null); });
    }
    function add() {
      var ok = rows.filter(function (x) { return !x.err && !x.id; }), upd = rows.filter(function (x) { return !x.err && x.id && x.changes.length; });
      p.update(function (d) {
        upd.forEach(function (x) { d.users.forEach(function (u) {
          if (u.id !== x.id) return;
          ['name', 'login', 'position', 'department'].forEach(function (k) { if (x[k]) u[k] = x[k]; });
          if (x.phone || x.telegram) { u.profile = u.profile || {}; if (x.phone) u.profile.phone = x.phone; if (x.telegram) u.profile.telegram = x.telegram; }
          if (x.password) u.password = x.password;   // the server moves it into the account
        }); });
        var nid = Math.max.apply(null, d.users.map(function (u) { return u.id; }).concat([10000])) + 1;
        ok.forEach(function (x) {
          d.users.push({ id: nid++, role: 'employee', login: x.login, password: x.password, name: x.name, position: x.position, department: x.department, trackId: (tracksOf(d).filter(function (tr) { return (tr.positions || []).indexOf(x.position) >= 0; })[0] || {}).id, status: 'probation', profileComplete: false, createdAt: Date.now(), startedAt: Date.now(), cohort: dayKey(Date.now()).slice(0, 7), reminderTime: '19:00' });
        });
      });
      done[1]({ list: ok.concat(upd.filter(function (x) { return x.password; })), a: ok.length, b: upd.length }); rs[1](null);
    }
    function dl() { downloadText('xodimlar-loginlar.csv', '\ufeff' + [csvLine(['F.I.Sh.', 'Lavozim', 'Bo‘lim', 'Login', 'Parol'])].concat(done[0].list.map(function (x) { return csvLine([x.name, x.position, x.department, x.login, x.password]); })).join('\r\n'), 'text/csv;charset=utf-8'); }
    var nA = rows ? rows.filter(function (x) { return !x.err && !x.id; }).length : 0, nB = rows ? rows.filter(function (x) { return !x.err && x.id && x.changes.length; }).length : 0;
    return h('section', { className: 'box imp-box' },
      h('h2', { className: 'lor-h' }, t('imp_x_t')),
      h('p', { className: 'lor-sm lor-muted', style: { margin: '0 0 12px' } }, t('imp_x_hint')),
      h('div', { className: 'box-row imp-act' },
        h('input', { ref: inp, id: 'staff-import', type: 'file', accept: '.xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', className: 'sr-only', onChange: pick }),
        h('label', { className: 'lor-btn lor-btn-outline lor-btn-sm', htmlFor: 'staff-import' }, t('imp_x_pick')),
        h('button', { type: 'button', className: 'app-link', onClick: tpl_ }, t('imp_x_tpl')),
        h(Btn, { variant: 'secondary', size: 'sm', onClick: function () { downloadBlob('buraq-xodimlar-' + dayKey(Date.now()) + '.xlsx', staffWorkbook(p.db)); } }, t('imp_x_export'))),
      h('p', { className: 'lor-sm lor-muted', style: { margin: '8px 0 0' } }, t('imp_x_gs_hint')),
      er[0] ? h('p', { className: 'lor-field-error' }, er[0]) : null,
      rows ? h(F, null,
        h('div', { className: 'lor-table-wrap' }, h('table', { className: 'lor-table imp-table' },
          h('thead', null, h('tr', null, [t('fio'), t('position'), t('department'), t('login'), t('password'), t('imp_x_col_status')].map(function (x, i) { return h('th', { key: i }, x); }))),
          h('tbody', null, rows.map(function (x, i) {
            return h('tr', { key: i, className: x.err ? 'imp-bad' : '' }, h('td', null, x.name), h('td', null, x.position), h('td', null, x.department),
              h('td', null, h('code', null, x.login), x.auto ? h('small', { className: 'lor-muted' }, ' · ' + t('imp_x_auto')) : null), h('td', null, x.password ? h('code', null, x.password) : '—'),
              h('td', null, x.err ? h('span', { className: 'lor-field-error' }, t(x.err)) : !x.id ? '✓ ' + t('imp_x_new')
                : x.changes.length ? h('span', { title: x.changes.map(function (k) { return t(k); }).join(', ') }, '✎ ' + tpl(t('imp_x_upd'), { n: x.changes.length }) + ': ' + x.changes.map(function (k) { return t(k); }).join(', ')) : h('span', { className: 'lor-muted' }, t('imp_x_same'))));
          })))),
        h('div', { className: 'box-row' },
          h(Btn, { variant: 'ghost', size: 'sm', onClick: function () { rs[1](null); } }, t('cancel')),
          h(Btn, { variant: 'primary', arrow: true, disabled: !nA && !nB, onClick: add }, tpl(t('imp_x_apply'), { a: nA, b: nB })))) : null,
      done[0] ? h('div', { className: 'lor-notice imp-done' }, h('div', { className: 'lor-notice-body' },
        h('b', null, '✓ ' + tpl(t('imp_x_done2'), { a: done[0].a, b: done[0].b })),
        done[0].list.length ? h('p', { className: 'lor-sm', style: { margin: '4px 0 8px' } }, t('imp_x_dl_hint')) : null,
        done[0].list.length ? h(Btn, { variant: 'secondary', size: 'sm', onClick: dl }, t('imp_x_dl')) : null)) : null);
  }

  function Staff(p) {
    var t = p.t, db = p.db;
    var blank = function () { return { name: '', position: 'Omborchi', department: 'Logistika bo‘limi', login: '', password: genPw() }; };
    var f = useState(blank), form = f[0], er = useState({}), pw = useState({}), made = useState(null);
    var op = useState(null), flt = useState('all'), ed = useState(null);
    function set(k, v) { var o = Object.assign({}, form); o[k] = v; f[1](o); }
    function create() {
      var e = {}; ['name', 'login', 'password'].forEach(function (k) { if (!String(form[k]).trim()) e[k] = t('fill_required'); });
      if (!e.login && db.users.some(function (u) { return u.login === form.login.trim().toLowerCase(); })) e.login = t('login_taken');
      er[1](e); if (Object.keys(e).length) return;
      var nid = Math.max.apply(null, db.users.map(function (u) { return u.id; })) + 1;
      p.update(function (d) { d.users.push({ id: nid, role: 'employee', login: form.login.trim().toLowerCase(), password: form.password, name: form.name.trim(), position: form.position, department: form.department, trackId: (tracksOf(d).filter(function (x) { return (x.positions || []).indexOf(form.position) >= 0; })[0] || {}).id, status: 'probation', profileComplete: false, createdAt: Date.now(), startedAt: Date.now(), cohort: dayKey(Date.now()).slice(0, 7), reminderTime: '19:00' }); });
      made[1]({ login: form.login.trim().toLowerCase(), password: form.password, name: form.name.trim() }); f[1](blank());
    }
    var emps = db.users.filter(function (u) { return u.role === 'employee'; });
    var L = levelsOf(db), open = op[0];
    var fl = flt[0], rows = emps.filter(function (u) { return fl === 'all' || String(Math.min(u.level || 0, L.length - 1)) === fl; });
    var groups = L.map(function (lv, i) { return { i: i, lv: lv, list: rows.filter(function (u) { return Math.min(u.level || 0, L.length - 1) === i; }) }; }).filter(function (g) { return g.list.length; });
    var moodAll = emps.map(function (u) { return empMood(db, u.id); }).filter(function (m) { return m.n; });
    var moodAvg = moodAll.length ? moodAll.reduce(function (a, m) { return a + (m.recent || m.avg); }, 0) / moodAll.length : 0;
    var attnList = emps.filter(function (u) { var m = empMood(db, u.id); return m.n && ((m.recent || m.avg) < 3 || m.low.length); });

    function row(u) {
      var m = empMood(db, u.id), isOpen = open === u.id;
      return h(F, { key: u.id },
        h('tr', { className: cx(isOpen && 'is-open') },
          h('td', null, h('div', { className: 'lor-emp' }, h(Av, { name: u.name, src: u.avatar, size: 32 }), h('span', null, u.name, h('small', null, u.position + ' · ' + u.department))),
            (function () { var xs = xtasksOf(db, u.id), act = xs.filter(function (x) { return x.status !== 'done'; }).length, rev = xs.filter(function (x) { return x.status === 'review'; }).length;
              return h('button', { type: 'button', className: cx('xt-staff-b', rev && 'has-rev'), 'aria-expanded': isOpen, onClick: function () { op[1](u.id); setTimeout(function () { var el = document.getElementById('xt-' + u.id); if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 60); } },
                h(CondIco, { type: 'xtask', size: 13 }), act ? tpl(t('xt_staff_n'), { n: act }) : t('xt_staff_add'), rev ? h('span', { className: 'app-navcount' }, rev) : null); })()),
          h('td', null, h('code', null, u.login), pw[0][u.id] ? h('div', { className: 'lor-sm made' }, t('new_pw') + ': ', h('code', null, pw[0][u.id])) : null),
          h('td', null,
            h('select', { className: 'lor-input slim', 'aria-label': t('trk_title'), value: (trackOf(db, u) || {}).id || '', onChange: function (e) { var v = e.target.value; p.update(function (d) { d.users.forEach(function (x) { if (x.id === u.id) { if (v) x.trackId = v; else delete x.trackId; } }); }); } },
              h('option', { value: '' }, t('trk_none')),
              tracksOf(db).map(function (x) { return h('option', { key: x.id, value: x.id }, trackTitle(x, p.lang)); })),
            (function () { var st = planStat(db, u); return h('div', { className: cx('lor-sm', st.late ? 'plan-late' : 'lor-muted'), style: { marginTop: 4 } }, tpl(t('pl_col'), { n: st.done, all: st.total })); })()),
          h('td', null, h('select', { className: 'lor-input slim', 'aria-label': t('level'), value: Math.min(u.level || 0, L.length - 1), onChange: function (e) { var v = +e.target.value, was = rankOf(db, u); p.update(function (d) { var xp = xpOf(d, u); d.users.forEach(function (x) { if (x.id === u.id) { x.level = v; x.levelXpBase = xp; x.levelAt = Date.now(); if (v <= was.li) x.lastRank = String(v); } }); if (v > was.li) markPromotion(d, u.id, v, was.li); }); if (v > was.li) p.say(t('promo_admin_note')); } },
            L.map(function (l, i) { return h('option', { key: l.id, value: i }, lvlName(l, p.lang)); })), h('div', { className: 'lor-sm lor-muted', style: { marginTop: 4 } }, rankOf(db, u).xp + ' XP')),
          h('td', null, h('select', { className: 'lor-input slim', 'aria-label': t('th_status'), value: u.status, onChange: function (e) { var v = e.target.value; p.update(function (d) { d.users.forEach(function (x) { if (x.id === u.id) x.status = v; }); }); } },
            h('option', { value: 'probation' }, t('s_probation')), h('option', { value: 'official' }, t('s_official')))),
          h('td', { className: 'sp-td' }, h('button', { type: 'button', className: 'sp-btn', 'aria-expanded': isOpen, onClick: function () { op[1](isOpen ? null : u.id); } }, h(PulseCell, { t: t, m: m }))),
          h('td', null, u.profileComplete ? '✓ ' + t('filled') : h('span', { className: 'lor-muted' }, '○ ' + t('not_filled')),
            (function () { var pf = (u.profile || {}).passportFile; return pf ? h('a', { className: 'app-link pp-link', href: pf.data, download: pf.name, target: '_blank', rel: 'noopener', onClick: saveLink(pf.name) }, t('pp_staff')) : h('div', { className: 'lor-sm lor-muted' }, '○ ' + t('pp_staff')); })()),
          (function () {
            var mineA = assetsOf(db, u.id), live = mineA.filter(function (a) { return a.status !== 'returned'; }).length, attn = mineA.filter(assetAttn).length;
            return h('td', { className: 'nowrap' }, h('button', { type: 'button', className: 'app-link as-staff', onClick: function () { p.goAssets(u.id); } }, live + ' ' + t('pcs'), attn ? h('span', { className: 'app-navcount' }, attn) : null),
              h('div', { className: 'lor-sm lor-muted', style: { marginTop: 4 } }, u.assetsDeclaredAt ? '✓ ' + t('as_declared_short') : '○ ' + t('not_filled')));
          })(),
          h('td', { className: 'nowrap' }, u.termsAcceptedAt ? h('span', { className: 'lor-sm' }, '✓ ' + fmtDate(u.termsAcceptedAt)) : h('span', { className: 'lor-muted' }, '○')),
          h('td', { className: 'nowrap' }, h(Btn, { variant: 'ghost', size: 'sm', onClick: function () { ed[1](u.id); } }, t('ue_edit')),
            h(Btn, { variant: 'ghost', size: 'sm', onClick: function () { var np = genPw(); p.update(function (d) { d.users.forEach(function (x) { if (x.id === u.id) x.password = np; }); }); var o = Object.assign({}, pw[0]); o[u.id] = np; pw[1](o); } }, t('reset_pw')))),
        isOpen ? h('tr', { className: 'sp-row' }, h('td', { colSpan: 10 },
          h('div', { className: 'sp-detail' },
            h(XtPanel, Object.assign({}, p, { u: u, key: 'xtp' + u.id })),
            h(PlanBox, Object.assign({}, p, { u: u, admin: true })),
            rankOf(db, u).next ? h('section', { className: 'box sp-level' }, h('span', { className: 'lor-eyebrow' }, tpl(t('lr_title'), { x: lvlName(rankOf(db, u).next, p.lang) }) + ' · ' + u.name), h(LevelRuler, Object.assign({}, p, { u: u, admin: true, tag: 'sp' }))) : null,
            h('span', { className: 'lor-eyebrow' }, t('sp_detail') + ' · ' + u.name),
            h(PulseDetail, { t: t, db: db, uid: u.id })))) : null);
    }

    return h('div', { className: 'app-wrap' },
      h('div', { className: 'page-head' }, h('div', null, h('span', { className: 'lor-eyebrow' }, 'RBAC'), h('h1', { className: 'lor-title' }, t('nav_staff'), h(PageTip, { t: t, id: 'staff' })))),
      h('div', { className: 'tiles' },
        h('div', { className: 'tile' }, h('span', { className: 'lor-eyebrow' }, t('sp_t_emps')), h('b', null, emps.length), h('span', { className: 'lor-sm lor-muted' }, tpl(t('sp_t_levels'), { n: groups.length }))),
        h('div', { className: 'tile' }, h('span', { className: 'lor-eyebrow' }, t('sp_t_new')), h('b', null, emps.filter(function (u) { return u.status === 'probation'; }).length), h('span', { className: 'lor-sm lor-muted' }, t('s_probation'))),
        h('div', { className: 'tile' }, h('span', { className: 'lor-eyebrow' }, t('sp_t_mood')), h('div', { className: 'tile-mood' }, moodAvg ? h(Face, { v: Math.max(1, Math.min(5, Math.round(moodAvg))), size: 34 }) : null, h('b', null, moodAvg ? moodAvg.toFixed(1) : '—')), h('span', { className: 'lor-sm lor-muted' }, tpl(t('sp_t_answered'), { n: moodAll.length, all: emps.length }))),
        h('div', { className: 'tile' }, h('span', { className: 'lor-eyebrow' }, t('sp_t_attn')), h('b', null, attnList.length), h('span', { className: 'lor-sm lor-muted' }, t('sp_t_attn_sub')))),
      attnList.length ? h('section', { className: 'box sp-attn' },
        h('span', { className: 'lor-eyebrow' }, t('sp_attn_t')),
        h('div', { className: 'sp-attn-list' }, attnList.map(function (u) {
          var m = empMood(db, u.id);
          return h('button', { key: u.id, type: 'button', className: cx('sp-attn-p', moodClass(m.recent || m.avg)), onClick: function () { op[1](u.id); } },
            h(Face, { v: Math.max(1, Math.min(5, Math.round(m.recent || m.avg))), size: 26 }),
            h('span', null, h('b', null, u.name), h('small', null, (m.low.length ? m.low.map(function (k) { return t('pt_' + k); }).join(', ') : (m.recent || m.avg).toFixed(1) + ' / 5'))));
        })),
        h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('sp_attn_note'))) : null,
      lvlOf(p.user) === 'boss' ? null : h('section', { className: 'box' },
        h('h2', { className: 'lor-h' }, t('new_emp')),
        h('div', { className: 'staff-form' },
          h(Field, { name: 'n-name', label: t('fio'), required: true, value: form.name, error: er[0].name, onChange: function (v) { set('name', v); }, placeholder: 'Ism Familiya' }),
          h(Field, { name: 'n-pos', label: t('position'), value: form.position, onChange: function (v) { set('position', v); }, options: STAFF_POS }),
          h(Field, { name: 'n-dep', label: t('department'), value: form.department, onChange: function (v) { set('department', v); }, options: STAFF_DEP }),
          h(Field, { name: 'n-login', label: t('login'), required: true, value: form.login, error: er[0].login, onChange: function (v) { set('login', v); }, placeholder: 'i.familiya' }),
          h(Field, { name: 'n-pw', label: t('password'), required: true, value: form.password, error: er[0].password, onChange: function (v) { set('password', v); } })),
        h('div', { className: 'box-row' },
          made[0] ? h('span', { className: 'lor-sm made' }, '✓ ' + t('created') + ': ', h('code', null, made[0].login + ' / ' + made[0].password)) : h('span'),
          h(Btn, { variant: 'primary', arrow: true, onClick: create }, t('create')))),
      lvlOf(p.user) === 'boss' ? null : h('section', { className: 'box pp-ask' },
        h('label', { className: 'check' }, h('input', { type: 'checkbox', checked: askPassport(db), onChange: function (e) { var v = e.target.checked; p.update(function (d) { d.settings = d.settings || {}; d.settings.passportScan = v; }); } }), t('pp_ask')),
        h('p', { className: 'lor-sm lor-muted', style: { margin: '6px 0 0' } }, t('pp_ask_hint'))),
      lvlOf(p.user) === 'boss' ? null : h(StaffImport, p),
      /* logins of the management: CEO — everyone's; SOP manager — only the first CEO, while there is none */
      lvlOf(p.user) === 'ceo' ? h(LeadersBox, p)
        : lvlOf(p.user) === 'sop' && !db.users.some(function (u) { return lvlOf(u) === 'ceo'; }) ? h(LeadersBox, Object.assign({}, p, { first: true })) : null,
      h('div', { className: 'seg sp-seg', role: 'tablist' }, [['all', t('all'), emps.length]].concat(L.map(function (lv, i) { return [String(i), lvlShort(lv, p.lang), emps.filter(function (u) { return Math.min(u.level || 0, L.length - 1) === i; }).length]; })).map(function (x) {
        return h('button', { key: x[0], type: 'button', role: 'tab', 'aria-selected': fl === x[0], className: fl === x[0] ? 'is-on' : '', onClick: function () { flt[1](x[0]); } }, x[1], h('span', { className: 'lor-count' }, x[2]));
      })),
      groups.map(function (g) {
        return h('section', { key: g.lv.id, className: 'sp-group' },
          h('div', { className: 'sp-group-h' },
            h(LevelEmblem, { n: g.i + 1, size: 34, uid: 'st' + g.i, className: 'lvl-mini' }),
            h('div', null, h('b', null, lvlName(g.lv, p.lang)), lvlRole(g.lv, p.lang) ? h('small', null, lvlRole(g.lv, p.lang)) : null),
            h('span', { className: 'sp-group-n' }, tpl(t('sp_n_emp'), { n: g.list.length })),
            stepXp(L, g.i) != null ? h('span', { className: 'lor-sm lor-muted' }, stepXp(L, g.i) + ' XP') : null),
          h('div', { className: 'lor-table-wrap' }, h('table', { className: 'lor-table staff-table' },
            h('thead', null, h('tr', null, [t('th_emp'), t('login'), t('trk_col'), t('level'), t('th_status'), t('sp_col'), t('profile'), t('as_col'), t('th_terms'), ''].map(function (x, i) { return h('th', { key: i }, x); }))),
            h('tbody', null, g.list.map(row)))));
      }),
      groups.length ? null : h('section', { className: 'box' }, h('p', { className: 'lor-muted', style: { margin: 0 } }, t('sp_empty'))),
      ed[0] && userOf(db, ed[0]).id ? h(UserEditModal, Object.assign({}, p, { key: 'ue' + ed[0], u: userOf(db, ed[0]), onClose: function () { ed[1](null); } })) : null);
  }

  /* ---------------- admin shell ---------------- */
  function AdminApp(p) {
    var lv = lvlOf(p.user);
    if (lv === 'boss') p = Object.assign({}, p, { update: roUpdate(p, p.t) });   // the owner: view only
    var t = p.t, db = p.db, r = useState({ name: lv === 'boss' ? 'monitor' : 'inbox' }), route = r[0];
    var openN = db.requests.filter(function (x) { return x.state === 'open'; }).length + xtReview(db).length;
    function go(x) { r[1](x); window.scrollTo(0, 0); }
    var ai = useState(false), tour = useState(false), pal = useState(false);
    usePalette(pal[0], pal[1]);
    var hintOn = !!p.user.hints;
    var theme = useThemePref(p.say, t);
    var hint = { on: hintOn, toggle: function (v) { p.update(function (d) { d.users.forEach(function (x) { if (x.id === p.user.id) x.hints = v; }); }); p.say(t(v ? 'hint_said_on' : 'hint_said_off')); } };

    var attnA = (db.assets || []).filter(assetAttn).length, newIni = (db.initiatives || []).filter(function (x) { var to = iniTo(x); return (!to.length || to.indexOf(p.user.post) >= 0) && x.status === 'new'; }).length;
    var qN = errStats(db, 90).open;
    var nav = [['inbox', t('nav_inbox'), openN], ['monitor', t('nav_monitor')], ['quality', t('nav_quality'), qN], ['rating', t('nav_rating')], ['levels', t('nav_levels')], ['cms', t('nav_cms')], ['staff', t('nav_staff')], ['assets', t('nav_assets'), attnA], ['feedback', t('nav_feedback'), newIni], ['pay', t('nav_pay'), lv === 'ceo' ? (db.payCalcs || []).filter(function (c) { return c.status === 'saved'; }).length : 0]].filter(function (n) { return n[0] !== 'pay' || lv !== 'sop'; }).map(function (n) { return { key: n[0], label: n[1], count: n[2], active: route.name === n[0], onClick: function () { go({ name: n[0] }); } }; });
    var q = Object.assign({}, p, { goCms: function (lid) { go({ name: 'cms', lessonId: lid }); }, goAssets: function (uid) { go({ name: 'assets', uid: uid }); } });
    var main = route.name === 'monitor' ? h(Monitor, Object.assign({}, q, { tab: route.tab, ym: route.ym })) : route.name === 'rating' ? h(Rating, q) : route.name === 'levels' ? h(LevelsAdmin, q) : route.name === 'cms' ? h(CMS, Object.assign({}, q, { lessonId: route.lessonId, tab: route.tab })) : route.name === 'staff' ? h(Staff, q)
      : route.name === 'assets' ? h(AssetsAdmin, Object.assign({}, q, { uid: route.uid, key: 'as' + (route.uid || '') })) : route.name === 'feedback' ? h(FeedbackAdmin, Object.assign({}, q, { tab: route.tab }))
      : route.name === 'quality' ? h(QualityAdmin, Object.assign({}, q, { tab: route.tab }))
      : route.name === 'pay' && lv !== 'sop' ? h(PayAdmin, Object.assign({}, q, { tab: route.tab }))
      : route.name === 'help' ? h(HelpPage, Object.assign({}, q, { go: go, hint: hint, theme: theme, onTour: function () { tour[1](true); } })) : h(Inbox, Object.assign({}, q, { tab: route.tab }));
    return h(F, null,
      h(Header, { t: t, lang: p.lang, setLang: p.setLang, onProfile: p.openProfile, user: p.user, nav: nav, wide: true, onLogout: p.logout, onTerms: p.showTerms, subtitle: t('lvl_' + lv),
        hint: hint, theme: theme, onSearch: function () { pal[1](true); }, onHelp: function () { go({ name: 'help' }); }, links: [{ key: 'help', label: t('nav_help'), onClick: function () { go({ name: 'help' }); } }, { key: 'export', label: t('exp_btn'), onClick: function () { exportAll(p.say, t); } }],
        notifs: db.notifications.filter(function (n) { return n.userId === p.user.id; }), fmtNotif: function (n) { return notifText(n, db, p.lang, t); },
        onReadAll: function () { p.update(function (d) { d.notifications.forEach(function (n) { if (n.userId === p.user.id) n.read = true; }); }); },
        onNotif: function (n) { p.update(function (d) { d.notifications.forEach(function (x) { if (x.id === n.id) x.read = true; }); }); go({ name: n.route === 'mentor' ? 'quality' : (n.route || 'inbox'), tab: n.kind === 'errfix' ? 'err' : (n.tab || null), ym: n.ym || null }); } }),
      h('div', { className: 'app-body no-side' }, h('main', { className: 'app-main', id: 'main' },
        lv === 'boss' ? h('div', { className: 'ro-bar', role: 'note' }, h(Ico, { name: 'lock', size: 16 }), h('span', null, t('ro_bar'))) : null,
        h('div', { className: 'page-anim', key: route.name + (route.id || route.uid || route.lessonId || '') + (route.tab || '') + (route.ym || '') }, main), h(Foot, { t: t, onTerms: p.showTerms, admin: true, say: p.say }))),
      h(AIMentor, Object.assign({}, p, { open: ai[0], setOpen: ai[1], lessonId: route.name === 'cms' ? route.lessonId : null, openLesson: function (id) { go({ name: 'cms', lessonId: id }); } })),
      hintOn && !tour[0] && p.user.tourDone ? h(HintLayer, { t: t }) : null,
      pal[0] ? h(Palette, Object.assign({}, q, { user: p.user, onClose: function () { pal[1](false); }, go: function (x) { go(x); } })) : null,
      tour[0] || !p.user.tourDone ? h(Tour, { t: t, user: p.user, go: go, onClose: function () { tour[1](false); p.update(function (d) { d.users.forEach(function (x) { if (x.id === p.user.id) x.tourDone = true; }); }); } }) : null);
  }

  /* ---------------- recipient shell: CEO, Project Manager, Boss — the initiatives sent to them, nothing else ---------------- */
  function LeaderApp(p) {
    var t = p.t, db = p.db, u = p.user, theme = useThemePref(p.say, t);
    var only = function (x) { return iniTo(x).indexOf(u.post) >= 0; };
    var nNew = (db.initiatives || []).filter(function (x) { return only(x) && x.status === 'new'; }).length;
    return h(F, null,
      h(Header, { t: t, lang: p.lang, setLang: p.setLang, onProfile: p.openProfile, user: u, wide: true, onLogout: p.logout, onTerms: p.showTerms, theme: theme,
        subtitle: INI_TO.indexOf(u.post) >= 0 ? t('ini_to_' + u.post) : u.position,
        nav: [{ key: 'ideas', label: t('fb_tab_ini'), count: nNew, active: true, onClick: function () { window.scrollTo(0, 0); } }],
        notifs: db.notifications.filter(function (n) { return n.userId === u.id; }), fmtNotif: function (n) { return notifText(n, db, p.lang, t); },
        onReadAll: function () { p.update(function (d) { d.notifications.forEach(function (n) { if (n.userId === u.id) n.read = true; }); }); },
        onNotif: function (n) { p.update(function (d) { d.notifications.forEach(function (x) { if (x.id === n.id) x.read = true; }); }); } }),
      h('div', { className: 'app-body no-side' }, h('main', { className: 'app-main', id: 'main' },
        h('div', { className: 'app-wrap' },
          h('div', { className: 'page-head' }, h('div', null, h('span', { className: 'lor-eyebrow' }, t('ini_eyebrow')), h('h1', { className: 'lor-title' }, t('ld_inbox_t')),
            h('p', { className: 'lor-muted', style: { margin: '6px 0 0' } }, t('ld_inbox_p')))),
          h(IniAdmin, Object.assign({}, p, { only: only }))),
        h(Foot, { t: t, onTerms: p.showTerms, say: p.say }))));
  }

  /* the SOP manager downloads all data and files — a copy kept outside the server */
  function exportAll(say, t) {
    say(t('exp_wait'));
    SV.exportAll().then(function (x) {
      downloadText('buraq-lms-' + dayKey(Date.now()) + '.json', JSON.stringify(x), 'application/json;charset=utf-8');
      say(tpl(t('exp_done'), { n: Object.keys(x.files || {}).length }));
    }, function (e) { say(t(e.code === 'net' ? 'srv_net' : 'exp_err')); });
  }

  /* ---------------- server: templates, course import, sync status, server code ---------------- */
  /* a new platform on the server starts empty: levels, programmes, the 30/60/90 plan and the schedule come from the templates */
  function fillTemplates(d) {
    if (!(d.levels || []).length) d.levels = seedLevels();
    if (!(d.tracks || []).length) d.tracks = seedTracks();
    if (!(d.planTpl || []).length) d.planTpl = seedPlan();
    d.settings = d.settings || {};
    if (!d.settings.schedule) d.settings.schedule = seedSchedule();
    if (!d.settings.survey) d.settings.survey = { on: true, every: 3, round: 0 };
  }
  /* chapter 4 from the prototype file (the .html exported from Claude): the line «var CH4 = […];».
     A file of the former demo had only titles — that one is refused */
  function parseCh4(text) {
    var m = /^var CH4 = (\[.*\]);\s*$/m.exec(text), list;
    if (!m) return null;
    try { list = JSON.parse(m[1]); } catch (e) { return null; }
    if (!Array.isArray(list) || !list.length || list.some(function (x) { return !x || !x.id || !x.title || typeof x.html !== 'string'; })) return null;
    return list.some(function (x) { return x.html.indexOf('Namuna (demo)') >= 0; }) ? 'demo' : list;
  }
  /* a section file (.json) — a chapter of the standards made outside the repo (the texts stay on the server only):
     { app: 'buraq-lms-chapter', v: 1, tracks: 'all' | [track ids],
       section: { id, title: '2-bob. …', officialOnly, lessons: [{ id, title, html, quiz: [{ q, options, answer }], source }] } } */
  var SEC_ID = /^[\w-]{1,40}$/;
  function parseChapter(text) {
    var x; try { x = JSON.parse(text); } catch (e) { return null; }
    var s = x && x.app === 'buraq-lms-chapter' ? x.section : null, seen = {}, bad = false;
    if (!s || !SEC_ID.test(s.id || '') || typeof s.title !== 'string' || !s.title.trim() || !Array.isArray(s.lessons) || !s.lessons.length) return null;
    var lessons = s.lessons.map(function (l) {
      if (!l || !SEC_ID.test(l.id || '') || seen[l.id] || typeof l.title !== 'string' || !l.title.trim() || typeof l.html !== 'string') { bad = true; return null; }
      seen[l.id] = 1;
      var quiz = (Array.isArray(l.quiz) ? l.quiz : []).filter(function (q) {
        return q && typeof q.q === 'string' && q.q.trim() && Array.isArray(q.options) && q.options.length >= 2 && q.options.every(function (o) { return typeof o === 'string'; })
          && q.answer === Math.floor(q.answer) && q.answer >= 0 && q.answer < q.options.length;
      }).map(function (q) { return { q: q.q.trim(), options: q.options.slice(), answer: q.answer }; });
      var out = { id: l.id, title: l.title.trim(), html: sanitize(l.html), quiz: quiz };
      if (typeof l.source === 'string') out.source = l.source;
      return out;
    });
    if (bad) return null;
    return { section: { id: s.id, title: s.title.trim(), officialOnly: !!s.officialOnly, lessons: lessons },
      tracks: x.tracks === 'all' ? 'all' : Array.isArray(x.tracks) ? x.tracks.filter(function (t) { return typeof t === 'string'; }) : [] };
  }
  function chapNo(title) { var m = /^(\d+)\s*-\s*bob\b/i.exec(title || ''); return m ? +m[1] : null; }
  /* the same section is replaced in place; a new one goes before the first chapter with a higher number
     (2-bob before 4-bob; the intro without a number stays first) and into the programmes */
  function importChapter(p, ch) {
    var t = p.t, sec = ch.section, ids = {};
    sec.lessons.forEach(function (l) { ids[l.id] = 1; });
    var clash = p.db.course.sections.some(function (s) { return s.id !== sec.id && s.lessons.some(function (l) { return ids[l.id]; }); });
    if (clash) { p.say(t('imp_clash')); return; }
    p.update(function (d) {
      var list = d.course.sections, copy = JSON.parse(JSON.stringify(sec)), i = list.findIndex(function (x) { return x.id === sec.id; });
      if (i >= 0) list[i] = copy;
      else {
        var n = chapNo(sec.title), j = n === null ? -1 : list.findIndex(function (x) { var m = chapNo(x.title); return m !== null && m > n; });
        if (j < 0) list.push(copy); else list.splice(j, 0, copy);
      }
      (d.tracks || []).forEach(function (tr) {
        if ((ch.tracks === 'all' || ch.tracks.indexOf(tr.id) >= 0) && (tr.sections || []).length && tr.sections.indexOf(sec.id) < 0) tr.sections.push(sec.id);
      });
    });
    p.say(tpl(t('imp_sec_ok'), { x: sec.title, n: sec.lessons.length, q: sec.lessons.reduce(function (a, l) { return a + l.quiz.length; }, 0) }));
  }
  function CourseImport(p) {
    var t = p.t;
    function pick(e) {
      var f = e.target.files && e.target.files[0]; e.target.value = '';
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        var text = String(rd.result || ''), ch = parseChapter(text);
        if (ch) { importChapter(p, ch); return; }
        var list = parseCh4(text);
        if (list === 'demo') { p.say(t('imp_demo')); return; }
        if (!list) { p.say(t('imp_bad')); return; }
        var secs = ch4Sections(list);
        p.update(function (d) {
          secs.forEach(function (s) { var i = d.course.sections.findIndex(function (x) { return x.id === s.id; }); if (i >= 0) d.course.sections[i] = s; else d.course.sections.push(s); });
        });
        p.say(tpl(t('imp_ok'), { n: list.length }));
      };
      rd.readAsText(f);
    }
    return h('div', { className: 'cms-import' },
      h('input', { id: 'cms-import', type: 'file', accept: '.json,.html,application/json,text/html', className: 'sr-only', onChange: pick }),
      h('label', { className: 'lor-btn lor-btn-outline lor-btn-sm', htmlFor: 'cms-import' }, t('imp_btn')),
      h('p', { className: 'lor-sm lor-muted', style: { margin: 0 } }, t('imp_hint')));
  }
  /* bottom-left: no connection, changes the server did not take, outdated server code (SOP manager) */
  function SyncChip(p) {
    var t = p.t, s = useState(null), st = s[0];
    useEffect(function () { return SV.onStatus(function (x) { s[1](x); }); }, []);
    if (!st) return null;
    var old = GS && p.admin && st.v && st.v < SV.SERVER_V;
    var msg = st.rejected ? t('srv_rejected') + ': ' + st.rejected.slice(0, 2).join('; ')
      : st.error ? t('srv_error') + ': ' + st.error
      : st.net === 'off' ? t('srv_offline') + (st.pending ? ' (' + st.pending + ')' : '')
      : st.net === 'busy' ? t('srv_busy') : null;
    if (!msg && !old && !st.update) return null;
    return h('div', { className: 'sync-chip', role: 'status' },
      st.update ? h('span', null, t('srv_update'), ' ', h('button', { type: 'button', className: 'app-link', onClick: function () { location.reload(); } }, t('srv_reload'))) : null,
      old ? h('span', null, tpl(t('srv_old'), { v: st.v, need: SV.SERVER_V }), ' ', h('button', { type: 'button', className: 'app-link', onClick: function () { copyServerCode(p.say, t); } }, t('srv_code'))) : null,
      msg ? h('span', null, msg) : null,
      st.rejected || st.error ? h('button', { type: 'button', className: 'app-link', onClick: SV.clearNotice }, t('srv_ok')) : null);
  }
  /* the server code (tools/lms-gs/Code.gs) for Apps Script — lms-gs-script.js, loaded for the SOP manager only */
  function loadServerCode(cb) {
    if (window.LMS_GS_SCRIPT) { if (cb) cb(); return; }
    var el = document.getElementById('lms-gs-script');
    if (!el) { el = document.createElement('script'); el.id = 'lms-gs-script'; el.src = 'lms-gs-script.js'; document.head.appendChild(el); }
    if (cb) el.addEventListener('load', cb);
  }
  function copyServerCode(say, t) {
    loadServerCode(function () {
      var txt = window.LMS_GS_SCRIPT || '', done = function () { say(tpl(t('srv_copied'), { v: window.LMS_GS_VERSION })); };
      var file = function () { downloadText('Code.gs', txt, 'text/plain;charset=utf-8'); done(); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, file); else file();
    });
  }

  /* ---------------- root ---------------- */
  function App() {
    var s = useDB(), db = s[0], update = s[1];
    var lang = db.lang || 'uz', t0 = T(lang), t = function (k) { return t0(k === 'ai_unavail' ? 'srv_ai_unavail' : k); };
    var ts = useState(null), toast = ts[0], sampler = useSampler(), tm = useState(false), pf = useState(false);
    useEffect(function () { if (!toast) return; var id = setTimeout(function () { ts[1](null); }, 3600); return function () { clearTimeout(id); }; }, [toast]);
    useEffect(function () { document.documentElement.lang = lang; }, [lang]);
    var user = db.users.filter(function (u) { return u.id === db.session; })[0];
    SAY = function (k) { ts[1]({ msg: t(k), k: Date.now() }); };
    /* the 1st of a month (or the first open after it): the closed month's report goes out — from the SOP manager's device */
    var due = monthlyDue(db, Date.now()), canIssue = !!(user && user.role === 'admin');
    useEffect(function () { if (due && canIssue) update(function (d) { if (monthlyDue(d, Date.now()) === due) issueMonthly(d, due); }); }, [due, canIssue]);
    /* new platform on the server: levels, programmes, adaptation plan and schedule come from the templates */
    var needTpl = !!(user && user.role === 'admin' && !(db.levels || []).length);
    useEffect(function () { if (needTpl) update(fillTemplates); }, [needTpl]);
    var p = {
      db: db, update: update, t: t, lang: lang, user: user,
      setLang: function (l) { update(function (d) { d.lang = l; }); },
      say: function (msg) { ts[1]({ msg: msg, k: Date.now() }); },
      logout: function () { ts[1](null); SV.logout(); },
      sampler: sampler, showTerms: function () { tm[1](true); }, openProfile: function () { pf[1](true); }
    };
    var view = !user ? h(Login, p)
      : needTpl ? h('div', { className: 'app-wrap' }, h('p', { className: 'lor-muted' }, t('srv_preparing')))
      : user.role === 'admin' ? h(AdminApp, Object.assign({ key: 'a' + user.id }, p))
      : user.role === 'leader' ? h(LeaderApp, Object.assign({ key: 'l' + user.id }, p))
      : h(EmployeeApp, Object.assign({ key: 'e' + user.id }, p));
    return h(F, null, view, tm[0] ? h(TermsModal, { t: t, lang: lang, acceptedAt: user && user.termsAcceptedAt, onClose: function () { tm[1](false); } }) : null,
      user && pf[0] ? h(ProfileModal, Object.assign({}, p, { key: 'pf' + user.id, onClose: function () { pf[1](false); } })) : null,
      user ? h(SyncChip, { t: t, admin: user.role === 'admin', say: p.say }) : null, h(Toast, { toast: toast }));
  }

  /* no server address in config.js: without the server the platform does not work (there is no demo any more) */
  function NoServer() {
    var lang = 'uz'; try { lang = localStorage.getItem('lor-lms-lang') || 'uz'; } catch (e) {}
    var t = T(lang);
    return h('div', { className: 'login-page' },
      h('div', { className: 'lor-login' },
        h('div', { className: 'lor-login-hero' },
          h('img', { src: LOGO_W, alt: 'BURAQ logistics', width: 116, height: 40 }),
          h('div', { className: 'lor-login-foot' }, h('span', null, t('app_full')), h('span', null, 'BIRGALIKDA MUVAFFAQIYATGA'))),
        h('div', { className: 'lor-login-side' },
          h('div', { className: 'login-col' },
            h('section', { className: 'lor-login-card lg-card' },
              h('span', { className: 'lor-eyebrow' }, t('app_full')),
              h('h1', { className: 'lor-title' }, t('srv_none_t')),
              h('p', { className: 'lor-muted', style: { margin: 0 } }, t('srv_none_p')))))));
  }

  /* phone chrome: the browser bar takes the brand navy, and the page can be
     pinned to the home screen with the BURAQ mark on it */
  (function () {
    function head(tag, attrs) { var e = document.createElement(tag); for (var k in attrs) e.setAttribute(k, attrs[k]); document.head.appendChild(e); }
    function themeColor() {
      var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      var c = dark ? '#081a2f' : '#0e2e54';
      var m = document.querySelector('meta[name="theme-color"]');
      if (m) { m.setAttribute('content', c); return; }
      head('meta', { name: 'theme-color', content: c });
    }
    themeColor();
    if (window.matchMedia) { var mq = window.matchMedia('(prefers-color-scheme: dark)'); (mq.addEventListener ? mq.addEventListener.bind(mq, 'change') : mq.addListener.bind(mq))(themeColor); }
    head('meta', { name: 'mobile-web-app-capable', content: 'yes' });
    head('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' });
    head('meta', { name: 'apple-mobile-web-app-title', content: 'BURAQ' });
    head('meta', { name: 'application-name', content: 'BURAQ' });
    if (typeof TOUCH_ICON === 'string') { head('link', { rel: 'apple-touch-icon', href: TOUCH_ICON }); head('link', { rel: 'icon', href: TOUCH_ICON }); }
  })();

  ReactDOM.createRoot(document.getElementById('app')).render(h(SV ? App : NoServer));
})();
