const assert = require('assert');
const checks = require('../extension/checks.js');

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

test('normalizeEmail extracts address from display format', () => {
  assert.strictEqual(checks.normalizeEmail('山田 <YAMADA@Example.COM>'), 'yamada@example.com');
});

test('normalizeEmailList extracts multiple addresses and deduplicates', () => {
  assert.deepStrictEqual(
    checks.normalizeEmailList('A@example.com, b@example.com\nA@example.com'),
    ['a@example.com', 'b@example.com']
  );
});

test('domainOf extracts domain', () => {
  assert.strictEqual(checks.domainOf('user@example.com'), 'example.com');
});

test('groupEmailsByDomain groups and deduplicates', () => {
  assert.deepStrictEqual(checks.groupEmailsByDomain([
    'a@example.com',
    'b@example.com',
    'a@example.com',
    'x@example.org'
  ]), {
    'example.com': ['a@example.com', 'b@example.com'],
    'example.org': ['x@example.org']
  });
});

test('default keyword is 添付', () => {
  assert.deepStrictEqual(checks.normalizeKeywords([]), ['添付']);
});

test('attachment keyword hits subject and body', () => {
  assert.deepStrictEqual(checks.findAttachmentKeywords('資料を添付します', '', ['添付']), ['添付']);
});

test('attachment warning when keyword exists and no attachment', () => {
  const result = checks.evaluateAttachment('資料を添付します', '', 0, ['添付']);
  assert.strictEqual(result.level, 'warn');
  assert.strictEqual(result.reason, 'attachment_keyword_without_file');
});

test('attachment ok when attachment exists', () => {
  const result = checks.evaluateAttachment('資料を添付します', '', 1, ['添付']);
  assert.strictEqual(result.level, 'ok');
  assert.strictEqual(result.reason, 'attachment_present');
});

test('subject empty is error', () => {
  const result = checks.evaluateSubject('', false);
  assert.strictEqual(result.level, 'error');
});

test('subject confirmed is ok', () => {
  const result = checks.evaluateSubject('7月分レポート', true);
  assert.strictEqual(result.level, 'ok');
});

test('evaluateAutoBccState returns muted when disabled', () => {
  const result = checks.evaluateAutoBccState({ autoBccEnabled: false }, {}, {});
  assert.strictEqual(result.status, 'muted');
});

test('evaluateAutoBccState returns warn when target missing', () => {
  const result = checks.evaluateAutoBccState(
    { autoBccEnabled: true, autoBccAddress: 'log@example.com' },
    { recipients: { to: ['other@example.com'] } },
    { autoBccPending: false }
  );
  assert.strictEqual(result.status, 'warn');
  assert.strictEqual(result.reason, 'missing');
});

test('evaluateAutoBccState returns warn when pending', () => {
  const result = checks.evaluateAutoBccState(
    { autoBccEnabled: true, autoBccAddress: 'log@example.com' },
    { recipients: { to: ['other@example.com'] } },
    { autoBccPending: true }
  );
  assert.strictEqual(result.status, 'warn');
  assert.strictEqual(result.reason, 'pending');
});

test('evaluateAutoBccState returns ok when present', () => {
  const result = checks.evaluateAutoBccState(
    { autoBccEnabled: true, autoBccAddress: 'log@example.com' },
    { recipients: { to: ['other@example.com'], bcc: ['log@example.com'] } },
    { autoBccPending: false }
  );
  assert.strictEqual(result.status, 'ok');
  assert.strictEqual(result.reason, 'present');
});

test('evaluateAutoBccState supports multiple configured addresses', () => {
  const result = checks.evaluateAutoBccState(
    { autoBccEnabled: true, autoBccAddresses: ['log1@example.com', 'log2@example.com'] },
    { recipients: { to: ['other@example.com'], cc: [], bcc: ['log1@example.com', 'log2@example.com'] } },
    { autoBccPending: false }
  );
  assert.strictEqual(result.status, 'ok');
  assert.deepStrictEqual(result.targets, ['log1@example.com', 'log2@example.com']);
});

test('evaluateAutoBccState warns when any configured address is missing', () => {
  const result = checks.evaluateAutoBccState(
    { autoBccEnabled: true, autoBccAddresses: ['log1@example.com', 'log2@example.com'] },
    { recipients: { to: ['other@example.com'], cc: [], bcc: ['log1@example.com'] } },
    { autoBccPending: false }
  );
  assert.strictEqual(result.status, 'warn');
  assert.strictEqual(result.reason, 'missing');
  assert.deepStrictEqual(result.missingTargets, ['log2@example.com']);
});

test('shouldInjectBcc handles skip logic', () => {
  const settings = { autoBccEnabled: true, autoBccAddress: 'log@example.com', autoBccSkipIfSelfAlreadyPresent: true };
  
  // Not in recipients -> should inject
  assert.strictEqual(checks.shouldInjectBcc(settings, { recipients: { to: ['other@example.com'] } }), true);
  
  // Already in TO -> skip
  assert.strictEqual(checks.shouldInjectBcc(settings, { recipients: { to: ['log@example.com'] } }), false);
  
  // Already in BCC -> skip
  assert.strictEqual(checks.shouldInjectBcc(settings, { recipients: { bcc: ['log@example.com'] } }), false);
});

test('autoBcc does not duplicate existing BCC', () => {
  const settings = { autoBccEnabled: true, autoBccAddress: 'log@example.com', autoBccSkipIfSelfAlreadyPresent: false };
  const snapshot = { recipients: { to: [], cc: [], bcc: ['LOG@Example.com'] } };
  assert.strictEqual(checks.shouldInjectBcc(settings, snapshot), false);
});

test('autoBcc skips when self already in To/Cc/Bcc and setting enabled', () => {
  const settings = { autoBccEnabled: true, autoBccAddress: 'log@example.com', autoBccSkipIfSelfAlreadyPresent: true };
  assert.strictEqual(checks.shouldInjectBcc(settings, { recipients: { to: ['log@example.com'], cc: [], bcc: [] } }), false);
  assert.strictEqual(checks.shouldInjectBcc(settings, { recipients: { to: [], cc: ['log@example.com'], bcc: [] } }), false);
  assert.strictEqual(checks.shouldInjectBcc(settings, { recipients: { to: [], cc: [], bcc: ['log@example.com'] } }), false);
});

test('evaluateAutoBccState distinguishes an already-present address from an injected BCC', () => {
  const result = checks.evaluateAutoBccState(
    { autoBccEnabled: true, autoBccAddress: 'log@example.com', autoBccSkipIfSelfAlreadyPresent: true },
    { recipients: { to: ['log@example.com'], cc: [], bcc: [] } },
    { autoBccPending: false, autoBccFailed: false }
  );
  assert.strictEqual(result.status, 'ok');
  assert.strictEqual(result.reason, 'already_present');
});

test('evaluateAutoBccState reports a bounded injection failure separately from a missing address', () => {
  const result = checks.evaluateAutoBccState(
    { autoBccEnabled: true, autoBccAddress: 'log@example.com' },
    { recipients: { to: [], cc: [], bcc: [] } },
    { autoBccPending: false, autoBccFailed: true }
  );
  assert.strictEqual(result.status, 'warn');
  assert.strictEqual(result.reason, 'failed');
});

test('getPendingAutoBccTargets returns only missing configured addresses', () => {
  const settings = {
    autoBccEnabled: true,
    autoBccAddresses: ['log1@example.com', 'log2@example.com', 'log3@example.com'],
    autoBccSkipIfSelfAlreadyPresent: true
  };
  const snapshot = {
    recipients: {
      to: ['log2@example.com'],
      cc: [],
      bcc: ['log1@example.com']
    }
  };
  assert.deepStrictEqual(checks.getPendingAutoBccTargets(settings, snapshot), ['log3@example.com']);
});

test('evaluateAutoCcState supports multiple configured addresses', () => {
  const result = checks.evaluateAutoCcState(
    { autoCcEnabled: true, autoCcAddresses: ['log1@example.com', 'log2@example.com'] },
    { recipients: { to: ['other@example.com'], cc: ['log1@example.com', 'log2@example.com'], bcc: [] } },
    { autoCcPending: false }
  );
  assert.strictEqual(result.status, 'ok');
  assert.deepStrictEqual(result.targets, ['log1@example.com', 'log2@example.com']);
});

test('autoCc does not duplicate existing CC', () => {
  const settings = { autoCcEnabled: true, autoCcAddress: 'log@example.com', autoCcSkipIfSelfAlreadyPresent: false };
  const snapshot = { recipients: { to: [], cc: ['LOG@Example.com'], bcc: [] } };
  assert.strictEqual(checks.shouldInjectCc(settings, snapshot), false);
});

test('autoCc skips when self already in To/Cc/Bcc and setting enabled', () => {
  const settings = { autoCcEnabled: true, autoCcAddress: 'log@example.com', autoCcSkipIfSelfAlreadyPresent: true };
  assert.strictEqual(checks.shouldInjectCc(settings, { recipients: { to: ['log@example.com'], cc: [], bcc: [] } }), false);
  assert.strictEqual(checks.shouldInjectCc(settings, { recipients: { to: [], cc: ['log@example.com'], bcc: [] } }), false);
  assert.strictEqual(checks.shouldInjectCc(settings, { recipients: { to: [], cc: [], bcc: ['log@example.com'] } }), false);
});

test('getPendingAutoCcTargets returns only missing configured addresses', () => {
  const settings = {
    autoCcEnabled: true,
    autoCcAddresses: ['log1@example.com', 'log2@example.com', 'log3@example.com'],
    autoCcSkipIfSelfAlreadyPresent: true
  };
  const snapshot = {
    recipients: {
      to: ['log2@example.com'],
      cc: ['log1@example.com'],
      bcc: []
    }
  };
  assert.deepStrictEqual(checks.getPendingAutoCcTargets(settings, snapshot), ['log3@example.com']);
});
