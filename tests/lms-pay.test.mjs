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
