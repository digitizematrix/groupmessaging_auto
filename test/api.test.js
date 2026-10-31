const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../app');
const key = 'test-only-key-12345678901234567890';
class Fake extends EventEmitter {
  sent = 0;
  async connect() { this.emit('state', 'ready'); }
  async groups() { return [{ id: '123@g.us', name: 'Test' }]; }
  async chats() { return [{ id: '919876543210@c.us', name:'Test individual', isGroup:false }]; }
  async checkChat(id) { return id === '919876543210@c.us'; }
  async resolve(phone) { return phone === '919999999999' ? null : phone + '@c.us'; }
  async checkGroup(id) { return id === '123@g.us'; }
  async send() { this.sent++; return { id: 'msg-' + this.sent, ack: 1 }; }
}
async function fixture(t, { dir, demo = false } = {}) {
  dir ||= fs.mkdtempSync(path.join(os.tmpdir(), 'wa-test-'));
  const adapter = new Fake();
  const server = createApp({ adapter, key, dataDir: dir, port: 3001, demo }).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  t.after(() => new Promise(r => server.close(r)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  async function request(route, method = 'GET', body, extras = {}) {
    return new Promise((resolve, reject) => {
      const req = require('node:http').request(base + '/api' + route, { method, headers: { Host: '127.0.0.1:3001', Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', ...extras } }, res => {
        let text = ''; res.on('data', chunk => text += chunk); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
      });
      req.on('error', reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }
  const connect = () => request('/connect', 'POST', {});
  const send = (body = { phone: '919876543210', message: 'Hello' }, id = 'event-0001') => request('/send', 'POST', body, { 'Idempotency-Key': id });
  return { request, connect, send, adapter, dir };
}
test('API authentication and cross-origin / host restrictions', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/status', 'GET', undefined, { Authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await f.request('/status', 'GET', undefined, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await f.request('/status', 'GET', undefined, { Host: 'evil.example:3001' })).status, 403);
});
test('requires connection; QR state is rendered and cleared on readiness', async t => {
  const f = await fixture(t);
  assert.equal((await f.send()).status, 503);
  f.adapter.emit('qr', 'test-only-qr');
  await new Promise(r => setTimeout(r, 100));
  assert.match((await f.request('/status')).body.qr, /^data:image\/png;base64,/);
  await f.connect();
  const s = (await f.request('/status')).body;
  assert.equal(s.state, 'ready'); assert.equal(s.qr, null);
});
test('individual send, durable duplicate protection, and key conflict', async t => {
  const f = await fixture(t); await f.connect();
  assert.equal((await f.send()).body.status, 'submitted');
  assert.equal((await f.send()).body.duplicate, true);
  assert.equal(f.adapter.sent, 1);
  assert.equal((await f.send({ phone:'919876543210', message:'Different' })).status, 409);
  const saved = JSON.parse(fs.readFileSync(path.join(f.dir, 'messages.json')));
  assert.equal(saved[0].messageId, 'msg-1');
});
test('groups resolve, group validation and unknown number', async t => {
  const f = await fixture(t); await f.connect();
  assert.equal((await f.request('/groups')).body[0].id, '123@g.us');
  assert.equal((await f.send({ groupId:'123@g.us', message:'Team' })).status, 200);
  assert.equal((await f.send({ groupId:'456@g.us', message:'Missing' }, 'event-0002')).status, 404);
  assert.equal((await f.send({ phone:'919999999999', message:'Missing' }, 'event-0003')).status, 404);
});
test('validates content, recipients, and idempotency key', async t => {
  const f = await fixture(t); await f.connect();
  for (const body of [{ phone:'abc', message:'test' }, { phone:'919876543210', groupId:'123@g.us', message:'test' }, { message:'test' }, { phone:'919876543210', message:' ' }, { groupId:'bad@g.us',message:'test' }, { phone:'919876543210',message:'x'.repeat(4001) }]) assert.equal((await f.send(body)).status, 400);
  assert.equal((await f.request('/send', 'POST', {phone:'919876543210',message:'Hi'})).status, 400);
  assert.equal(f.adapter.sent, 0);
});
test('delivery acknowledgements update history', async t => {
  const f = await fixture(t); await f.connect(); await f.send();
  f.adapter.emit('ack', 'msg-1', 2);
  assert.equal((await f.request('/messages')).body[0].delivery, 'delivered');
  f.adapter.emit('ack', 'msg-1', 3);
  assert.equal((await f.request('/messages')).body[0].delivery, 'read');
});
test('send failure is uncertain and never automatically resent', async t => {
  const f = await fixture(t); await f.connect();
  f.adapter.send = async () => { f.adapter.sent++; throw Error('Simulated ambiguous send failure'); };
  assert.equal((await f.send()).status, 500);
  assert.equal((await f.send()).status, 409);
  assert.equal(f.adapter.sent, 1);
  assert.equal((await f.request('/messages')).body[0].status, 'uncertain');
});
test('simultaneous sends are serialized through a busy rejection', async t => {
  const f = await fixture(t); await f.connect();
  let release; let entered;
  const started = new Promise(r => entered = r);
  f.adapter.send = async () => { entered(); await new Promise(r => release = r); return {id:'msg-1',ack:1}; };
  const first = f.send(); await started;
  assert.equal((await f.send(undefined, 'event-0002')).status, 429);
  release(); assert.equal((await first).status, 200);
});
test('persisted sending records become uncertain after a restart', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-restart-'));
  fs.writeFileSync(path.join(dir,'messages.json'), JSON.stringify([{ id:'prior',status:'sending',key:'old-key-001' }]));
  const f = await fixture(t, {dir});
  assert.equal((await f.request('/messages')).body[0].status, 'uncertain');
});
test('demo mode never claims real submission', async t => {
  const f = await fixture(t, {demo:true}); await f.connect();
  assert.equal((await f.request('/status')).body.mode, 'demo');
  const result = await f.send();
  assert.equal(result.body.status,'simulated'); assert.equal(result.body.delivery,'simulated-only');
});
test('chat-list failure is read-only and exposes useful diagnostics', async t => {
  const f = await fixture(t); await f.connect();
  f.adapter.groups = async () => { throw Error('getChatModel failed'); };
  const r = await f.request('/groups');
  assert.equal(r.status, 502);
  assert.match(r.body.error, /getChatModel failed/);
  assert.doesNotMatch(r.body.error, /send may be uncertain/);
  assert.equal(r.body.operation, 'load-groups'); assert.equal(f.adapter.sent, 0);
});
test('existing individual chat can be selected and sent with safe destination validation', async t => {
  const f = await fixture(t); await f.connect();
  assert.equal((await f.request('/chats')).body[0].id, '919876543210@c.us');
  assert.equal((await f.send({chatId:'919876543210@c.us', message:'Existing chat'})).status, 200);
  assert.equal((await f.send({chatId:'123@g.us', message:'Not individual'}, 'existing-0002')).status, 400);
  assert.equal((await f.send({chatId:'919999999999@lid', message:'Missing'}, 'existing-0003')).status, 404);
});
