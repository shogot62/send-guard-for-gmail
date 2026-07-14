// extension/gmail_dom.js
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.GmailSendGuardDom = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function isVisible(el) {
    if (!el) return false;
    if (el.closest && el.closest('[hidden]')) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }

  // --- Compose root element scoring ---

  const SUBJECT_SELECTORS = [
    'input[name="subjectbox"]',
    'input[aria-label="Subject"]',
    'input[aria-label*="Subject"]',
    'input[aria-label*="件名"]',
    'input[placeholder="Subject"]',
    'input[placeholder*="Subject"]',
    'input[placeholder*="件名"]',
    'input[name*="subject" i]'
  ];

  const BODY_SELECTORS = [
    'div[aria-label="Message Body"][contenteditable="true"]',
    'div[aria-label*="本文"][contenteditable="true"]',
    'div[contenteditable="true"][role="textbox"]',
    'div[g_editable="true"]'
  ];

  const SEND_BUTTON_SELECTORS = [
    '.T-I.J-J5-Ji.aoO.v7.T-I-atl.L3',
    'div[role="button"][data-tooltip^="Send"]',
    'div[role="button"][data-tooltip^="send"]',
    'div[role="button"][data-tooltip^="送信"]',
    'div[role="button"][aria-label^="Send"]',
    'div[role="button"][aria-label^="send"]',
    'div[role="button"][aria-label^="送信"]'
  ];

  const RECIPIENT_SELECTORS = [
    'div[name="to"]', 'textarea[name="to"]', 'input[name="to"]',
    'div[name="cc"]', 'textarea[name="cc"]', 'input[name="cc"]',
    'div[name="bcc"]', 'textarea[name="bcc"]', 'input[name="bcc"]',
    '[aria-label*="To"]', '[aria-label*="宛先"]',
    '[aria-label*="Cc"]', '[aria-label*="CC"]',
    '[aria-label*="Bcc"]', '[aria-label*="BCC"]'
  ];

  const ATTACHMENT_SELECTORS = [
    '[role="listitem"]', '.vI', '.vZ', '.dQ'
  ];

  function containsAny(el, selectors) {
    for (const sel of selectors) {
      if (el.querySelector(sel)) return true;
    }
    return false;
  }

  function containsRecipientEditorHint(el) {
    const candidates = Array.from(el.querySelectorAll('.reply-recipient-summary, button, [role="button"], span, div'));
    for (const cand of candidates) {
      if (isInsideEditableBody(cand)) continue;
      const text = directTextForClickableCandidate(cand);
      if (/\bto:?\b/i.test(text) || /宛先|受信者|recipients?|recipient/i.test(text)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Score a candidate compose root element.
   * Higher score = better root candidate.
   */
  function scoreComposeRoot(el, doc) {
    if (!el || el === doc.body || el === doc.documentElement) return -100;
    if (!el.querySelector) return -100;

    let score = 0;

    // +5: 件名欄を含む
    if (containsAny(el, SUBJECT_SELECTORS)) score += 5;
    // +4: 宛先欄を含む
    if (containsAny(el, RECIPIENT_SELECTORS)) score += 4;
    // +4: 本文欄を含む
    if (containsAny(el, BODY_SELECTORS)) score += 4;
    // +4: 送信ボタンを含む
    if (containsAny(el, SEND_BUTTON_SELECTORS)) score += 4;
    // +3: role="dialog"
    if (el.getAttribute('role') === 'dialog') score += 3;
    // +2: 添付領域候補を含む
    if (containsAny(el, ATTACHMENT_SELECTORS)) score += 2;
    // +1: collapsed reply recipient editor control/summary
    if (containsRecipientEditorHint(el)) score += 1;

    return score;
  }

  /**
   * Minimum requirements: must contain body + send button.
   */
  function isMinimalComposeRoot(el, doc) {
    if (!el || el === doc.body || el === doc.documentElement) return false;
    if (!el.querySelector) return false;
    const hasBody = containsAny(el, BODY_SELECTORS);
    const hasSend = containsAny(el, SEND_BUTTON_SELECTORS);
    return hasBody && hasSend;
  }

  function isAutoRecipientComposeRoot(el, doc) {
    if (!el || el === doc.body || el === doc.documentElement) return false;
    if (!el.querySelector) return false;
    const hasBody = containsAny(el, BODY_SELECTORS);
    if (!hasBody) return false;
    const hasRecipientUi = containsAny(el, RECIPIENT_SELECTORS) || containsRecipientEditorHint(el);
    const hasSend = containsAny(el, SEND_BUTTON_SELECTORS);
    return hasRecipientUi || hasSend;
  }

  function pickBestComposeRootFromSeed(seed, doc, predicate) {
    const ancestors = [];
    let current = seed;
    for (let depth = 0; depth < 20 && current && current !== doc.body && current !== doc.documentElement; depth++) {
      if (predicate(current, doc)) {
        ancestors.push(current);
      }
      current = current.parentElement;
    }

    if (ancestors.length === 0) return null;

    const anyHasSubject = ancestors.some(c => containsAny(c, SUBJECT_SELECTORS));
    let bestRoot = null;
    let bestScore = -Infinity;

    for (const cand of ancestors) {
      let score = scoreComposeRoot(cand, doc);
      if (anyHasSubject && !containsAny(cand, SUBJECT_SELECTORS)) {
        score -= 5;
      }
      if (score > bestScore) {
        bestScore = score;
        bestRoot = cand;
      }
    }

    return bestRoot;
  }

  function dedupeComposeRoots(candidateList, doc) {
    const result = [];
    for (const root of candidateList) {
      let dominated = false;
      for (const other of candidateList) {
        if (other === root) continue;
        if (other.contains(root)) {
          const outerScore = scoreComposeRoot(other, doc);
          const innerScore = scoreComposeRoot(root, doc);
          if (outerScore >= innerScore) {
            dominated = true;
            break;
          }
        }
      }
      if (!dominated) {
        result.push(root);
      }
    }

    return result;
  }

  /**
   * P0-2: Find the optimal compose root from a send button.
   * Collect ALL valid ancestor candidates, score them, then pick the best.
   * If an upper candidate contains subject but a lower one doesn't,
   * penalize the lower candidate.
   */
  function findComposeRootFromSendButton(sendBtn, doc) {
    if (!sendBtn) return null;
    const candidates = [];
    let current = sendBtn.parentElement;

    for (let depth = 0; depth < 15 && current && current !== doc.body && current !== doc.documentElement; depth++) {
      if (isMinimalComposeRoot(current, doc)) {
        candidates.push(current);
      }
      current = current.parentElement;
    }

    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    // Check if any upper candidate has subject
    const anyHasSubject = candidates.some(c => containsAny(c, SUBJECT_SELECTORS));

    let bestRoot = null;
    let bestScore = -Infinity;

    for (const cand of candidates) {
      let score = scoreComposeRoot(cand, doc);

      // P0-2 penalty: if this candidate lacks subject but a containing
      // candidate has subject, penalize this one
      if (anyHasSubject && !containsAny(cand, SUBJECT_SELECTORS)) {
        score -= 5;
      }

      if (score > bestScore) {
        bestScore = score;
        bestRoot = cand;
      }
    }

    return bestRoot;
  }

  /**
   * P0-3: Find all compose roots in the document.
   * After collecting candidates, deduplicate by containment:
   * if outer root contains inner root AND outer has subject/recipient/body/send,
   * discard the inner root.
   */
  function findComposeRoots(doc) {
    const seeds = Array.from(doc.querySelectorAll(
      SUBJECT_SELECTORS.join(', ') + ', ' + BODY_SELECTORS.join(', ')
    ));
    const candidateSet = new Set();
    const candidateList = [];

    for (const seed of seeds) {
      // For each seed, find the best root via scoring (same logic as sendButton)
      const ancestors = [];
      let current = seed;
      for (let depth = 0; depth < 15 && current && current !== doc.body && current !== doc.documentElement; depth++) {
        if (isMinimalComposeRoot(current, doc)) {
          ancestors.push(current);
        }
        current = current.parentElement;
      }

      if (ancestors.length === 0) continue;

      // Pick the best scored ancestor
      const anyHasSubject = ancestors.some(c => containsAny(c, SUBJECT_SELECTORS));
      let bestRoot = null;
      let bestScore = -Infinity;

      for (const cand of ancestors) {
        let score = scoreComposeRoot(cand, doc);
        if (anyHasSubject && !containsAny(cand, SUBJECT_SELECTORS)) {
          score -= 5;
        }
        if (score > bestScore) {
          bestScore = score;
          bestRoot = cand;
        }
      }

      if (bestRoot && !candidateSet.has(bestRoot) && isVisible(bestRoot)) {
        candidateSet.add(bestRoot);
        candidateList.push(bestRoot);
      }
    }

    return dedupeComposeRoots(candidateList, doc);
  }

  function findAutoRecipientComposeRoots(doc) {
    const seeds = Array.from(doc.querySelectorAll(
      SUBJECT_SELECTORS.join(', ') + ', ' +
      BODY_SELECTORS.join(', ') + ', ' +
      RECIPIENT_SELECTORS.join(', ') + ', ' +
      SEND_BUTTON_SELECTORS.join(', ')
    ));
    const candidateSet = new Set();
    const candidateList = [];

    for (const seed of seeds) {
      const bestRoot = pickBestComposeRootFromSeed(seed, doc, isAutoRecipientComposeRoot);
      if (bestRoot && !candidateSet.has(bestRoot) && isVisible(bestRoot)) {
        candidateSet.add(bestRoot);
        candidateList.push(bestRoot);
      }
    }

    return dedupeComposeRoots(candidateList, doc);
  }

  // --- Subject reading ---

  function findSubjectElement(root, doc) {
    for (const selector of SUBJECT_SELECTORS) {
      const els = root.querySelectorAll(selector);
      for (const el of els) {
        if (isVisible(el)) return el;
      }
    }
    // Fallback: non-visible
    for (const selector of SUBJECT_SELECTORS) {
      const el = root.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  function readSubject(root, doc) {
    const info = readSubjectInfo(root, doc);
    return info.value;
  }

  /**
   * P0-4: Read subject with source/confidence metadata.
   * Tries multiple strategies in order.
   */
  function readSubjectInfo(root, doc) {
    // Strategy 1: subjectbox inside compose root
    const subjectEl = findSubjectElement(root, doc);
    if (subjectEl) {
      const value = (typeof subjectEl.value === 'string' && subjectEl.value !== '')
        ? subjectEl.value
        : (subjectEl.textContent || subjectEl.innerText || '');
      return {
        value: value,
        source: 'subjectbox',
        available: true,
        confidence: 'high'
      };
    }

    // Strategy 2: compose-header text (e.g. popout header with subject display)
    const headerCandidates = root.querySelectorAll('[data-subject], .hP, .ha h2, .nH h2');
    for (const hc of headerCandidates) {
      const subjectAttr = hc.getAttribute('data-subject');
      if (subjectAttr) {
        return { value: subjectAttr, source: 'compose-header', available: true, confidence: 'medium' };
      }
      const text = (hc.textContent || '').trim();
      if (text) {
        return { value: text, source: 'compose-header', available: true, confidence: 'medium' };
      }
    }

    // Strategy 3: thread-header near the compose root
    // Walk up from root to find a thread container, then look for subject
    let ancestor = root.parentElement;
    for (let depth = 0; depth < 8 && ancestor && ancestor !== doc.body && ancestor !== doc.documentElement; depth++) {
      // Look for thread subject elements within this ancestor but NOT inside another compose root
      const threadSubjects = ancestor.querySelectorAll(
        'h2[data-thread-perm-id], [data-legacy-thread-id] h2, .hP, .ha h2'
      );
      for (const ts of threadSubjects) {
        // Make sure this subject element is not inside a different compose root
        if (root.contains(ts)) continue; // already checked above
        // Check it's not inside a sibling compose
        let isInOtherCompose = false;
        let parent = ts.parentElement;
        while (parent && parent !== ancestor) {
          if (parent !== root && isMinimalComposeRoot(parent, doc)) {
            isInOtherCompose = true;
            break;
          }
          parent = parent.parentElement;
        }
        if (isInOtherCompose) continue;

        const text = (ts.textContent || '').trim();
        if (text) {
          return { value: text, source: 'thread-header', available: true, confidence: 'medium' };
        }
      }

      // Also try message subject headers
      const msgSubjects = ancestor.querySelectorAll('.g3, [data-subject]');
      for (const ms of msgSubjects) {
        if (root.contains(ms)) continue;
        let isInOtherCompose = false;
        let parent = ms.parentElement;
        while (parent && parent !== ancestor) {
          if (parent !== root && isMinimalComposeRoot(parent, doc)) {
            isInOtherCompose = true;
            break;
          }
          parent = parent.parentElement;
        }
        if (isInOtherCompose) continue;

        const subjectAttr = ms.getAttribute('data-subject');
        if (subjectAttr) {
          return { value: subjectAttr, source: 'message-header', available: true, confidence: 'low' };
        }
        const text = (ms.textContent || '').trim();
        if (text && text.length < 200) {
          return { value: text, source: 'message-header', available: true, confidence: 'low' };
        }
      }

      ancestor = ancestor.parentElement;
    }

    // Strategy 4: not found
    return {
      value: '',
      source: 'unknown',
      available: false,
      confidence: 'low'
    };
  }

  // --- Body reading ---

  function findBodyElement(root, doc) {
    for (const selector of BODY_SELECTORS) {
      const el = root.querySelector(selector);
      if (el && isVisible(el)) return el;
    }
    for (const selector of BODY_SELECTORS) {
      const el = root.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  function readBody(root, doc) {
    const bodyEl = findBodyElement(root, doc);
    if (!bodyEl) return '';
    return bodyEl.innerText || bodyEl.textContent || '';
  }

  function readCurrentComposeBody(root, doc) {
    const bodyEl = findBodyElement(root, doc);
    if (!bodyEl) return '';

    // Clone the node to avoid modifying the actual DOM
    const clone = bodyEl.cloneNode(true);

    // Selectors for elements that should be excluded from the "current" body text
    const EXCLUDE_SELECTORS = [
      '.gmail_quote',
      '.gmail_signature',
      '[data-smartmail="gmail_signature"]',
      'blockquote',
      '[aria-label*="quoted" i]',
      '[aria-label*="引用"]'
    ];

    for (const selector of EXCLUDE_SELECTORS) {
      const els = clone.querySelectorAll(selector);
      for (const el of els) {
        el.remove();
      }
    }

    return clone.innerText || clone.textContent || '';
  }

  // --- Recipient reading ---

  function extractAllEmails(str, out) {
    if (!str) return;
    const matches = str.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/g);
    if (matches) {
      for (const m of matches) {
        out.push(m.toLowerCase());
      }
    }
  }

  function collectEmailsFromElement(el, out) {
    if (!el) return;
    const attrs = ['email', 'data-hovercard-id', 'title', 'aria-label', 'value'];
    for (const attr of attrs) {
      const value = el.getAttribute ? el.getAttribute(attr) : '';
      extractAllEmails(value, out);
    }
    if ('value' in el) {
      extractAllEmails(el.value, out);
    }
    extractAllEmails(el.textContent, out);
  }

  function fieldSelectors(field) {
    const jp = field === 'to' ? ['宛先', 'To'] : field === 'cc' ? ['Cc', 'CC'] : ['Bcc', 'BCC'];
    return [
      `div[name="${field}"] [email]`,
      `div[name="${field}"] [data-hovercard-id]`,
      `textarea[name="${field}"]`,
      `input[name="${field}"]`,
      `[aria-label="${field}"] [email]`,
      `[aria-label="${field.toUpperCase()}"] [email]`,
      ...jp.map((label) => `[aria-label*="${label}"] [email]`),
      ...jp.map((label) => `[aria-label*="${label}"] [data-hovercard-id]`)
    ];
  }

  function uniqueEmails(values) {
    const seen = new Set();
    const result = [];
    for (const email of values) {
      if (!email || seen.has(email)) continue;
      seen.add(email);
      result.push(email);
    }
    return result;
  }

  function readRecipientsForField(root, field) {
    const selectors = fieldSelectors(field);
    const values = [];
    for (const selector of selectors) {
      for (const el of root.querySelectorAll(selector)) {
        collectEmailsFromElement(el, values);
      }
    }
    return uniqueEmails(values);
  }

  function readRecipients(root, doc) {
    return {
      to: readRecipientsForField(root, 'to'),
      cc: readRecipientsForField(root, 'cc'),
      bcc: readRecipientsForField(root, 'bcc')
    };
  }

  // --- Attachment reading ---

  const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
  const FILE_EXTENSION_PATTERN = /\.(pdf|xlsx?|docx?|pptx?|zip|rar|txt|csv|png|jpe?g|gif|html|svg|mp3|mp4|wav)(?:\s|$)/i;
  const FILE_NAME_PATTERN = /\.(pdf|xlsx?|docx?|pptx?|zip|rar|txt|csv|png|jpe?g|gif|html|svg|mp3|mp4|wav)$/i;
  const SIZE_PATTERN = /(\b\d[\d,.]*\s*(?:KB|MB|GB|bytes?|B|キロバイト|メガバイト|ギガバイト|バイト)\b|\b\d+\s*B\b)/i;
  const ATTACHMENT_SPECIFIC_DELETE_SELECTOR = '[aria-label*="Remove attachment"], [aria-label*="添付ファイルを削除"]';

  function isEmailLike(value) {
    const text = String(value || '').trim().replace(/^["']|["']$/g, '');
    if (!text || FILE_NAME_PATTERN.test(text)) return false;
    return new RegExp(`^${EMAIL_PATTERN.source}$`, 'i').test(text);
  }

  function collectElementEvidenceText(el) {
    if (!el) return '';
    const parts = [
      el.textContent || '',
      el.getAttribute('aria-label') || '',
      el.getAttribute('title') || '',
      el.getAttribute('data-tooltip') || ''
    ];
    for (const child of el.querySelectorAll('[aria-label], [title], [data-tooltip], [data-hovercard-id], [email]')) {
      parts.push(
        child.getAttribute('aria-label') || '',
        child.getAttribute('title') || '',
        child.getAttribute('data-tooltip') || '',
        child.getAttribute('data-hovercard-id') || '',
        child.getAttribute('email') || ''
      );
    }
    return parts.join(' ');
  }

  function isWithinRecipientArea(el, root) {
    let current = el;
    for (let depth = 0; depth < 6 && current && current !== root; depth++) {
      const label = [
        current.getAttribute('aria-label') || '',
        current.getAttribute('name') || '',
        current.getAttribute('role') || ''
      ].join(' ');
      if (/\b(to|cc|bcc)\b|宛先|受信者/i.test(label)) return true;
      current = current.parentElement;
    }
    return false;
  }

  function isRecipientChipLike(el, root) {
    if (!el) return false;
    if (isWithinRecipientArea(el, root)) return true;
    if (el.matches && el.matches('[email], [data-hovercard-id]')) return true;
    if (el.querySelector('[email]')) return true;
    for (const hovercardEl of el.querySelectorAll('[data-hovercard-id]')) {
      if (isEmailLike(hovercardEl.getAttribute('data-hovercard-id'))) return true;
    }
    const evidence = collectElementEvidenceText(el);
    const hasFileName = FILE_EXTENSION_PATTERN.test(evidence);
    if (!hasFileName && EMAIL_PATTERN.test(evidence)) return true;
    if (!hasFileName && /\b(Remove|Delete)\b\s+[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(evidence)) return true;
    if (!hasFileName && /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\s*を削除/i.test(evidence)) return true;
    return false;
  }

  function readAttachments(root, doc) {
    const attachments = [];
    const seenElements = new Set();

    const allPotentials = new Set();
    for (const el of root.querySelectorAll('[role="listitem"], .vI, .vZ, .dQ')) {
      allPotentials.add(el);
    }

    for (const btn of root.querySelectorAll(ATTACHMENT_SPECIFIC_DELETE_SELECTOR)) {
      let parent = btn.parentElement;
      for (let depth = 0; depth < 4 && parent && parent !== root; depth++) {
        allPotentials.add(parent);
        parent = parent.parentElement;
      }
    }

    const candidates = [];
    for (const el of allPotentials) {
      if (!isVisible(el)) continue;
      if (isRecipientChipLike(el, root)) continue;

      let score = 0;
      const hasAttachmentSpecificDelete = Boolean(el.querySelector(ATTACHMENT_SPECIFIC_DELETE_SELECTOR));
      if (hasAttachmentSpecificDelete) score += 3;

      const text = el.textContent || '';
      const title = el.getAttribute('title') || '';
      const combinedText = collectElementEvidenceText(el);

      const hasFileName = FILE_EXTENSION_PATTERN.test(combinedText);
      if (hasFileName) score += 3;

      const hasSize = SIZE_PATTERN.test(combinedText);
      if (hasSize) score += 2;

      const progressbar = el.querySelector('[role="progressbar"], progress');
      const hasVisibleProgress = Boolean(progressbar && isVisible(progressbar));
      if (hasVisibleProgress) score += 3;

      if (el.getAttribute('role') === 'listitem' && (hasAttachmentSpecificDelete || hasFileName || hasSize || hasVisibleProgress)) score += 1;
      if (title) score += 1;
      if (el.hasAttribute('data-tooltip')) score += 1;

      const isAttachButton = /Attach\s+files|ファイルを添付|Google\s*Drive|ドラフト|挿入|ドラッグ/i.test(combinedText);
      if (isAttachButton) score -= 5;

      const hasStrongAttachmentEvidence = hasAttachmentSpecificDelete || hasFileName || hasSize || hasVisibleProgress;
      if (score >= 3 && hasStrongAttachmentEvidence) {
        candidates.push({ el, score });
      }
    }

    candidates.sort((a, b) => b.score - a.score);

    for (const cand of candidates) {
      let alreadySeen = false;
      for (const seen of seenElements) {
        if (seen.contains(cand.el) || cand.el.contains(seen)) {
          alreadySeen = true;
          break;
        }
      }
      if (alreadySeen) continue;
      seenElements.add(cand.el);

      const el = cand.el;
      let name = '';
      let sizeText = '';
      let status = 'ready';
      let confidence = 'low';

      const text = el.textContent || '';
      const title = el.getAttribute('title') || '';
      const combinedText = collectElementEvidenceText(el);

      // Extract name from delete button aria-label
      let extractedName = '';
      const deleteBtn = el.querySelector(ATTACHMENT_SPECIFIC_DELETE_SELECTOR);
      if (deleteBtn) {
        const ariaLabel = deleteBtn.getAttribute('aria-label') || '';
        let cleaned = ariaLabel;
        // P1: fix "Remove attachment - filename" leaving "- " prefix
        cleaned = cleaned.replace(/Remove\s+attachment\s*[-:]?\s*/i, '');
        cleaned = cleaned.replace(/添付ファイルを削除\s*[-:]?\s*/i, '');
        cleaned = cleaned.replace(/を削除/i, '');
        cleaned = cleaned.trim();
        cleaned = cleaned.replace(/^["']|["']$/g, '');
        if (cleaned) {
          extractedName = cleaned;
        }
      }

      if (!extractedName && title) {
        extractedName = title.trim();
      }

      if (!extractedName) {
        const tokens = combinedText.split(/\s+/);
        for (const tok of tokens) {
          const cleanTok = tok.replace(/^["'「（(]|["'」、）),:;]$/g, '').trim();
          if (FILE_NAME_PATTERN.test(cleanTok)) {
            extractedName = cleanTok;
            break;
          }
        }
      }

      if (isEmailLike(extractedName)) {
        extractedName = '';
      }
      name = extractedName.trim();

      const sizeMatch = combinedText.match(SIZE_PATTERN);
      if (sizeMatch) {
        sizeText = sizeMatch[1].trim();
      }

      let isUploading = false;
      const progressbar = el.querySelector('[role="progressbar"], progress');
      const hasUploadingText = /uploading|アップロード中/i.test(combinedText);

      if (hasUploadingText) {
        isUploading = true;
      } else if (progressbar) {
        // Only if it's visible or has specific uploading values
        if (isVisible(progressbar)) {
          if (progressbar.hasAttribute('value') && progressbar.hasAttribute('max')) {
            const val = parseFloat(progressbar.getAttribute('value'));
            const max = parseFloat(progressbar.getAttribute('max'));
            if (val < max) isUploading = true;
          } else if (progressbar.hasAttribute('aria-valuenow')) {
            const val = parseFloat(progressbar.getAttribute('aria-valuenow'));
            if (val < 100) isUploading = true;
          } else {
            // Indeterminate progressbar
            isUploading = true;
          }
        }
      }

      if (isUploading) {
        status = 'uploading';
      } else if (name) {
        status = 'ready';
      } else {
        // P1: unknown only if there is some attachment evidence (delete button, size, etc.)
        const hasEvidence = cand.score >= 5;
        status = hasEvidence ? 'unknown' : 'ready';
        if (!hasEvidence && !name) {
          // Skip this candidate entirely - not enough evidence
          seenElements.delete(cand.el);
          continue;
        }
        status = 'unknown';
      }

      if (name && sizeText) {
        confidence = 'high';
      } else if (name) {
        confidence = 'medium';
      } else {
        confidence = 'low';
      }

      attachments.push({
        name,
        sizeText,
        status,
        confidence,
        detected: true
      });
    }

    return attachments;
  }

  function countAttachments(root, doc) {
    return readAttachments(root, doc).length;
  }

  // --- Recipient compose helpers ---

  function recipientFieldLabels(field) {
    if (field === 'cc') return ['Cc', 'CC'];
    if (field === 'bcc') return ['Bcc', 'BCC', '秘密のコピー'];
    return ['To', '宛先'];
  }

  function recipientTogglePattern(field) {
    if (field === 'cc') return /^(cc|cc:)$/i;
    if (field === 'bcc') return /^(bcc|bcc:)$/i;
    return /^(to|to:)$/i;
  }

  function findRecipientInput(root, doc, field) {
    const labels = recipientFieldLabels(field);
    const labelSelectors = labels.flatMap((label) => [
      `input[aria-label*="${label}" i]`,
      `textarea[aria-label*="${label}" i]`,
      `div[aria-label*="${label}" i][contenteditable="true"]`,
      `[role="textbox"][aria-label*="${label}" i]`,
      `[aria-label*="${label}"] input`,
      `[aria-label*="${label}"] textarea`
    ]);
    const selectors = [
      ...labelSelectors,
      `textarea[name="${field}"]`,
      `input[name="${field}"]`,
      `div[name="${field}"] textarea`,
      `div[name="${field}"] input`
    ];
    for (const selector of selectors) {
      const els = root.querySelectorAll(selector);
      for (const el of els) {
        if (isVisible(el)) return el;
      }
    }
    return null;
  }

  function findCcInput(root, doc) {
    return findRecipientInput(root, doc, 'cc');
  }

  function findBccInput(root, doc) {
    return findRecipientInput(root, doc, 'bcc');
  }

  function textForClickableCandidate(el) {
    return [
      el.textContent || '',
      el.getAttribute('aria-label') || '',
      el.getAttribute('data-tooltip') || '',
      el.getAttribute('title') || ''
    ].join(' ').replace(/\s+/g, ' ').trim();
  }

  function directTextForClickableCandidate(el) {
    const directText = Array.from(el.childNodes || [])
      .filter((node) => node.nodeType === 3)
      .map((node) => node.textContent || '')
      .join(' ');
    return [
      directText,
      el.getAttribute('aria-label') || '',
      el.getAttribute('data-tooltip') || '',
      el.getAttribute('title') || ''
    ].join(' ').replace(/\s+/g, ' ').trim();
  }

  function isInsideEditableBody(el) {
    return Boolean(el.closest && el.closest('[contenteditable="true"]'));
  }

  function isUnsafeAutoBccClickTarget(el) {
    if (!el || !el.getAttribute) return true;
    if (isInsideEditableBody(el)) return true;
    const tagName = String(el.tagName || '').toLowerCase();
    const text = textForClickableCandidate(el);
    if (tagName === 'a' && el.getAttribute('href')) return true;
    if (/送信|\bsend\b/i.test(text)) return true;
    if (/添付|attach|attachment|google\s*drive|drive/i.test(text)) return true;
    return false;
  }

  function isRecipientToggleCandidate(el) {
    if (!el || !el.getAttribute) return false;
    const tagName = String(el.tagName || '').toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (tagName === 'button' || tagName === 'a') return true;
    if (role === 'button' || role === 'link') return true;
    if (el.hasAttribute('tabindex')) return true;
    const className = String(el.className || '');
    return /\b(gO|aQY|aB|gQ)\b/.test(className);
  }

  function activateRecipientControl(el) {
    if (!el) return false;
    try {
      if (typeof el.focus === 'function') el.focus();
    } catch (e) {
      // Ignore focus failures from Gmail-managed controls.
    }
    if (typeof el.click === 'function') {
      el.click();
      return true;
    }
    try {
      const view = el.ownerDocument && el.ownerDocument.defaultView;
      const EventCtor = view && view.MouseEvent ? view.MouseEvent : MouseEvent;
      el.dispatchEvent(new EventCtor('click', { bubbles: true, cancelable: true, view }));
    } catch (e) {
      return false;
    }
    return true;
  }

  function findRecipientToggle(root, doc, field) {
    const labels = recipientFieldLabels(field);
    const togglePattern = recipientTogglePattern(field);
    const candidates = Array.from(root.querySelectorAll('button, [role="button"], span, div, a'));
    let best = null;
    let bestScore = -Infinity;
    for (const el of candidates) {
      if (!isRecipientToggleCandidate(el)) continue;
      if (!isVisible(el) || isUnsafeAutoBccClickTarget(el)) continue;
      const text = directTextForClickableCandidate(el);
      const allText = textForClickableCandidate(el);
      if (togglePattern.test(text) || labels.some((label) => text.includes(label))) {
        let score = 0;
        if (togglePattern.test(text)) score += 6;
        if (/宛先を追加|add\s+(cc|bcc)|add\s+recipients?/i.test(allText)) score += 4;
        if (/連絡先を選択|contacts?/i.test(allText)) score -= 3;
        if (el.getAttribute('role') === 'link' || el.getAttribute('role') === 'button') score += 1;
        if (score > bestScore) {
          bestScore = score;
          best = el;
        }
      }
    }
    return best;
  }

  function findCcToggle(root, doc) {
    return findRecipientToggle(root, doc, 'cc');
  }

  function findBccToggle(root, doc) {
    return findRecipientToggle(root, doc, 'bcc');
  }

  function findRecipientEditorExpander(root, doc) {
    const selectors = [
      '.reply-recipient-summary',
      '.aoD.hl',
      '.aoD',
      '[aria-label*="宛先"]',
      '[aria-label*="受信者"]',
      '[aria-label*="To"]',
      '[aria-label*="recipients" i]',
      '[aria-label*="recipient" i]',
      '[data-tooltip*="宛先"]',
      '[data-tooltip*="受信者"]',
      '[data-tooltip*="To"]',
      '[data-tooltip*="recipients" i]',
      '[data-tooltip*="recipient" i]',
      'button',
      '[role="button"]',
      'span',
      'div'
    ];
    const seen = new Set();
    const candidates = [];
    for (const selector of selectors) {
      for (const el of root.querySelectorAll(selector)) {
        if (seen.has(el)) continue;
        seen.add(el);
        candidates.push(el);
      }
    }

    for (const el of candidates) {
      if (!isVisible(el) || isUnsafeAutoBccClickTarget(el)) continue;
      const text = directTextForClickableCandidate(el);
      if (/\bto:?\b/i.test(text) || /宛先|受信者|recipients?|recipient/i.test(text)) {
        return el;
      }
      if (el.matches && el.matches('.aoD') && el.querySelector('[email], [data-hovercard-id]')) {
        return el;
      }
    }
    return null;
  }

  function expandRecipientEditor(root, doc) {
    const expander = findRecipientEditorExpander(root, doc);
    if (!expander) return false;
    return activateRecipientControl(expander);
  }

  function ensureRecipientVisible(root, doc, field) {
    if (findRecipientInput(root, doc, field)) return true;

    const firstToggle = findRecipientToggle(root, doc, field);
    if (firstToggle) {
      activateRecipientControl(firstToggle);
      if (findRecipientInput(root, doc, field)) return true;
      return false;
    }

    expandRecipientEditor(root, doc);
    if (findRecipientInput(root, doc, field)) return true;

    const secondToggle = findRecipientToggle(root, doc, field);
    if (secondToggle) {
      activateRecipientControl(secondToggle);
    }
    return Boolean(findRecipientInput(root, doc, field));
  }

  function ensureCcVisible(root, doc) {
    return ensureRecipientVisible(root, doc, 'cc');
  }

  function ensureBccVisible(root, doc) {
    return ensureRecipientVisible(root, doc, 'bcc');
  }

  return {
    isVisible,
    findComposeRootFromSendButton,
    findComposeRoots,
    findAutoRecipientComposeRoots,
    findSubjectElement,
    readSubject,
    readSubjectInfo,
    findBodyElement,
    readBody,
    readCurrentComposeBody,
    readRecipients,
    readAttachments,
    countAttachments,
    findRecipientInput,
    findCcInput,
    findBccInput,
    findRecipientToggle,
    findCcToggle,
    findBccToggle,
    findRecipientEditorExpander,
    expandRecipientEditor,
    ensureRecipientVisible,
    ensureCcVisible,
    ensureBccVisible
  };
});
