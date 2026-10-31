const { EventEmitter } = require('node:events');
const path = require('node:path');

class WhatsAppAdapter extends EventEmitter {
  constructor(root) { super(); this.root = root; this.client = null; this.connecting = false; }
  async connect() {
    if (this.connecting) return;
    this.connecting = true;
    try {
      if (this.client) await this.client.destroy();
      const { Client, LocalAuth } = require('whatsapp-web.js');
      this.client = new Client({
        authStrategy: new LocalAuth({ clientId: 'prototype', dataPath: path.join(this.root, '.wwebjs_auth') }),
        puppeteer: { headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) }
      });
      this.client.on('qr', qr => this.emit('qr', qr));
      this.client.on('authenticated', () => this.emit('state', 'syncing'));
      this.client.on('ready', () => this.emit('state', 'ready'));
      this.client.on('auth_failure', () => this.emit('problem', 'Authentication failed. Reconnect, or unlink this device in WhatsApp and try again.'));
      this.client.on('disconnected', reason => this.emit('problem', `Disconnected: ${reason}. Click Connect to reconnect.`));
      this.client.on('message_ack', (msg, ack) => this.emit('ack', msg.id._serialized, ack));
      await this.client.initialize();
    } finally { this.connecting = false; }
  }
  async chats() {
    // Read only identifiers and titles. Full getChats() serializes every chat and
    // can fail on unrelated WhatsApp Business fields in a single chat model.
    try {
      if (!this.client?.pupPage) throw new Error('WhatsApp browser is unavailable. Reconnect.');
      return await this.client.pupPage.evaluate(() => {
        let collection;
        let moduleError = '';
        try {
          if (typeof window.require === 'function') collection = window.require('WAWebCollections')?.Chat;
        } catch (error) { moduleError = String(error?.message || error); }
        // Modern library releases use the module loader, not window.Store.
        if (typeof collection?.getModelsArray !== 'function') collection = window.Store?.Chat;
        if (typeof collection?.getModelsArray !== 'function') throw new Error(`Chat collection unavailable through WAWebCollections or legacy Store.${moduleError ? ' Module error: ' + moduleError : ''}`);
        const models = collection.getModelsArray();
        const validId = value => typeof value === 'string' && /^[0-9]+(?:-[0-9]+)?@(g\.us|c\.us|lid)$/.test(value);
        const readId = wid => {
          if (validId(wid)) return wid;
          // Some WhatsApp builds rename the serialized WID field to $1.
          for (const field of ['_serialized', '$1']) {
            try { if (validId(wid?.[field])) return wid[field]; } catch {}
          }
          try { const value = wid?.toString(); if (validId(value)) return value; } catch {}
          return null;
        };
        const result = [];
        for (const chat of models) {
          try {
            const id = readId(chat.id);
            if (!id) continue;
            let name = id;
            // Access each optional getter independently: one bad title must not
            // prevent all other chats from appearing.
            for (const field of ['formattedTitle', 'name']) {
              try { const value = chat[field]; if (typeof value === 'string' && value.trim()) { name = value; break; } } catch {}
            }
            result.push({ id, name, isGroup: id.endsWith('@g.us') });
          } catch { /* Ignore an invalid individual model, not the entire list. */ }
        }
        if (models.length && !result.length) throw new Error(`Chat collection contains ${models.length} entries, but none have a recognized recipient ID. A WhatsApp compatibility update may be needed.`);
        return result;
      });
    } catch (lightError) {
      // Keep the public library method as a fallback if its internal store changes.
      try {
        return (await this.client.getChats()).map(c => ({ id: c.id._serialized, name: c.name || c.id._serialized, isGroup: Boolean(c.isGroup) }));
      } catch (fullError) {
        throw new Error(`Chat loading failed. Lightweight lookup: ${lightError.message}; library lookup: ${fullError.message}`);
      }
    }
  }
  async groups() { return (await this.chats()).filter(c => c.isGroup); }
  async resolve(phone) {
    const result = await this.client.getNumberId(phone);
    return result?._serialized;
  }
  async checkGroup(id) {
    return (await this.groups()).some(chat => chat.id === id);
  }
  async checkChat(id) { return (await this.chats()).some(chat => chat.id === id && !chat.isGroup); }
  async send(id, message) {
    const sent = await this.client.sendMessage(id, message);
    return { id: sent.id._serialized, ack: sent.ack };
  }
  async close() { if (this.client) await this.client.destroy(); }
}

class DemoAdapter extends EventEmitter {
  async connect() { this.emit('state', 'ready'); }
  async chats() { return [{ id: '120363000000000000@g.us', name: 'Demo team — simulated', isGroup: true }, { id: '919876543210@c.us', name: 'Demo individual — simulated', isGroup: false }]; }
  async groups() { return (await this.chats()).filter(c => c.isGroup); }
  async checkChat(id) { return id === '919876543210@c.us'; }
  async resolve(phone) { return `${phone}@c.us`; }
  async checkGroup(id) { return id === '120363000000000000@g.us'; }
  async send() { return { id: `demo-${require('node:crypto').randomUUID()}`, ack: 0 }; }
  async close() {}
}
module.exports = { WhatsAppAdapter, DemoAdapter };
