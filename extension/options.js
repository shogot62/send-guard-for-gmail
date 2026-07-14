(function () {
  'use strict';

  const checks = window.GmailSendGuardChecks;
  const i18n = window.GmailSendGuardI18n;
  const DEFAULT_SETTINGS = {
    settingsVersion: 1,
    language: 'auto',
    theme: 'system',
    subjectCheckEnabled: true,
    domainDisplayEnabled: true,
    attachmentCheckEnabled: true,
    customAttachmentKeywords: [],
    autoCcEnabled: false,
    autoCcAddresses: [],
    autoCcAddress: '',
    autoCcSkipIfSelfAlreadyPresent: true,
    autoBccEnabled: false,
    autoBccAddresses: [],
    autoBccAddress: '',
    autoBccSkipIfSelfAlreadyPresent: true,
    confirmationCheckboxes: {
      subject: true,
      domains: true,
      attachments: true,
      autoCc: false,
      autoBcc: false
    },
    requireAllEnabledConfirmations: false
  };

  const simpleFields = [
    'subjectCheckEnabled',
    'domainDisplayEnabled',
    'attachmentCheckEnabled',
    'autoCcEnabled',
    'autoCcSkipIfSelfAlreadyPresent',
    'autoBccEnabled',
    'autoBccSkipIfSelfAlreadyPresent',
    'requireAllEnabledConfirmations'
  ];

  let customKeywords = [];
  let autoCcAddresses = [];
  let autoBccAddresses = [];
  let currentLanguage = DEFAULT_SETTINGS.language;

  function $(id) {
    return document.getElementById(id);
  }

  function load() {
    loadStoredSettings((settings) => {
      renderSettings(settings);
    });
  }

  function normalizeSettings(input) {
    const stored = input || {};
    const settings = {
      ...DEFAULT_SETTINGS,
      ...stored,
      language: i18n.normalizeLanguage(stored.language),
      customAttachmentKeywords: Array.isArray(stored.customAttachmentKeywords) ? stored.customAttachmentKeywords : [],
      autoCcAddresses: checks.normalizeEmailList(
        Array.isArray(stored.autoCcAddresses) && stored.autoCcAddresses.length > 0
          ? stored.autoCcAddresses
          : stored.autoCcAddress
      ),
      autoBccAddresses: checks.normalizeEmailList(
        Array.isArray(stored.autoBccAddresses) && stored.autoBccAddresses.length > 0
          ? stored.autoBccAddresses
          : stored.autoBccAddress
      )
    };
    settings.autoCcAddress = settings.autoCcAddresses[0] || '';
    settings.autoBccAddress = settings.autoBccAddresses[0] || '';
    if (stored.confirmationCheckboxes) {
      settings.confirmationCheckboxes = { ...DEFAULT_SETTINGS.confirmationCheckboxes, ...stored.confirmationCheckboxes };
    }
    return settings;
  }

  function loadStoredSettings(callback) {
    chrome.storage.local.get(null, (localSettings) => {
      callback(normalizeSettings(localSettings || {}));
    });
  }

  function renderSettings(settings) {
    currentLanguage = i18n.normalizeLanguage(settings.language);
    const languageSelect = $('languageSelect');
    if (languageSelect) languageSelect.value = currentLanguage;
    applyI18n(document, currentLanguage);

    const themeSelect = $('themeSelect');
    if (themeSelect) themeSelect.value = settings.theme || 'system';
    applyTheme(settings.theme || 'system');

    for (const key of simpleFields) {
      const el = $(key);
      if (el) {
        el.checked = Boolean(settings[key]);
        el.dispatchEvent(new Event('change'));
      }
    }

    if ($('chkConfirmSubject')) $('chkConfirmSubject').checked = settings.confirmationCheckboxes.subject;
    if ($('chkConfirmDomains')) $('chkConfirmDomains').checked = settings.confirmationCheckboxes.domains;
    if ($('chkConfirmAttachments')) $('chkConfirmAttachments').checked = settings.confirmationCheckboxes.attachments;
    if ($('chkConfirmAutoCc')) $('chkConfirmAutoCc').checked = settings.confirmationCheckboxes.autoCc;
    if ($('chkConfirmAutoBcc')) $('chkConfirmAutoBcc').checked = settings.confirmationCheckboxes.autoBcc;

    customKeywords = Array.isArray(settings.customAttachmentKeywords) ? settings.customAttachmentKeywords : [];
    renderCustomKeywordList();

    autoCcAddresses = Array.from(settings.autoCcAddresses || []);
    autoBccAddresses = Array.from(settings.autoBccAddresses || []);
    $('autoCcAddress').value = '';
    $('autoBccAddress').value = '';
    renderAutoRecipientAddressList('autoCc');
    renderAutoRecipientAddressList('autoBcc');
  }

  function save() {
    const btn = $('btnSave');
    btn.textContent = i18n.t('savingButton', currentLanguage);
    btn.classList.add('is-saving');
    btn.disabled = true;
    clearValidationError();

    const settings = {};
    settings.settingsVersion = DEFAULT_SETTINGS.settingsVersion;
    settings.language = i18n.normalizeLanguage($('languageSelect')?.value);
    settings.theme = $('themeSelect').value;

    for (const key of simpleFields) {
      settings[key] = $(key).checked;
    }

    settings.confirmationCheckboxes = {
      subject: $('chkConfirmSubject').checked,
      domains: $('chkConfirmDomains').checked,
      attachments: $('chkConfirmAttachments').checked,
      autoCc: $('chkConfirmAutoCc').checked,
      autoBcc: $('chkConfirmAutoBcc').checked
    };

    settings.customAttachmentKeywords = customKeywords.map(k => String(k || '').trim()).filter(Boolean);
    if (!commitAutoRecipientInput('autoCc')) {
      restoreSaveButton(btn);
      return;
    }
    if (settings.autoCcEnabled && autoCcAddresses.length === 0) {
      restoreSaveButton(btn);
      showValidationError('autoCcAddress', 'invalidAutoCcAddress');
      return;
    }
    settings.autoCcAddresses = autoCcAddresses.slice();
    settings.autoCcAddress = autoCcAddresses[0] || '';

    if (!commitAutoRecipientInput('autoBcc')) {
      restoreSaveButton(btn);
      return;
    }
    if (settings.autoBccEnabled && autoBccAddresses.length === 0) {
      restoreSaveButton(btn);
      showValidationError('autoBccAddress', 'invalidAutoBccAddress');
      return;
    }
    settings.autoBccAddresses = autoBccAddresses.slice();
    settings.autoBccAddress = autoBccAddresses[0] || '';

    chrome.storage.local.set(settings, () => {
      $('autoCcAddress').value = '';
      $('autoBccAddress').value = '';
      renderAutoRecipientAddressList('autoCc');
      renderAutoRecipientAddressList('autoBcc');
      setTimeout(() => {
        btn.textContent = i18n.t('saveButton', currentLanguage);
        btn.classList.remove('is-saving');
        btn.disabled = false;
        showStatus();
      }, 400);
      applyTheme(settings.theme);
    });
  }

  function restoreSaveButton(btn) {
    btn.textContent = i18n.t('saveButton', currentLanguage);
    btn.classList.remove('is-saving');
    btn.disabled = false;
  }

  function parseAutoRecipientAddressInput(value) {
    const raw = String(value || '').trim();
    if (!raw) return { emails: [], valid: true };
    const tokens = raw.split(/[,\s;]+/).map((item) => item.trim()).filter(Boolean);
    const validTokens = tokens.filter(isPlainEmailAddress);
    const emails = checks.uniqueEmails(validTokens);
    return {
      emails,
      valid: tokens.length > 0 && tokens.length === validTokens.length && emails.length > 0
    };
  }

  function isPlainEmailAddress(value) {
    const normalized = checks.normalizeEmail(value);
    return normalized === String(value || '').toLowerCase() && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(value);
  }

  function reset() {
    if (confirm(i18n.t('resetConfirm', currentLanguage))) {
      chrome.storage.local.set(DEFAULT_SETTINGS, () => {
        load();
        showStatus();
      });
    }
  }

  function showValidationError(inputId, messageKey) {
    const input = $(inputId);
    const error = $('optionsValidationError');
    if (!input || !error) return;
    error.textContent = i18n.t(messageKey, currentLanguage);
    error.hidden = false;
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  }

  function clearValidationError() {
    const error = $('optionsValidationError');
    if (error) {
      error.textContent = '';
      error.hidden = true;
    }
    for (const inputId of ['autoCcAddress', 'autoBccAddress']) {
      const input = $(inputId);
      if (input) input.setAttribute('aria-invalid', 'false');
    }
  }

  function showStatus() {
    const toast = $('toast');
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  }

  function applyTheme(theme) {
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      // system
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.documentElement.setAttribute('data-theme', 'dark');
      } else {
        document.documentElement.setAttribute('data-theme', 'light');
      }
    }
  }

  function applyI18n(root, language) {
    const normalized = i18n.normalizeLanguage(language);
    document.documentElement.lang = i18n.resolveLanguage(normalized);
    document.title = i18n.t('optionsTitle', normalized);

    root.querySelectorAll('[data-i18n]').forEach((node) => {
      const key = node.getAttribute('data-i18n');
      node.textContent = i18n.t(key, normalized);
    });

    root.querySelectorAll('[data-i18n-title]').forEach((node) => {
      const key = node.getAttribute('data-i18n-title');
      node.setAttribute('title', i18n.t(key, normalized));
    });

    root.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
      const key = node.getAttribute('data-i18n-placeholder');
      node.setAttribute('placeholder', i18n.t(key, normalized));
    });

    root.querySelectorAll('[data-i18n-aria-label]').forEach((node) => {
      const key = node.getAttribute('data-i18n-aria-label');
      node.setAttribute('aria-label', i18n.t(key, normalized));
    });
  }

  function saveLanguagePreference(language) {
    currentLanguage = i18n.normalizeLanguage(language);
    const languageSelect = $('languageSelect');
    if (languageSelect) languageSelect.value = currentLanguage;
    applyI18n(document, currentLanguage);
    renderCustomKeywordList();
    renderAutoRecipientAddressList('autoCc');
    renderAutoRecipientAddressList('autoBcc');
    chrome.storage.local.set({ language: currentLanguage });
  }

  // --- UI Event Handlers ---

  function toggleSubSettings(switchId, subGroupId) {
    const isChecked = $(switchId).checked;
    const subGroup = $(subGroupId);
    if (!subGroup) return;

    if (isChecked) {
      subGroup.classList.remove('hidden');
    } else {
      subGroup.classList.add('hidden');
    }
  }

  function renderCustomKeywordList() {
    const list = $('customKeywordList');
    list.replaceChildren();

    if (customKeywords.length === 0) {
      const emptyLi = document.createElement('li');
      emptyLi.className = 'list-empty';
      emptyLi.textContent = i18n.t('noCustomKeywords', currentLanguage);
      list.appendChild(emptyLi);
    } else {
      customKeywords.forEach((keyword, index) => {
        const li = document.createElement('li');
        const span = document.createElement('span');
        span.className = 'value';
        span.textContent = keyword;
        
        const btn = document.createElement('button');
        btn.className = 'btn-remove';
        const accessibleName = i18n.t('removeKeywordNamed', currentLanguage, { keyword });
        btn.title = accessibleName;
        btn.setAttribute('aria-label', accessibleName);
        btn.type = 'button';
        btn.textContent = i18n.t('removeKeyword', currentLanguage);
        btn.addEventListener('click', () => {
          customKeywords.splice(index, 1);
          renderCustomKeywordList();
        });

        li.appendChild(span);
        li.appendChild(btn);
        list.appendChild(li);
      });
    }
  }

  function addCustomKeyword() {
    const input = $('customKeywordInput');
    const keyword = String(input.value || '').trim();
    if (!keyword) {
      input.focus();
      return;
    }
    if (keyword === '添付') {
      alert(i18n.t('duplicateBuiltInKeyword', currentLanguage));
      input.value = '';
      return;
    }
    if (!customKeywords.includes(keyword)) {
      customKeywords.push(keyword);
      renderCustomKeywordList();
    }
    input.value = '';
    input.focus();
  }

  function renderAutoRecipientAddressList(field) {
    const input = $(`${field}Address`);
    const list = $(`${field}AddressList`);
    if (!input || !list) return;

    const addresses = getAutoRecipientAddresses(field);
    const emptyKey = field === 'autoCc' ? 'noAutoCcAddresses' : 'noAutoBccAddresses';
    const removeKey = field === 'autoCc' ? 'removeAutoCcAddress' : 'removeAutoBccAddress';
    const listLabelKey = field === 'autoCc' ? 'configuredAutoCcLabel' : 'configuredAutoBccLabel';
    list.replaceChildren();

    list.setAttribute('aria-label', i18n.t(addresses.length === 0 ? emptyKey : listLabelKey, currentLanguage));
    if (addresses.length === 0) return;

    for (const email of addresses) {
      const li = document.createElement('li');
      const address = document.createElement('span');
      address.className = 'value';
      address.textContent = email;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn-remove';
      remove.textContent = '×';
      const accessibleName = i18n.t(removeKey, currentLanguage, { email });
      remove.title = accessibleName;
      remove.setAttribute('aria-label', accessibleName);
      remove.addEventListener('click', () => removeAutoRecipientAddress(field, email));
      li.appendChild(address);
      li.appendChild(remove);
      list.appendChild(li);
    }
  }

  function removeAutoRecipientAddress(field, email) {
    const input = $(`${field}Address`);
    if (!input) return;
    setAutoRecipientAddresses(field, getAutoRecipientAddresses(field).filter((value) => value !== email));
    persistAutoRecipientAddresses(field);
    clearValidationError();
    renderAutoRecipientAddressList(field);
    input.focus();
  }

  function getAutoRecipientAddresses(field) {
    return field === 'autoCc' ? autoCcAddresses : autoBccAddresses;
  }

  function setAutoRecipientAddresses(field, addresses) {
    if (field === 'autoCc') {
      autoCcAddresses = addresses;
    } else {
      autoBccAddresses = addresses;
    }
  }

  function commitAutoRecipientInput(field) {
    const input = $(`${field}Address`);
    const parsed = parseAutoRecipientAddressInput(input.value);
    if (!String(input.value || '').trim()) return true;
    clearValidationError();
    const invalidKey = field === 'autoCc' ? 'invalidAutoCcAddress' : 'invalidAutoBccAddress';
    const duplicateKey = field === 'autoCc' ? 'duplicateAutoCcAddress' : 'duplicateAutoBccAddress';
    if (!parsed.valid) {
      showValidationError(`${field}Address`, invalidKey);
      return false;
    }
    const addresses = getAutoRecipientAddresses(field);
    const newAddresses = parsed.emails.filter((email) => !addresses.includes(email));
    input.value = '';
    if (newAddresses.length === 0) {
      showValidationError(`${field}Address`, duplicateKey);
      return false;
    }
    setAutoRecipientAddresses(field, [...addresses, ...newAddresses]);
    renderAutoRecipientAddressList(field);
    persistAutoRecipientAddresses(field);
    input.focus();
    return true;
  }

  function persistAutoRecipientAddresses(field) {
    const addresses = getAutoRecipientAddresses(field);
    chrome.storage.local.set({
      [`${field}Addresses`]: addresses.slice(),
      [`${field}Address`]: addresses[0] || ''
    }, showStatus);
  }

  // --- Initialization ---

  document.addEventListener('DOMContentLoaded', () => {
    load();
    
    // Bind toggle events
    $('subjectCheckEnabled').addEventListener('change', () => toggleSubSettings('subjectCheckEnabled', 'subject-subs'));
    $('attachmentCheckEnabled').addEventListener('change', () => toggleSubSettings('attachmentCheckEnabled', 'attach-subs'));
    $('autoCcEnabled').addEventListener('change', () => toggleSubSettings('autoCcEnabled', 'cc-subs'));
    $('autoBccEnabled').addEventListener('change', () => toggleSubSettings('autoBccEnabled', 'bcc-subs'));

    // Bind action buttons
    $('btnSave').addEventListener('click', save);
    $('btnReset').addEventListener('click', reset);
    $('btnAddKeyword').addEventListener('click', addCustomKeyword);
    for (const field of ['autoCc', 'autoBcc']) {
      const input = $(`${field}Address`);
      input.addEventListener('input', () => {
        if (input.value && !input.value.trim()) {
          input.value = '';
          return;
        }
        clearValidationError();
      });
      input.addEventListener('keydown', (event) => {
        if (!event.isComposing && ['Enter', ',', ';', ' '].includes(event.key) && input.value.trim()) {
          event.preventDefault();
          commitAutoRecipientInput(field);
        } else if (event.key === 'Backspace' && !input.value && getAutoRecipientAddresses(field).length > 0) {
          const addresses = getAutoRecipientAddresses(field);
          setAutoRecipientAddresses(field, addresses.slice(0, -1));
          persistAutoRecipientAddresses(field);
          renderAutoRecipientAddressList(field);
        } else if (event.key === 'Escape') {
          input.value = '';
          clearValidationError();
        }
      });
      input.addEventListener('paste', (event) => {
        const pasted = event.clipboardData?.getData('text') || '';
        if (!pasted) return;
        event.preventDefault();
        input.value = [input.value, pasted].filter(Boolean).join(' ');
        commitAutoRecipientInput(field);
      });
      $(`${field}ChipEditor`).addEventListener('click', (event) => {
        if (event.target === event.currentTarget) input.focus();
      });
    }
    
    $('customKeywordInput').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addCustomKeyword();
      }
    });
    
    // Listen for OS theme changes if set to system
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
      const themeSelect = $('themeSelect');
      if (themeSelect && themeSelect.value === 'system') {
        applyTheme('system');
      }
    });
    
    $('themeSelect').addEventListener('change', (e) => {
        applyTheme(e.target.value);
    });

    $('languageSelect').addEventListener('change', (e) => {
      saveLanguagePreference(e.target.value);
    });
  });

})();
