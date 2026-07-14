const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
  EXTENSION_FILES,
  compareExtensionTrees,
  getReleasePaths,
  parseCliArgs,
  readZipRecords,
  sha256File,
  validateExtensionWhitelist
} = require('./release_common');

const EXTENSION_PAGE_CSP = "script-src 'self'; object-src 'none'";

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function validateManifest(sourceDir) {
  const errors = [];
  const manifest = JSON.parse(readText(path.join(sourceDir, 'manifest.json')));
  if (manifest.manifest_version !== 3) errors.push('manifest_version must be 3.');
  if (manifest.default_locale !== 'en') errors.push('manifest.default_locale must be en.');
  if (JSON.stringify(manifest.permissions || []) !== JSON.stringify(['storage'])) {
    errors.push('manifest.permissions must be exactly ["storage"].');
  }
  if (Object.prototype.hasOwnProperty.call(manifest, 'host_permissions')) {
    errors.push('manifest.host_permissions must be absent; static content_scripts.matches is the only Gmail site scope.');
  }
  if (manifest.content_security_policy?.extension_pages !== EXTENSION_PAGE_CSP) {
    errors.push('manifest.content_security_policy.extension_pages is not the required MV3 CSP.');
  }
  for (const key of ['background', 'externally_connectable', 'web_accessible_resources', 'optional_permissions']) {
    if (Object.prototype.hasOwnProperty.call(manifest, key)) errors.push(`manifest must not declare ${key}.`);
  }
  if (manifest.options_page !== 'options.html') errors.push('manifest.options_page must be options.html.');
  const scripts = manifest.content_scripts;
  if (!Array.isArray(scripts) || scripts.length !== 1) {
    errors.push('manifest must declare exactly one static content script entry.');
    return errors;
  }
  const contentScript = scripts[0];
  const expectedScripts = ['i18n.js', 'checks.js', 'gmail_dom.js', 'content.js'];
  if (JSON.stringify(contentScript.matches || []) !== JSON.stringify(['https://mail.google.com/*'])) {
    errors.push('content_scripts.matches must be limited to https://mail.google.com/*.');
  }
  if (JSON.stringify(contentScript.js || []) !== JSON.stringify(expectedScripts)) {
    errors.push('content_scripts.js load order is invalid.');
  }
  if (JSON.stringify(contentScript.css || []) !== JSON.stringify(['styles.css'])) {
    errors.push('content_scripts.css must contain only styles.css.');
  }

  const referencedFiles = [
    manifest.options_page,
    ...(contentScript.js || []),
    ...(contentScript.css || []),
    ...Object.values(manifest.icons || {})
  ];
  for (const relativePath of referencedFiles) {
    if (!relativePath || !fs.existsSync(path.join(sourceDir, relativePath))) {
      errors.push(`Manifest reference is missing: ${relativePath}`);
    }
  }
  for (const locale of ['en', 'ja']) {
    if (!fs.existsSync(path.join(sourceDir, '_locales', locale, 'messages.json'))) {
      errors.push(`Missing locale file: _locales/${locale}/messages.json`);
    }
  }
  return errors;
}

function validateI18n(sourceDir) {
  const errors = [];
  const code = readText(path.join(sourceDir, 'i18n.js'));
  const context = {
    chrome: { i18n: { getUILanguage: () => 'en-US' } }
  };
  context.globalThis = context;
  try {
    vm.runInNewContext(code, context, { filename: 'i18n.js' });
    const messages = context.GmailSendGuardI18n?.messages;
    const jaKeys = Object.keys(messages?.ja || {}).sort();
    const enKeys = Object.keys(messages?.en || {}).sort();
    if (jaKeys.length === 0 || enKeys.length === 0 || JSON.stringify(jaKeys) !== JSON.stringify(enKeys)) {
      errors.push('Japanese and English i18n key sets must match exactly.');
    }
    const html = readText(path.join(sourceDir, 'options.html'));
    const keys = Array.from(html.matchAll(/data-i18n="([A-Za-z0-9_]+)"/g), (match) => match[1]);
    for (const key of keys) {
      if (!jaKeys.includes(key) || !enKeys.includes(key)) errors.push(`options.html references an unknown i18n key: ${key}`);
    }
  } catch (error) {
    errors.push(`Could not evaluate local i18n dictionaries: ${error.message}`);
  }
  return errors;
}

function validateExtensionSecurity(sourceDir) {
  const errors = [];
  const forbiddenPatterns = [
    ['external network API', /fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/],
    ['dynamic code API', /eval\s*\(|new\s+Function\s*\(|setTimeout\s*\(\s*["']|setInterval\s*\(\s*["']|importScripts\s*\(\s*["']https?:/],
    ['unsafe HTML API', /innerHTML|outerHTML|insertAdjacentHTML|document\.write/],
    ['console logging', /console\./],
    ['Chrome sync storage', /chrome\.storage\.sync/]
  ];

  for (const relativePath of EXTENSION_FILES) {
    const fullPath = path.join(sourceDir, relativePath);
    if (!/\.(js|html|css|json)$/i.test(relativePath)) continue;
    const text = readText(fullPath);
    if (relativePath !== 'manifest.json' && /https?:\/\//i.test(text)) {
      errors.push(`Remote URL found in extension file: ${relativePath}`);
    }
    for (const [label, pattern] of forbiddenPatterns) {
      if (pattern.test(text)) errors.push(`${label} found in ${relativePath}`);
    }
  }

  const optionsHtml = readText(path.join(sourceDir, 'options.html'));
  if (/<style\b/i.test(optionsHtml) || /\sstyle\s*=/i.test(optionsHtml)) {
    errors.push('options.html must not contain inline CSS.');
  }
  if (/\son[a-z]+\s*=/i.test(optionsHtml)) errors.push('options.html must not contain inline event handlers.');
  if (/<script\b(?![^>]+\bsrc=)[^>]*>/i.test(optionsHtml)) errors.push('options.html must not contain inline scripts.');
  if (!/<link\b[^>]+href="options\.css"/i.test(optionsHtml)) errors.push('options.html must load local options.css.');

  const content = readText(path.join(sourceDir, 'content.js'));
  const hookIndex = content.indexOf('window.GmailSendGuardTestHooks');
  if (hookIndex < 0) {
    errors.push('GmailSendGuardTestHooks is missing.');
  } else {
    const hookTail = content.slice(hookIndex);
    for (const sensitiveName of ['createModalSnapshot', 'readRecipients', 'readAttachments', 'readCurrentComposeBody', 'composeState', 'settings']) {
      if (hookTail.includes(sensitiveName)) errors.push(`Test hook exposes or references sensitive state: ${sensitiveName}`);
    }
  }
  return errors;
}

function validateZip(zipPath, checksumPath = `${zipPath}.sha256`) {
  const errors = [];
  if (!zipPath || !fs.existsSync(zipPath)) return [`Release ZIP is missing: ${zipPath}`];
  let archive;
  try {
    archive = readZipRecords(zipPath);
  } catch (error) {
    return [`Could not inspect release ZIP: ${error.message}`];
  }
  const rawNames = archive.entries.map((entry) => entry.name);
  const entries = rawNames.slice().sort();
  const expected = EXTENSION_FILES.slice().sort();
  const directoryEntries = rawNames.filter((entry) => entry.endsWith('/'));
  if (directoryEntries.length > 0) errors.push(`Release ZIP contains directory entries: ${directoryEntries.join(', ')}`);
  if (new Set(rawNames).size !== rawNames.length) errors.push('Release ZIP contains duplicate entries.');
  if (rawNames.some((entry) => entry.startsWith('/') || /^[A-Za-z]:/.test(entry))) errors.push('Release ZIP contains an absolute path.');
  if (rawNames.some((entry) => entry.split('/').includes('..'))) errors.push('Release ZIP contains a path traversal entry.');
  if (rawNames.some((entry) => entry.includes('\\'))) errors.push('Release ZIP contains a backslash path.');
  if (archive.diskNumber !== 0 || archive.centralDisk !== 0 || archive.diskEntryCount !== archive.entries.length) {
    errors.push('Release ZIP must be a single-disk archive.');
  }
  if (archive.archiveCommentLength !== 0) errors.push('Release ZIP archive comment must be empty.');
  for (const entry of archive.entries) {
    if (entry.extraLength !== 0) errors.push(`Release ZIP entry has an extra field: ${entry.name}`);
    if (entry.commentLength !== 0) errors.push(`Release ZIP entry has a comment: ${entry.name}`);
  }
  if (rawNames.length !== expected.length) errors.push(`Release ZIP entry count must be exactly ${expected.length}; found ${rawNames.length}.`);
  if (!entries.includes('manifest.json')) errors.push('Release ZIP does not contain manifest.json at its root.');
  if (JSON.stringify(entries) !== JSON.stringify(expected)) {
    errors.push(`Release ZIP contents do not match the extension whitelist: ${entries.join(', ')}`);
  }
  if (!fs.existsSync(checksumPath)) {
    errors.push(`Release checksum is missing: ${checksumPath}`);
  } else {
    const checksum = readText(checksumPath).trim().match(/^([0-9a-f]{64})  ([^\r\n]+)$/);
    if (!checksum) {
      errors.push('Release checksum format is invalid.');
    } else {
      if (checksum[2] !== path.basename(zipPath)) errors.push('Release checksum filename does not match the ZIP filename.');
      if (checksum[1] !== sha256File(zipPath)) errors.push('Release checksum does not match the ZIP SHA-256.');
    }
  }
  return errors;
}

function validatePublicRepo(publicRoot) {
  const errors = [];
  if (!fs.existsSync(publicRoot)) return ['public_repo directory is missing.'];
  const forbiddenDirectories = new Set(['skills', 'agent', '.agents', '.codex', 'preview', 'node_modules', 'coverage', 'release']);
  const forbiddenFiles = new Set([
    'SKILL.md',
    'REPORT.md',
    'FINAL_AUDIT.md',
    'CWS_SUBMISSION_PREP.md',
    'MANUAL_QA_CHECKLIST.md',
    'PUBLIC_EXPORT_PLAN.md',
    'PUBLIC_EXPORT_AUDIT.md'
  ]);
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      const relativePath = path.relative(publicRoot, fullPath);
      if (entry.isDirectory()) {
        if (forbiddenDirectories.has(entry.name)) {
          errors.push(`Forbidden public directory: ${relativePath}`);
          continue;
        }
        visit(fullPath);
      } else if (entry.isFile()) {
        if (forbiddenFiles.has(entry.name)) errors.push(`Forbidden public file: ${relativePath}`);
        if (/\.(md|js|html|json|yml|yaml|txt)$/i.test(entry.name)) {
          const text = readText(fullPath);
          if (/C:\\Users|C:\/Users|file:\/\//i.test(text)) errors.push(`Local path found in public content: ${relativePath}`);
          const emails = text.match(/\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi) || [];
          for (const email of emails) {
            const domain = email.slice(email.lastIndexOf('@') + 1).toLowerCase();
            if (!['example.com', 'example.org', 'example.net', 'invalid'].includes(domain)) {
              errors.push(`Non-reserved email address found in public content: ${relativePath}`);
              break;
            }
          }
        }
      }
    }
  }
  visit(publicRoot);
  return errors;
}

function validateRelease(rootDir, sourceDir, zipPath, compareTargets) {
  const errors = [];
  const whitelist = validateExtensionWhitelist(sourceDir);
  errors.push(...whitelist.errors);
  errors.push(...validateManifest(sourceDir));
  errors.push(...validateI18n(sourceDir));
  errors.push(...validateExtensionSecurity(sourceDir));
  if (zipPath) errors.push(...validateZip(zipPath));
  for (const target of compareTargets) {
    errors.push(...compareExtensionTrees(sourceDir, target).map((error) => `${path.relative(rootDir, target)}: ${error}`));
  }
  if (path.basename(path.resolve(rootDir)) !== 'public_repo') {
    errors.push(...validatePublicRepo(path.join(rootDir, 'public_repo')));
  }
  return errors;
}

function main() {
  const rootDir = path.resolve(__dirname, '..');
  const args = parseCliArgs(process.argv.slice(2));
  const sourceDir = path.resolve(rootDir, args.source || 'extension');
  const manifest = JSON.parse(readText(path.join(sourceDir, 'manifest.json')));
  const defaultPaths = getReleasePaths(rootDir, manifest.version);
  const zipPath = args.zip ? path.resolve(rootDir, args.zip) : defaultPaths.zipPath;
  const targets = args.compare
    ? String(args.compare).split(',').filter(Boolean).map((value) => path.resolve(rootDir, value))
    : path.basename(rootDir) === 'public_repo'
      ? []
      : [path.join(rootDir, 'public_repo', 'extension'), path.join(rootDir, 'extension_package', 'extension')];
  const errors = validateRelease(rootDir, sourceDir, zipPath, targets);
  if (errors.length > 0) {
    for (const error of errors) console.error(`ERROR release validation: ${error}`);
    process.exit(1);
  }
  console.log(`PASS release validation: ${path.relative(rootDir, sourceDir)} (${EXTENSION_FILES.length} whitelisted files)`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`ERROR release validation: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  validateExtensionSecurity,
  validateI18n,
  validateManifest,
  validatePublicRepo,
  validateRelease,
  validateZip
};
