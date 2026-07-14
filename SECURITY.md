# Security Policy

## Reporting Vulnerabilities

Please do not open a public issue for suspected security vulnerabilities.

GitHub Private Vulnerability Reporting is planned to be enabled after the repository is published. Once enabled, use it for confidential security reports. Include a description, reproduction steps, affected version, and potential impact.

Do not include real email body text, recipient addresses, attachment names, screenshots containing customer data, Gmail DOM dumps, credentials, or other confidential information in public discussions. Use synthetic examples such as `client@example.com` and dummy filenames for non-security reports.

## Security Design

- Chrome Manifest V3
- No remote hosted code or external network communication
- No Gmail API, Google API, or OAuth
- No analytics or telemetry
- Minimal API permission: `storage`
- Gmail scope is limited by the static `content_scripts.matches` entry for `https://mail.google.com/*`; there is no separate `host_permissions` entry
- Extension-page CSP: `script-src 'self'; object-src 'none'`
- Normal settings storage uses `chrome.storage.local`
- Gmail-derived values are rendered with safe DOM APIs, not HTML injection
- Packaged TestHooks run in Chrome's content-script isolated world and expose only aggregate performance metrics plus test lifecycle controls; they do not expose Gmail content or compose snapshots
- Release ZIPs are created by the repository's deterministic Node.js STORE writer from an exact whitelist, with no directory entries, extra fields, or comments; validation also verifies the companion SHA-256 file
- Options-page user values are rendered with `createElement` and `textContent`; there are no inline handlers or HTML-string rendering paths

## Sensitive Test Data

Tests and reports must use reserved domains such as `example.com`. Do not commit real customer names, real email addresses, real attachment names, screenshots, Gmail DOM dumps, or local machine paths.

## Trademark Notice

Gmail™ is a trademark of Google LLC.
Send Guard is an independent project and is not affiliated with, endorsed by, or sponsored by Google.
