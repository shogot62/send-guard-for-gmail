# Changelog

## 0.1.0 public metadata update

- Renames public product references to Send Guard for Gmail and the repository metadata to `send-guard-for-gmail`.
- Sets the copyright holder to shogot62 under the MIT License.
- Adds independent-project and Gmail™ trademark notices, contribution policy, and planned private vulnerability reporting guidance.

## 0.1.0 Auto CC/BCC settings UX alignment

- Aligns Auto CC and Auto BCC address registration with the same de-duplicated chip-input flow, multi-address paste handling, and per-address removal controls.
- Applies saved Auto CC/BCC settings to already-open Gmail compose windows and skips Auto CC/BCC-specific root discovery while both features are disabled.

## 0.1.0

- Release-candidate hardening: removes duplicate `host_permissions`, adds an explicit MV3 extension-page CSP, and keeps Gmail scope in static content-script matches.
- Adds accessible modal dialog semantics, dynamic Tab focus trapping, send-control focus return on cancellation, and `aria-disabled` state on the final send action.
- Moves options-page CSS to `options.css`, adds explicit control labels and validation announcements, and provides configured-address lists with per-address removal for Auto CC/BCC.
- Completes light/dark primary-button contrast, narrow-window layout, long-value wrapping, fieldset alignment, reduced-motion handling, sticky save actions, focus visibility, and `aria-live` save feedback.
- Keeps fieldset/legend titles inside the Confirmation Checkboxes, Auto CC, and Auto BCC cards, and shows configured Auto CC/BCC addresses in domain-grouped modal accordions, including warning states.
- Adds deterministic whitelist-based public/staging synchronization and a Node.js STORE-only CWS ZIP writer with fixed metadata, byte-for-byte reproducibility proof, strict directory/duplicate/traversal/extra/missing entry rejection, SHA-256 generation, checksum validation, and CI verification.
- Distinguishes Auto CC/BCC disabled, unconfigured, pending, added, already-present, partial-missing, and bounded-failure Modal states without reintroducing a permanent send block.

- Initial local-only Gmail pre-send review extension.
- Adds subject, recipient domain, attachment, Auto CC/BCC, and confirmation checkbox checks.
- Uses Chrome Manifest V3 with minimal permissions.
- Stores settings in `chrome.storage.local`.
- Keeps email content, recipients, attachment names, and attachment sizes out of storage and external transmission.
- Includes automated checks for Gmail DOM helpers, checklist logic, security posture, and static linting.
- Adds Japanese/English UI switching for the options page and pre-send modal using packaged local dictionaries.
- Stores language preference in `chrome.storage.local` and does not use external translation services or remote localization files.
- Improves reply Auto CC/BCC handling by attempting to expand collapsed recipient areas, opening Cc/Bcc, verifying the resulting Gmail recipient DOM, and falling back to a warning instead of a permanent pending block.
- Adds Auto CC with the same multi-address, duplicate-skip, modal confirmation, and warning fallback behavior as Auto BCC.
- Moves Auto CC/BCC injection to compose/reply detection so collapsed recipient fields are physically expanded before the self-check modal is opened.
- Hardens reply Auto CC/BCC injection by detecting recipient compose roots before the send button is available, preferring Gmail's visible "add Cc/Bcc recipient" controls, and using recipient-summary clicks only as a fallback.
- Routes modal Ctrl+Enter/Cmd+Enter confirmation through the same send-confirmation path as the final button and handles Ctrl+NumpadEnter.
- Supports multiple configured Auto CC/BCC addresses through `autoCcAddresses` and `autoBccAddresses` while keeping legacy `autoCcAddress` and `autoBccAddress` read compatibility.
