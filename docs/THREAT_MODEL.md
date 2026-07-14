# Threat Model

## Product Context

This threat model applies to Send Guard for Gmail v0.1, an independent Chrome extension for Gmail Web. It is authored by shogot62 and licensed under the MIT License.

Gmail™ is a trademark of Google LLC. Send Guard is an independent project and is not affiliated with, endorsed by, or sponsored by Google.

## Assets

- Email body and quoted body
- Subject
- Recipient addresses and domains
- Attachment names and sizes
- CC/BCC state
- Extension settings
- Language preference

## Trust Boundaries

- Gmail Web DOM is untrusted input.
- Extension settings are local browser data.
- There is no trusted external server in v0.1.

## Attack Surface

- Content script DOM parsing
- Modal rendering
- Options page input handling
- Chrome storage migration
- Gmail DOM changes causing false positives or false negatives

## Controls

- No external communication
- No Gmail API, Google API, or OAuth
- Minimal Chrome permissions
- Normal settings storage uses `chrome.storage.local`
- `chrome.storage.local` is not treated as an encrypted secrets vault; credentials and tokens are out of scope for settings
- Gmail-derived values are rendered with `textContent`, `createTextNode`, and `createElement`
- Options-page Auto BCC values are added one at a time, validated and deduplicated, rendered with `textContent`, and stored only in `chrome.storage.local`
- Options controls retain visible keyboard focus, announce validation/save status, wrap long values, and support reduced-motion and narrow-window layouts
- Japanese/English UI strings are bundled locally; no external translation service or remote localization file is used
- Gmail-derived subject, recipient, domain, attachment name, and attachment size values are not translated
- Attachment detection excludes recipient/email chips and generic delete buttons without strong file evidence
- Reply Auto CC/BCC uses bounded local DOM expansion/retry logic and verifies the inserted address through Gmail's visible recipient DOM
- Auto CC/BCC state display distinguishes disabled, unconfigured, pending, already-present, partially-missing, and bounded-failure outcomes so a failed local injection is not misrepresented as success
- Normal MutationObserver handling is debounced and limited to lightweight compose/send-button detection
- Detailed body, recipient, and attachment checks run only at send intent time or during necessary modal refresh
- Attachment upload refresh timers run only while the modal is visible and an upload is detected
- Automated tests cover core checks and high-risk Gmail DOM variants
- Shipped TestHooks are limited to isolated-world lifecycle controls and aggregate metrics; they do not expose Gmail-derived data
- CWS release archives are generated from a fixed whitelist by a deterministic STORE-only ZIP writer and validated for exact entries, safe paths, zero directories, and checksum integrity

## Residual Risks

- Gmail DOM may change without notice.
- Chrome 150 + Gmail Web manual verification is still required.
- Chrome 150 + Gmail Web performance behavior must be verified manually on representative mailboxes.
- Chrome 150 + Gmail Web language switching behavior must be verified manually.
- Reply Auto CC/BCC expansion depends on Gmail reply-recipient DOM variants and must be verified manually in Chrome 150 + Gmail Web.
- Some attachment chip variants may require future selector updates.
- Ctrl+Enter/Cmd+Enter depends on Gmail Web keyboard event behavior and must be verified manually in Chrome 150 + Gmail Web.
- Schedule Send and other special Gmail sending flows may use different DOM or event paths and remain residual risks in v0.1.
- Browser, operating system, device compromise, and other extensions are outside the guarantees of this extension.
