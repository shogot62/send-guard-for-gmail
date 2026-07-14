(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.GmailSendGuardChecks = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function normalizeEmail(value) {
    if (!value) return '';
    const text = String(value).trim().toLowerCase();
    const match = text.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    return match ? match[0].toLowerCase() : '';
  }

  function normalizeEmailList(value) {
    const values = [];
    if (Array.isArray(value)) {
      for (const item of value) {
        values.push(...normalizeEmailList(item));
      }
      return uniqueEmails(values);
    }

    const text = String(value || '');
    const matches = text.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [];
    return uniqueEmails(matches);
  }

  function getAutoBccTargets(settings) {
    const configuredList = Array.isArray(settings?.autoBccAddresses) ? settings.autoBccAddresses : [];
    if (configuredList.length > 0) {
      return normalizeEmailList(configuredList);
    }
    return normalizeEmailList(settings?.autoBccAddress || '');
  }

  function getAutoCcTargets(settings) {
    const configuredList = Array.isArray(settings?.autoCcAddresses) ? settings.autoCcAddresses : [];
    if (configuredList.length > 0) {
      return normalizeEmailList(configuredList);
    }
    return normalizeEmailList(settings?.autoCcAddress || '');
  }

  function domainOf(email) {
    const normalized = normalizeEmail(email);
    if (!normalized || !normalized.includes('@')) return '';
    return normalized.split('@').pop();
  }

  function uniqueEmails(values) {
    const seen = new Set();
    const result = [];
    for (const value of values || []) {
      const email = normalizeEmail(value);
      if (!email || seen.has(email)) continue;
      seen.add(email);
      result.push(email);
    }
    return result;
  }

  function groupEmailsByDomain(values) {
    const groups = {};
    for (const email of uniqueEmails(values)) {
      const domain = domainOf(email) || '(unknown)';
      if (!groups[domain]) groups[domain] = [];
      groups[domain].push(email);
    }
    return Object.fromEntries(
      Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))
    );
  }

  function normalizeKeywords(customKeywords) {
    const base = Array.isArray(customKeywords) ? customKeywords : [];
    const cleaned = base
      .map((keyword) => String(keyword || '').trim())
      .filter(Boolean);
    return Array.from(new Set(['添付', ...cleaned]));
  }

  function findAttachmentKeywords(subject, body, keywords) {
    const source = `${subject || ''}\n${body || ''}`;
    const normalizedKeywords = normalizeKeywords(keywords);
    return normalizedKeywords.filter((keyword) => source.includes(keyword));
  }

  function evaluateSubject(subject, confirmed) {
    const trimmed = String(subject || '').trim();
    if (!trimmed) {
      return {
        level: 'error',
        ok: false,
        label: '件名：未入力',
        reason: 'subject_empty'
      };
    }
    if (confirmed) {
      return {
        level: 'ok',
        ok: true,
        label: '件名：確認済み',
        reason: 'subject_confirmed'
      };
    }
    return {
      level: 'warn',
      ok: true,
      label: '件名：入力あり / 要確認',
      reason: 'subject_needs_human_check'
    };
  }

  function evaluateAttachment(subject, body, attachmentCount, keywords) {
    const hits = findAttachmentKeywords(subject, body, keywords);
    const count = Number(attachmentCount || 0);
    if (hits.length > 0 && count <= 0) {
      return {
        level: 'warn',
        ok: false,
        label: `添付：本文または件名に「${hits[0]}」がありますが、添付ファイルなし`,
        reason: 'attachment_keyword_without_file',
        hits
      };
    }
    if (count > 0) {
      return {
        level: 'ok',
        ok: true,
        label: `添付：あり（${count}件）`,
        reason: 'attachment_present',
        hits
      };
    }
    return {
      level: 'muted',
      ok: true,
      label: '添付：キーワードなし',
      reason: 'attachment_not_required',
      hits
    };
  }

  function evaluateAutoRecipientState(settings, snapshot, state, config) {
    if (!settings[config.enabledKey]) {
      return { status: 'muted', reason: 'disabled' };
    }
    const targets = config.getTargets(settings);
    if (targets.length === 0) {
      return { status: 'warn', reason: 'no_target' };
    }
    if (state && state[config.pendingKey]) {
      return { status: 'warn', reason: 'pending', targets };
    }
    if (state && state[config.failedKey]) {
      return { status: 'warn', reason: 'failed', targets };
    }
    const allEmails = uniqueEmails([
      ...(snapshot.recipients.to || []),
      ...(snapshot.recipients.cc || []),
      ...(snapshot.recipients.bcc || [])
    ]);
    const fieldEmails = uniqueEmails(snapshot.recipients[config.field] || []);
    const missingTargets = targets.filter((target) => {
      if (fieldEmails.includes(target)) return false;
      if (settings[config.skipKey] && allEmails.includes(target)) return false;
      return true;
    });
    if (missingTargets.length > 0) {
      return { status: 'warn', reason: 'missing', targets, missingTargets, target: missingTargets[0] };
    }
    const alreadyPresent = targets.some((target) => !fieldEmails.includes(target) && allEmails.includes(target));
    return { status: 'ok', reason: alreadyPresent ? 'already_present' : 'present', targets, target: targets[0] };
  }

  function evaluateAutoBccState(settings, snapshot, state) {
    return evaluateAutoRecipientState(settings, snapshot, state, {
      field: 'bcc',
      enabledKey: 'autoBccEnabled',
      pendingKey: 'autoBccPending',
      failedKey: 'autoBccFailed',
      skipKey: 'autoBccSkipIfSelfAlreadyPresent',
      getTargets: getAutoBccTargets
    });
  }

  function evaluateAutoCcState(settings, snapshot, state) {
    return evaluateAutoRecipientState(settings, snapshot, state, {
      field: 'cc',
      enabledKey: 'autoCcEnabled',
      pendingKey: 'autoCcPending',
      failedKey: 'autoCcFailed',
      skipKey: 'autoCcSkipIfSelfAlreadyPresent',
      getTargets: getAutoCcTargets
    });
  }

  function getPendingAutoRecipientTargets(settings, snapshot, config) {
    if (!settings[config.enabledKey]) return [];
    const targets = config.getTargets(settings);
    if (targets.length === 0) return [];

    const allEmails = uniqueEmails([
      ...(snapshot.recipients.to || []),
      ...(snapshot.recipients.cc || []),
      ...(snapshot.recipients.bcc || [])
    ]);

    const fieldEmails = uniqueEmails(snapshot.recipients[config.field] || []);
    return targets.filter((target) => {
      if (fieldEmails.includes(target)) return false;
      if (settings[config.skipKey] && allEmails.includes(target)) return false;
      return true;
    });
  }

  function getPendingAutoBccTargets(settings, snapshot) {
    return getPendingAutoRecipientTargets(settings, snapshot, {
      field: 'bcc',
      enabledKey: 'autoBccEnabled',
      skipKey: 'autoBccSkipIfSelfAlreadyPresent',
      getTargets: getAutoBccTargets
    });
  }

  function getPendingAutoCcTargets(settings, snapshot) {
    return getPendingAutoRecipientTargets(settings, snapshot, {
      field: 'cc',
      enabledKey: 'autoCcEnabled',
      skipKey: 'autoCcSkipIfSelfAlreadyPresent',
      getTargets: getAutoCcTargets
    });
  }

  function shouldInjectBcc(settings, snapshot) {
    return getPendingAutoBccTargets(settings, snapshot).length > 0;
  }

  function shouldInjectCc(settings, snapshot) {
    return getPendingAutoCcTargets(settings, snapshot).length > 0;
  }

  return {
    normalizeEmail,
    normalizeEmailList,
    getAutoCcTargets,
    getAutoBccTargets,
    domainOf,
    uniqueEmails,
    groupEmailsByDomain,
    normalizeKeywords,
    findAttachmentKeywords,
    evaluateSubject,
    evaluateAttachment,
    evaluateAutoCcState,
    evaluateAutoBccState,
    getPendingAutoCcTargets,
    getPendingAutoBccTargets,
    shouldInjectCc,
    shouldInjectBcc
  };
});
