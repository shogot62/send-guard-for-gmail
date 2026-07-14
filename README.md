# Send Guard for Gmail

Send Guard for Gmail is an independent, privacy-first, local-only Chrome MV3 extension for Gmail Web. It helps users review the subject, recipient domains, attachments, configured Auto CC/BCC, and confirmation checks immediately before sending.

No external servers. No Gmail API. No OAuth. No email-content storage.

Send Guard for Gmailは、Gmail Web版の送信前に件名・宛先ドメイン・添付ファイル・CC/BCC・確認チェックを確認する、ローカル処理のChrome拡張です。

外部通信なし、Gmail API/OAuthなし、メール本文等の保存なし、設定は`chrome.storage.local`にのみ保存します。

## Independence and Trademark Notice

Gmail™ is a trademark of Google LLC.
Send Guard is an independent project and is not affiliated with, endorsed by, or sponsored by Google.

Gmail™はGoogle LLCの商標です。
Send Guardは独立したプロジェクトであり、Googleとの提携、承認、後援関係はありません。

## What It Checks

- Subject presence and optional confirmation.
- Recipient domains grouped for review.
- Attachment-related wording when no attachment is detected.
- Configured Auto CC/BCC state in a compose or reply window.
- Optional per-section confirmation checkboxes.

## Privacy and Security

- All checks run locally in the Gmail Web page.
- The extension does not make external network requests or use Gmail API, Google API, OAuth, analytics, or telemetry.
- Email body, quoted body, subject, recipient addresses/domains, attachment names/sizes, Gmail IDs, and actual CC/BCC state are not stored.
- Settings are stored in `chrome.storage.local`; it is not an encrypted secrets vault.
- The only Chrome API permission is `storage`; the content script is limited to `https://mail.google.com/*`.

## Install Locally

1. Open `chrome://extensions/`.
2. Enable Developer mode.
3. Click **Load unpacked**.
4. Select the `extension/` directory.
5. Reload Gmail Web and test a compose window.

The production load target is `extension/`. Create the CWS candidate with `npm run release:package`.

## Development and Release Validation

```bash
npm ci
npm test
npm run lint:basic
npm run release:package
npm run release:validate
npm run release:reproducibility
```

Release scripts regenerate `public_repo/extension/` and `extension_package/extension/` from `extension/`. The CWS ZIP is deterministic, has no directory entries, includes only the approved extension-file whitelist, and has a companion SHA-256 file.

## Chrome 150 + Gmail Web QA

Automated tests are candidate evidence only. Chrome 150 + real Gmail Web manual QA has not been performed in this AI environment and remains required before public rollout. Gmail DOM changes, reply/forward flows, Auto CC/BCC behavior, keyboard shortcuts, Schedule Send, attachments, language switching, and performance require real-browser verification.

## Documentation

- [Local install guide](docs/INSTALL_LOCAL.md)
- [Privacy policy](PRIVACY.md)
- [Security policy](SECURITY.md)
- [Enterprise review notes](docs/ENTERPRISE_REVIEW.md)
- [Threat model](docs/THREAT_MODEL.md)
- [Code of conduct](CODE_OF_CONDUCT.md)

## Project Metadata

- Repository: [shogot62/send-guard-for-gmail](https://github.com/shogot62/send-guard-for-gmail) (available after repository publication)
- Author: shogot62
- License: [MIT License](LICENSE)
- Created and maintained by shogot62.

## Contributing

Issues and feature suggestions are welcome. Unsolicited code pull requests are not being accepted at this time; please open an issue before proposing implementation work. See [CONTRIBUTING.md](CONTRIBUTING.md).
