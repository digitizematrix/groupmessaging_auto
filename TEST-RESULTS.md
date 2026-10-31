# Prototype validation

Development checks completed on 30 October 2026.

## Passed

- Installed dependencies successfully, including whatsapp-web.js 1.34.7 and its browser download.
- Verified the real library exports and all Client methods used by the adapter.
- All 10 automated HTTP tests passed: authentication/origin/Host restrictions, not-ready rejection and QR rendering, individual sends and duplicate keys, groups and missing recipients, input validation, delivery acknowledgements, uncertain send handling, concurrent request rejection, restart recovery, explicit demo labeling.
- Browser interaction test passed: unlock, demo connect, individual simulated send, group loading/selection and group simulated send, history rendering.
- Browser run reported no frontend JavaScript errors.
- Visually inspected desktop (1280 px) and mobile (390 px) layouts. No page horizontal overflow.
- JavaScript syntax check passed.

## Requires the user's live account

No WhatsApp account was linked and no real messages were sent during development. The browser interaction check used the explicitly labeled demo adapter. Real QR pairing, session restoration, individual delivery, group delivery and real WhatsApp acknowledgements must be verified by running npm start and following README.md. Tests do not establish account safety or protection from blocking.

The launcher is supplied for Windows, but the .cmd file itself was not executed on Windows in this environment. Node and browser/API checks ran on Linux.

## v1.1 regression checks

- All 15 automated tests pass, including chat-model serialization failure isolation, fallback lookups, read-only list diagnostics, and existing individual chat sending.
- A lightweight chat-store fixture reproduces a failing Business title getter and verifies other chats remain available. This is a simulated fixture, not a live WhatsApp Business reproduction.
- Live account behavior still needs verification on the affected machine. A screenshot alone cannot establish the exact upstream exception.
- v1.1 browser regression passed: automatic group loading after readiness, group send, existing individual chat selection/send, deliberate group-list failure with actionable diagnostic, zero JavaScript errors, and no mobile horizontal overflow. All sends in this test were explicitly simulated.

## v1.2 correction checks

All 17 automated tests pass. New tests cover modern WAWebCollections module loading when window.Store is absent, alternate serialized recipient IDs, and detection of an incompatible ID shape. These are browser-context fixtures; real account chat discovery and sending remain to be verified on the user's machine. No new live WhatsApp test is claimed.
