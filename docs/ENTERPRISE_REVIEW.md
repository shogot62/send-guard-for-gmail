# Enterprise Review Notes

This document summarizes Send Guard for Gmail v0.1 for IT, security, legal, and operations review.

## Product and Legal Status

- Product: Send Guard for Gmail
- Brand: Send Guard
- Author: shogot62
- License: MIT License
- Repository: `https://github.com/shogot62/send-guard-for-gmail`
- Gmail™ is a trademark of Google LLC.
- Send Guard is an independent project and is not affiliated with, endorsed by, or sponsored by Google.

## Purpose

Send Guard for Gmail displays a local pre-send self-check modal in Gmail Web to reduce subject, recipient domain, attachment, CC/BCC, and confirmation-check omissions.

## Permissions

- `storage`: stores extension settings.
- Static `content_scripts.matches`: limits content-script execution to `https://mail.google.com/*`.

No `host_permissions`, `tabs`, `history`, `identity`, `scripting`, `activeTab`, `webRequest`, or `declarativeNetRequest` permission is requested. The extension does not perform cross-origin fetches or use host-permission APIs.

The extension-page CSP is explicitly `script-src 'self'; object-src 'none'`.

## Data Handling

The extension reads visible Gmail compose state locally:

- Subject
- Current compose body
- To/Cc/Bcc chips and domains
- Attachment chips and upload state
- CC/BCC compose state

The extension stores only settings in `chrome.storage.local`:

- UI settings
- Attachment keywords
- Auto CC/BCC settings
- Auto CC/BCC addresses configured by the user
- Confirmation checkbox settings
- Language preference
- Theme

The extension does not store:

- Email body or quoted body
- Subject
- Recipient email addresses
- Recipient domain lists
- Attachment names
- Attachment sizes
- Gmail IDs
- Actual CC/BCC state

## External Services

The extension does not use external servers, Gmail API, Google API, OAuth, analytics, telemetry, `fetch`, `XMLHttpRequest`, `WebSocket`, or `sendBeacon`.

Japanese/English UI strings are bundled in the extension. No external translation service or remote localization file is used.

## Language Support

The options page allows users to choose Auto, Japanese, or English. The language preference is stored in `chrome.storage.local`.

Options page labels and the pre-send modal are localized. Gmail-derived subject, recipient addresses, domains, attachment names, and attachment sizes are not translated and are displayed as original Gmail data.

Auto CC and Auto BCC use the same chip-input flow: Enter, comma, or space commits an address as a chip, and pasting multiple separated addresses creates multiple chips. Normalized duplicates are skipped. Each chip has an address-specific accessible remove control, and changes are saved immediately to `chrome.storage.local`. The options page also provides explicit labels, visible keyboard focus, `aria-live` status, light/dark contrast, reduced-motion handling, long-value wrapping, and a narrow desktop layout down to 360px equivalent.

## Performance Design

Normal Gmail monitoring is intentionally lightweight. MutationObserver activity is debounced and used for compose/send-button detection and hook setup only. When both Auto CC and Auto BCC are disabled, scans skip Auto CC/BCC-specific compose-root discovery.

Detailed checks for subject, recipients, attachments, and current compose body run immediately before a send click or Ctrl+Enter/Cmd+Enter send shortcut, or while an already-open self-check modal needs to refresh.

Attachment upload re-evaluation is limited to the visible modal and only runs while an uploading attachment is detected. Timers are stopped when the modal is canceled, closed with Esc, confirmed, or when the upload becomes ready.

Saving settings schedules a new bounded scan in already-open Gmail tabs, so newly enabled Auto CC/BCC settings are applied without requiring a Gmail reload.

Basic manual verification on real Gmail Web has been completed by the maintainer for the initial public release. Full real-browser performance verification remains recommended before organizational rollout and after changes affecting Gmail monitoring or compose detection.

## Reply Auto CC/BCC Behavior

When Auto CC or Auto BCC is enabled, the content script attempts to expand collapsed compose/reply recipient areas, open the Cc/Bcc control, inject each configured address, and then verify that Gmail exposes the addresses through the compose recipient DOM. This injection path runs when a compose/reply window is detected and is not executed while the self-check modal is open. Pending Auto CC/BCC temporarily disables final send confirmation.

If any configured Auto CC/BCC address cannot be verified after bounded retries, the pending state is cleared and the modal shows a warning. The user can still choose to send; the extension does not create a permanent local block.

The modal displays every configured Auto CC/BCC address in native `details`/`summary` accordions grouped by domain, matching the To/Cc/Bcc recipient review. It keeps these details visible for partial-missing and bounded-failure warnings, and distinguishes disabled, unconfigured, pending, added, already-present, partially-missing, and bounded-failure states. This avoids presenting an enabled setting with no configured address as a successful injection.

## Package Boundary

`extension/` is the canonical product source. The release script regenerates `public_repo/extension/` and `extension_package/extension/` from that source using an explicit file whitelist. A Node.js STORE-only writer creates the CWS ZIP with fixed entry order, timestamp, creator/mode metadata, and slash paths; it emits no directory entries, extra fields, entry comments, or archive comment. The validator compares every entry against the whitelist, rejects duplicate/absolute/traversal/backslash/extra/missing entries, requires root `manifest.json`, and verifies the generated SHA-256 checksum. A separate command independently creates two archives and requires identical bytes, SHA-256, entry order/count, and zero directory entries.

The GitHub repository may include docs, tests, CI, and general packaging tools. Internal audit logs, work prompts, design previews, screenshots, and Gmail DOM dumps are not part of the public or extension package scope.

## Test Hooks

`GmailSendGuardTestHooks` is retained so the shipped and tested code do not diverge. It exists only in Chrome's content-script isolated world, returns aggregate counters only, has no external communication capability, and does not return Gmail body text, subjects, recipients, attachments, or compose snapshots.

## Known Limitations

- Gmail DOM is not a stable public API.
- Automated tests are candidate evidence only.
- Basic manual verification on real Gmail Web has been completed for the initial public release, but the comprehensive checklist below is not represented as fully completed.
- Full real-browser functional and performance verification remains required before organizational rollout and after material Gmail DOM changes.
- Ctrl+Enter/Cmd+Enter send shortcuts are routed through the same self-check modal in v0.1. When the modal is active and the final send button is enabled, Ctrl+Enter/Cmd+Enter confirms the modal. Esc cancels and returns to editing. These flows should be manually verified in the target Chrome and Gmail Web environment.
- Reply Auto CC/BCC attempts to open collapsed recipient/Cc/Bcc areas and should be manually verified in the target Chrome and Gmail Web environment.
- Schedule Send and other special Gmail sending flows are residual risks in v0.1 and require manual review before rollout.

## Security Reporting

Do not include suspected vulnerability details in public Issues. Use GitHub Private Vulnerability Reporting when the repository displays the **Report a vulnerability** option.

If the private reporting option is unavailable, open a public issue containing only a request for a private reporting channel. Do not include vulnerability details, proof-of-concept code, screenshots, logs, real email data, credentials, or other confidential information.

## Comprehensive Manual Verification Checklist

1. New compose with subject shows subject.
2. New compose without subject shows a warning.
3. Reply compose obtains a subject or shows subject-unavailable warning.
4. Forward compose obtains a subject or shows subject-unavailable warning.
5. Pop-out compose is detected.
6. Multiple compose windows do not mix data.
7. Quoted thread text containing attachment keywords does not trigger attachment warning.
8. Current body containing attachment keywords without a file triggers warning.
9. PDF attachment shows name and size.
10. Excel attachment shows name and size.
11. Image attachment shows name and size.
12. ZIP attachment shows name and size.
13. Japanese filenames display correctly.
14. Filenames with spaces or parentheses display correctly.
15. Multiple attachments are listed.
16. Uploading attachments disable final send with uploading text.
17. Completed uploads restore the correct final button state.
18. Auto CC pending disables final send and OK state restores normal judgment.
19. Auto BCC pending disables final send and OK state restores normal judgment.
20. Existing CC is not duplicated.
21. Existing BCC is not duplicated.
22. Reply Auto CC expands collapsed recipient/Cc areas without a manual recipient click and before the self-check modal opens.
23. Reply Auto BCC expands collapsed recipient/Bcc areas without a manual recipient click and before the self-check modal opens.
24. Auto CC failure clears pending state and allows warning-based confirmation.
25. Auto BCC failure clears pending state and allows warning-based confirmation.
26. Confirmation checkbox settings change modal visibility and button text as expected.
27. Send confirmation triggers the original send button once.
28. Repeated clicks do not double send.
29. Esc or cancel does not send.
30. Ctrl+Enter/Cmd+Enter opens the self-check modal.
31. Ctrl+Enter/Cmd+Enter in the active modal confirms only when the final send button is enabled.
32. Ctrl+NumpadEnter follows the same modal path.
33. Esc in the active modal cancels and does not send.
34. Schedule Send and other special Gmail send flows are understood and documented as residual risks.
35. Options page renders correctly with Auto language.
36. Options page renders correctly with Japanese selected.
37. Options page renders correctly with English selected.
38. Language switching updates the options page without reload.
39. New compose pre-send modal renders in Japanese.
40. New compose pre-send modal renders in English.
41. Ctrl+Enter/Cmd+Enter confirmation works in each language.
42. Esc cancellation works in each language.
43. Attachment warnings render in each language.
44. Gmail-derived subject, recipient, domain, attachment name, and size values remain untranslated and safely displayed.
