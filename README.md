# LivDecor WhatsApp Lab v1.2 — working local prototype

A standalone Node.js service and browser UI for linking a WhatsApp account, sending a text to one individual or one group, and inspecting message IDs and acknowledgements. It uses whatsapp-web.js, not WABA. The API is designed to be called later by another application.

**This is an unofficial integration. Account restriction or blocking is possible. There is no ban-proof sending interval or volume. Use expected, consented test messages.**

## Updating from the first prototype (keep your linked login)

1. Stop the original server with Ctrl+C.
2. Extract this ZIP to a temporary folder.
3. Copy its source files and public/test folders into your existing prototype folder, replacing matching files. Keep your original `.wwebjs_auth`, `.wwebjs_cache`, `data`, `.env` and `node_modules` folders/files. This ZIP does not include them.
4. In the original folder run `npm.cmd start`, refresh the browser with Ctrl+F5, unlock and click Connect. The saved session should restore unless WhatsApp has revoked it.
5. Select Group chat and click Refresh groups. To select an existing individual conversation, choose **Existing individual chat**, then Refresh chats. The normal Individual chat option still accepts a phone number directly.
6. If loading still fails, copy the exact orange error text, plus the matching terminal error. Do not share the API key or QR code.

### v1.2 correction

The v1.1 lookup incorrectly required the legacy `window.Store.Chat`. The current installed library uses `window.require('WAWebCollections').Chat`. This revision uses that module first and keeps the legacy store only as a fallback. It also supports alternate `$1` and validated string WID representations. The regression tests now include a modern module-loader environment with no `window.Store` at all.

For this specific update you can stop the server, replace **adapter.js** from this archive in your existing folder, and restart with npm.cmd start. No reinstall, auth folder deletion or QR reset is required solely for this code change. Then reconnect and refresh the group list. The complete archive also updates the version badge and status wording.

### v1.1 changes

- Lightweight ID/title lookup avoids full chat serialization, which can fail for some WhatsApp Business accounts. The public library lookup remains a fallback. This uses internal WhatsApp Web fields and may require maintenance after WhatsApp updates.
- Groups automatically load when the connection becomes ready while Group chat is selected.
- Existing individual chats can be selected by title/ID. Lists reflect chats currently synced to the linked device; this is not a full message-history viewer.
- Read-only list errors show the actual diagnostic and never imply that a message was sent.
- Existing phone/group idempotency fingerprints and local credentials are preserved.

## Quick start on Windows

1. Install **Node.js 24 LTS** from https://nodejs.org (Node 22+ is required by this prototype).
2. Extract the entire ZIP to a normal folder, e.g. `C:\Projects\whatsapp-prototype`. Do not run from inside the ZIP viewer.
3. Double-click **start-windows.cmd**. The first run installs packages and downloads Chromium; keep internet access available. Or use PowerShell:

```powershell
cd C:\Projects\whatsapp-prototype
npm.cmd ci
npm.cmd start
```

4. Open **http://127.0.0.1:3001** in Chrome or Edge.
5. Copy the **API key printed in the terminal** into the page and click Unlock.
6. Click **Connect WhatsApp**. Wait for a QR code; it refreshes automatically as needed.
7. On your phone open WhatsApp → Linked devices → Link a device, and scan the QR.
8. Wait for the connection badge to say **ready**.
9. Select Individual chat, enter an international phone number (digits only), type a message, tick the permission checkbox, and click Send. Confirm the recipient in the popup.
10. Select Group chat, click Refresh groups, select the correct group, and send a test. The linked account must belong to the group and be allowed to post (admin-only groups require the sending account to be an admin).
11. Check the recipient's phone and the history. A message ID or submitted result alone is **not proof of delivery**.

Keep the terminal open and computer awake while using the app. Ctrl+C stops it. Restart with the same folder to reuse the saved session. The prototype does not automatically connect on startup; click Connect to restore the session.

## What is real and what is a simulation?

- `npm start`: live mode. Connect generates a real WhatsApp QR, and Send calls whatsapp-web.js. No fake login or fake message success.
- `npm run demo`: local simulation for UI testing. A permanent DEMO label is shown, no WhatsApp browser starts, no QR is generated and no messages leave the app. History says simulated.
- `npm test`: automated tests with a fake adapter. These verify application behavior, not delivery through WhatsApp.

Stop the running server before switching modes. Live and demo histories use separate files.

## Verification checklist

- [ ] Link an account with a real QR code in LIVE mode.
- [ ] Send to an individual and confirm the exact text on their phone.
- [ ] Send to a group and confirm it in that group.
- [ ] Record the returned WhatsApp message ID.
- [ ] Restart, unlock and reconnect; check whether the existing session restores without a QR.
- [ ] POST an identical request twice with the same Idempotency-Key; verify only one copy arrives.
- [ ] Disable the connection / unlink the device; verify sending is unavailable and an error is visible.
- [ ] Observe acknowledgements where available; read receipts may depend on recipient settings and group semantics.

The included TEST-RESULTS.md states which checks were performed during development. Real account linking and actual delivery must be verified with your account.

## API for your other application

All `/api/*` routes require `Authorization: Bearer YOUR_KEY`. Requests are accepted only on loopback with localhost/127.0.0.1 Host and same-origin browser requests. The key is generated on first startup and stored in `data/api-key.txt`, unless overridden by API_KEY in .env. Do not put the secret into a public frontend.

| Method | Route | Purpose |
|---|---|---|
| GET | /api/status | Mode, connection state, current QR data URL, last problem |
| POST | /api/connect | Start/restore WhatsApp connection (asynchronous) |
| GET | /api/groups | Groups belonging to the linked account |
| GET | /api/chats | Synced chat IDs and titles (individual and group) |
| POST | /api/send | Send one text; requires Idempotency-Key |
| GET | /api/messages | Most recent 100 records, newest first |

### Test the API in a second PowerShell window

```powershell
$waHeaders = @{
    Authorization = "Bearer PASTE_YOUR_SERVER_KEY"
    "Idempotency-Key" = "manual-test-0001"
}
$waBody = @{
    phone = "919876543210"
    message = "Test from the standalone WhatsApp prototype"
} | ConvertTo-Json
Invoke-RestMethod -Uri "http://127.0.0.1:3001/api/send" -Method Post -Headers $waHeaders -ContentType "application/json" -Body $waBody
```

Replace the number with your actual test recipient. For a group, replace `phone` with `groupId`, using a real ID returned by `/api/groups`. Provide exactly one of phone, groupId, or chatId. For an existing individual conversation, use chatId from /api/chats (including its @c.us or @lid suffix). Message limit: 4000 characters. One send is allowed in progress at a time; concurrent new sends get HTTP 429.

### Backend integration example (Node.js)

```js
async function notifyLead(lead) {
  const response = await fetch('http://127.0.0.1:3001/api/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `lead-created:${lead.id}:team`
    },
    body: JSON.stringify({
      groupId: process.env.WHATSAPP_TEAM_GROUP_ID,
      message: `New lead #${lead.id}: ${lead.city}`
    }),
    signal: AbortSignal.timeout(30000)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result));
  return result;
}
```

Your backend can call this after saving a lead, after verifying and deduplicating a payment webhook, or from its own scheduler. The current prototype does not include a scheduling UI. The send endpoint must never be used as a raw public Razorpay webhook.

Use a stable unique key for each event + recipient + message type, and reuse that key on retries. Same key + same payload returns the existing record without resending. Same key + changed payload gives 409. Before contacting WhatsApp the app writes a reservation to disk. A send exception or interrupted in-flight send becomes **uncertain**, and the same key is blocked from automatic resend. Check the recipient before deciding to create a genuinely new request. This is conservative duplicate suppression, not a guarantee of exactly-once delivery. Do not delete history if you rely on its duplicate keys.

The UI reuses a key for unchanged failed sends in the same page session. A page reload creates a new UI request context: check History before trying again.

## Status meanings

- `submitted`: whatsapp-web.js returned a WhatsApp message object. Not confirmation of recipient delivery.
- `pending` / `server-accepted` / `delivered` / `read`: acknowledgement supplied by WhatsApp, when observed. Group behavior and read receipts vary.
- `uncertain`: the result cannot be confirmed. Do not automatically resend.
- `simulated`: only demo mode. No WhatsApp delivery.

## Configuration and hosting

Optional: copy .env.example to .env and set PORT, API_KEY (24+ characters), or CHROME_PATH. The generated key works without any configuration.

- `data/`: API key and message logs (including text and destinations).
- `.wwebjs_auth/`: sensitive linked-device credentials and browser session data.
- `.wwebjs_cache/`: WhatsApp Web cache.

Keep these folders private, restrict filesystem access, and exclude them from uploads, source control and shared ZIPs. The API key appears in the local terminal; do not share screenshots of it. QR codes also grant account access. The UI intentionally does not read or display incoming chat contents.

For production, replace the single-process JSON store with your application's durable database/outbox and worker. Run one process for this session, add monitoring, durable job scheduling if needed, retention policy and backups. Never start two processes using the same auth directory. A long-running host with a browser and persistent disk is required; ordinary serverless functions and many shared cPanel plans are unsuitable.

The default loopback binding is intentional. If your other application is on a different server, localhost refers to that other server: use a private network or authenticated HTTPS reverse proxy with deliberate origin/Host configuration. Do not simply change the bind address and expose the port publicly. This prototype has no multi-user roles or production login system.

On Linux, install Chromium system dependencies, run as a non-root OS user and keep browser sandboxing enabled. The Windows launcher is the easiest path for this prototype. No Docker/root/no-sandbox setup is included.

## Troubleshooting

| Problem | Action |
|---|---|
| npm blocked by PowerShell execution policy | Use `npm.cmd`, or the provided .cmd launcher. |
| First installation fails | Check internet access and the terminal error. Browser download may be blocked by firewall/proxy. Rerun npm.cmd ci after correcting the cause. |
| Could not find Chrome | Run `npx.cmd puppeteer browsers install chrome`, or point CHROME_PATH in .env to an installed compatible Chrome executable. Restart. |
| QR does not appear | Check the status error and terminal. Wait for browser startup and ensure web.whatsapp.com is reachable from this computer. |
| Authentication fails | Unlink the prototype under WhatsApp Linked devices, stop the server, then reconnect. Never delete session files while the browser is running. |
| QR required every time | Keep the same extracted folder and preserve .wwebjs_auth. Unlinking/expiry can still require a fresh QR. |
| Group is missing | Confirm membership and refresh after chats finish loading. |
| Server port is busy | Stop the previous process, or set another PORT in .env and use that port in the browser. |
| Delivery not confirmed | Check the recipient's phone; submitted alone is insufficient. |
| WhatsApp updates break the client | Review the project's releases/issues, back up securely, update and retest before production use. |

## Source layout

- server.js: configuration, localhost listener and shutdown.
- adapter.js: isolated real WhatsApp adapter and explicit demo adapter.
- app.js: authenticated API, QR state, history and idempotency.
- public/: local UI; no external scripts, trackers or CDN assets.
- test/api.test.js: fake-adapter HTTP tests; no real messages sent.
- package-lock.json: exact tested dependency resolution. Install with npm ci.

Reference documentation: https://wwebjs.dev/guide/ and https://docs.wwebjs.dev/Client.html
