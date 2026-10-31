const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, timingSafeEqual, randomUUID } = require('node:crypto');
const QRCode = require('qrcode');

function createApp({ adapter, key, dataDir, demo = false, port = 3001 }) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const historyFile = path.join(dataDir, demo ? 'demo-messages.json' : 'messages.json');
  let records = fs.existsSync(historyFile) ? JSON.parse(fs.readFileSync(historyFile, 'utf8')) : [];
  const save = () => {
    fs.writeFileSync(historyFile + '.tmp', JSON.stringify(records, null, 2), { mode: 0o600 });
    fs.renameSync(historyFile + '.tmp', historyFile);
  };
  // A previous process may have stopped after sending but before saving the result.
  for (const item of records) if (item.status === 'sending') item.status = 'uncertain';
  save();
  let state = 'disconnected', qr = null, problem = '', connecting = false, busy = false, qrGeneration = 0;
  const ackName = ack => ({ '-1': 'delivery-error', 0: 'pending', 1: 'server-accepted', 2: 'delivered', 3: 'read', 4: 'played' }[ack] || 'unknown');
  adapter.on('state', value => { state = value; problem = ''; qr = null; qrGeneration++; });
  adapter.on('problem', value => { state = 'error'; problem = value; qr = null; qrGeneration++; });
  adapter.on('qr', async value => {
    state = 'scan-qr'; problem = ''; qr = null;
    const generation = ++qrGeneration;
    try {
      const encoded = await QRCode.toDataURL(value, { width: 280, margin: 2 });
      if (generation === qrGeneration) qr = encoded;
    } catch { state = 'error'; problem = 'Unable to render QR code. Reconnect.'; }
  });
  adapter.on('ack', (id, ack) => {
    const item = records.find(r => r.messageId === id);
    if (item) { item.delivery = ackName(ack); save(); }
  });
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
    const allowed = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!allowed.includes(req.headers.host)) return res.status(403).json({ error: 'Use the localhost URL printed in the terminal.' });
    if (req.headers.origin && !allowed.map(h => `http://${h}`).includes(req.headers.origin)) return res.status(403).json({ error: 'Cross-origin requests are disabled.' });
    next();
  });
  app.use(express.json({ limit: '16kb' }));
  app.use('/api', (req, res, next) => {
    const supplied = req.get('Authorization') || '';
    const expected = `Bearer ${key}`;
    if (Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return res.status(401).json({ error: 'Enter the API key printed in the server terminal.' });
    next();
  });
  app.get('/api/status', (req, res) => res.json({ mode: demo ? 'demo' : 'live', state, qr, problem }));
  app.post('/api/connect', (req, res) => {
    if (!connecting && state !== 'ready') {
      connecting = true; state = 'connecting'; problem = ''; qr = null; qrGeneration++;
      adapter.connect().catch(error => { state = 'error'; problem = error.message; qr = null; }).finally(() => { connecting = false; });
    }
    res.status(202).json({ state });
  });
  for (const [route, method] of [['groups', 'groups'], ['chats', 'chats']]) {
    app.get(`/api/${route}`, async (req, res) => {
      try {
        if (state !== 'ready') return res.status(503).json({ error: 'Connect WhatsApp first.' });
        res.json(await adapter[method]());
      } catch (error) {
        console.error(`[${route}]`, error.stack || error.message);
        // Listing is read-only; never imply that a message may have been sent.
        res.status(502).json({ error: `Unable to load ${route}. ${String(error.message).slice(0, 800)}`, operation: `load-${route}` });
      }
    });
  }
  app.get('/api/messages', (req, res) => res.json(records.slice(-100).reverse()));
  app.post('/api/send', async (req, res, next) => {
    const body = req.body || {};
    const { phone, groupId, chatId: existingChatId, message } = body;
    const id = req.get('Idempotency-Key');
    if (typeof id !== 'string' || !/^[A-Za-z0-9_:.-]{8,128}$/.test(id)) return res.status(400).json({ error: 'Provide an Idempotency-Key header (8–128 letters, digits, :, _, . or -).' });
    if ([phone, groupId, existingChatId].filter(Boolean).length !== 1) return res.status(400).json({ error: 'Provide exactly one destination: phone, groupId or chatId.' });
    if (typeof message !== 'string' || !message.trim() || message.length > 4000) return res.status(400).json({ error: 'Message must contain 1–4000 characters.' });
    if (phone && (typeof phone !== 'string' || !/^[1-9]\d{7,14}$/.test(phone))) return res.status(400).json({ error: 'Use international phone digits, e.g. 919876543210, without + or spaces.' });
    if (groupId && (typeof groupId !== 'string' || !/^\d+(?:-\d+)?@g\.us$/.test(groupId))) return res.status(400).json({ error: 'Select a valid group.' });
    if (existingChatId && (typeof existingChatId !== 'string' || !/^\d+@(c\.us|lid)$/.test(existingChatId))) return res.status(400).json({ error: 'Select a valid existing individual chat.' });
    const fingerprint = createHash('sha256').update(JSON.stringify(existingChatId ? [null, null, message, existingChatId] : [phone || null, groupId || null, message])).digest('hex');
    const old = records.find(r => r.key === id);
    if (old) {
      if (old.fingerprint !== fingerprint) return res.status(409).json({ error: 'This key belongs to a different message. Use a new key for a new message.' });
      return res.status(old.status === 'submitted' || old.status === 'simulated' ? 200 : 409).json({ ...old, duplicate: true });
    }
    if (state !== 'ready') return res.status(503).json({ error: 'WhatsApp is not ready. Connect first.' });
    if (busy) return res.status(429).json({ error: 'Another message is in progress. Retry this same request later with the same key.' });
    busy = true;
    let record;
    try {
      let destination = groupId || existingChatId;
      if (phone) {
        destination = await adapter.resolve(phone);
        if (!destination) return res.status(404).json({ error: 'This number is not registered on WhatsApp.' });
      } else if (existingChatId) {
        if (!await adapter.checkChat(existingChatId)) return res.status(404).json({ error: 'This individual chat is not available for the linked account.' });
      } else if (!await adapter.checkGroup(groupId)) return res.status(404).json({ error: 'Group not found for the linked account.' });
      // Reserve durably before the side effect. Never retry an uncertain send automatically.
      record = { id: randomUUID(), key: id, fingerprint, destination, message, createdAt: new Date().toISOString(), status: 'sending', delivery: 'unknown', mode: demo ? 'demo' : 'live' };
      records.push(record); save();
      const sent = await adapter.send(destination, message);
      record.status = demo ? 'simulated' : 'submitted';
      record.messageId = sent.id; record.delivery = demo ? 'simulated-only' : ackName(sent.ack);
      save();
      res.json(record);
    } catch (error) {
      if (record) { record.status = 'uncertain'; record.error = error.message; save(); }
      next(error);
    } finally { busy = false; }
  });
  app.use(express.static(path.join(__dirname, 'public')));
  app.use((error, req, res, next) => {
    const status = error.status && error.status >= 400 && error.status < 500 ? error.status : 500;
    res.status(status).json({ error: status === 500 ? 'Operation failed. Check History before retrying; the send may be uncertain.' : error.message });
    console.error(error.message);
  });
  return app;
}
module.exports = { createApp };
