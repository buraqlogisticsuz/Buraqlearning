/* Учебная платформа: синхронизация данных. Правка на странице — это разница двух состояний («было → стало»),
   сервер применяет её к общему состоянию. Один файл работает на странице (window.LmsSync), в тестах Node
   (module.exports) и в Google Apps Script (сборка tools/build-lms-gs.mjs кладёт его в один файл со скриптом).

   Правка (op):
     { op: 'set', path: [...], value: X }               — записать значение
     { op: 'set', path: [..., { id: 7 }], value: {…}, after: 6 | null }
                                                         — новый элемент списка: после элемента с id 6, null — в начало,
                                                           без after — в конец
     { op: 'del', path: [...] }                          — удалить
   Путь: строка — поле объекта, { id: X } — элемент списка объектов по его id (номерам элементов не верим:
   у двух устройств они разъезжаются). Список, где у элементов нет id или их порядок поменялся, пишется целиком. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.LmsSync = api;
})(this, function () {
  'use strict';

  var BAD_KEYS = ['__proto__', 'constructor', 'prototype'];
  var has = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  function isObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
  function isIdSeg(s) { return isObj(s) && has(s, 'id') && (typeof s.id === 'number' || typeof s.id === 'string'); }
  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }

  function equal(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
      if (a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) if (!equal(a[i], b[i])) return false;
      return true;
    }
    var ka = Object.keys(a).filter(function (k) { return a[k] !== undefined; }), kb = Object.keys(b).filter(function (k) { return b[k] !== undefined; });
    if (ka.length !== kb.length) return false;
    for (var j = 0; j < ka.length; j++) if (!has(b, ka[j]) || !equal(a[ka[j]], b[ka[j]])) return false;
    return true;
  }

  /* id элементов списка — или null, если это не список объектов с разными id */
  function key(id) { return typeof id + ':' + id; }
  function idsOf(arr) {
    var out = [], seen = {};
    for (var i = 0; i < arr.length; i++) {
      var x = arr[i];
      if (!isObj(x) || (typeof x.id !== 'number' && typeof x.id !== 'string') || seen[key(x.id)]) return null;
      seen[key(x.id)] = 1; out.push(x.id);
    }
    return out;
  }
  /* общие id идут в одном порядке в обоих списках */
  function sameOrder(ia, ib) {
    var inB = {}, inA = {};
    ib.forEach(function (id) { inB[key(id)] = 1; });
    ia.forEach(function (id) { inA[key(id)] = 1; });
    var ca = ia.filter(function (id) { return inB[key(id)]; }), cb = ib.filter(function (id) { return inA[key(id)]; });
    for (var i = 0; i < ca.length; i++) if (key(ca[i]) !== key(cb[i])) return false;
    return true;
  }

  function diff(a, b, path, out) {
    out = out || []; path = path || [];
    if (equal(a, b)) return out;
    if (isObj(a) && isObj(b)) {
      Object.keys(b).forEach(function (k) {
        if (b[k] === undefined) { if (has(a, k) && a[k] !== undefined) out.push({ op: 'del', path: path.concat(k) }); return; }
        if (!has(a, k) || a[k] === undefined) out.push({ op: 'set', path: path.concat(k), value: clone(b[k]) });
        else diff(a[k], b[k], path.concat(k), out);
      });
      Object.keys(a).forEach(function (k) { if (a[k] !== undefined && (!has(b, k))) out.push({ op: 'del', path: path.concat(k) }); });
      return out;
    }
    if (Array.isArray(a) && Array.isArray(b) && path.length) {
      var ia = idsOf(a), ib = idsOf(b);
      if (ia && ib && sameOrder(ia, ib)) {
        var at = {}, inB = {};
        ia.forEach(function (id, i) { at[key(id)] = i; });
        ib.forEach(function (id) { inB[key(id)] = 1; });
        ia.forEach(function (id) { if (!inB[key(id)]) out.push({ op: 'del', path: path.concat([{ id: id }]) }); });
        ib.forEach(function (id, j) {
          var p = path.concat([{ id: id }]);
          if (has(at, key(id))) diff(a[at[key(id)]], b[j], p, out);
          else out.push({ op: 'set', path: p, value: clone(b[j]), after: j ? ib[j - 1] : null });
        });
        return out;
      }
    }
    out.push({ op: 'set', path: path, value: clone(b) });
    return out;
  }

  function fail(reason) { var e = new Error(reason); e.code = 'path'; return e; }
  function checkSeg(s) {
    if (typeof s === 'string') { if (BAD_KEYS.indexOf(s) >= 0 || !s.length) throw fail('недопустимое поле «' + s + '»'); return; }
    if (!isIdSeg(s)) throw fail('недопустимый шаг пути');
  }
  function indexById(arr, id) { for (var i = 0; i < arr.length; i++) if (isObj(arr[i]) && arr[i].id === id) return i; return -1; }
  function child(parent, s) {
    if (typeof s === 'string') { if (!isObj(parent)) throw fail('поле «' + s + '» — не у объекта'); return has(parent, s) ? parent[s] : undefined; }
    if (!Array.isArray(parent)) throw fail('id ' + s.id + ' — не в списке');
    var i = indexById(parent, s.id); return i < 0 ? undefined : parent[i];
  }

  /* одна правка; изменяет root. Возвращает true — применена, false — нечего удалять */
  function applyOne(root, op) {
    if (!op || (op.op !== 'set' && op.op !== 'del')) throw fail('неизвестная правка');
    var path = op.path;
    if (!Array.isArray(path) || !path.length) throw fail('пустой путь');
    path.forEach(checkSeg);
    var parent = root;
    for (var i = 0; i < path.length - 1; i++) {
      var next = child(parent, path[i]);
      if (next === undefined || next === null) {
        if (op.op === 'del') return false;
        if (isIdSeg(path[i])) throw fail('элемента ' + path[i].id + ' уже нет');
        next = isIdSeg(path[i + 1]) ? [] : {};
        parent[path[i]] = next;
      }
      parent = next;
    }
    var last = path[path.length - 1];
    if (op.op === 'del') {
      if (typeof last === 'string') { if (!isObj(parent)) throw fail('поле «' + last + '» — не у объекта'); if (!has(parent, last)) return false; delete parent[last]; return true; }
      if (!Array.isArray(parent)) throw fail('id ' + last.id + ' — не в списке');
      var di = indexById(parent, last.id); if (di < 0) return false; parent.splice(di, 1); return true;
    }
    var value = clone(op.value);
    if (value === undefined) throw fail('нет значения');
    if (typeof last === 'string') { if (!isObj(parent)) throw fail('поле «' + last + '» — не у объекта'); parent[last] = value; return true; }
    if (!Array.isArray(parent)) throw fail('id ' + last.id + ' — не в списке');
    if (!isObj(value) || value.id !== last.id) throw fail('id элемента не совпадает с путём');
    var k = indexById(parent, last.id);
    if (k >= 0) { parent[k] = value; return true; }
    if (op.after === null) parent.unshift(value);
    else {
      var ai = op.after === undefined ? -1 : indexById(parent, op.after);
      if (ai < 0) parent.push(value); else parent.splice(ai + 1, 0, value);
    }
    return true;
  }

  /* все правки по порядку; неудачные пропускаются и возвращаются с причиной */
  function apply(root, ops) {
    var failed = [], applied = 0;
    (ops || []).forEach(function (op, i) {
      try { if (applyOne(root, op)) applied++; } catch (e) { failed.push({ i: i, reason: e.message }); }
    });
    return { applied: applied, failed: failed };
  }

  /* значение по пути (undefined — нет) */
  function get(root, path) {
    var cur = root;
    for (var i = 0; i < path.length; i++) {
      if (cur === undefined || cur === null) return undefined;
      checkSeg(path[i]);
      cur = child(cur, path[i]);
    }
    return cur;
  }

  return { diff: diff, apply: apply, applyOne: applyOne, get: get, equal: equal, clone: clone, isIdSeg: isIdSeg };
});
