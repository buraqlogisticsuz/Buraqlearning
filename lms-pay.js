/* Учебная платформа: зарплата сотрудника — фикса + KPI по условиям SOP-менеджера. Один файл считает на странице
   (window.LmsPay), в тестах Node (module.exports) и на сервере (сборка tools/build-lms-gs.mjs кладёт его к скрипту):
   расчёт, который сотрудник сохраняет в историю, сервер пересчитывает этой же функцией — сумму не подогнать.

   Условия (state.pay, правит CEO):
     people:  { <id сотрудника>: { fixed, base, kpis: [KPI], note, title?, from? } } — СВОИ условия человека (v24): оклад,
              KPI-бонус при 100 %, свои KPI с планами и весами; from — шаблон, с которого начали. Старое { schemeId?, fixed? } —
              шаблон и своя фикса, как раньше
     schemes: [{ id, title, positions: [должности], fixed: фикса, base: KPI-бонус при выполнении 100%, kpis: [KPI], note }]
              — шаблоны («Shablonlar»): у кого своих условий нет, считается по шаблону своей должности
   KPI-бонус: base — сумма, или baseMode 'pct' + basePct — процент от оклада (v25).
   extras: [{ id, name, amount }] — постоянные доплаты (транспорт, связь…) и удержания (amount < 0) каждого месяца (v25).
   KPI: { id, name, unit, src: 'manual' (вводит сотрудник) или показатель платформы (считает страница), type, … }
     type 'plan'  — доля KPI-бонуса: вес w %, план plan. Выполнение = факт / план (less — «меньше — лучше»: план / факт),
                    ниже порога min % — 0, выше потолка cap % — cap. Сумма = base × w % × выполнение.
                    steps: [{ from, pay }] — ступени (v25): выполнение ≥ from % → платится pay % доли (вместо линейного)
     type 'pct'   — процент от факта: факт × rate % (комиссия с продаж, доля сэкономленного; v25)
     type 'unit'  — за единицу: rate × факт (rate меньше нуля — вычет, например за ошибку)
     type 'bonus' — премия amount, если факт ≥ plan (less: факт ≤ plan)
   История (state.payCalcs): { id, uid, at, ym, scheme: снимок условий, fixed, inputs: { id KPI: факт }, lines, kpi, total,
     pct, note, status: 'saved' | 'approved' | 'rejected', reply, by, repliedAt } */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.LmsPay = api;
})(this, function () {
  'use strict';

  var TYPES = ['plan', 'pct', 'unit', 'bonus'];
  function num(x) { x = +x; return isFinite(x) ? x : 0; }

  /* условия человека: свои (people[id].kpis), иначе выбранный шаблон или первый по должности; фикса — своя или шаблона.
     null — условий нет */
  function schemeFor(pay, u) {
    if (!pay || !u) return null;
    var me = (pay.people || {})[u.id] || {}, list = pay.schemes || [], s = null;
    if (Array.isArray(me.kpis)) return { own: true, fixed: num(me.fixed),
      scheme: { id: 'u' + u.id, title: String(me.title || ''), positions: [], fixed: num(me.fixed), base: num(me.base), baseMode: me.baseMode === 'pct' ? 'pct' : 'sum', basePct: num(me.basePct), extras: Array.isArray(me.extras) ? me.extras : [], kpis: me.kpis, note: String(me.note || ''), from: me.from || null } };
    if (me.schemeId) s = list.filter(function (x) { return x && x.id === me.schemeId; })[0] || null;
    if (!s) s = list.filter(function (x) { return x && (x.positions || []).indexOf(u.position) >= 0; })[0] || null;
    if (!s) return null;
    var own = me.fixed !== undefined && me.fixed !== null && me.fixed !== '' && isFinite(+me.fixed);
    return { scheme: s, fixed: own ? +me.fixed : num(s.fixed) };
  }

  /* снимок условий для истории: только то, из чего считается сумма (схему потом могут поменять) */
  function steps(st) {
    return (Array.isArray(st) ? st : []).map(function (x) { return { from: num(x && x.from), pay: num(x && x.pay) }; })
      .filter(function (x) { return x.from >= 0; }).sort(function (a, b) { return a.from - b.from; }).slice(0, 10);
  }
  function snapshot(s) {
    var o0 = { id: s.id, title: String(s.title || ''), base: num(s.base), kpis: (s.kpis || []).map(function (k) {
      var o = { id: String(k.id), name: String(k.name || ''), unit: String(k.unit || ''), src: String(k.src || 'manual'), type: TYPES.indexOf(k.type) >= 0 ? k.type : 'plan' };
      if (o.type === 'plan') { o.plan = num(k.plan); o.w = num(k.w); o.min = num(k.min); o.cap = num(k.cap) || 100; var st = steps(k.steps); if (st.length) o.steps = st; }
      else if (o.type === 'unit' || o.type === 'pct') o.rate = num(k.rate);
      else { o.plan = num(k.plan); o.amount = num(k.amount); }
      if ((o.type === 'plan' || o.type === 'bonus') && k.less) o.less = true;
      return o;
    }) };
    if (s.baseMode === 'pct') { o0.baseMode = 'pct'; o0.basePct = num(s.basePct); }
    var ex = (s.extras || []).filter(function (x) { return x && String(x.name || '').trim() && num(x.amount); })
      .map(function (x) { return { id: String(x.id), name: String(x.name).trim(), amount: num(x.amount) }; });
    if (ex.length) o0.extras = ex;
    return o0;
  }
  /* KPI-бонус при 100 %: сумма или процент от оклада */
  function baseOf(snap, fixed) { return snap.baseMode === 'pct' ? Math.round(num(fixed) * num(snap.basePct) / 100) : num(snap.base); }
  /* ступени: последняя, до которой дотянуло выполнение */
  function stepPay(st, s) { var p = 0; st.forEach(function (x) { if (s >= x.from) p = x.pay; }); return p; }

  /* выполнение KPI типа plan, % — до порога и потолка */
  function rawScore(k, f) {
    if (!(k.plan > 0)) return 0;
    if (!k.less) return f / k.plan * 100;
    return f <= 0 ? Infinity : k.plan / f * 100;
  }

  /* расчёт по снимку условий: строки по KPI (факт, выполнение %, сумма) и итог; суммы — целые сумы */
  function calc(snap, fixed, inputs) {
    inputs = inputs || {};
    var lines = [], kpi = 0, wsum = 0, wdone = 0, base = baseOf(snap, fixed);
    (snap.kpis || []).forEach(function (k) {
      var f = num(inputs[k.id]), a = 0, s = null, pay = null;
      if (k.type === 'unit') a = num(k.rate) * f;
      else if (k.type === 'pct') a = f * num(k.rate) / 100;
      else if (k.type === 'bonus') { var ok = k.less ? f <= k.plan : f >= k.plan; s = ok ? 100 : 0; a = ok ? num(k.amount) : 0; }
      else if (k.steps && k.steps.length) {
        s = Math.min(rawScore(k, f), 1000);                          // выполнение — для показа; платится ступень
        pay = stepPay(k.steps, s);
        a = base * num(k.w) / 100 * pay / 100;
        wsum += num(k.w); wdone += num(k.w) * pay / 100;
      } else {
        s = Math.min(rawScore(k, f), k.cap || 100);
        if (s < (k.min || 0)) s = 0;
        a = base * num(k.w) / 100 * s / 100;
        wsum += num(k.w); wdone += num(k.w) * s / 100;
      }
      a = Math.round(a) || 0;            // без «−0» у вычета при нулевом факте
      var ln = { k: k.id, f: f, s: s === null ? null : Math.round(s * 10) / 10, a: a };
      if (pay !== null) ln.p = pay;
      lines.push(ln);
      kpi += a;
    });
    var extra = 0;
    (snap.extras || []).forEach(function (x) { var a = Math.round(num(x.amount)) || 0; lines.push({ k: 'x:' + x.id, x: true, a: a }); extra += a; });
    fixed = Math.round(num(fixed));
    var r = { fixed: fixed, kpi: kpi, total: fixed + kpi + extra, pct: wsum ? Math.round(wdone * 100 / wsum) : null, lines: lines };
    if (extra || (snap.extras || []).length) r.extra = extra;
    if (snap.baseMode === 'pct') r.base = base;
    return r;
  }

  return { TYPES: TYPES, schemeFor: schemeFor, snapshot: snapshot, calc: calc, baseOf: baseOf };
});
