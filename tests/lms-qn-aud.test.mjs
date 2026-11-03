// «Savolnoma»: раздел только для кандидатов или только для штатных (section.aud, qnForU) и столбец «Holat» в Excel-загрузке
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const part = (a, b) => app.slice(app.indexOf(a), app.indexOf(b, app.indexOf(a)));
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(part('  var QN_AUD = ', '  function qnDone(') + '\n' + part('  function impStatus(', '\n', 0) + '\nthis.qnForU = qnForU; this.impStatus = impStatus;', ctx);

const q = { questions: [
  { id: 's1', type: 'section', text: 'Shaxsiy' }, { id: 'a', type: 'text', text: 'Ism' },
  { id: 's2', type: 'section', text: 'Nomzodlik haqida', aud: 'probation' }, { id: 'b', type: 'text', text: 'Lavozim?' },
  { id: 's3', type: 'section', text: 'Faqat rasmiy', aud: 'official' }, { id: 'c', type: 'text', text: 'Ish joyi' },
  { id: 's4', type: 'section', text: 'Test' }, { id: 'd', type: 'scale', text: 'Fikr' }] };
const ids = r => r.questions.map(x => x.id).join(',');

test('кандидат не видит раздел для штатных, штатный — раздел для кандидатов', () => {
  assert.equal(ids(ctx.qnForU(q, { status: 'probation' })), 's1,a,s2,b,s4,d');
  assert.equal(ids(ctx.qnForU(q, { status: 'official' })), 's1,a,s3,c,s4,d');
  assert.equal(ids(ctx.qnForU(q, {})), 's1,a,s2,b,s4,d', 'без статуса — как кандидат');
  assert.equal(ctx.qnForU(q, { status: 'official' }), ctx.qnForU(q, { status: 'official' }), 'один и тот же объект (кэш)');
  const plain = { questions: [{ id: 'x', type: 'text' }] };
  assert.equal(ctx.qnForU(plain, { status: 'official' }), plain, 'без разделов по статусу — анкета как есть');
});

test('столбец «Holat»: rasmiy / sinov на трёх языках, пусто — без изменений', () => {
  assert.equal(ctx.impStatus('Rasmiy'), 'official'); assert.equal(ctx.impStatus('official'), 'official'); assert.equal(ctx.impStatus('Штатный'), 'official');
  assert.equal(ctx.impStatus('Sinov muddati'), 'probation'); assert.equal(ctx.impStatus('Испытательный срок'), 'probation');
  assert.equal(ctx.impStatus(''), ''); assert.equal(ctx.impStatus('boshqa'), '');
});
