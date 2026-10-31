const $ = id => document.getElementById(id);
let key = sessionStorage.getItem('wa-key') || '';
let mode = 'live', ready = false, inFlight = false, requestKey = null, lastBody = null, unlocked = false, loadingGroups = false, loadingChats = false;
function notice(text) { $('notice').textContent = text; $('notice').hidden = !text; }
async function api(url, options = {}) {
  const response = await fetch('/api' + url, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, ...(options.headers || {}) } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || (data.status === 'uncertain' ? 'Previous attempt is uncertain. Verify receipt before creating a new message.' : 'This request has already been reserved. Check history.'));
  return data;
}
async function status() {
  const s = await api('/status');
  const previouslyReady = ready;
  mode = s.mode; ready = s.state === 'ready';
  $('mode').textContent = mode === 'demo' ? 'DEMO · NO REAL MESSAGES' : 'LIVE · REAL WHATSAPP';
  $('status').textContent = s.state.replaceAll('-', ' ');
  $('qr').hidden = !s.qr;
  if (s.qr) $('qr').src = s.qr; else $('qr').removeAttribute('src');
  $('qrHint').hidden = Boolean(s.qr);
  $('qrHint').textContent = ready ? (mode === 'demo' ? 'Demo connected.\nNo WhatsApp account is linked.' : 'Account linked.\nChoose a recipient to test messaging.') : (s.problem || (s.state === 'scan-qr' ? 'Generating QR…' : s.state === 'connecting' || s.state === 'syncing' ? 'Connecting… this can take a minute.' : 'Start a connection to generate\nyour WhatsApp login QR.'));
  $('connect').disabled = ready || ['connecting', 'syncing', 'scan-qr'].includes(s.state);
  $('connect').textContent = ready ? 'Connected' : mode === 'demo' ? 'Connect demo' : 'Connect WhatsApp';
  $('send').disabled = !ready || inFlight;
  $('send').textContent = inFlight ? 'Sending…' : mode === 'demo' ? 'Simulate message' : 'Send message';
  if (ready && !previouslyReady) {
    if ($('kind').value === 'group') groups().catch(e => notice(e.message));
    if ($('kind').value === 'existing') chats().catch(e => notice(e.message));
  }
  if ($('sendResult').textContent === 'Connect WhatsApp to enable sending.' && ready) $('sendResult').textContent = 'Choose a recipient and enter your test message.';
  $('connectionHelp').textContent = mode === 'demo' ? 'Demo mode only tests the interface and local API. Restart with npm start for real WhatsApp.' : 'On your phone: WhatsApp → Linked devices → Link a device.';
}
async function history() {
  const items = await api('/messages');
  const box = $('history'); box.replaceChildren();
  if (!items.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = 'No messages yet. Your first test will appear here.'; box.append(p); }
  for (const item of items) {
    const row = document.createElement('div'); row.className = 'historyRow';
    const a = document.createElement('div'); const title = document.createElement('strong'); title.textContent = item.destination;
    const time = document.createElement('p'); time.className = 'small'; time.textContent = new Date(item.createdAt).toLocaleString(); a.append(title,time);
    const b = document.createElement('div'); const body = document.createElement('p'); body.textContent = item.message;
    const id = document.createElement('code'); id.textContent = item.messageId || item.id; b.append(body,id);
    const c = document.createElement('div'); c.textContent = item.status;
    const delivery = document.createElement('p'); delivery.className = 'delivery'; delivery.textContent = item.delivery;
    c.append(delivery);
    if (item.status === 'uncertain') { const warning = document.createElement('p'); warning.className = 'small'; warning.textContent = 'Check recipient before sending again.'; c.append(warning); }
    row.append(a,b,c); box.append(row);
  }
}
async function groups() {
  if (loadingGroups) return;
  loadingGroups = true; $('refresh').disabled = true;
  $('groupStatus').textContent = 'Loading groups…';
  const selected = $('group').value;
  try {
    const items = await api('/groups');
    $('group').replaceChildren(new Option(items.length ? 'Select a group' : 'No groups synced yet — refresh shortly', ''));
    items.sort((a,b) => a.name.localeCompare(b.name)).forEach(g => $('group').append(new Option(g.name, g.id)));
    if (items.some(g => g.id === selected)) $('group').value = selected;
    $('groupStatus').textContent = `${items.length} groups loaded. ${items.length ? '' : 'Open WhatsApp on your phone, allow syncing, then refresh.'}`;
    notice('');
  } catch(e) {
    $('groupStatus').textContent = 'Group loading failed. No message was sent by this action.';
    if (!$('group').value) $('group').replaceChildren(new Option('Could not load groups — see error above', ''));
    throw e;
  } finally { loadingGroups = false; $('refresh').disabled = false; }
}
async function chats() {
  if (loadingChats) return;
  loadingChats = true; $('chatsRefresh').disabled = true;
  const selected = $('chat').value;
  try {
    const items = (await api('/chats')).filter(c => !c.isGroup);
    $('chat').replaceChildren(new Option(items.length ? 'Select an individual chat' : 'No individual chats synced yet', ''));
    items.sort((a,b) => a.name.localeCompare(b.name)).forEach(c => $('chat').append(new Option(c.name, c.id)));
    if (items.some(c => c.id === selected)) $('chat').value = selected;
    notice('');
  } finally { loadingChats = false; $('chatsRefresh').disabled = false; }
}
async function unlock() {
  await status(); unlocked = true;
  sessionStorage.setItem('wa-key', key);
  $('unlock').hidden = true; $('workspace').hidden = false;
  await history();
}
$('unlockForm').addEventListener('submit', async e => { e.preventDefault(); key = $('apiKey').value.trim(); try { await unlock(); notice(''); } catch (e) { notice(e.message); } });
$('connect').addEventListener('click', async () => { try { await api('/connect', { method:'POST', body:'{}' }); await status(); } catch(e) { notice(e.message); } });
$('kind').addEventListener('change', () => {
  const kind = $('kind').value;
  $('phoneFields').hidden = kind !== 'phone'; $('groupFields').hidden = kind !== 'group'; $('chatFields').hidden = kind !== 'existing';
  if (ready && kind === 'group') groups().catch(e=>notice(e.message));
  if (ready && kind === 'existing') chats().catch(e=>notice(e.message));
});
$('chatsRefresh').addEventListener('click', () => chats().catch(e=>notice(e.message)));
$('refresh').addEventListener('click', () => groups().catch(e=>notice(e.message)));
$('historyRefresh').addEventListener('click', () => history().catch(e=>notice(e.message)));
$('message').addEventListener('input', () => { $('count').textContent = `${$('message').value.length} / 4000`; });
$('sendForm').addEventListener('submit', async e => {
  e.preventDefault(); if (inFlight || !ready) return;
  const kind = $('kind').value;
  const body = { message: $('message').value, ...(kind === 'phone' ? { phone: $('phone').value.trim() } : kind === 'group' ? { groupId: $('group').value } : { chatId: $('chat').value }) };
  if (!body.phone && !body.groupId && !body.chatId) { notice('Choose a destination first.'); return; }
  if (mode === 'live' && !confirm(`Send this real WhatsApp message to ${body.phone || (kind === 'group' ? $('group') : $('chat')).selectedOptions[0].text}?`)) return;
  // Preserve the key on failed requests; explicit new submits after success get a new key.
  const serialized = JSON.stringify(body);
  if (serialized !== lastBody || !requestKey) { requestKey = crypto.randomUUID(); lastBody = serialized; }
  inFlight = true; $('send').disabled = true; notice('');
  try {
    const result = await api('/send', { method:'POST', headers:{ 'Idempotency-Key':requestKey }, body:serialized });
    $('sendResult').textContent = result.status === 'simulated' ? 'Simulated only. No message was sent to WhatsApp.' : `Submitted. Message ID: ${result.messageId}. Verify on the recipient’s phone.`;
    requestKey = null;
  } catch(e) { notice(e.message); $('sendResult').textContent = 'Check history before retrying. The same request key will be reused for an unchanged message.'; }
  finally { inFlight = false; await status().catch(()=>{}); await history().catch(()=>{}); }
});
if (key) unlock().catch(() => { key = ''; sessionStorage.removeItem('wa-key'); });
setInterval(async () => { if (unlocked) { try { await status(); await history(); } catch(e) { ready = false; $('send').disabled = true; notice('Service unavailable or access expired. Check the server terminal.'); } } }, 3000);
