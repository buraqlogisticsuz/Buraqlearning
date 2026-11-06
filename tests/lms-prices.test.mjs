// «Narxlar» (app.js): вставка из Excel (prParse) — таблица со своими столбцами (как прайс-лист «вес на 1 m³ × тарифы»)
// и простой список; отметка смены цены (prMark), формат чисел (prFmt). Функции берём из app.js как есть (кусок без React).
// Запуск: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const part = (a, b) => app.slice(app.indexOf(a), app.indexOf(b, app.indexOf(a)));
const ctx = { DAY: 864e5 };
vm.createContext(ctx);
vm.runInContext(part('  var PR_CUR', '  function PrCell('), ctx);
const { prParse, prFmt, prMark, prSearch, prSub } = ctx;
const plain = x => JSON.parse(JSON.stringify(x));

const SHEET = [
  'Yukning 1 m3 hajmdagi og‘irligi\tStandart tarif (usd)\tEksklyuziv tarif (usd)\tHorgos Standart tarif (usd)\tHorgos Eksklyuziv tarif (usd)',
  '0-100 kg\t125\t145\t95\t115',
  '101-150 kg\t135\t155\t105\t125',
  '1000 kg<\t0.395 (kg uchun)\t0.495 (kg uchun)\t0.345 (kg uchun)\t0.445 (kg uchun)'].join('\n');

test('таблица: шапка Excel — первый столбец и тарифы, строки — значения по столбцам', () => {
  const r = prParse(SHEET, { kind: 'table', cols: [{ id: 'c1', label: '' }] });
  assert.equal(r.head, 'Yukning 1 m3 hajmdagi og‘irligi');
  assert.deepEqual(r.cols.map(c => c.label), ['Standart tarif (usd)', 'Eksklyuziv tarif (usd)', 'Horgos Standart tarif (usd)', 'Horgos Eksklyuziv tarif (usd)']);
  assert.equal(r.cols[0].id, 'c1', 'прежний столбец сохраняет id');
  assert.equal(r.rows.length, 3);
  const ids = r.cols.map(c => c.id);
  assert.deepEqual(plain(ids.map(k => r.rows[0].v[k])), ['125', '145', '95', '115']);
  assert.deepEqual(plain(ids.map(k => r.rows[2].v[k])), ['0.395 (kg uchun)', '0.495 (kg uchun)', '0.345 (kg uchun)', '0.445 (kg uchun)']);
});

test('таблица без шапки: строки идут в уже заданные столбцы; лишние ячейки — новые столбцы; строка из одной ячейки — заголовок', () => {
  const x = { kind: 'table', cols: [{ id: 'a', label: 'Standart' }, { id: 'b', label: 'Eksklyuziv' }] };
  const r = prParse('Avia\n0-100 kg\t125\t145\t95', x);
  assert.equal(r.head, undefined);
  assert.equal(r.rows[0].h, true); assert.equal(r.rows[0].name, 'Avia');
  assert.equal(r.rows[1].v.a, '125'); assert.equal(r.rows[1].v.b, '145');
  assert.equal(r.cols.length, 3, 'третье значение — новый столбец'); assert.equal(r.rows[1].v[r.cols[2].id], '95');
});

test('список: шапка пропускается, валюта словами — код', () => {
  const r = prParse('Xizmat\tBirlik\tNarx\tValyuta\nBojxona\txizmat\t1 500 000\tso‘m\nAvia\tkg\t7,5\t$', { kind: 'list', cur: 'USD' });
  assert.deepEqual(plain(r.rows.map(x => [x.name, x.price, x.cur])), [['Bojxona', '1 500 000', 'UZS'], ['Avia', '7,5', 'USD']]);
});

test('числа: разряды, дробь — как ввели; текст — как есть', () => {
  assert.equal(prFmt('1500000'), '1 500 000');
  assert.equal(prFmt('7,5'), '7,5'); assert.equal(prFmt('0.395'), '0.395');
  assert.equal(prFmt('0.395 (kg uchun)'), '0.395 (kg uchun)');
});

test('смена цены: стрелка и прежняя — 14 дней, по столбцу таблицы', () => {
  const now = Date.now(), it = { v: { a: '130', b: '145' }, was: { a: '125' }, chAt: now - 3600e3 };
  assert.deepEqual(plain(prMark(it, 'a')), { k: 'up', was: '125' });
  assert.equal(prMark(it, 'b'), null);
  assert.equal(prMark(Object.assign({}, it, { chAt: now - 15 * 864e5 }), 'a'), null, 'через 14 дней отметки нет');
  assert.deepEqual(plain(prMark({ price: '7', was: '7,5', chAt: now }, undefined)), { k: 'down', was: '7,5' });
  const x = { kind: 'table', title: 'Asosiy', head: 'Og‘irlik', cols: [{ id: 'a', label: 'Standart' }] };
  assert.match(prSearch(x, { name: '0-100 kg', v: { a: '125' } }), /0-100 kg.*Standart 125/);
  assert.equal(prSub(x, { name: '0-100 kg', v: { a: '125' } }), 'Standart: 125 · Asosiy');
});
