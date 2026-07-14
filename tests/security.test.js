const assert = require('assert');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const extensionDir = path.join(rootDir, 'extension');
const runningInPublicRepo = path.basename(rootDir) === 'public_repo';

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

function readText(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function listFiles(dir, predicate) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFiles(fullPath, predicate));
    } else if (predicate(fullPath)) {
      results.push(fullPath);
    }
  }
  return results;
}

function exists(relativePath) {
  return fs.existsSync(path.join(rootDir, relativePath));
}

function findFilesByName(dir, names) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      results.push(...findFilesByName(fullPath, names));
    } else if (names.has(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

function extensionTexts() {
  return listFiles(extensionDir, (filePath) => /\.(js|html|css|json)$/i.test(filePath))
    .map((filePath) => ({
      filePath,
      text: fs.readFileSync(filePath, 'utf8')
    }));
}

test('manifest has only required permissions', () => {
  const manifest = JSON.parse(readText('extension/manifest.json'));
  assert.strictEqual(manifest.manifest_version, 3);
  assert.strictEqual(manifest.default_locale, 'en');
  assert.deepStrictEqual(manifest.permissions, ['storage']);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(manifest, 'host_permissions'), false);
  assert.deepStrictEqual(manifest.content_security_policy, {
    extension_pages: "script-src 'self'; object-src 'none'"
  });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(manifest, 'background'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(manifest, 'externally_connectable'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(manifest, 'web_accessible_resources'), false);
  assert.strictEqual(manifest.options_page, 'options.html');
  assert.deepStrictEqual(manifest.content_scripts[0].matches, ['https://mail.google.com/*']);
  assert.deepStrictEqual(manifest.content_scripts[0].js, ['i18n.js', 'checks.js', 'gmail_dom.js', 'content.js']);
});

test('manifest-referenced files exist in the extension package', () => {
  const manifest = JSON.parse(readText('extension/manifest.json'));
  const references = [
    manifest.options_page,
    ...manifest.content_scripts.flatMap((entry) => [...(entry.js || []), ...(entry.css || [])]),
    ...Object.values(manifest.icons)
  ];
  for (const reference of references) {
    assert.strictEqual(fs.existsSync(path.join(extensionDir, reference)), true, reference);
  }
});

test('no remote code or CDN references', () => {
  const html = readText('extension/options.html');
  const remoteUrlPattern = /<(script|link)\b[^>]+(?:src|href)=["']https?:\/\//i;
  assert.strictEqual(remoteUrlPattern.test(html), false);
  assert.strictEqual(/<script\b(?![^>]+src=)[^>]*>[\s\S]*?<\/script>/i.test(html), false);

  for (const { filePath, text } of extensionTexts()) {
    if (path.basename(filePath) === 'manifest.json') continue;
    assert.strictEqual(/https?:\/\//i.test(text), false, filePath);
  }
});

test('no dynamic code execution APIs', () => {
  const patterns = [
    new RegExp('e' + 'val\\s*\\('),
    new RegExp('new\\s+' + 'Function\\s*\\('),
    new RegExp('setTimeout\\s*\\(\\s*["\']'),
    new RegExp('setInterval\\s*\\(\\s*["\']'),
    new RegExp('importScripts\\s*\\(\\s*["\']https?:')
  ];

  for (const { filePath, text } of extensionTexts()) {
    for (const pattern of patterns) {
      assert.strictEqual(pattern.test(text), false, filePath);
    }
  }
});

test('no external network APIs are used', () => {
  const patterns = [
    new RegExp('fe' + 'tch\\s*\\('),
    new RegExp('XML' + 'HttpRequest'),
    new RegExp('Web' + 'Socket'),
    new RegExp('send' + 'Beacon'),
    new RegExp('chrome\\.runtime\\.send' + 'Message\\s*\\('),
    new RegExp('googleapis|gmail\\.google')
  ];

  for (const { filePath, text } of extensionTexts()) {
    for (const pattern of patterns) {
      assert.strictEqual(pattern.test(text), false, filePath);
    }
  }
});

test('no Gmail or email content is stored in default settings', () => {
  const content = readText('extension/content.js') + '\n' + readText('extension/options.js');
  for (const forbiddenKey of ['subjectValue', 'bodyText', 'recipientEmails', 'attachmentNames', 'attachmentSizes', 'actualBcc']) {
    assert.strictEqual(content.includes(forbiddenKey), false, forbiddenKey);
  }
  assert.ok(content.includes('customAttachmentKeywords'));
  assert.ok(content.includes('confirmationCheckboxes'));
  assert.ok(content.includes('autoCcAddresses'));
  assert.ok(content.includes('autoBccAddresses'));
});

test('settings use chrome.storage.local only', () => {
  const content = readText('extension/content.js') + '\n' + readText('extension/options.js');
  assert.ok(/chrome\.storage\.local\.get/.test(content));
  assert.ok(/chrome\.storage\.local\.set/.test(content));
  assert.strictEqual(/chrome\.storage\.sync/.test(content), false);
});

test('public docs do not recommend Chrome sync storage', () => {
  const docs = [
    'README.md',
    'PRIVACY.md',
    'SECURITY.md',
    'docs/ENTERPRISE_REVIEW.md',
    'docs/THREAT_MODEL.md',
    'docs/INSTALL_LOCAL.md'
  ].map(readText).join('\n');
  assert.strictEqual(/chrome\.storage\.sync/.test(docs), false);
});

test('manifest declares extension icons', () => {
  const manifest = JSON.parse(readText('extension/manifest.json'));
  assert.deepStrictEqual(manifest.icons, {
    16: 'icons/icon16.png',
    32: 'icons/icon32.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png'
  });
});

test('extension icons are present', () => {
  for (const size of [16, 32, 48, 128]) {
    const iconPath = path.join(extensionDir, 'icons', `icon${size}.png`);
    assert.strictEqual(fs.existsSync(iconPath), true, iconPath);
    assert.ok(fs.statSync(iconPath).size > 0, iconPath);
  }
});

test('dynamic values are rendered without HTML injection sinks', () => {
  for (const { filePath, text } of extensionTexts()) {
    if (!/\.js$/i.test(filePath)) continue;
    assert.strictEqual(text.includes('inner' + 'HTML'), false, filePath);
    assert.strictEqual(/\.\s*outerHTML\s*=/.test(text), false, filePath);
    assert.strictEqual(/insertAdjacentHTML\s*\(/.test(text), false, filePath);
  }
});

test('extension has no production console logging', () => {
  for (const { filePath, text } of extensionTexts()) {
    assert.strictEqual(/console\./.test(text), false, filePath);
  }
});

test('options page keeps CSS and event handlers out of HTML', () => {
  const html = readText('extension/options.html');
  assert.strictEqual(/<style\b/i.test(html), false);
  assert.strictEqual(/\sstyle\s*=/i.test(html), false);
  assert.strictEqual(/\son[a-z]+\s*=/i.test(html), false);
  assert.ok(/<link\b[^>]+href="options\.css"/i.test(html));
  assert.strictEqual(exists('extension/options.css'), true);
});

test('TestHooks only expose operational test controls and aggregate metrics', () => {
  const content = readText('extension/content.js');
  const hookTail = content.slice(content.indexOf('window.GmailSendGuardTestHooks'));
  for (const sensitiveName of ['createModalSnapshot', 'readRecipients', 'readAttachments', 'readCurrentComposeBody', 'composeState', 'settings']) {
    assert.strictEqual(hookTail.includes(sensitiveName), false, sensitiveName);
  }
  for (const method of ['getMetrics', 'resetMetrics', 'scheduleScanForTest', 'scanComposesForTest', 'disconnectObserver']) {
    assert.ok(hookTail.includes(`${method}()`), method);
  }
});

test('extension i18n does not use fetch', () => {
  const text = readText('extension/i18n.js');
  assert.strictEqual(new RegExp('fe' + 'tch\\s*\\(').test(text), false);
});

test('extension i18n does not use innerHTML', () => {
  const text = readText('extension/i18n.js');
  assert.strictEqual(text.includes('inner' + 'HTML'), false);
});

test('extension i18n does not use insertAdjacentHTML', () => {
  const text = readText('extension/i18n.js');
  assert.strictEqual(text.includes('insertAdjacentHTML'), false);
});

test('extension i18n does not use eval/new Function', () => {
  const text = readText('extension/i18n.js');
  assert.strictEqual(new RegExp('e' + 'val\\s*\\(').test(text), false);
  assert.strictEqual(new RegExp('new\\s+' + 'Function\\s*\\(').test(text), false);
});

test('extension has _locales/en/messages.json', () => {
  const messages = JSON.parse(readText('extension/_locales/en/messages.json'));
  assert.strictEqual(messages.extensionName.message, 'Send Guard for Gmail');
  assert.ok(messages.extensionDescription.message.includes('privacy-first'));
});

test('extension has _locales/ja/messages.json', () => {
  const messages = JSON.parse(readText('extension/_locales/ja/messages.json'));
  assert.strictEqual(messages.extensionName.message, 'Send Guard for Gmail');
  assert.ok(messages.extensionDescription.message.includes('Gmail Web版'));
});

test('manifest declares default_locale', () => {
  const manifest = JSON.parse(readText('extension/manifest.json'));
  assert.strictEqual(manifest.default_locale, 'en');
  assert.strictEqual(manifest.name, '__MSG_extensionName__');
  assert.strictEqual(manifest.description, '__MSG_extensionDescription__');
});

test('language setting uses chrome.storage.local only', () => {
  const content = readText('extension/content.js') + '\n' + readText('extension/options.js');
  assert.ok(content.includes('language'));
  assert.ok(/chrome\.storage\.local\.get/.test(content));
  assert.ok(/chrome\.storage\.local\.set/.test(content));
  assert.strictEqual(/chrome\.storage\.sync/.test(content), false);
});

test('extension package includes i18n.js and _locales', () => {
  const manifest = JSON.parse(readText('extension/manifest.json'));
  assert.ok(manifest.content_scripts[0].js.includes('i18n.js'));
  assert.strictEqual(exists('extension/i18n.js'), true);
  assert.strictEqual(exists('extension/_locales/en/messages.json'), true);
  assert.strictEqual(exists('extension/_locales/ja/messages.json'), true);
});

test('public repo does not include internal skill files', () => {
  if (!runningInPublicRepo) return;
  assert.strictEqual(exists('skills'), false);
  const skillFiles = findFilesByName(rootDir, new Set(['SKILL.md']));
  assert.deepStrictEqual(skillFiles, []);
});

test('public repo does not include agent/codex/private workspace directories', () => {
  if (!runningInPublicRepo) return;
  for (const relativePath of ['agent', '.agents', '.codex', 'preview']) {
    assert.strictEqual(exists(relativePath), false, relativePath);
  }
});

test('public repo does not include export audit work notes', () => {
  if (!runningInPublicRepo) return;
  const privateNoteFiles = findFilesByName(rootDir, new Set([
    'REPORT.md',
    'PUBLIC_EXPORT_PLAN.md',
    'PUBLIC_EXPORT_AUDIT.md'
  ]));
  assert.deepStrictEqual(privateNoteFiles, []);
});
