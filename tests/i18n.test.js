const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const rootDir = path.resolve(__dirname, '..');
const i18nCode = fs.readFileSync(path.join(rootDir, 'extension/i18n.js'), 'utf8');
const checksCode = fs.readFileSync(path.join(rootDir, 'extension/checks.js'), 'utf8');
const optionsCode = fs.readFileSync(path.join(rootDir, 'extension/options.js'), 'utf8');
const optionsHtml = fs.readFileSync(path.join(rootDir, 'extension/options.html'), 'utf8');
const optionsCss = fs.readFileSync(path.join(rootDir, 'extension/options.css'), 'utf8');

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

function loadI18n(uiLanguage) {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', { runScripts: 'dangerously' });
  const win = dom.window;
  win.chrome = {
    i18n: {
      getUILanguage: () => uiLanguage
    }
  };
  const script = win.document.createElement('script');
  script.textContent = i18nCode;
  win.document.head.appendChild(script);
  return { win, i18n: win.GmailSendGuardI18n };
}

function appendScript(win, code) {
  const script = win.document.createElement('script');
  script.textContent = code;
  win.document.head.appendChild(script);
}

function setupOptionsPage(storedSettings) {
  const dom = new JSDOM(optionsHtml, {
    runScripts: 'dangerously',
    url: 'chrome-extension://example/options.html'
  });
  const win = dom.window;
  const storageState = { ...(storedSettings || {}) };
  const setCalls = [];
  const alerts = [];

  win.matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {}
  });
  win.alert = (message) => alerts.push(message);
  win.confirm = () => true;
  win.chrome = {
    i18n: {
      getUILanguage: () => 'en-US'
    },
    storage: {
      local: {
        get: (keys, callback) => callback({ ...storageState }),
        set: (values, callback) => {
          setCalls.push({ ...values });
          Object.assign(storageState, values || {});
          if (callback) callback();
        }
      }
    }
  };
  win.setTimeout = (callback) => {
    callback();
    return 1;
  };

  appendScript(win, i18nCode);
  appendScript(win, checksCode);
  appendScript(win, optionsCode);
  win.document.dispatchEvent(new win.Event('DOMContentLoaded', { bubbles: true }));

  return { win, storageState, setCalls, alerts };
}

test('normalizeLanguage accepts auto/ja/en', () => {
  const { i18n } = loadI18n('en-US');
  assert.strictEqual(i18n.normalizeLanguage('auto'), 'auto');
  assert.strictEqual(i18n.normalizeLanguage('ja'), 'ja');
  assert.strictEqual(i18n.normalizeLanguage('en'), 'en');
});

test('normalizeLanguage rejects invalid value to auto', () => {
  const { i18n } = loadI18n('en-US');
  assert.strictEqual(i18n.normalizeLanguage('fr'), 'auto');
  assert.strictEqual(i18n.normalizeLanguage(''), 'auto');
});

test('resolveLanguage auto maps ja-JP to ja', () => {
  const { i18n } = loadI18n('ja-JP');
  assert.strictEqual(i18n.resolveLanguage('auto'), 'ja');
});

test('resolveLanguage auto maps en-US to en', () => {
  const { i18n } = loadI18n('en-US');
  assert.strictEqual(i18n.resolveLanguage('auto'), 'en');
});

test('t returns Japanese message', () => {
  const { i18n } = loadI18n('en-US');
  assert.strictEqual(i18n.t('sendButton', 'ja'), '送信する');
});

test('t returns English message', () => {
  const { i18n } = loadI18n('en-US');
  assert.strictEqual(i18n.t('sendButton', 'en'), 'Send');
});

test('t falls back to English', () => {
  const { i18n } = loadI18n('en-US');
  delete i18n.messages.ja.saveButton;
  assert.strictEqual(i18n.t('saveButton', 'ja'), 'Save settings');
});

test('t performs safe placeholder substitution', () => {
  const { i18n } = loadI18n('en-US');
  const value = i18n.t('attachmentKeywordWarning', 'en', {
    keyword: '<img src=x>'
  });
  assert.strictEqual(value.includes('<img src=x>'), true);
  assert.strictEqual(value.includes('but no attachment was found'), true);
});

test('missing key returns key', () => {
  const { i18n } = loadI18n('en-US');
  assert.strictEqual(i18n.t('missingKeyForTest', 'en'), 'missingKeyForTest');
});

test('Japanese and English UI dictionaries have identical keys', () => {
  const { i18n } = loadI18n('en-US');
  assert.deepStrictEqual(
    Array.from(Object.keys(i18n.messages.ja)).sort(),
    Array.from(Object.keys(i18n.messages.en)).sort()
  );
});

test('options page renders Japanese labels when language=ja', () => {
  const { win } = setupOptionsPage({ language: 'ja' });
  assert.strictEqual(win.document.getElementById('languageSelect').value, 'ja');
  assert.ok(win.document.body.textContent.includes('件名チェック設定'));
  assert.ok(win.document.body.textContent.includes('設定を保存'));
});

test('options page renders English labels when language=en', () => {
  const { win } = setupOptionsPage({ language: 'en' });
  assert.strictEqual(win.document.getElementById('languageSelect').value, 'en');
  assert.ok(win.document.body.textContent.includes('Subject Check'));
  assert.ok(win.document.body.textContent.includes('Save settings'));
});

test('changing language select updates labels immediately', () => {
  const { win } = setupOptionsPage({ language: 'ja' });
  const select = win.document.getElementById('languageSelect');
  select.value = 'en';
  select.dispatchEvent(new win.Event('change', { bubbles: true }));
  assert.ok(win.document.body.textContent.includes('Subject Check'));
  assert.ok(!win.document.body.textContent.includes('件名チェック設定'));
});

test('language setting is saved to chrome.storage.local', () => {
  const { win, storageState, setCalls } = setupOptionsPage({ language: 'ja' });
  const select = win.document.getElementById('languageSelect');
  select.value = 'en';
  select.dispatchEvent(new win.Event('change', { bubbles: true }));
  assert.strictEqual(storageState.language, 'en');
  assert.deepStrictEqual(setCalls.at(-1), { language: 'en' });
});

function commitAutoRecipientAddresses(win, field, value, key = 'Enter') {
  const input = win.document.getElementById(`${field}Address`);
  input.value = value;
  input.dispatchEvent(new win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

test('Auto CC creates de-duplicated chips from newline/comma/space-separated addresses', () => {
  const { win, storageState } = setupOptionsPage({ language: 'en' });
  commitAutoRecipientAddresses(win, 'autoCc', 'CC1@example.com\ncc2@example.com, cc3@example.com cc1@example.com');
  assert.deepStrictEqual(Array.from(storageState.autoCcAddresses), ['cc1@example.com', 'cc2@example.com', 'cc3@example.com']);
  assert.strictEqual(storageState.autoCcAddress, 'cc1@example.com');
  assert.strictEqual(win.document.getElementById('autoCcAddress').value, '');
  assert.strictEqual(win.document.querySelectorAll('#autoCcAddressList button').length, 3);
});

test('Auto BCC uses the same de-duplicated chip flow as Auto CC', () => {
  const { win, storageState } = setupOptionsPage({ language: 'en' });
  commitAutoRecipientAddresses(win, 'autoBcc', 'LOG1@example.com\nlog2@example.com, log3@example.com log1@example.com');
  assert.deepStrictEqual(Array.from(storageState.autoBccAddresses), ['log1@example.com', 'log2@example.com', 'log3@example.com']);
  assert.strictEqual(storageState.autoBccAddress, 'log1@example.com');
  assert.strictEqual(win.document.getElementById('autoBccAddress').value, '');
  assert.strictEqual(win.document.querySelectorAll('#autoBccAddressList button').length, 3);
});

test('comma and space keys create address chips', () => {
  const { win, storageState } = setupOptionsPage({ language: 'en' });
  commitAutoRecipientAddresses(win, 'autoCc', 'comma@example.com', ',');
  commitAutoRecipientAddresses(win, 'autoCc', 'space@example.com', ' ');
  assert.deepStrictEqual(Array.from(storageState.autoCcAddresses), ['comma@example.com', 'space@example.com']);
  assert.strictEqual(win.document.querySelectorAll('#autoCcAddressList li').length, 2);
});

test('pasting multiple addresses creates chips and skips duplicates', () => {
  const { win, storageState } = setupOptionsPage({ language: 'en' });
  commitAutoRecipientAddresses(win, 'autoBcc', 'existing@example.com');
  const input = win.document.getElementById('autoBccAddress');
  const paste = new win.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(paste, 'clipboardData', {
    value: { getData: () => 'existing@example.com, first@example.com\nsecond@example.com first@example.com' }
  });
  input.dispatchEvent(paste);
  assert.deepStrictEqual(Array.from(storageState.autoBccAddresses), ['existing@example.com', 'first@example.com', 'second@example.com']);
  assert.strictEqual(input.value, '');
});

test('legacy single Auto BCC address renders in configured list', () => {
  const { win } = setupOptionsPage({ language: 'en', autoBccAddress: 'LEGACY@example.com' });
  assert.strictEqual(win.document.getElementById('autoBccAddress').value, '');
  assert.strictEqual(win.document.querySelector('#autoBccAddressList .value').textContent, 'legacy@example.com');
});

test('legacy single Auto CC address renders in the configured list', () => {
  const { win } = setupOptionsPage({ language: 'en', autoCcAddress: 'LEGACY-CC@example.com' });
  assert.strictEqual(win.document.getElementById('autoCcAddress').value, '');
  assert.strictEqual(win.document.querySelector('#autoCcAddressList .value').textContent, 'legacy-cc@example.com');
});

test('invalid stored language falls back to auto', () => {
  const { win } = setupOptionsPage({ language: 'fr' });
  assert.strictEqual(win.document.getElementById('languageSelect').value, 'auto');
});

test('Auto BCC address list removes one address without changing the other addresses', () => {
  const { win, storageState } = setupOptionsPage({ language: 'en' });
  const input = win.document.getElementById('autoBccAddress');
  commitAutoRecipientAddresses(win, 'autoBcc', 'first@example.com');
  commitAutoRecipientAddresses(win, 'autoBcc', 'second@example.com');
  const removeButtons = win.document.querySelectorAll('#autoBccAddressList button');
  assert.strictEqual(removeButtons.length, 2);
  assert.ok(removeButtons[1].getAttribute('aria-label').includes('second@example.com'));
  removeButtons[1].click();
  assert.strictEqual(input.value, '');
  assert.strictEqual(win.document.querySelectorAll('#autoBccAddressList button').length, 1);
  assert.deepStrictEqual(Array.from(storageState.autoBccAddresses), ['first@example.com']);
});

test('Auto CC address list removes one address without changing the other addresses', () => {
  const { win, storageState } = setupOptionsPage({ language: 'en' });
  commitAutoRecipientAddresses(win, 'autoCc', 'first@example.com, second@example.com');
  const removeButtons = win.document.querySelectorAll('#autoCcAddressList button');
  assert.strictEqual(removeButtons.length, 2);
  assert.ok(removeButtons[1].getAttribute('aria-label').includes('second@example.com'));
  removeButtons[1].click();
  assert.strictEqual(win.document.querySelectorAll('#autoCcAddressList button').length, 1);
  assert.deepStrictEqual(Array.from(storageState.autoCcAddresses), ['first@example.com']);
});

test('duplicate and invalid Auto BCC addresses are rejected', () => {
  const { win, storageState } = setupOptionsPage({ language: 'en' });
  commitAutoRecipientAddresses(win, 'autoBcc', 'archive@example.com');
  commitAutoRecipientAddresses(win, 'autoBcc', 'archive@example.com');
  assert.ok(win.document.getElementById('optionsValidationError').textContent.includes('already configured'));
  commitAutoRecipientAddresses(win, 'autoBcc', 'not-an-address');
  assert.strictEqual(win.document.getElementById('autoBccAddress').getAttribute('aria-invalid'), 'true');
  assert.deepStrictEqual(Array.from(storageState.autoBccAddresses), ['archive@example.com']);
});

test('delimiter residue is cleared without hiding a duplicate warning', () => {
  const { win, storageState } = setupOptionsPage({ language: 'en' });
  commitAutoRecipientAddresses(win, 'autoBcc', 'archive@example.com');
  commitAutoRecipientAddresses(win, 'autoBcc', 'archive@example.com');
  const input = win.document.getElementById('autoBccAddress');
  input.value = '\n';
  input.dispatchEvent(new win.Event('input', { bubbles: true }));
  assert.strictEqual(input.value, '');
  assert.ok(win.document.getElementById('optionsValidationError').textContent.includes('already configured'));
  assert.deepStrictEqual(Array.from(storageState.autoBccAddresses), ['archive@example.com']);
});

test('language switching keeps configured Auto BCC addresses', () => {
  const { win, storageState } = setupOptionsPage({ language: 'ja' });
  commitAutoRecipientAddresses(win, 'autoBcc', 'archive@example.com');
  const select = win.document.getElementById('languageSelect');
  select.value = 'en';
  select.dispatchEvent(new win.Event('change', { bubbles: true }));
  assert.strictEqual(win.document.querySelector('#autoBccAddressList .value').textContent, 'archive@example.com');
  assert.deepStrictEqual(Array.from(storageState.autoBccAddresses), ['archive@example.com']);
});

test('Auto CC validation is announced and associated with the address input', () => {
  const { win, alerts } = setupOptionsPage({ language: 'en' });
  const input = win.document.getElementById('autoCcAddress');
  win.document.getElementById('autoCcEnabled').checked = true;
  win.document.getElementById('btnSave').click();
  const error = win.document.getElementById('optionsValidationError');
  assert.strictEqual(error.hidden, false);
  assert.strictEqual(error.getAttribute('role'), 'alert');
  assert.ok(error.textContent.includes('valid Auto CC'));
  assert.strictEqual(input.getAttribute('aria-invalid'), 'true');
  assert.ok(input.getAttribute('aria-describedby').includes('optionsValidationError'));
  assert.strictEqual(alerts.length, 0);
});

test('settings controls have explicit labels and grouped controls use fieldsets', () => {
  const { win } = setupOptionsPage({ language: 'en' });
  assert.ok(win.document.querySelectorAll('fieldset.card').length >= 3);
  assert.ok(win.document.getElementById('autoBccEnabled').labels.length > 0);
  assert.ok(win.document.getElementById('autoCcAddress').labels.length > 0);
  assert.ok(win.document.getElementById('autoBccAddress').labels.length > 0);
  assert.strictEqual(win.document.getElementById('themeSelect').getAttribute('aria-label'), 'Theme');
  assert.strictEqual(win.document.getElementById('btnAddAutoCc'), null);
  assert.strictEqual(win.document.getElementById('btnAddAutoBcc'), null);
  assert.strictEqual(win.document.getElementById('toast').getAttribute('aria-live'), 'polite');
});

test('Auto CC and Auto BCC use matching chip editors without Add buttons', () => {
  const { win } = setupOptionsPage({ language: 'en' });
  assert.strictEqual(win.document.querySelector('#autoCcAddress').tagName, 'TEXTAREA');
  assert.strictEqual(win.document.querySelector('#autoBccAddress').tagName, 'TEXTAREA');
  assert.ok(win.document.getElementById('autoCcChipEditor'));
  assert.ok(win.document.getElementById('autoBccChipEditor'));
  assert.ok(win.document.getElementById('autoCcAddressList'));
  assert.ok(win.document.getElementById('autoBccAddressList'));
  assert.strictEqual(win.document.getElementById('btnAddAutoCc'), null);
  assert.strictEqual(win.document.getElementById('btnAddAutoBcc'), null);
});

test('options page contains no inline handlers or inline script', () => {
  assert.strictEqual(/\son[a-z]+\s*=/i.test(optionsHtml), false);
  assert.strictEqual(/<script\b(?![^>]+\bsrc=)[^>]*>/i.test(optionsHtml), false);
});

test('theme cascade resolves readable primary button text', () => {
  const { win } = setupOptionsPage({ language: 'en' });
  const style = win.document.createElement('style');
  style.textContent = optionsCss;
  win.document.head.appendChild(style);
  const button = win.document.getElementById('btnSave');
  win.document.documentElement.setAttribute('data-theme', 'light');
  assert.strictEqual(win.getComputedStyle(button).color, 'rgb(255, 255, 255)');
  win.document.documentElement.setAttribute('data-theme', 'dark');
  assert.strictEqual(win.getComputedStyle(button).color, 'rgb(32, 33, 36)');
  assert.strictEqual(optionsCss.includes(':not([data-theme="dark"])'), false);
});

test('primary button normal and hover colors meet 4.5 to 1 contrast', () => {
  function luminance(hex) {
    const channels = hex.match(/[a-f0-9]{2}/gi).map((value) => parseInt(value, 16) / 255);
    return channels.map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  }
  function contrast(first, second) {
    const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
  }
  assert.ok(contrast('1a73e8', 'ffffff') >= 4.5);
  assert.ok(contrast('1765cc', 'ffffff') >= 4.5);
  assert.ok(contrast('8ab4f8', '202124') >= 4.5);
  assert.ok(contrast('aecbfa', '202124') >= 4.5);
});

test('long values wrap while remove buttons remain non-shrinking', () => {
  const { win } = setupOptionsPage({ language: 'en', autoBccAddresses: ['very-long-department-address-for-mail-archive@example.com'] });
  const style = win.document.createElement('style');
  style.textContent = optionsCss;
  win.document.head.appendChild(style);
  const value = win.document.querySelector('#autoBccAddressList .value');
  const remove = win.document.querySelector('#autoBccAddressList .btn-remove');
  assert.strictEqual(win.getComputedStyle(value).overflowWrap, 'anywhere');
  assert.strictEqual(win.getComputedStyle(remove).flexShrink, '0');
  assert.ok(remove.getAttribute('aria-label').includes('very-long-department-address'));
});

test('responsive, reduced-motion, and fieldset alignment rules exist', () => {
  assert.match(optionsCss, /@media\s*\(max-width:\s*560px\)/);
  assert.match(optionsCss, /\.recipient-chip-input\s*\{[^}]*flex-basis:\s*140px/s);
  assert.match(optionsCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(optionsCss, /fieldset\.card\s*\{[^}]*margin:\s*0 0 20px/s);
  assert.match(optionsCss, /legend\.card-title\s*\{[^}]*float:\s*left[^}]*padding-inline:\s*0/s);
  assert.match(optionsCss, /legend\.card-title\s*\+\s*\*\s*\{[^}]*clear:\s*both/s);
});

test('options page does not use innerHTML for i18n rendering', () => {
  assert.strictEqual(optionsCode.includes('inner' + 'HTML'), false);
  assert.strictEqual(optionsCode.includes('insertAdjacentHTML'), false);
});
