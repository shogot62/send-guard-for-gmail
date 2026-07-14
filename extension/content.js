(function () {
  'use strict';

  const checks = window.GmailSendGuardChecks;
  const dom = window.GmailSendGuardDom;
  const i18n = window.GmailSendGuardI18n;
  const EXT_ATTR = 'data-gsg-compose-id';
  const SEND_BUTTON_SELECTOR = '.T-I.J-J5-Ji.aoO.v7.T-I-atl.L3, div[role="button"][data-tooltip^="Send"], div[role="button"][data-tooltip^="send"], div[role="button"][data-tooltip^="送信"], div[role="button"][aria-label^="Send"], div[role="button"][aria-label^="send"], div[role="button"][aria-label^="送信"]';
  const SCAN_DEBOUNCE_MS = 120;
  const MODAL_REFRESH_MS = 500;
  const MODAL_REFRESH_MAX_TICKS = 120;

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

  let settings = { ...DEFAULT_SETTINGS };
  let composeSeq = 1;
  const composeState = new WeakMap();
  const hookedSendButtons = new WeakSet();
  const allowedSendButtons = new WeakSet();

  let scanTimer = null;
  let scanScheduled = false;
  const pendingAutoRecipientTimers = new Set();
  
  let modalRoot = null;
  let activeSendButton = null;
  let modalFocusReturnTarget = null;
  let modalConfirmInProgress = false;
  const metrics = {
    scanComposesCallCount: 0,
    snapshotReadCount: 0,
    readCurrentComposeBodyCallCount: 0,
    readAttachmentsCallCount: 0,
    modalRefreshTimerStartCount: 0,
    modalRefreshTimerStopCount: 0
  };

  function loadSettings() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    chrome.storage.local.get(null, (loaded) => {
      settings = normalizeSettings(loaded || {});
      scheduleScan();
    });
  }

  function normalizeSettings(input) {
    const stored = input || {};
    const s = {
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
    s.autoCcAddress = s.autoCcAddresses[0] || '';
    s.autoBccAddress = s.autoBccAddresses[0] || '';
    if (stored.confirmationCheckboxes) {
      s.confirmationCheckboxes = { ...DEFAULT_SETTINGS.confirmationCheckboxes, ...stored.confirmationCheckboxes };
    }
    return s;
  }

  function text(key, substitutions) {
    return i18n.t(key, settings.language, substitutions);
  }

  function reloadLocalSettings(callback) {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    chrome.storage.local.get(null, (loaded) => {
      settings = normalizeSettings(loaded || {});
      if (typeof callback === 'function') callback();
    });
  }

  function refreshComposesAfterSettingsChange() {
    const roots = getAutoRecipientRoots();
    for (const root of roots) {
      const state = composeState.get(root);
      if (state) {
        state.autoCcInjected = false;
        state.autoCcPending = false;
        state.autoCcFailed = false;
        state.lastAutoCcStateStr = '';
        state.autoCcConfirmed = false;
        state.autoBccInjected = false;
        state.autoBccPending = false;
        state.autoBccFailed = false;
        state.lastAutoBccStateStr = '';
        state.autoBccConfirmed = false;
      }
    }
    
    applyTheme();
    if (activeSendButton) {
      const activeRoot = dom.findComposeRootFromSendButton(activeSendButton, document);
      if (activeRoot) {
        renderModalBody(activeRoot, activeSendButton);
      }
    }

    // An options-page save does not necessarily mutate the Gmail document, so
    // schedule a fresh pass to apply newly enabled Auto CC/BCC settings.
    scheduleScan();
  }

  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scanScheduled = false;
      scanComposes();
    }, SCAN_DEBOUNCE_MS);
  }

  function ensureComposeId(root) {
    let id = root.getAttribute(EXT_ATTR);
    if (!id) {
      id = `gsg-${Date.now()}-${composeSeq++}`;
      root.setAttribute(EXT_ATTR, id);
    }
    let state = composeState.get(root);
    if (!state) {
      state = { 
        subjectConfirmed: false, 
        domainsConfirmed: false,
        attachmentsConfirmed: false,
        autoCcConfirmed: false,
        autoBccConfirmed: false,
        lastSubject: '', 
        lastRecipientsStr: '',
        lastAttachmentsStr: '',
        lastAutoCcStateStr: '',
        lastAutoBccStateStr: '',
        autoCcInjected: false,
        autoCcPending: false,
        autoCcFailed: false,
        autoBccInjected: false, 
        autoBccPending: false,
        autoBccFailed: false
      };
      composeState.set(root, state);
    }
    return id;
  }

  function getComposeState(root) {
    ensureComposeId(root);
    return composeState.get(root);
  }

  function syncConfirmationStateFromSnapshot(state, snapshot, ccState, bccState) {
    if (!state || !snapshot) return;

    if (state.lastSubject !== snapshot.subject) {
      state.lastSubject = snapshot.subject;
      state.subjectConfirmed = false;
    }

    const recipientsStr = JSON.stringify(snapshot.recipients || {});
    if (state.lastRecipientsStr !== recipientsStr) {
      state.lastRecipientsStr = recipientsStr;
      state.domainsConfirmed = false;
    }

    const attachmentsStr = JSON.stringify(snapshot.attachments || []);
    if (state.lastAttachmentsStr !== attachmentsStr) {
      state.lastAttachmentsStr = attachmentsStr;
      state.attachmentsConfirmed = false;
    }

    const recipients = snapshot.recipients || { to: [], cc: [], bcc: [] };
    const allRecipients = checks.uniqueEmails([
      ...(recipients.to || []),
      ...(recipients.cc || []),
      ...(recipients.bcc || [])
    ]);
    const autoCcTargets = checks.getAutoCcTargets(settings);
    const autoCcStateStr = JSON.stringify({
      enabled: Boolean(settings.autoCcEnabled),
      configured: autoCcTargets.length > 0,
      present: autoCcTargets.length > 0 && autoCcTargets.every((target) => allRecipients.includes(target)),
      targets: autoCcTargets,
      injected: Boolean(state.autoCcInjected),
      pending: Boolean(state.autoCcPending),
      status: ccState?.status || '',
      reason: ccState?.reason || ''
    });
    if (state.lastAutoCcStateStr !== autoCcStateStr) {
      state.lastAutoCcStateStr = autoCcStateStr;
      state.autoCcConfirmed = false;
    }

    const autoBccTargets = checks.getAutoBccTargets(settings);
    const autoBccStateStr = JSON.stringify({
      enabled: Boolean(settings.autoBccEnabled),
      configured: autoBccTargets.length > 0,
      present: autoBccTargets.length > 0 && autoBccTargets.every((target) => allRecipients.includes(target)),
      targets: autoBccTargets,
      injected: Boolean(state.autoBccInjected),
      pending: Boolean(state.autoBccPending),
      status: bccState?.status || '',
      reason: bccState?.reason || ''
    });
    if (state.lastAutoBccStateStr !== autoBccStateStr) {
      state.lastAutoBccStateStr = autoBccStateStr;
      state.autoBccConfirmed = false;
    }
  }

  function scanComposes() {
    metrics.scanComposesCallCount++;
    ensureModalRoot();
    const roots = dom.findComposeRoots(document);
    for (const root of roots) {
      ensureComposeId(root);
      hookSendButton(root);
    }

    if (!settings.autoCcEnabled && !settings.autoBccEnabled) return;

    for (const root of getAutoRecipientRoots(roots)) {
      ensureComposeId(root);
      autoRecipientsIfNeeded(root);
    }
  }

  function getAutoRecipientRoots(knownComposeRoots) {
    const roots = [];
    const seen = new Set();
    const addRoot = (root) => {
      if (!root || seen.has(root)) return;
      seen.add(root);
      roots.push(root);
    };

    for (const root of knownComposeRoots || dom.findComposeRoots(document)) {
      addRoot(root);
    }

    if (typeof dom.findAutoRecipientComposeRoots === 'function') {
      for (const root of dom.findAutoRecipientComposeRoots(document)) {
        addRoot(root);
      }
    }

    return roots;
  }

  function hookSendButton(root) {
    const sendBtn = findSendButton(root);
    if (!sendBtn) return;
    if (hookedSendButtons.has(sendBtn)) return;
    
    hookedSendButtons.add(sendBtn);
    
    sendBtn.addEventListener('click', (e) => {
      if (allowedSendButtons.has(sendBtn)) {
        allowedSendButtons.delete(sendBtn);
        return;
      }

      interceptSendAttempt(root, sendBtn, e);
    }, true);
  }

  function findSendButton(root) {
    if (!root) return null;
    return root.querySelector(SEND_BUTTON_SELECTOR);
  }

  function consumeSendEvent(event) {
    if (!event) return;
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation();
    }
  }

  function interceptSendAttempt(root, sendBtn, event) {
    if (!root || !sendBtn) return false;
    consumeSendEvent(event);

    showModal(root, sendBtn);
    return true;
  }

  function isKeyboardSendEvent(event) {
    const enterKey = event.key === 'Enter' || event.code === 'Enter' || event.code === 'NumpadEnter';
    return enterKey && (event.ctrlKey || event.metaKey);
  }

  function isModalActive() {
    if (!modalRoot) return false;
    const overlay = modalRoot.querySelector('.gsg-modal-overlay');
    return Boolean(overlay && overlay.classList.contains('gsg-active'));
  }

  function confirmActiveModalIfAllowed() {
    return confirmSendFromModal();
  }

  function findComposeRootFromKeyboardEvent(event) {
    const roots = dom.findComposeRoots(document);
    const targets = [event.target, document.activeElement];
    for (const target of targets) {
      if (!target || target.nodeType !== Node.ELEMENT_NODE) continue;
      if (modalRoot && modalRoot.contains(target)) return null;
      for (const root of roots) {
        if (root.contains(target)) return root;
      }
    }
    return null;
  }

  function handleKeyboardSend(event) {
    if (!isKeyboardSendEvent(event)) return;
    if (isModalActive()) {
      consumeSendEvent(event);
      if (event.repeat) return;
      confirmActiveModalIfAllowed();
      return;
    }

    const root = findComposeRootFromKeyboardEvent(event);
    const sendBtn = findSendButton(root);
    if (!root || !sendBtn) return;
    interceptSendAttempt(root, sendBtn, event);
  }

  function ensureModalRoot() {
    if (modalRoot) return;
    modalRoot = document.createElement('div');
    modalRoot.className = 'gsg-root';

    const overlay = document.createElement('div');
    overlay.className = 'gsg-modal-overlay';
    overlay.setAttribute('aria-hidden', 'true');

    const box = document.createElement('div');
    box.className = 'gsg-modal-box';
    box.id = 'gsg-modal-dialog';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'gsg-modal-title');
    box.setAttribute('aria-describedby', 'gsg-modal-description');
    box.tabIndex = -1;

    const header = document.createElement('div');
    header.className = 'gsg-modal-header';
    const headerIcon = document.createElement('div');
    headerIcon.className = 'gsg-check-icon';
    headerIcon.style.color = 'var(--primary)';
    headerIcon.setAttribute('aria-hidden', 'true');
    headerIcon.textContent = '✓';
    const headerTitle = document.createElement('h2');
    headerTitle.id = 'gsg-modal-title';
    headerTitle.setAttribute('data-gsg-i18n', 'sendGuardTitle');
    headerTitle.textContent = text('sendGuardTitle');
    header.appendChild(headerIcon);
    header.appendChild(headerTitle);

    const body = document.createElement('div');
    body.className = 'gsg-modal-body';
    body.id = 'gsg-modal-description';

    const footer = document.createElement('div');
    footer.className = 'gsg-modal-footer';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'gsg-btn gsg-btn-cancel';
    cancelBtn.setAttribute('data-gsg-i18n', 'cancelButton');
    cancelBtn.textContent = text('cancelButton');
    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'gsg-btn gsg-btn-confirm';
    confirmBtn.id = 'gsg-btn-final-send';
    confirmBtn.setAttribute('aria-disabled', 'false');
    confirmBtn.textContent = text('sendButton');
    footer.appendChild(cancelBtn);
    footer.appendChild(confirmBtn);

    box.appendChild(header);
    box.appendChild(body);
    box.appendChild(footer);
    overlay.appendChild(box);
    modalRoot.appendChild(overlay);
    document.body.appendChild(modalRoot);
    updateModalStaticText();
    
    cancelBtn.addEventListener('click', () => {
      closeModalWithoutSending();
    });
    
    confirmBtn.addEventListener('click', () => {
      confirmSendFromModal();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!overlay.classList.contains('gsg-active')) return;
      consumeSendEvent(e);
      closeModalWithoutSending();
    }, true);

    modalRoot.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab' || !overlay.classList.contains('gsg-active')) return;
      const focusable = getFocusableModalElements();
      if (focusable.length === 0) {
        e.preventDefault();
        box.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
    
    modalRoot.addEventListener('change', (e) => {
        if (!activeSendButton) return;
        const root = dom.findComposeRootFromSendButton(activeSendButton, document);
        if (!root) return;
        const state = composeState.get(root);
        if (!state) return;

        if (e.target.id === 'gsg-subject-confirm-chk') {
            state.subjectConfirmed = e.target.checked;
            renderModalBody(root, activeSendButton);
        } else if (e.target.id === 'gsg-domains-confirm-chk') {
            state.domainsConfirmed = e.target.checked;
            renderModalBody(root, activeSendButton);
        } else if (e.target.id === 'gsg-attachments-confirm-chk') {
            state.attachmentsConfirmed = e.target.checked;
            renderModalBody(root, activeSendButton);
        } else if (e.target.id === 'gsg-autocc-confirm-chk') {
            state.autoCcConfirmed = e.target.checked;
            renderModalBody(root, activeSendButton);
        } else if (e.target.id === 'gsg-autobcc-confirm-chk') {
            state.autoBccConfirmed = e.target.checked;
            renderModalBody(root, activeSendButton);
        }
    });
  }

  let modalRefreshTimer = null;
  let modalRefreshTickCount = 0;

  function stopModalRefresh() {
    if (modalRefreshTimer) {
      clearTimeout(modalRefreshTimer);
      modalRefreshTimer = null;
      metrics.modalRefreshTimerStopCount++;
    }
    modalRefreshTickCount = 0;
  }

  function closeModalWithoutSending() {
    stopModalRefresh();
    const overlay = modalRoot?.querySelector('.gsg-modal-overlay');
    if (overlay) {
      overlay.classList.remove('gsg-active');
      overlay.setAttribute('aria-hidden', 'true');
    }
    const focusTarget = modalFocusReturnTarget;
    modalFocusReturnTarget = null;
    activeSendButton = null;
    modalConfirmInProgress = false;
    if (focusTarget && focusTarget.isConnected && typeof focusTarget.focus === 'function') {
      focusTarget.focus();
    }
  }

  function confirmSendFromModal() {
    if (modalConfirmInProgress || !modalRoot) return false;
    const overlay = modalRoot.querySelector('.gsg-modal-overlay');
    const confirmBtn = modalRoot.querySelector('.gsg-btn-confirm');
    if (!overlay || !overlay.classList.contains('gsg-active')) return false;
    if (!confirmBtn || confirmBtn.disabled) return false;
    if (!activeSendButton) return false;

    modalConfirmInProgress = true;
    try {
      stopModalRefresh();
      overlay.classList.remove('gsg-active');
      overlay.setAttribute('aria-hidden', 'true');
      const sendBtn = activeSendButton;
      activeSendButton = null;
      modalFocusReturnTarget = null;
      allowedSendButtons.add(sendBtn);
      sendBtn.click();
      return true;
    } finally {
      modalConfirmInProgress = false;
    }
  }

  function scheduleModalRefreshIfNeeded(activeRoot, sendBtn, attachments) {
    const hasUploading = attachments.some(a => a.status === 'uploading');
    const overlay = modalRoot?.querySelector('.gsg-modal-overlay');
    const modalActive = Boolean(overlay && overlay.classList.contains('gsg-active'));
    if (!modalActive || !hasUploading || activeSendButton !== sendBtn) {
      stopModalRefresh();
      return;
    }

    clearTimeout(modalRefreshTimer);
    if (modalRefreshTickCount >= MODAL_REFRESH_MAX_TICKS) {
      modalRefreshTimer = null;
      return;
    }

    modalRefreshTimer = setTimeout(() => {
      modalRefreshTimer = null;
      metrics.modalRefreshTimerStopCount++;
      modalRefreshTickCount++;
      const stillActive = modalRoot?.querySelector('.gsg-modal-overlay')?.classList.contains('gsg-active');
      if (!stillActive || !activeRoot.isConnected || !sendBtn.isConnected || modalRefreshTickCount > MODAL_REFRESH_MAX_TICKS) {
        return;
      }
      renderModalBody(activeRoot, sendBtn);
    }, MODAL_REFRESH_MS);
    metrics.modalRefreshTimerStartCount++;
  }

  function applyTheme() {
    if (!modalRoot) return;
    if (settings.theme === 'dark') {
      modalRoot.setAttribute('data-gsg-theme', 'dark');
    } else if (settings.theme === 'light') {
      modalRoot.removeAttribute('data-gsg-theme');
    } else {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        modalRoot.setAttribute('data-gsg-theme', 'dark');
      } else {
        modalRoot.removeAttribute('data-gsg-theme');
      }
    }
  }

  function updateModalStaticText() {
    if (!modalRoot) return;
    modalRoot.querySelectorAll('[data-gsg-i18n]').forEach((node) => {
      const key = node.getAttribute('data-gsg-i18n');
      node.textContent = text(key);
    });
  }

  function showModal(root, sendBtn) {
    if (!modalRoot) ensureModalRoot();
    const focused = document.activeElement;
    modalFocusReturnTarget = focused && !modalRoot.contains(focused) ? focused : sendBtn;
    activeSendButton = sendBtn;
    stopModalRefresh();
    applyTheme();
    updateModalStaticText();
    const activeRoot = dom.findComposeRootFromSendButton(sendBtn, document) || root;
    
    if (!activeRoot) {
      const overlay = modalRoot.querySelector('.gsg-modal-overlay');
      const body = modalRoot.querySelector('.gsg-modal-body');
      body.replaceChildren();
      body.appendChild(buildCheckItem(text('composeRootErrorTitle'), 'error', text('composeRootErrorDescription'), '⚠️'));
      overlay.classList.add('gsg-active');
      overlay.setAttribute('aria-hidden', 'false');
      focusModalPrimaryAction();
      return;
    }

    const overlay = modalRoot.querySelector('.gsg-modal-overlay');
    ensureComposeId(activeRoot); // ensure state is fresh before showing modal
    overlay.classList.add('gsg-active');
    overlay.setAttribute('aria-hidden', 'false');
    renderModalBody(activeRoot, sendBtn);
    focusModalPrimaryAction();
  }

  function createModalSnapshot(activeRoot) {
    metrics.snapshotReadCount++;
    const recipients = dom.readRecipients(activeRoot, document);
    const attachments = readAttachmentsForSnapshot(activeRoot);
    const subjectInfo = dom.readSubjectInfo(activeRoot, document);
    const currentBody = readCurrentComposeBodyForSnapshot(activeRoot);
    return {
      subjectInfo,
      subject: subjectInfo.value,
      quotedBodyUnsafe: '',
      currentBody,
      rawBodyForDebug: '',
      attachmentCount: attachments.length,
      attachments,
      recipients
    };
  }

  function readCurrentComposeBodyForSnapshot(activeRoot) {
    metrics.readCurrentComposeBodyCallCount++;
    return dom.readCurrentComposeBody(activeRoot, document);
  }

  function readAttachmentsForSnapshot(activeRoot) {
    metrics.readAttachmentsCallCount++;
    return dom.readAttachments(activeRoot, document);
  }

  function focusModalPrimaryAction() {
    if (!modalRoot) return;
    const confirmBtn = modalRoot.querySelector('.gsg-btn-confirm');
    if (confirmBtn && !confirmBtn.disabled) {
      confirmBtn.focus();
      return;
    }
    const cancelBtn = modalRoot.querySelector('.gsg-btn-cancel');
    if (cancelBtn) {
      cancelBtn.focus();
      return;
    }
    modalRoot.querySelector('.gsg-modal-box')?.focus();
  }

  function getFocusableModalElements() {
    if (!modalRoot) return [];
    const selector = 'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';
    return Array.from(modalRoot.querySelectorAll(selector)).filter((element) => {
      if (element.disabled || element.getAttribute('aria-disabled') === 'true') return false;
      if (element.closest('[hidden], [aria-hidden="true"]')) return false;
      return element.tabIndex >= 0;
    });
  }

  function renderModalBody(activeRoot, sendBtn) {
    const body = modalRoot.querySelector('.gsg-modal-body');
    const confirmBtn = modalRoot.querySelector('.gsg-btn-confirm');
    
    const snapshot = createModalSnapshot(activeRoot);
    const recipients = snapshot.recipients;
    const attachments = snapshot.attachments;
    const subjectInfo = snapshot.subjectInfo;
    const state = getComposeState(activeRoot) || {
      subjectConfirmed: false,
      lastSubject: '',
      autoCcInjected: false,
      autoCcPending: false,
      autoCcFailed: false,
      autoBccInjected: false,
      autoBccPending: false,
      autoBccFailed: false
    };
    const ccState = checks.evaluateAutoCcState(settings, snapshot, state);
    const bccState = checks.evaluateAutoBccState(settings, snapshot, state);
    syncConfirmationStateFromSnapshot(state, snapshot, ccState, bccState);
    const subjectResult = checks.evaluateSubject(snapshot.subject, state.subjectConfirmed);
    const attachmentResult = checks.evaluateAttachment(
      snapshot.subject,
      snapshot.currentBody,
      snapshot.attachmentCount,
      settings.customAttachmentKeywords
    );

    let hasWarning = false;
    let hasUnconfirmedItems = false;
    body.replaceChildren();
    
    function appendConfirmCheckbox(container, id, labelText, isChecked) {
        const chkDiv = document.createElement('div');
        chkDiv.style.marginTop = '8px';
        const label = document.createElement('label');
        label.style.cursor = 'pointer';
        label.style.display = 'flex';
        label.style.alignItems = 'center';
        label.style.gap = '6px';
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.id = id;
        chk.checked = isChecked;
        label.appendChild(chk);
        label.appendChild(document.createTextNode(' ' + labelText));
        chkDiv.appendChild(label);
        container.appendChild(chkDiv);
    }
    
    // 件名チェック
    if (settings.subjectCheckEnabled) {
      const descContainer = document.createElement('div');
      let isUnconfirmed = false;
      
      if (!subjectInfo.available) {
          hasWarning = true;
          const t = document.createElement('span');
          t.textContent = text('subjectUnavailable');
          descContainer.appendChild(t);
          
          if (settings.confirmationCheckboxes?.subject) {
              if (!state.subjectConfirmed) isUnconfirmed = true;
              appendConfirmCheckbox(descContainer, 'gsg-subject-confirm-chk', text('subjectConfirmLabel'), state.subjectConfirmed);
          }
          
          const level = (settings.confirmationCheckboxes?.subject && state.subjectConfirmed) ? 'ok' : 'warn';
          body.appendChild(buildCheckItemNode(
            (settings.confirmationCheckboxes?.subject && state.subjectConfirmed) ? text('subjectConfirmedTitle') : text('subjectCheckTitle'),
            level,
            descContainer
          ));
      } else {
          let checkWarn = subjectResult.level === 'warn' && settings.confirmationCheckboxes?.subject;
          if (subjectResult.level === 'error' || checkWarn) hasWarning = true;
          const hasSubjectText = snapshot.subject.trim().length > 0;
          
          if (!hasSubjectText) {
              const t = document.createElement('span');
              t.textContent = text('subjectEmpty');
              descContainer.appendChild(t);
          } else {
              const t = document.createElement('span');
              t.textContent = text('subjectPresent', { subject: snapshot.subject });
              descContainer.appendChild(t);
              
              if (settings.confirmationCheckboxes?.subject) {
                  if (!state.subjectConfirmed) isUnconfirmed = true;
                  appendConfirmCheckbox(descContainer, 'gsg-subject-confirm-chk', text('subjectConfirmLabel'), state.subjectConfirmed);
              }
          }
          
          let level = subjectResult.level;
          if (hasSubjectText && !settings.confirmationCheckboxes?.subject) {
              level = 'ok';
          } else if (hasSubjectText && settings.confirmationCheckboxes?.subject && !state.subjectConfirmed) {
              level = 'warn';
          }
          
          body.appendChild(buildCheckItemNode(
            (hasSubjectText && settings.confirmationCheckboxes?.subject && state.subjectConfirmed) ? text('subjectConfirmedTitle') : text('subjectCheckTitle'), 
            level, 
            descContainer
          ));
      }
      if (isUnconfirmed) hasUnconfirmedItems = true;
    }
    
    // 添付チェック
    if (settings.attachmentCheckEnabled && attachmentResult.level !== 'muted') {
      if (attachmentResult.level === 'warn') hasWarning = true;
      const descContainer = document.createElement('div');
      
      let itemTitle = text('attachmentCheckTitle');
      if (attachments.length > 0) {
          const hasUploading = attachments.some(a => a.status === 'uploading');
          const allUnknown = attachments.every(a => a.detected && !a.name);
          
          const summary = document.createElement('div');
          if (hasUploading) {
              itemTitle = text('attachmentProcessingTitle');
              summary.textContent = text('attachmentProcessing');
          } else if (allUnknown) {
              summary.textContent = text('attachmentDetected');
          } else {
              summary.textContent = text('attachmentPresent');
          }
          descContainer.appendChild(summary);

          const ul = document.createElement('ul');
          ul.style.marginTop = '4px';
          ul.style.paddingLeft = '20px';
          
          for (const att of attachments) {
              const li = document.createElement('li');
              if (att.detected && !att.name) {
                  li.textContent = text('attachmentUnknownDetails');
              } else {
                  if (att.status === 'uploading') {
                      li.textContent = text('attachmentUploading', { name: att.name });
                  } else {
                      const sizeStr = att.sizeText ? att.sizeText : text('attachmentUnknownSize');
                      li.textContent = text('attachmentWithSize', { name: att.name, size: sizeStr });
                  }
              }
              ul.appendChild(li);
          }
          descContainer.appendChild(ul);
      } else {
          descContainer.textContent = localizeAttachmentResult(attachmentResult);
      }
      
      let level = attachmentResult.level;
      if (settings.confirmationCheckboxes?.attachments) {
          if (!state.attachmentsConfirmed) {
              hasUnconfirmedItems = true;
              if (level === 'ok') level = 'warn';
          }
          appendConfirmCheckbox(descContainer, 'gsg-attachments-confirm-chk', text('attachmentConfirmLabel'), state.attachmentsConfirmed);
      }
      
      body.appendChild(buildCheckItemNode(
        (settings.confirmationCheckboxes?.attachments && state.attachmentsConfirmed && level !== 'warn' && level !== 'error') ? text('attachmentConfirmedTitle') : itemTitle, 
        level, 
        descContainer
      ));
    }

    // ドメイン表示
    if (settings.domainDisplayEnabled) {
      const domainContent = document.createElement('div');
      domainContent.appendChild(buildDomainAccordions('To', snapshot.recipients.to));
      domainContent.appendChild(buildDomainAccordions('Cc', snapshot.recipients.cc));
      domainContent.appendChild(buildDomainAccordions('Bcc', snapshot.recipients.bcc));
      
      if (domainContent.children.length > 0) {
        if (settings.confirmationCheckboxes?.domains) {
            if (!state.domainsConfirmed) hasUnconfirmedItems = true;
            appendConfirmCheckbox(domainContent, 'gsg-domains-confirm-chk', text('domainsConfirmLabel'), state.domainsConfirmed);
        }
        
        const domainItem = document.createElement('div');
        domainItem.className = 'gsg-check-item';
        const icon = document.createElement('div');
        icon.className = 'gsg-check-icon';
        icon.textContent = '🌐';
        const content = document.createElement('div');
        content.className = 'gsg-check-content';
        const title = document.createElement('div');
        title.className = 'gsg-check-title';
        title.textContent = (settings.confirmationCheckboxes?.domains && state.domainsConfirmed) ? text('domainsConfirmedTitle') : text('domainsTitle');
        const domainContainer = document.createElement('div');
        domainContainer.className = 'gsg-domain-container';
        domainContainer.appendChild(domainContent);
        content.appendChild(title);
        content.appendChild(domainContainer);
        domainItem.appendChild(icon);
        domainItem.appendChild(content);
        
        if (settings.confirmationCheckboxes?.domains && !state.domainsConfirmed) {
            icon.textContent = '⚠️';
        }
        
        body.appendChild(domainItem);
      }
    }

    function appendAutoRecipientCheck(config) {
      const recipientState = config.state;
      if (!settings[config.enabledKey]) {
        body.appendChild(buildCheckItem(text(config.titleKey), 'muted', text(config.disabledTextKey), '—'));
        return;
      }
      if (recipientState.status === 'warn' || recipientState.status === 'error') hasWarning = true;

      const descContainer = document.createElement('div');
      if (recipientState.status === 'ok') {
         const tContainer = document.createElement('div');
         tContainer.style.padding = '4px 0';
         tContainer.style.display = 'flex';
         tContainer.style.justifyContent = 'space-between';
         tContainer.style.alignItems = 'center';
          
         const spanEmail = document.createElement('span');
         spanEmail.textContent = text(config.configuredAddressesKey, {
           count: Array.isArray(recipientState.targets) ? recipientState.targets.length : 1
         });
          
         const spanBadge = document.createElement('span');
          spanBadge.textContent = text(recipientState.reason === 'already_present' ? config.alreadyPresentTextKey : config.addedKey);
         spanBadge.style.color = 'var(--success)';
         spanBadge.style.fontWeight = '600';
         spanBadge.style.fontSize = '12px';
         spanBadge.style.background = 'var(--success-bg)';
         spanBadge.style.padding = '2px 8px';
         spanBadge.style.borderRadius = '12px';
         
         tContainer.appendChild(spanEmail);
         tContainer.appendChild(spanBadge);
         descContainer.appendChild(tContainer);
      } else if (recipientState.reason === 'pending') {
         descContainer.textContent = text(config.pendingTextKey);
      } else if (recipientState.reason === 'missing') {
         const hasPartialFailure = Array.isArray(recipientState.missingTargets)
           && Array.isArray(recipientState.targets)
           && recipientState.missingTargets.length < recipientState.targets.length;
         descContainer.textContent = text(hasPartialFailure ? config.partialMissingTextKey : config.missingTextKey);
         descContainer.style.whiteSpace = 'pre-wrap';
      } else if (recipientState.reason === 'no_target') {
         descContainer.textContent = text(config.noTargetTextKey);
      } else if (recipientState.reason === 'failed') {
         descContainer.textContent = text(config.failedTextKey);
      } else {
         descContainer.textContent = recipientState.label || '';
      }

      const detailTargets = Array.isArray(recipientState.targets) ? recipientState.targets : [];
      if (detailTargets.length > 0) {
        const domainDetails = document.createElement('div');
        domainDetails.className = 'gsg-auto-recipient-domains';
        domainDetails.appendChild(buildDomainAccordions(text(config.titleKey), detailTargets));
        descContainer.appendChild(domainDetails);
      }
       
      let level = recipientState.status;
      if (settings.confirmationCheckboxes?.[config.confirmationKey]) {
          if (!state[config.confirmedKey]) {
              hasUnconfirmedItems = true;
              if (level === 'ok') level = 'warn';
          }
          appendConfirmCheckbox(descContainer, config.checkboxId, text(config.confirmLabelKey), state[config.confirmedKey]);
      }
       
      body.appendChild(buildCheckItemNode(
        (settings.confirmationCheckboxes?.[config.confirmationKey] && state[config.confirmedKey] && level !== 'warn' && level !== 'error') ? text(config.confirmedTitleKey) : text(config.titleKey),
        level, 
        descContainer, 
        (level === 'ok' || level === 'warn') ? '✉' : null
      ));
    }

    appendAutoRecipientCheck({
      enabledKey: 'autoCcEnabled',
      state: ccState,
      confirmationKey: 'autoCc',
      confirmedKey: 'autoCcConfirmed',
      checkboxId: 'gsg-autocc-confirm-chk',
      titleKey: 'autoCcTitle',
      confirmedTitleKey: 'autoCcConfirmedTitle',
      configuredAddressesKey: 'autoCcConfiguredAddresses',
      addedKey: 'autoCcAdded',
      disabledTextKey: 'autoCcDisabled',
      noTargetTextKey: 'autoCcNoTarget',
      pendingTextKey: 'autoCcPending',
      missingTextKey: 'autoCcMissing',
      partialMissingTextKey: 'autoCcPartialMissing',
      failedTextKey: 'autoCcFailed',
      alreadyPresentTextKey: 'autoCcAlreadyPresent',
      confirmLabelKey: 'autoCcConfirmLabel'
    });

    appendAutoRecipientCheck({
      enabledKey: 'autoBccEnabled',
      state: bccState,
      confirmationKey: 'autoBcc',
      confirmedKey: 'autoBccConfirmed',
      checkboxId: 'gsg-autobcc-confirm-chk',
      titleKey: 'autoBccTitle',
      confirmedTitleKey: 'autoBccConfirmedTitle',
      configuredAddressesKey: 'autoBccConfiguredAddresses',
      addedKey: 'autoBccAdded',
      disabledTextKey: 'autoBccDisabled',
      noTargetTextKey: 'autoBccNoTarget',
      pendingTextKey: 'autoBccPending',
      missingTextKey: 'autoBccMissing',
      partialMissingTextKey: 'autoBccPartialMissing',
      failedTextKey: 'autoBccFailed',
      alreadyPresentTextKey: 'autoBccAlreadyPresent',
      confirmLabelKey: 'autoBccConfirmLabel'
    });

    const isCcPending = settings.autoCcEnabled && ccState.reason === 'pending';
    const isBccPending = settings.autoBccEnabled && bccState.reason === 'pending';
    const isAutoRecipientPending = isCcPending || isBccPending;
    const isAttachmentUploading = attachments.some(a => a.status === 'uploading');

    if (isAutoRecipientPending) {
      confirmBtn.disabled = true;
      confirmBtn.className = 'gsg-btn gsg-btn-confirm gsg-disabled';
      confirmBtn.textContent = isCcPending && isBccPending
        ? text('autoRecipientPendingButton')
        : isCcPending ? text('ccPendingButton') : text('bccPendingButton');
    } else if (isAttachmentUploading) {
      confirmBtn.disabled = true;
      confirmBtn.className = 'gsg-btn gsg-btn-confirm gsg-disabled';
      confirmBtn.textContent = text('attachmentUploadingButton');
    } else if (settings.requireAllEnabledConfirmations && hasUnconfirmedItems) {
      confirmBtn.disabled = true;
      confirmBtn.className = 'gsg-btn gsg-btn-confirm gsg-disabled';
      confirmBtn.textContent = text('unconfirmedButton');
    } else {
      confirmBtn.disabled = false;
      if (hasWarning || hasUnconfirmedItems) {
        confirmBtn.className = 'gsg-btn gsg-btn-confirm gsg-danger';
        confirmBtn.textContent = text('sendAnywayButton');
      } else {
        confirmBtn.className = 'gsg-btn gsg-btn-confirm';
        confirmBtn.textContent = text('sendButton');
      }
    }
    confirmBtn.setAttribute('aria-disabled', confirmBtn.disabled ? 'true' : 'false');
    
    scheduleModalRefreshIfNeeded(activeRoot, sendBtn, attachments);
  }

  function buildCheckItem(title, level, descText, customIcon = null) {
      const descContainer = document.createElement('div');
      descContainer.textContent = descText;
      return buildCheckItemNode(title, level, descContainer, customIcon);
  }

  function buildCheckItemNode(title, level, descNode, customIcon = null) {
    const iconStr = customIcon ? customIcon : (level === 'ok' ? '✅' : '⚠️');
    const descClass = level === 'warn' || level === 'error' ? 'gsg-check-desc gsg-warning-box' : 'gsg-check-desc';
    
    const div = document.createElement('div');
    div.className = 'gsg-check-item';
    
    const iconDiv = document.createElement('div');
    iconDiv.className = 'gsg-check-icon';
    iconDiv.textContent = iconStr;
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'gsg-check-content';
    
    const titleDiv = document.createElement('div');
    titleDiv.className = 'gsg-check-title';
    titleDiv.textContent = title;
    
    const descDiv = document.createElement('div');
    descDiv.className = descClass;
    descDiv.appendChild(descNode);
    
    contentDiv.appendChild(titleDiv);
    contentDiv.appendChild(descDiv);
    
    div.appendChild(iconDiv);
    div.appendChild(contentDiv);
    
    return div;
  }

  function buildDomainAccordions(label, emails) {
    const fragment = document.createDocumentFragment();
    const groups = checks.groupEmailsByDomain(emails);
    
    for (const [domain, groupedEmails] of Object.entries(groups)) {
      const details = document.createElement('details');
      details.className = 'gsg-domain-accordion';
      const total = groupedEmails.length;
      
      const summary = document.createElement('summary');
      summary.className = 'gsg-domain-summary';
      
      const leftDiv = document.createElement('div');
      leftDiv.style.display = 'flex'; leftDiv.style.alignItems = 'center'; leftDiv.style.gap = '8px';
      const badge = document.createElement('span');
      badge.className = 'gsg-domain-badge';
      badge.textContent = label;
      const domSpan = document.createElement('span');
      domSpan.style.fontWeight = '600'; domSpan.style.color = 'var(--text-main)';
      domSpan.textContent = domain;
      leftDiv.appendChild(badge);
      leftDiv.appendChild(domSpan);
      
      const rightDiv = document.createElement('div');
      rightDiv.style.display = 'flex'; rightDiv.style.alignItems = 'center'; rightDiv.style.gap = '4px'; rightDiv.style.color = 'var(--text-muted)';
      rightDiv.textContent = text('countLabel', { count: total });
      const svgSpan = document.createElement('span');
      svgSpan.className = 'gsg-chevron';
      svgSpan.textContent = '⌄';
      rightDiv.appendChild(svgSpan);
      
      summary.appendChild(leftDiv);
      summary.appendChild(rightDiv);
      
      const detailsDiv = document.createElement('div');
      detailsDiv.className = 'gsg-domain-details';
      const ul = document.createElement('ul');
      for (const email of groupedEmails) {
        const li = document.createElement('li');
        li.textContent = email;
        ul.appendChild(li);
      }
      detailsDiv.appendChild(ul);
      
      details.appendChild(summary);
      details.appendChild(detailsDiv);
      fragment.appendChild(details);
    }
    return fragment;
  }

  function localizeAttachmentResult(result) {
    if (result?.reason === 'attachment_keyword_without_file') {
      const keyword = Array.isArray(result.hits) && result.hits.length > 0 ? result.hits[0] : '添付';
      return text('attachmentKeywordWarning', { keyword });
    }
    if (result?.reason === 'attachment_not_required') {
      return text('attachmentNotRequired');
    }
    return result?.label || '';
  }

  // --- Auto CC/BCC Logic ---
  function getAutoRecipientConfig(field) {
    if (field === 'cc') {
      return {
        field,
        enabledKey: 'autoCcEnabled',
        pendingKey: 'autoCcPending',
        injectedKey: 'autoCcInjected',
        failedKey: 'autoCcFailed',
        getPendingTargets: checks.getPendingAutoCcTargets,
        findInput: dom.findCcInput,
        ensureVisible: dom.ensureCcVisible
      };
    }
    return {
      field: 'bcc',
      enabledKey: 'autoBccEnabled',
      pendingKey: 'autoBccPending',
      injectedKey: 'autoBccInjected',
      failedKey: 'autoBccFailed',
      getPendingTargets: checks.getPendingAutoBccTargets,
      findInput: dom.findBccInput,
      ensureVisible: dom.ensureBccVisible
    };
  }

  function autoRecipientsIfNeeded(root) {
    autoRecipientIfNeeded(root, 'cc');
    autoRecipientIfNeeded(root, 'bcc');
  }

  function autoRecipientIfNeeded(root, field) {
    const config = getAutoRecipientConfig(field);
    if (!settings[config.enabledKey]) return;
    if (isModalActive()) return;
    const state = composeState.get(root);
    if (state && state[config.pendingKey]) return;

    const recipients = dom.readRecipients(root, document);
    const snapshot = { recipients };

    const initialPendingTargets = config.getPendingTargets(settings, snapshot);
    if (initialPendingTargets.length === 0) {
        if (state) {
          state[config.injectedKey] = true;
          state[config.failedKey] = false;
        }
        return;
    }

    if (state) {
      state[config.pendingKey] = true;
      state[config.failedKey] = false;
    }

    let attempts = 0;
    let activeTarget = '';
    const retryDelays = [0, 100, 200, 300, 500, 700, 900, 1100, 1200];
    const verifyDelay = 300;
    
    function scheduleAutoRecipientTimer(callback, delay) {
        let timerId = null;
        const wrappedCallback = () => {
            if (timerId !== null) pendingAutoRecipientTimers.delete(timerId);
            callback();
        };
        timerId = setTimeout(wrappedCallback, delay);
        pendingAutoRecipientTimers.add(timerId);
        return timerId;
    }

    function refreshActiveModalIfNeeded() {
      if (activeSendButton && dom.findComposeRootFromSendButton(activeSendButton, document) === root) {
        renderModalBody(root, activeSendButton);
      }
    }

    function readCurrentPendingTargets() {
      return config.getPendingTargets(settings, {
        recipients: dom.readRecipients(root, document)
      });
    }

    function markAutoRecipientFailure() {
      if (state) {
        state[config.pendingKey] = false;
        state[config.injectedKey] = false;
        state[config.failedKey] = true;
      }
      refreshActiveModalIfNeeded();
    }

    function markAutoRecipientSuccess() {
      if (state) {
        state[config.pendingKey] = false;
        state[config.injectedKey] = true;
        state[config.failedKey] = false;
      }
      refreshActiveModalIfNeeded();
    }

    function verifyInjectedOrContinue() {
      if (isModalActive()) {
        markAutoRecipientFailure();
        return;
      }
      const pendingTargets = readCurrentPendingTargets();
      if (pendingTargets.length === 0) {
        markAutoRecipientSuccess();
        return;
      }
      if (!pendingTargets.includes(activeTarget)) {
        activeTarget = '';
        attempts = 0;
        tryFindAndInject();
        return;
      }
      scheduleNextAttempt();
    }

    function prepareRecipientUiForAttempt(attemptNumber) {
      if (attemptNumber === 0) {
        config.ensureVisible(root, document);
      } else if (attemptNumber === 2) {
        if (typeof dom.expandRecipientEditor === 'function') {
          dom.expandRecipientEditor(root, document);
        }
        config.ensureVisible(root, document);
      }
    }

    function tryFindAndInject() {
        if (isModalActive()) {
            markAutoRecipientFailure();
            return;
        }
        const pendingTargets = readCurrentPendingTargets();
        if (pendingTargets.length === 0) {
            markAutoRecipientSuccess();
            return;
        }

        const target = pendingTargets[0];
        if (target !== activeTarget) {
            activeTarget = target;
            attempts = 0;
        }

        prepareRecipientUiForAttempt(attempts);
        const input = config.findInput(root, document);
        if (input) {
            insertRecipientIntoInput(input, target);
            scheduleAutoRecipientTimer(verifyInjectedOrContinue, verifyDelay);
            return;
        }

        scheduleNextAttempt();
    }

    function scheduleNextAttempt() {
        attempts++;
        if (attempts < retryDelays.length) {
            scheduleAutoRecipientTimer(tryFindAndInject, retryDelays[attempts]);
        } else {
            markAutoRecipientFailure();
        }
    }
    
    tryFindAndInject();
  }

  function insertRecipientIntoInput(input, email) {
    const previousFocus = document.activeElement;
    input.focus();
    
    try {
        if (input.isContentEditable) {
            input.textContent = email;
        } else {
            const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            if (setter) {
                setter.call(input, email);
            } else {
                input.value = email;
            }
        }
    } catch (e) {
        if (input.isContentEditable) {
            input.textContent = email;
        } else {
            input.value = email;
        }
    }

    input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13 }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13 }));
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Tab', code: 'Tab', keyCode: 9 }));
    
    if (previousFocus && typeof previousFocus.focus === 'function' && previousFocus !== input) {
      previousFocus.focus();
    } else {
      input.blur();
    }
  }

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
  document.addEventListener('keydown', handleKeyboardSend, true);

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      reloadLocalSettings(refreshComposesAfterSettingsChange);
    });
  }

  loadSettings();

  // For testing purposes
  window.GmailSendGuardTestHooks = {
    getMetrics() {
      return {
        ...metrics,
        activeModalRefreshTimerCount: modalRefreshTimer ? 1 : 0
      };
    },
    resetMetrics() {
      for (const key of Object.keys(metrics)) {
        metrics[key] = 0;
      }
    },
    scheduleScanForTest() {
      scheduleScan();
    },
    scanComposesForTest() {
      scanComposes();
    },
    disconnectObserver() {
      if (observer) observer.disconnect();
      document.removeEventListener('keydown', handleKeyboardSend, true);
      clearTimeout(scanTimer);
      scanTimer = null;
      scanScheduled = false;
      for (const timerId of pendingAutoRecipientTimers) {
        clearTimeout(timerId);
      }
      pendingAutoRecipientTimers.clear();
      if (typeof stopModalRefresh === 'function') stopModalRefresh();
    }
  };
})();
