// Уведомления в Telegram — только у сервера на Node (Railway). Бот — TELEGRAM_BOT_TOKEN (создаётся у @BotFather).
//   Привязка: «Mening profilim» → «Telegram’ni ulash» → ссылка t.me/<бот>?start=<код> → в боте «Start».
//   Свойство tg:<id> = чат; в карточке человека tg: true (страница показывает «Ulangan»). /stop в боте — отвязать.
//   Каждое новое уведомление на платформе уходит в чат (тексты — strings.js, по-узбекски).
//   Напоминание учиться: в reminderTime сотрудника (по Ташкенту), если сегодня меньше GOAL минут.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const GOAL = 120;                     // дневная цель учёбы, минут (как GOAL в app.js)
const CODE_TTL = 30 * 60e3;           // ссылка привязки живёт 30 минут

export function loadStrings(root) {
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(root, 'strings.js'), 'utf8'), ctx);
  return Object.assign({}, ctx.APP_T, { months: ctx.MONTHS });
}

const tashkent = ms => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { day: p.year + '-' + p.month + '-' + p.day, hm: p.hour + ':' + p.minute };
};

export function startTelegram({ token, C, strings, fetch = globalThis.fetch, log = console.log, siteUrl = '', poll = true, now = () => Date.now() }) {
  const P = C.PropertiesService.getScriptProperties();
  const S = (strings && strings.uz) || {};
  const T = k => S[k] || k;
  const tpl = (s, o) => String(s).replace(/\{(\w+)\}/g, (m, k) => (o[k] != null ? o[k] : m));
  const api = (method, body) => fetch('https://api.telegram.org/bot' + token + '/' + method, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(70000)
  }).then(r => r.json());
  const codes = new Map(), reminded = {};
  let botName = null, offset = 0, stopped = false, seen = null, timer = null;

  const send = (chat, text) => api('sendMessage', { chat_id: chat, text, disable_web_page_preview: true })
    .catch(e => log('Telegram: не отправлено — ' + e.message));
  const withSite = text => text + (siteUrl ? '\n\n' + siteUrl : '');

  /* отметка в карточке: страница показывает «Ulangan» */
  function setFlag(uid, on) {
    C.withLock_(() => {
      const st = C.readState_(), u = C.userById_(st, uid);
      if (!u || !!u.tg === on) return;
      if (on) u.tg = true; else delete u.tg;
      st.rev = (+st.rev || 0) + 1;
      C.writeState_(st);
    });
  }
  function unlinkUser(uid) { P.deleteProperty('tg:' + uid); setFlag(uid, false); }
  function unlinkChat(chat) {
    const all = P.getProperties();
    Object.keys(all).forEach(k => { if (k.indexOf('tg:') === 0 && all[k] === String(chat)) unlinkUser(k.slice(3)); });
  }

  /* ответ бота на сообщение */
  async function handle(update) {
    const m = update && update.message;
    if (!m || !m.chat || typeof m.text !== 'string') return;
    const [cmd, arg] = m.text.trim().split(/\s+/);
    if (cmd === '/start' && arg) {
      const c = codes.get(arg);
      if (!c || c.exp < now()) return send(m.chat.id, T('tg_code_old'));
      codes.delete(arg);
      unlinkChat(m.chat.id);                       // один чат — один человек
      P.setProperty('tg:' + c.uid, String(m.chat.id));
      setFlag(c.uid, true);
      return send(m.chat.id, T('tg_linked'));
    }
    if (cmd === '/stop') { unlinkChat(m.chat.id); return send(m.chat.id, T('tg_unlinked')); }
    return send(m.chat.id, T('tg_help'));
  }

  /* текст уведомления — как на странице (notifText в app.js), по-узбекски */
  function text(n, st) {
    const lv = n.promo ? (st.levels || [])[n.promo.li] : null;
    if (n.kind === 'ini_in') return T('n_ini_in');
    if (n.kind === 'ini' && n.ini) return tpl(T('n_ini_' + n.ini.s), { x: n.ini.title }) + (n.ini.xp ? ' (+' + n.ini.xp + ' XP)' : '') + (n.ini.reply ? ' — ' + n.ini.reply : '');
    if (n.kind === 'asset' && n.asset) return tpl(T('n_as_' + n.asset.k), { x: n.asset.name });
    if (n.kind === 'pulse') return T('n_pulse');
    if (n.kind === 'err' && n.err) return tpl(T(n.err.retrain ? 'n_err_train' : 'n_err'), { c: T('ec_' + n.err.cat), x: n.err.ttl });
    if (n.kind === 'errfix' && n.err) return tpl(T('n_errfix'), { name: n.err.name, x: n.err.ttl, n: n.err.score });
    if (n.kind === 'sop' && n.sop) return tpl(T('n_sop'), { x: n.sop.ttl });
    if (n.kind === 'ltask' && n.lt) return tpl(T('n_ltask'), { x: (n.lt.x && (n.lt.x.uz || n.lt.x)) || '' });
    if (n.kind === 'pay' && n.pay) {
      const [y, mo] = String(n.pay.ym).split('-'), mn = (((strings || {}).months || {}).uz || [])[+mo - 1];
      return tpl(T('n_pay_' + n.pay.s), { m: mn ? mn + ' ' + y : n.pay.ym, x: String(Math.round(n.pay.total || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0') + ' ' + T('pay_cur') }) + (n.pay.reply ? ' — ' + n.pay.reply : '');
    }
    if (lv) return tpl(T('n_promo_level'), { x: (lv.name && (lv.name.uz || lv.name)) || '' });
    return n.text && !n.kind ? n.text : T('tg_new');
  }

  /* после каждой записи данных: новые уведомления — в Telegram */
  function onState(st) {
    const list = st.notifications || [];
    if (!seen) { seen = new Set(list.map(n => String(n.id))); return; }
    list.forEach(n => {
      if (!n || seen.has(String(n.id))) return;
      seen.add(String(n.id));
      const chat = P.getProperty('tg:' + n.userId);
      if (chat) send(chat, withSite(text(n, st)));
    });
  }

  /* раз в минуту: напоминание учиться в reminderTime сотрудника, если сегодня меньше цели */
  function tick(ms = now()) {
    let st; try { st = C.readState_(); } catch (e) { return; }
    const { day, hm } = tashkent(ms);
    (st.users || []).forEach(u => {
      if (u.role !== 'employee' || (u.reminderTime || '19:00') !== hm || reminded[u.id] === day) return;
      const chat = P.getProperty('tg:' + u.id);
      if (!chat) return;
      const m = ((st.study || {})[u.id] || {})[day] || 0;
      reminded[u.id] = day;
      if (m < GOAL) send(chat, withSite(tpl(T('tg_remind'), { m: Math.round(m), g: GOAL })));
    });
  }

  async function loop() {
    while (!stopped) {
      try {
        const r = await api('getUpdates', { offset, timeout: 50, allowed_updates: ['message'] });
        if (!r.ok) { log('Telegram: ' + (r.description || 'ошибка')); await new Promise(z => setTimeout(z, 10000)); continue; }
        for (const up of r.result) { offset = up.update_id + 1; await handle(up).catch(e => log('Telegram: ' + e.message)); }
      } catch (e) { if (!stopped) await new Promise(z => setTimeout(z, 5000)); }
    }
  }

  try { onState(C.readState_()); } catch (e) { seen = new Set(); }
  const ready = api('getMe').then(r => {
    if (!r.ok) { log('Telegram: неверный TELEGRAM_BOT_TOKEN — ' + (r.description || '')); return; }
    botName = r.result.username;
    log('Telegram: бот @' + botName + ' подключён');
    if (poll) { loop(); timer = setInterval(() => tick(), 60e3); }
  }, e => log('Telegram: нет связи — ' + e.message));

  return {
    ready, handle, onState, tick,
    /* ссылка привязки для человека; null — бот ещё не готов */
    linkUrl(uid) {
      if (!botName) return null;
      const code = randomBytes(9).toString('base64url');
      codes.set(code, { uid: String(uid), exp: now() + CODE_TTL });
      return 'https://t.me/' + botName + '?start=' + code;
    },
    unlinkUser,
    stop() { stopped = true; clearInterval(timer); }
  };
}
