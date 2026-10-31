const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
const { createApp } = require('./app');
const { WhatsAppAdapter, DemoAdapter } = require('./adapter');
const demo = process.argv.includes('--demo');
const port = Number(process.env.PORT || 3001);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be between 1024 and 65535.');
const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const keyFile = path.join(dataDir, 'api-key.txt');
let key = process.env.API_KEY;
if (!key) {
  if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  key = fs.readFileSync(keyFile, 'utf8').trim();
}
if (key.length < 24) throw new Error('API_KEY must contain at least 24 characters.');
const adapter = demo ? new DemoAdapter() : new WhatsAppAdapter(__dirname);
const app = createApp({ adapter, key, dataDir, demo, port });
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`\nWhatsApp prototype • ${demo ? 'DEMO — no messages leave this app' : 'LIVE — real WhatsApp connection'}\nOpen: http://127.0.0.1:${port}\nAPI key: ${key}\nKeep this key private. Paste it into the prototype to unlock.\n`);
});
server.on('error', error => { console.error(error.message); process.exit(1); });
async function stop() {
  const timeout = setTimeout(() => process.exit(1), 10000); timeout.unref();
  try { await adapter.close(); } finally { server.close(() => process.exit(0)); }
}
process.once('SIGINT', stop); process.once('SIGTERM', stop);
