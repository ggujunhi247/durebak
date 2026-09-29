import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';

function fixture(t: test.TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'durebak-store-'));
  let now=Date.now(); const clock={now:()=>now};
  const store = new Store(dir,clock);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const a = store.register('workspace-a', 'builder', 'codex');
  const b = store.register('workspace-a', 'reviewer', 'claude');
  const c = store.register('workspace-b', 'outsider', 'opencode');
  return { dir, store, a, b, c, clock, advance:()=>{now+=5000;} };
}

test('durable inbox survives restart; idempotency does not create duplicate messages', t => {
  const { dir, store, a, b, clock, advance } = fixture(t);
  const first = store.send(a.session, { to: b.session.id, body: '검토해주세요', key: 'request-1' });
  assert.equal(store.send(a.session, { to: b.session.id, body: '검토해주세요', key: 'request-1' }).id, first.id);
  assert.throws(() => store.send(a.session, { to: b.session.id, body: 'different', key: 'request-1' }), /idempotency_conflict/);
  advance(); const reopened = new Store(dir,clock);
  try {
    const inbox = reopened.receive(b.session, 10);
    assert.equal(inbox.items.length, 1);
    assert.equal(inbox.items[0]?.body, '검토해주세요');
    assert.equal(inbox.items[0]?.status, 'in_flight');
    reopened.ack(b.session, first.id, inbox.items[0]!.receipt);
    assert.equal(reopened.inbox(b.session, 0, 10).items[0]?.status, 'read');
  } finally { reopened.close(); }
});

test('workspace boundaries, recipient ownership and reply relationships are enforced', t => {
  const { store, a, b, c } = fixture(t);
  assert.throws(() => store.send(a.session, { to: c.session.id, body: 'leak', key: 'k' }), /not_found/);
  const message = store.send(a.session, { to: b.session.id, body: 'question', key: 'k' });
  assert.throws(() => store.ack(a.session, message.id), /not_found/);
  assert.throws(() => store.send(c.session, { to: c.session.id, body: 'spoof', key: 'k', replyTo: message.id }), /invalid_reply/);
  const reply = store.send(b.session, { to: a.session.id, body: 'answer', key: 'reply', replyTo: message.id });
  assert.equal(reply.reply_to, message.id);
  assert.equal(store.inbox(c.session, 0, 10).items.length, 0);
});

test('credentials are verified, revoked and bound to one session', t => {
  const { store, a } = fixture(t);
  assert.equal(store.authenticate(a.token)?.id, a.session.id);
  assert.equal(store.authenticate('wrong'), null);
  store.revoke(a.session.id);
  assert.equal(store.authenticate(a.token), null);
});

test('task claim is compare-and-swap; only owner can complete current revision', t => {
  const { dir, store, a, b, c } = fixture(t);
  const task = store.createTask(a.session, { title: 'Fix bug', criteria: 'Tests pass', key: 'task-1' });
  const secondConnection = new Store(dir);
  try {
    const claimed = store.claim(a.session, task.id, 1);
    assert.equal(claimed.version, 2);
    assert.throws(() => secondConnection.claim(b.session, task.id, 1), /claim_conflict/);
    const artifact = store.putArtifact(a.session, 'patch v1');
    assert.throws(() => store.complete(b.session, task.id, 2, artifact.hash), /claim_conflict/);
    assert.throws(() => store.complete(a.session, task.id, 1, artifact.hash), /claim_conflict/);
    assert.throws(() => store.getTask(c.session, task.id), /not_found/);
    const completed = store.complete(a.session, task.id, 2, artifact.hash);
    assert.equal(completed.state, 'completed');
    assert.equal(completed.result_hash, artifact.hash);
    assert.equal(completed.version, 3);
  } finally { secondConnection.close(); }
});

test('pending inbox backpressure permits retry of existing message and resumes after acknowledgement', t => {
  const { store, a, b, advance } = fixture(t);
  for (let i=0; i<100; i++) store.send(a.session, { to:b.session.id, body: 'x', key:String(i) });
  assert.throws(() => store.send(a.session, { to:b.session.id, body:'x', key:'101' }), /inbox_full/);
  const retry = store.send(a.session, { to:b.session.id, body:'x', key:'0' });
  advance(); const delivery=store.receive(b.session,1).items[0]!;
  store.ack(b.session, retry.id, delivery.receipt);
  assert.ok(store.send(a.session, { to:b.session.id, body:'x', key:'101' }).id);
});
