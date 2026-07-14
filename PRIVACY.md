# Privacy Policy

Send Guard for Gmail is an independent local-only Chrome extension for Gmail Web.

Gmail™ is a trademark of Google LLC.
Send Guard is an independent project and is not affiliated with, endorsed by, or sponsored by Google.

Gmail™はGoogle LLCの商標です。
Send Guardは独立したプロジェクトであり、Googleとの提携、承認、後援関係はありません。

## Information Read In The Page

The extension reads visible Gmail compose DOM state needed for pre-send review:

- Subject field or nearby subject text
- Current compose body, excluding quoted text and signatures where detectable
- To/Cc/Bcc recipient chips and domains
- Attachment chip names, size labels, and upload status labels
- Visible CC/BCC compose state for Auto CC/BCC verification

## Information Stored

Settings are stored in `chrome.storage.local`:

- UI settings
- Additional attachment keywords
- Auto CC/BCC enabled/disabled state
- Auto CC/BCC addresses configured by the user
- Confirmation checkbox settings
- Language preference
- Theme

Auto CC/BCC supports multiple configured addresses through the same de-duplicated chip-input workflow and per-address removal. These address-list changes are stored only in `chrome.storage.local`.

## Information Not Stored

The extension does not store:

- Email body or quoted body
- Subject
- Recipient email addresses
- Recipient domain lists
- Attachment file names
- Attachment file sizes
- Gmail thread IDs or message IDs
- Actual CC/BCC state

## External Transmission

No external communication is implemented by this extension. The extension does not send email content or settings to external servers.

It does not use Gmail API, Google API, OAuth, analytics, telemetry, `fetch`, `XMLHttpRequest`, `WebSocket`, or `sendBeacon`.

The Japanese/English UI is provided by packaged local dictionaries. The extension does not use external translation services or remote localization files.

## Local Processing

All checks run in the browser on the Gmail Web page. Gmail DOM content is treated as untrusted input and rendered with DOM APIs such as `textContent` and `createElement`.

Gmail-derived subject, recipient, domain, attachment name, and attachment size values are not translated. They are displayed as read from Gmail so users can review the original data.

## Local Storage Caveat

Settings remain in the user's local Chrome extension storage until changed, reset, or removed with the extension. `chrome.storage.local` is not an encrypted secrets vault and should not be used to store passwords, tokens, or other secrets. The extension does not store email content.
