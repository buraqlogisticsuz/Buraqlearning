/* Учебная платформа: зарплата сотрудника — фикса + KPI по условиям SOP-менеджера. Один файл считает на странице
   (window.LmsPay), в тестах Node (module.exports) и на сервере (сборка tools/build-lms-gs.mjs кладёт его к скрипту):
   расчёт, который сотрудник сохраняет в историю, сервер пересчитывает этой же функцией — сумму не подогнать.

   Условия (state.pay, правит SOP-менеджер):
     schemes: [{ id, title, positions: [должности], fixed: фикса, base: KPI-бонус при выполнении 100%, kpis: [KPI], note }]
     people:  { <id сотрудника>: { schemeId?, fixed? } } — своя схема или своя фикса (иначе — схема по должности)
   KPI: { id, name, unit, src: 'manual' (вводит сотрудник) или показатель платформы (считает страница), type, … }
     type 'plan'  — доля KPI-бонуса: вес w %, план plan. Выполнение = факт / план (less — «меньше — лучше»: план / факт),
                    ниже порога min % — 0, выше потолка cap % — cap. Сумма = base × w % × выполнение
     type 'unit'  — за единицу: rate × факт (rate меньше нуля — вычет, например за ошибку)
     type 'bonus' — премия amount, если факт ≥ plan (less: факт ≤ plan)
   История (state.payCalcs): { id, uid, at, ym, scheme: снимок условий, fixed, inputs: { id KPI: факт }, lines, kpi, total,
     pct, note, status: 'saved' | 'approved' | 'rejected', reply, by, repliedAt } */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.LmsPay = api;
})(this, function () {
  'use strict';

  var TYPES = ['plan', 'unit', 'bonus'];
  function num(x) { x = +x; return isFinite(x) ? x : 0; }

  /* условия человека: своя схема (people) или первая по должности; фикса — своя или схемы. null — условий нет */
  function schemeFor(pay, u) {
    if (!pay || !u) return null;
    var me = (pay.people || {})[u.id] || {}, list = pay.schemes || [], s = null;
    if (me.schemeId) s = list.filter(function (x) { return x && x.id === me.schemeId; })[0] || null;
    if (!s) s = list.filter(function (x) { return x && (x.positions || []).indexOf(u.position) >= 0; })[0] || null;
    if (!s) return null;
    var own = me.fixed !== undefined && me.fixed !== null && me.fixed !== '' && isFinite(+me.fixed);
    return { scheme: s, fixed: own ? +me.fixed : num(s.fixed) };
  }

  /* снимок условий для истории: только то, из чего считается сумма (схему потом могут поменять) */
  function snapshot(s) {
    return { id: s.id, title: String(s.title || ''), base: num(s.base), kpis: (s.kpis || []).map(function (k) {
      var o = { id: String(k.id), name: String(k.name || ''), unit: String(k.unit || ''), src: String(k.src || 'manual'), type: TYPES.indexOf(k.type) >= 0 ? k.type : 'plan' };
      if (o.type === 'plan') { o.plan = num(k.plan); o.w = num(k.w); o.min = num(k.min); o.cap = num(k.cap) || 100; }
      else if (o.type === 'unit') o.rate = num(k.rate);
      else { o.plan = num(k.plan); o.amount = num(k.amount); }
      if (o.type !== 'unit' && k.less) o.less = true;
      return o;
    }) };
  }

  /* выполнение KPI типа plan, % — до порога и потолка */
  function rawScore(k, f) {
    if (!(k.plan > 0)) return 0;
    if (!k.less) return f / k.plan * 100;
    return f <= 0 ? Infinity : k.plan / f * 100;
  }

  /* расчёт по снимку условий: строки по KPI (факт, выполнение %, сумма) и итог; суммы — целые сумы */
  function calc(snap, fixed, inputs) {
    inputs = inputs || {};
    var lines = [], kpi = 0, wsum = 0, wdone = 0;
    (snap.kpis || []).forEach(function (k) {
      var f = num(inputs[k.id]), a = 0, s = null;
      if (k.type === 'unit') a = num(k.rate) * f;
      else if (k.type === 'bonus') { var ok = k.less ? f <= k.plan : f >= k.plan; s = ok ? 100 : 0; a = ok ? num(k.amount) : 0; }
      else {
        s = Math.min(rawScore(k, f), k.cap || 100);
        if (s < (k.min || 0)) s = 0;
        a = num(snap.base) * num(k.w) / 100 * s / 100;
        wsum += num(k.w); wdone += num(k.w) * s / 100;
      }
      a = Math.round(a) || 0;            // без «−0» у вычета при нулевом факте
      lines.push({ k: k.id, f: f, s: s === null ? null : Math.round(s * 10) / 10, a: a });
      kpi += a;
    });
    fixed = Math.round(num(fixed));
    return { fixed: fixed, kpi: kpi, total: fixed + kpi, pct: wsum ? Math.round(wdone * 100 / wsum) : null, lines: lines };
  }

  return { TYPES: TYPES, schemeFor: schemeFor, snapshot: snapshot, calc: calc };
});
