// Учебная платформа: разница двух состояний и её применение (lms-sync.js). Запуск: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const S = createRequire(import.meta.url)('../lms-sync.js');

const clone = x => JSON.parse(JSON.stringify(x));
const roundTrip = (a, b) => { const ops = S.diff(a, b), c = clone(a), r = S.apply(c, clone(ops)); assert.deepEqual(r.failed, []); assert.deepEqual(c, b); return ops; };

test('поля объекта: новое, изменённое, удалённое — по одному пути на правку', () => {
  const a = { users: [{ id: 1, name: 'A', plan: { p1: { at: 1 } } }], study: { 1: { '2026-10-01': 30 } }, seq: 100 };
  const b = clone(a); b.users[0].reminderTime = '19:00'; b.study[1]['2026-10-02'] = 45; delete b.users[0].plan.p1; b.seq = 101;
  const ops = roundTrip(a, b);
  assert.deepEqual(ops, [
    { op: 'del', path: ['users', { id: 1 }, 'plan', 'p1'] },
    { op: 'set', path: ['users', { id: 1 }, 'reminderTime'], value: '19:00' },
    { op: 'set', path: ['study', '1', '2026-10-02'], value: 45 },
    { op: 'set', path: ['seq'], value: 101 }]);
});

test('список с id: новый элемент в начале, в середине и в конце, удаление, правка внутри', () => {
  const a = { n: [{ id: 2, t: 'b' }, { id: 3, t: 'c' }, { id: 5, t: 'e', read: false }] };
  const b = { n: [{ id: 1, t: 'a' }, { id: 2, t: 'b' }, { id: 4, t: 'd' }, { id: 5, t: 'e', read: true }, { id: 6, t: 'f' }] };
  const ops = roundTrip(a, b);
  assert.deepEqual(ops, [
    { op: 'del', path: ['n', { id: 3 }] },
    { op: 'set', path: ['n', { id: 1 }], value: { id: 1, t: 'a' }, after: null },
    { op: 'set', path: ['n', { id: 4 }], value: { id: 4, t: 'd' }, after: 2 },
    { op: 'set', path: ['n', { id: 5 }, 'read'], value: true },
    { op: 'set', path: ['n', { id: 6 }], value: { id: 6, t: 'f' }, after: 5 }]);
});

test('список без id или с новым порядком пишется целиком', () => {
  assert.deepEqual(S.diff({ q: [1, 2] }, { q: [2, 1] }), [{ op: 'set', path: ['q'], value: [2, 1] }]);
  assert.deepEqual(S.diff({ l: [{ id: 1 }, { id: 2 }] }, { l: [{ id: 2 }, { id: 1 }] }), [{ op: 'set', path: ['l'], value: [{ id: 2 }, { id: 1 }] }]);
  roundTrip({ a: [{ x: 1 }] }, { a: [{ x: 2 }] });
});

test('правки с двух устройств сливаются: каждое меняет своё', () => {
  const base = { notifications: [{ id: 10, userId: 1, read: false }, { id: 11, userId: 2, read: false }], requests: [] };
  const one = clone(base); one.notifications[0].read = true; one.requests.unshift({ id: 'r1', userId: 1 });
  const two = clone(base); two.notifications.unshift({ id: 12, userId: 1, text: 'новое' }); two.notifications[2].read = true;
  const server = clone(base);
  assert.deepEqual(S.apply(server, S.diff(base, one)).failed, []);
  assert.deepEqual(S.apply(server, S.diff(base, two)).failed, []);
  assert.deepEqual(server, {
    notifications: [{ id: 12, userId: 1, text: 'новое' }, { id: 10, userId: 1, read: true }, { id: 11, userId: 2, read: true }],
    requests: [{ id: 'r1', userId: 1 }] });
});

test('элемент удалён на другом устройстве: правка внутри него не применяется, удаление — без ошибки', () => {
  const st = { n: [{ id: 1 }] };
  const r = S.apply(st, [{ op: 'set', path: ['n', { id: 9 }, 'read'], value: true }, { op: 'del', path: ['n', { id: 9 }] }, { op: 'del', path: ['x', 'y'] }]);
  assert.equal(r.applied, 0); assert.equal(r.failed.length, 1); assert.match(r.failed[0].reason, /уже нет/);
});

test('недопустимые пути не применяются', () => {
  const st = { a: [{ id: 1 }], o: {} };
  const bad = [
    { op: 'set', path: ['__proto__', 'x'], value: 1 },
    { op: 'set', path: ['o', 'constructor'], value: 1 },
    { op: 'set', path: ['a', 0], value: { id: 5 } },
    { op: 'set', path: ['a', { id: 2 }], value: { id: 3 } },
    { op: 'set', path: ['o', { id: 1 }], value: { id: 1 } },
    { op: 'set', path: [], value: 1 },
    { op: 'move', path: ['o'] },
    { op: 'set', path: ['o', 'k'] }];
  const r = S.apply(st, bad);
  assert.equal(r.applied, 0); assert.equal(r.failed.length, bad.length);
  assert.deepEqual(st, { a: [{ id: 1 }], o: {} });
  assert.equal({}.x, undefined);
});

test('get: значение по пути', () => {
  const st = { users: [{ id: 7, plan: { p1: { at: 3 } } }] };
  assert.deepEqual(S.get(st, ['users', { id: 7 }, 'plan', 'p1']), { at: 3 });
  assert.equal(S.get(st, ['users', { id: 8 }, 'plan']), undefined);
});
