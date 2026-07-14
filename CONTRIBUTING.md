# Contributing

Issues and feature suggestions are welcome.

To keep the initial release focused and maintainable, unsolicited code pull requests are not being accepted at this time.

Please open an issue before proposing implementation work.

## Ground Rules

- Preserve the local-only privacy model.
- Do not add external communication, telemetry, analytics, OAuth, or Gmail API usage.
- Do not add Chrome permissions without a documented security rationale.
- Use synthetic test data such as `client@example.com`.
- Do not commit real email content, screenshots, Gmail DOM dumps, logs, or local paths.

## Development

```bash
npm ci
npm test
npm run lint:basic
npm run release:package
npm run release:validate
```

Chrome 150 + Gmail Web manual verification remains required before production rollout because Gmail DOM changes can affect selectors.
