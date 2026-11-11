// Зарплата: фикса + KPI (lms-pay.js — общая формула страницы и сервера). Запуск: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const P = createRequire(import.meta.url)('../lms-pay.js');
const scheme = { id: 'sk', title: 'Omborchi', positions: ['Omborchi'], fixed: 4000000, base: 2000000, kpis: [
  { id: 'k1', name: 'Konteynerlar', unit: 'dona', src: 'manual', type: 'plan', plan: 120, w: 60, min: 80, cap: 120 },
  { id: 'k2', name: 'Kechikishlar', unit: 'kun', src: 'att_late', type: 'plan', plan: 2, w: 40, min: 50, cap: 100, less: true },
  { id: 'k3', name: 'Xato', unit: 'ta', src: 'errors', type: 'unit', rate: -50000 },
  { id: 'k4', name: 'Ortiqcha ish', unit: 'soat', src: 'manual', type: 'unit', rate: 25000 },
  { id: 'k5', name: 'Kechikishsiz oy', unit: 'kun', src: 'att_late', type: 'bonus', plan: 0, amount: 300000, less: true }] };

test('условия человека: своя схема и фикса, иначе — по должности; без условий — null', () => {
  const pay = { schemes: [scheme, { id: 's2', positions: ['Haydovchi'], fixed: 5000000 }], people: { 7: { fixed: 4500000 }, 8: { schemeId: 's2' } } };
  assert.equal(P.schemeFor(pay, { id: 1, position: 'Omborchi' }).fixed, 4000000);
  assert.equal(P.schemeFor(pay, { id: 7, position: 'Omborchi' }).fixed, 4500000);
  assert.equal(P.schemeFor(pay, { id: 8, position: 'Omborchi' }).scheme.id, 's2');
  assert.equal(P.schemeFor(pay, { id: 9, position: 'Kassir' }), null);
  assert.equal(P.schemeFor(null, { id: 1 }), null);
});

test('свои условия человека (v24): свой оклад, KPI-бонус и KPI — важнее шаблона должности', () => {
  const own = { fixed: 5200000, base: 1500000, title: 'Aziza — shaxsiy', note: 'izoh', from: 'sk', kpis: [{ id: 'q1', name: 'Mijozlar', unit: 'ta', src: 'manual', type: 'plan', plan: 10, w: 100, min: 0, cap: 150 }] };
  const pay = { schemes: [scheme], people: { 5: own, 6: { fixed: 4100000 } } };
  const m = P.schemeFor(pay, { id: 5, position: 'Omborchi' });
  assert.equal(m.own, true); assert.equal(m.fixed, 5200000); assert.equal(m.scheme.base, 1500000); assert.equal(m.scheme.kpis[0].id, 'q1'); assert.equal(m.scheme.title, 'Aziza — shaxsiy');
  assert.equal(P.calc(P.snapshot(m.scheme), m.fixed, { q1: 12 }).total, 5200000 + 1800000, '120 % от 1 500 000');
  assert.equal(P.schemeFor(pay, { id: 6, position: 'Omborchi' }).scheme.id, 'sk', 'только своя фикса — шаблон должности');
  assert.equal(P.schemeFor({ schemes: [], people: { 9: { fixed: 1, base: 0, kpis: [] } } }, { id: 9, position: 'X' }).own, true, 'свои условия без KPI — только оклад');
});

test('план/факт: доля бонуса по весу, порог, потолок, «меньше — лучше»; за единицу; премия за условие', () => {
  const s = P.snapshot(scheme);
  // 108 из 120 = 90 % × 60 % × 2 000 000 = 1 080 000; 1 опоздание при плане 2 → 200 %, потолок 100 % → 800 000
  let r = P.calc(s, 4000000, { k1: 108, k2: 1, k3: 2, k4: 10, k5: 1 });
  assert.deepEqual(r.lines.map(x => x.a), [1080000, 800000, -100000, 250000, 0]);
  assert.deepEqual(r.lines.map(x => x.s), [90, 100, null, null, 0]);
  assert.equal(r.kpi, 2030000); assert.equal(r.total, 6030000); assert.equal(r.pct, 94);
  // ниже порога 80 % — 0; выше потолка 120 % — 120 %; ноль опозданий — потолок и премия
  r = P.calc(s, 4000000, { k1: 90, k2: 0, k5: 0 });
  assert.deepEqual(r.lines.map(x => x.a), [0, 800000, 0, 0, 300000]);
  assert.equal(P.calc(s, 4000000, { k1: 200 }).lines[0].a, 1440000);
  // 4 опоздания при плане 2 → 50 % = порог: ещё платится; 5 → 40 % — ниже порога
  assert.equal(P.calc(s, 0, { k2: 4 }).lines[1].a, 400000);
  assert.equal(P.calc(s, 0, { k2: 5 }).lines[1].a, 0);
  // пустые и нечисловые факты — ноль
  assert.equal(P.calc(s, 4000000.4, { k1: 'abc' }).total, 4000000 + 800000 + 300000);
});

test('снимок условий: только то, из чего считается сумма', () => {
  const s = P.snapshot({ ...scheme, positions: ['x'], note: 'izoh', kpis: [{ id: 'a', name: 'A', type: 'zzz', plan: '10', w: '50', hint: 'h' }] });
  assert.deepEqual(s, { id: 'sk', title: 'Omborchi', base: 2000000, kpis: [{ id: 'a', name: 'A', unit: '', src: 'manual', type: 'plan', plan: 10, w: 50, min: 0, cap: 100 }] });
});

test('гибкие условия (v25): бонус — % от оклада, доплаты и удержания, % от факта, ступени', () => {
  const me = { fixed: 5000000, baseMode: 'pct', basePct: 30, extras: [{ id: 'e1', name: 'Transport', amount: 300000 }, { id: 'e2', name: 'Avans', amount: -1000000 }, { id: 'e3', name: '', amount: 5 }],
    kpis: [
      { id: 's', name: 'Sotuv', unit: 'so‘m', src: 'manual', type: 'pct', rate: 2 },
      { id: 'p', name: 'Shartnoma', unit: 'ta', src: 'manual', type: 'plan', plan: 10, w: 100, steps: [{ from: 120, pay: 130 }, { from: 80, pay: 50 }, { from: 100, pay: 100 }] }] };
  const m = P.schemeFor({ schemes: [], people: { 3: me } }, { id: 3 }), snap = P.snapshot(m.scheme);
  assert.equal(snap.baseMode, 'pct'); assert.deepEqual(snap.extras.map(x => x.amount), [300000, -1000000], 'пустая доплата отброшена');
  assert.deepEqual(snap.kpis[1].steps.map(x => x.from), [80, 100, 120], 'ступени по порядку');
  const r = P.calc(snap, m.fixed, { s: 40000000, p: 9 });   // 90 % → ступень 80 % → 50 % от 1 500 000
  assert.deepEqual(r.lines.map(x => x.a), [800000, 750000, 300000, -1000000]);
  assert.equal(r.base, 1500000); assert.equal(r.extra, -700000); assert.equal(r.kpi, 1550000); assert.equal(r.total, 5000000 + 1550000 - 700000);
  assert.equal(P.calc(snap, m.fixed, { s: 0, p: 7 }).lines[1].a, 0, 'ниже первой ступени — 0');
  assert.equal(P.calc(snap, m.fixed, { s: 0, p: 13 }).lines[1].a, 1950000, '130 % — ступень 120 %: 130 %');
  assert.equal(P.calc(snap, m.fixed, { s: 0, p: 13 }).lines[1].p, 130);
});
