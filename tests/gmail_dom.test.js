// tests/gmail_dom.test.js
const assert = require('assert');
const { JSDOM } = require('jsdom');
const path = require('path');
const fs = require('fs');

// Load gmail_dom.js
const domScript = fs.readFileSync(path.join(__dirname, '../extension/gmail_dom.js'), 'utf8');
const scriptEl = new JSDOM('').window.document.createElement('script');
scriptEl.textContent = domScript;
const window = new JSDOM(`<!DOCTYPE html><html><head></head><body></body></html>`, { runScripts: "dangerously" }).window;
window.document.head.appendChild(scriptEl);

const domLayer = window.GmailSendGuardDom;

function setupMockDocument(html) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`);
  // Mock visibility for JSDOM
  dom.window.HTMLElement.prototype.getBoundingClientRect = function() {
    return { width: 100, height: 100, top: 0, left: 0, bottom: 100, right: 100 };
  };
  Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetParent', {
    get() { return this.parentNode; }
  });
  return dom.window.document;
}

async function runTests() {
  let passed = 0;
  let failed = 0;
  const promises = [];

  function run(name, fn) {
    const p = (async () => {
        try {
          const result = fn();
          if (result instanceof Promise) {
              await result;
          }
          console.log(`PASS ${name}`);
          passed++;
        } catch (e) {
          console.error(`FAIL ${name}`);
          console.error(e);
          failed++;
        }
    })();
    promises.push(p);
  }

  // === Basic subject reading ===

  run('gmailDom reads subject from active compose', () => {
    const doc = setupMockDocument(`
      <div role="dialog">
        <input name="subjectbox" value="Test Subject">
        <div aria-label="Message Body" contenteditable="true">Body text</div>
        <div role="button" data-tooltip="Send"></div>
      </div>
    `);
    const roots = domLayer.findComposeRoots(doc);
    assert.strictEqual(roots.length, 1);
    const subject = domLayer.readSubject(roots[0], doc);
    assert.strictEqual(subject, "Test Subject");
  });

  run('gmailDom does not read subject from another compose', () => {
    const doc = setupMockDocument(`
      <div role="dialog" id="c1">
        <input name="subjectbox" value="Active Subject">
        <div aria-label="Message Body" contenteditable="true">Body text</div>
        <div role="button" data-tooltip="Send" id="send1"></div>
      </div>
      <div role="dialog" id="c2">
        <input name="subjectbox" value="Other Subject">
        <div aria-label="Message Body" contenteditable="true">Body text</div>
        <div role="button" data-tooltip="Send" id="send2"></div>
      </div>
    `);
    const send1 = doc.getElementById('send1');
    const root1 = domLayer.findComposeRootFromSendButton(send1, doc);
    assert.strictEqual(root1.id, 'c1');
    const subject = domLayer.readSubject(root1, doc);
    assert.strictEqual(subject, "Active Subject");
  });

  // === BCC reading ===

  run('gmailDom reads bcc chip email', () => {
    const doc = setupMockDocument(`
      <div role="dialog">
        <input name="subjectbox" value="Subject">
        <div aria-label="Message Body" contenteditable="true">Body</div>
        <div role="button" data-tooltip="Send"></div>
        <div aria-label="Bcc">
           <span email="bcc1@example.com">bcc1</span>
           <span data-hovercard-id="bcc2@example.com">bcc2</span>
        </div>
      </div>
    `);
    const root = doc.querySelector('[role="dialog"]');
    const recipients = domLayer.readRecipients(root, doc);
    assert.deepStrictEqual(Array.from(recipients.bcc), ["bcc1@example.com", "bcc2@example.com"]);
  });

  // === Attachment counting ===

  run('gmailDom does not count attach button as attachment', () => {
    const doc = setupMockDocument(`
      <div role="dialog">
        <input name="subjectbox" value="Subject">
        <div aria-label="Message Body" contenteditable="true">Body</div>
        <div role="button" data-tooltip="Send"></div>
        <div role="button" aria-label="Attach files"></div>
        <div role="listitem">
          <div aria-label="Remove attachment file.txt"></div>
        </div>
        <div role="listitem">
          <div aria-label="添付ファイルを削除 document.pdf"></div>
        </div>
      </div>
    `);
    const root = doc.querySelector('[role="dialog"]');
    const count = domLayer.countAttachments(root, doc);
    assert.strictEqual(count, 2);
  });

  // === Inline reply compose detection ===

  run('gmailDom detects inline reply compose without subject input', () => {
    const doc = setupMockDocument(`
      <div class="reply-compose">
        <div class="toolbar">
          <div role="button" data-tooltip="送信"></div>
        </div>
        <div contenteditable="true" role="textbox" aria-label="本文">本文</div>
      </div>
    `);
    const roots = domLayer.findComposeRoots(doc);
    assert.strictEqual(roots.length, 1);
    assert.strictEqual(roots[0].className, 'reply-compose');
  });

  run('gmailDom finds root from send button when compose has body but no subject input', () => {
    const doc = setupMockDocument(`
      <div class="reply-compose">
        <div class="toolbar">
          <div role="button" data-tooltip="送信" id="sendBtn"></div>
        </div>
        <div contenteditable="true" role="textbox" aria-label="本文">本文</div>
      </div>
    `);
    const btn = doc.getElementById('sendBtn');
    const root = domLayer.findComposeRootFromSendButton(btn, doc);
    assert.ok(root);
    assert.strictEqual(root.className, 'reply-compose');
  });

  run('gmailDom prefers outer reply root when recipient controls are outside body/send area', () => {
    const doc = setupMockDocument(`
      <div class="reply-compose" id="outerReply">
        <div id="recipientSummary">To: client@example.com</div>
        <div id="recipientEditor" hidden>
          <button id="bccToggle">Bcc</button>
        </div>
        <div id="replyBodyArea">
          <div class="toolbar">
            <div role="button" data-tooltip="送信" id="sendBtn"></div>
          </div>
          <div contenteditable="true" role="textbox" aria-label="本文">本文</div>
        </div>
      </div>
    `);
    const sendBtn = doc.getElementById('sendBtn');
    const root = domLayer.findComposeRootFromSendButton(sendBtn, doc);
    assert.ok(root);
    assert.strictEqual(root.id, 'outerReply');

    const roots = domLayer.findComposeRoots(doc);
    assert.strictEqual(roots.length, 1);
    assert.strictEqual(roots[0].id, 'outerReply');
  });

  run('gmailDom does not return document.body as compose root', () => {
    const doc = setupMockDocument(`
      <div role="button" data-tooltip="送信" id="sendBtn"></div>
    `);
    const btn = doc.getElementById('sendBtn');
    const root = domLayer.findComposeRootFromSendButton(btn, doc);
    assert.strictEqual(root, null);
  });

  run('gmailDom does not treat Japanese more-send-options button as send button', () => {
    const doc = setupMockDocument(`
      <div class="reply-compose">
        <div contenteditable="true" role="textbox">Body</div>
        <div role="button" data-tooltip="その他の送信オプション" aria-label="その他の送信オプション"></div>
      </div>
    `);
    const roots = domLayer.findComposeRoots(doc);
    assert.strictEqual(roots.length, 0);
  });

  run('gmailDom handles multiple inline compose roots independently', () => {
    const doc = setupMockDocument(`
      <div class="reply-compose" id="r1">
        <div role="button" data-tooltip="送信" id="send1"></div>
        <div contenteditable="true" role="textbox">Body 1</div>
      </div>
      <div class="reply-compose" id="r2">
        <div role="button" data-tooltip="送信" id="send2"></div>
        <div contenteditable="true" role="textbox">Body 2</div>
      </div>
    `);
    const send1 = doc.getElementById('send1');
    const send2 = doc.getElementById('send2');
    const root1 = domLayer.findComposeRootFromSendButton(send1, doc);
    const root2 = domLayer.findComposeRootFromSendButton(send2, doc);
    assert.strictEqual(root1.id, 'r1');
    assert.strictEqual(root2.id, 'r2');
  });

  // === P0-2: Compose root scoring tests ===

  run('new compose nested lower area does not become compose root when outer root has subject', () => {
    const doc = setupMockDocument(`
      <div role="dialog" id="outer-compose">
        <div class="headers">
          <textarea name="to"></textarea>
          <input name="subjectbox" value="件名あり">
        </div>
        <div id="lower-compose-area">
          <div contenteditable="true" role="textbox">本文</div>
          <div role="button" data-tooltip="Send" id="send"></div>
        </div>
      </div>
    `);
    const sendBtn = doc.getElementById('send');
    const root = domLayer.findComposeRootFromSendButton(sendBtn, doc);
    assert.ok(root);
    assert.strictEqual(root.id, 'outer-compose');
  });

  run('findComposeRoots returns only outer root for new compose with subject/header/body/footer', () => {
    const doc = setupMockDocument(`
      <div role="dialog" id="outer-compose">
        <div class="headers">
          <textarea name="to"></textarea>
          <input name="subjectbox" value="件名あり">
        </div>
        <div id="lower-compose-area">
          <div contenteditable="true" role="textbox">本文</div>
          <div role="button" data-tooltip="Send"></div>
        </div>
      </div>
    `);
    const roots = domLayer.findComposeRoots(doc);
    assert.strictEqual(roots.length, 1);
    assert.strictEqual(roots[0].id, 'outer-compose');
  });

  run('findComposeRootFromSendButton returns outer root for new compose with nested body/footer', () => {
    const doc = setupMockDocument(`
      <div role="dialog" id="outer-compose">
        <input name="subjectbox" value="Test">
        <div aria-label="Message Body" contenteditable="true">Body</div>
        <div class="footer">
          <div role="button" data-tooltip="Send" id="sendBtn"></div>
        </div>
      </div>
    `);
    const sendBtn = doc.getElementById('sendBtn');
    const root = domLayer.findComposeRootFromSendButton(sendBtn, doc);
    assert.ok(root);
    assert.strictEqual(root.id, 'outer-compose');
  });

  run('multiple independent compose windows are both detected', () => {
    const doc = setupMockDocument(`
      <div role="dialog" id="compose1">
        <input name="subjectbox" value="Subject 1">
        <div aria-label="Message Body" contenteditable="true">Body 1</div>
        <div role="button" data-tooltip="Send" id="send1"></div>
      </div>
      <div role="dialog" id="compose2">
        <input name="subjectbox" value="Subject 2">
        <div aria-label="Message Body" contenteditable="true">Body 2</div>
        <div role="button" data-tooltip="Send" id="send2"></div>
      </div>
    `);
    const roots = domLayer.findComposeRoots(doc);
    assert.strictEqual(roots.length, 2);
    const ids = roots.map(r => r.id).sort();
    assert.strictEqual(JSON.stringify(ids), JSON.stringify(['compose1', 'compose2']));
  });

  run('inner root without subject is not used when parent root has subject', () => {
    const doc = setupMockDocument(`
      <div role="dialog" id="outer">
        <input name="subjectbox" value="My Subject">
        <div id="inner">
          <div contenteditable="true" role="textbox">Body</div>
          <div role="button" data-tooltip="Send" id="send"></div>
        </div>
      </div>
    `);
    const roots = domLayer.findComposeRoots(doc);
    assert.strictEqual(roots.length, 1);
    assert.strictEqual(roots[0].id, 'outer');
    
    const sendBtn = doc.getElementById('send');
    const root = domLayer.findComposeRootFromSendButton(sendBtn, doc);
    assert.strictEqual(root.id, 'outer');
  });

  // === P0-4: readSubjectInfo tests ===

  run('readSubjectInfo returns source=subjectbox for new compose', () => {
    const doc = setupMockDocument(`
      <div role="dialog">
        <input name="subjectbox" value="Hello World">
        <div aria-label="Message Body" contenteditable="true">Body</div>
        <div role="button" data-tooltip="Send"></div>
      </div>
    `);
    const root = domLayer.findComposeRoots(doc)[0];
    const info = domLayer.readSubjectInfo(root, doc);
    assert.strictEqual(info.value, 'Hello World');
    assert.strictEqual(info.source, 'subjectbox');
    assert.strictEqual(info.available, true);
    assert.strictEqual(info.confidence, 'high');
  });

  run('readSubjectInfo returns available=false when no subject source exists', () => {
    const doc = setupMockDocument(`
      <div class="reply-compose">
        <div role="button" data-tooltip="送信"></div>
        <div contenteditable="true" role="textbox">Body</div>
      </div>
    `);
    const root = domLayer.findComposeRoots(doc)[0];
    const info = domLayer.readSubjectInfo(root, doc);
    assert.strictEqual(info.available, false);
    assert.strictEqual(info.source, 'unknown');
    assert.strictEqual(info.confidence, 'low');
  });

  run('readSubjectInfo returns thread-header for reply compose near thread subject', () => {
    const doc = setupMockDocument(`
      <div class="thread-container">
        <h2 data-thread-perm-id="t123">Re: 元の件名</h2>
        <div class="reply-compose">
          <div role="button" data-tooltip="送信"></div>
          <div contenteditable="true" role="textbox">返信本文</div>
        </div>
      </div>
    `);
    const root = domLayer.findComposeRoots(doc)[0];
    const info = domLayer.readSubjectInfo(root, doc);
    assert.strictEqual(info.available, true);
    assert.strictEqual(info.value, 'Re: 元の件名');
    assert.strictEqual(info.source, 'thread-header');
    assert.strictEqual(info.confidence, 'medium');
  });

  run('readSubjectInfo does not pick up subject from a different compose', () => {
    const doc = setupMockDocument(`
      <div role="dialog" id="c1">
        <input name="subjectbox" value="Compose 1 Subject">
        <div aria-label="Message Body" contenteditable="true">Body 1</div>
        <div role="button" data-tooltip="Send" id="send1"></div>
      </div>
      <div class="reply-compose" id="c2">
        <div role="button" data-tooltip="送信" id="send2"></div>
        <div contenteditable="true" role="textbox">Body 2</div>
      </div>
    `);
    const root2 = domLayer.findComposeRootFromSendButton(doc.getElementById('send2'), doc);
    assert.ok(root2);
    const info = domLayer.readSubjectInfo(root2, doc);
    // Should NOT pick up "Compose 1 Subject" from the other compose
    if (info.available) {
      assert.notStrictEqual(info.value, 'Compose 1 Subject');
    }
  });

  // === P0-6: New compose subject as highest priority test ===

  run('new compose reads subject when subject is in header and send button is in nested footer', () => {
    const doc = setupMockDocument(`
      <div role="dialog" id="compose">
        <div class="compose-header">
          <textarea name="to"></textarea>
          <input name="subjectbox" value="Important Email">
        </div>
        <div class="compose-body-area">
          <div aria-label="Message Body" contenteditable="true">Body text here</div>
        </div>
        <div class="compose-footer">
          <div role="button" data-tooltip="Send" id="sendBtn"></div>
        </div>
      </div>
    `);
    const sendBtn = doc.getElementById('sendBtn');
    const root = domLayer.findComposeRootFromSendButton(sendBtn, doc);
    assert.ok(root);
    const subject = domLayer.readSubject(root, doc);
    assert.strictEqual(subject, 'Important Email');
  });

  run('new compose does not show subject unavailable when subjectbox exists in outer root', () => {
    const doc = setupMockDocument(`
      <div role="dialog" id="outer">
        <input name="subjectbox" value="Has Subject">
        <div id="inner-area">
          <div contenteditable="true" role="textbox">Body</div>
          <div role="button" data-tooltip="Send" id="send"></div>
        </div>
      </div>
    `);
    const sendBtn = doc.getElementById('send');
    const root = domLayer.findComposeRootFromSendButton(sendBtn, doc);
    assert.ok(root);
    const info = domLayer.readSubjectInfo(root, doc);
    assert.strictEqual(info.available, true);
    assert.strictEqual(info.value, 'Has Subject');
  });

  run('subject unavailable is warning, not muted/OK', () => {
    const doc = setupMockDocument(`
      <div class="reply-compose">
        <div role="button" data-tooltip="送信"></div>
        <div contenteditable="true" role="textbox">Body</div>
      </div>
    `);
    const root = domLayer.findComposeRoots(doc)[0];
    const info = domLayer.readSubjectInfo(root, doc);
    // When available is false, it should be treated as warning (not muted)
    assert.strictEqual(info.available, false);
    // The confidence should be 'low', not 'muted'
    assert.strictEqual(info.confidence, 'low');
    assert.notStrictEqual(info.source, 'muted');
  });

  // === P0 addition: readCurrentComposeBody tests ===

  run('readCurrentComposeBody excludes gmail_quote text', () => {
    const doc = setupMockDocument(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div aria-label="Message Body" contenteditable="true">
          <div>Current text</div>
          <div class="gmail_quote">Quoted text 添付</div>
        </div>
        <div role="button" data-tooltip="Send"></div>
      </div>
    `);
    const root = domLayer.findComposeRoots(doc)[0];
    const currentBody = domLayer.readCurrentComposeBody(root, doc);
    assert.strictEqual(currentBody.trim(), 'Current text');
  });

  run('readCurrentComposeBody excludes blockquote text', () => {
    const doc = setupMockDocument(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div aria-label="Message Body" contenteditable="true">
          <div>Current text</div>
          <blockquote>Quoted text 添付</blockquote>
        </div>
        <div role="button" data-tooltip="Send"></div>
      </div>
    `);
    const root = domLayer.findComposeRoots(doc)[0];
    const currentBody = domLayer.readCurrentComposeBody(root, doc);
    assert.strictEqual(currentBody.trim(), 'Current text');
  });

  run('readCurrentComposeBody excludes gmail_signature text', () => {
    const doc = setupMockDocument(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div aria-label="Message Body" contenteditable="true">
          <div>Current text</div>
          <div class="gmail_signature">Signature 添付</div>
        </div>
        <div role="button" data-tooltip="Send"></div>
      </div>
    `);
    const root = domLayer.findComposeRoots(doc)[0];
    const currentBody = domLayer.readCurrentComposeBody(root, doc);
    assert.strictEqual(currentBody.trim(), 'Current text');
  });

  // === Attachment tests ===

  run('readAttachments extracts name from Remove attachment: filename', () => {
    const doc = setupMockDocument(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div aria-label="Message Body" contenteditable="true">Body</div>
        <div role="button" data-tooltip="Send"></div>
        <div role="listitem">
          <div aria-label="Remove attachment: details.pdf"></div>
          <span>100 KB</span>
        </div>
      </div>
    `);
    const root = doc.querySelector('[role="dialog"]');
    const atts = domLayer.readAttachments(root, doc);
    assert.strictEqual(atts.length, 1);
    assert.strictEqual(atts[0].name, 'details.pdf');
  });

  run('readAttachments extracts name from Japanese "filename を削除"', () => {
    const doc = setupMockDocument(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div aria-label="Message Body" contenteditable="true">Body</div>
        <div role="button" data-tooltip="Send"></div>
        <div role="listitem">
          <div aria-label="photo.jpg を削除"></div>
          <span>2.3 MB</span>
        </div>
      </div>
    `);
    const root = doc.querySelector('[role="dialog"]');
    const atts = domLayer.readAttachments(root, doc);
    assert.strictEqual(atts.length, 1);
    assert.strictEqual(atts[0].name, 'photo.jpg');
  });

  run('readAttachments extracts name from title when aria-label has no filename', () => {
    const doc = setupMockDocument(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div aria-label="Message Body" contenteditable="true">Body</div>
        <div role="button" data-tooltip="Send"></div>
        <div role="listitem" title="report.xlsx">
          <div aria-label="添付ファイルを削除"></div>
          <span>86 KB</span>
        </div>
      </div>
    `);
    const root = doc.querySelector('[role="dialog"]');
    const atts = domLayer.readAttachments(root, doc);
    assert.strictEqual(atts.length, 1);
    assert.strictEqual(atts[0].name, 'report.xlsx');
  });

  run('readAttachments extracts size from sibling text', () => {
    const doc = setupMockDocument(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div aria-label="Message Body" contenteditable="true">Body</div>
        <div role="button" data-tooltip="Send"></div>
        <div role="listitem">
          <span aria-label="Remove attachment doc.pdf"></span>
          <span>1,024 KB</span>
        </div>
      </div>
    `);
    const root = doc.querySelector('[role="dialog"]');
    const atts = domLayer.readAttachments(root, doc);
    assert.strictEqual(atts.length, 1);
    assert.strictEqual(atts[0].sizeText, '1,024 KB');
  });

  run('readAttachments handles comma size like 1,024 KB', () => {
    const doc = setupMockDocument(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div aria-label="Message Body" contenteditable="true">Body</div>
        <div role="button" data-tooltip="Send"></div>
        <div role="listitem" title="bigfile.zip">
          <span>1,024 KB</span>
        </div>
      </div>
    `);
    const root = doc.querySelector('[role="dialog"]');
    const atts = domLayer.readAttachments(root, doc);
    assert.strictEqual(atts.length, 1);
    assert.strictEqual(atts[0].sizeText, '1,024 KB');
  });

  run('readAttachments deduplicates same attachment', () => {
    const doc = setupMockDocument(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div aria-label="Message Body" contenteditable="true">Body</div>
        <div role="button" data-tooltip="Send"></div>
        <div role="listitem">
          <span aria-label="Remove attachment doc.pdf"></span>
          <span>12 KB</span>
        </div>
      </div>
    `);
    const root = doc.querySelector('[role="dialog"]');
    const atts = domLayer.readAttachments(root, doc);
    assert.strictEqual(atts.length, 1);
  });

  run('readAttachments does not count attach button', () => {
    const doc = setupMockDocument(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div aria-label="Message Body" contenteditable="true">Body</div>
        <div role="button" data-tooltip="Send"></div>
        <div role="button" aria-label="ファイルを添付"></div>
      </div>
    `);
    const root = doc.querySelector('[role="dialog"]');
    const atts = domLayer.readAttachments(root, doc);
    assert.strictEqual(atts.length, 0);
  });

  run('readAttachments does not count Google Drive attach button', () => {
    const doc = setupMockDocument(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div aria-label="Message Body" contenteditable="true">Body</div>
        <div role="button" data-tooltip="Send"></div>
        <div role="button" aria-label="Google Drive を使ってファイルを挿入"></div>
      </div>
    `);
    const root = doc.querySelector('[role="dialog"]');
    const atts = domLayer.readAttachments(root, doc);
    assert.strictEqual(atts.length, 0);
  });

  run('readAttachments does not count recipient chip remove button as attachment', () => {
    const doc = setupMockDocument(`
      <div role="dialog" id="root">
        <input name="subjectbox" value="test">
        <div aria-label="To">
          <div role="listitem" class="recipient-chip">
            <span email="client@example.com">client@example.com</span>
            <span aria-label="client@example.com を削除"></span>
          </div>
        </div>
        <div contenteditable="true" role="textbox">本文に添付と書いています。</div>
        <div role="button" data-tooltip="送信"></div>
      </div>
    `);
    const root = doc.getElementById('root');
    const atts = domLayer.readAttachments(root, doc);
    assert.strictEqual(atts.length, 0);
  });

  run('readAttachments ignores aria-label="client@example.com を削除"', () => {
    const doc = setupMockDocument(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div aria-label="Message Body" contenteditable="true">Body</div>
        <div role="button" data-tooltip="Send"></div>
        <div role="listitem">
          <span aria-label="client@example.com を削除"></span>
        </div>
      </div>
    `);
    const root = doc.querySelector('[role="dialog"]');
    const atts = domLayer.readAttachments(root, doc);
    assert.strictEqual(atts.length, 0);
  });

  run('readAttachments ignores non-file listitem with generic delete/remove button', () => {
    const doc = setupMockDocument(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div aria-label="Message Body" contenteditable="true">Body</div>
        <div role="button" data-tooltip="Send"></div>
        <div role="listitem" class="vI">
          <span class="vJ" aria-label="Delete item"></span>
        </div>
      </div>
    `);
    const root = doc.querySelector('[role="dialog"]');
    const atts = domLayer.readAttachments(root, doc);
    assert.strictEqual(atts.length, 0);
  });

  run('readAttachments detects uploading/progress state', () => {
    const doc = setupMockDocument(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div aria-label="Message Body" contenteditable="true">Body</div>
        <div role="button" data-tooltip="Send"></div>
        <div role="listitem" title="loading_file.pdf">
          <div role="progressbar"></div>
          <span>アップロード中...</span>
        </div>
      </div>
    `);
    const root = doc.querySelector('[role="dialog"]');
    const atts = domLayer.readAttachments(root, doc);
    assert.strictEqual(atts.length, 1);
    assert.strictEqual(atts[0].status, 'uploading');
  });

  run('readAttachments returns sizeText empty when size is unavailable', () => {
    const doc = setupMockDocument(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div aria-label="Message Body" contenteditable="true">Body</div>
        <div role="button" data-tooltip="Send"></div>
        <div role="listitem" title="nosize.pdf">
          <!-- no size info -->
        </div>
      </div>
    `);
    const root = doc.querySelector('[role="dialog"]');
    const atts = domLayer.readAttachments(root, doc);
    assert.strictEqual(atts.length, 1);
    assert.strictEqual(atts[0].sizeText, '');
  });

  run('readAttachments does not detect bare vI without evidence as attachment', () => {
    const doc = setupMockDocument(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div aria-label="Message Body" contenteditable="true">Body</div>
        <div role="button" data-tooltip="Send"></div>
        <div class="vI">
          <!-- no title, no delete btn, no filename, no size -->
        </div>
      </div>
    `);
    const root = doc.querySelector('[role="dialog"]');
    const atts = domLayer.readAttachments(root, doc);
    assert.strictEqual(atts.length, 0);
  });

  run('readAttachments does not mark ready attachment as uploading because of .vq class only', () => {
    const doc = setupMockDocument(`
      <div role="dialog">
        <div aria-label="Message Body" contenteditable="true">Body</div>
        <div role="listitem">
          <div aria-label="Remove attachment - file.pdf"></div>
          <span class="vq"></span>
        </div>
      </div>
    `);
    const root = doc.querySelector('[role="dialog"]');
    const atts = domLayer.readAttachments(root, doc);
    assert.strictEqual(atts.length, 1);
    assert.strictEqual(atts[0].status, 'ready');
  });

  run('readAttachments does not mark ready attachment as uploading because of .vy class only', () => {
    const doc = setupMockDocument(`
      <div role="dialog">
        <div aria-label="Message Body" contenteditable="true">Body</div>
        <div role="listitem">
          <div aria-label="Remove attachment - file.pdf"></div>
          <span class="vy"></span>
        </div>
      </div>
    `);
    const root = doc.querySelector('[role="dialog"]');
    const atts = domLayer.readAttachments(root, doc);
    assert.strictEqual(atts.length, 1);
    assert.strictEqual(atts[0].status, 'ready');
  });

  run('readAttachments treats file with title size and .vq as ready', () => {
    const doc = setupMockDocument(`
      <div role="dialog">
        <div role="listitem" title="report.pdf">
          <span class="vq"></span>
          <span>20 KB</span>
        </div>
      </div>
    `);
    const root = doc.querySelector('[role="dialog"]');
    const atts = domLayer.readAttachments(root, doc);
    assert.strictEqual(atts.length, 1);
    assert.strictEqual(atts[0].name, 'report.pdf');
    assert.strictEqual(atts[0].sizeText, '20 KB');
    assert.strictEqual(atts[0].status, 'ready');
    assert.strictEqual(atts[0].confidence, 'high');
  });

  run('readAttachments treats file with title size and .vy as ready', () => {
    const doc = setupMockDocument(`
      <div role="dialog">
        <div role="listitem" title="report.pdf">
          <span class="vy"></span>
          <span>20 KB</span>
        </div>
      </div>
    `);
    const root = doc.querySelector('[role="dialog"]');
    const atts = domLayer.readAttachments(root, doc);
    assert.strictEqual(atts.length, 1);
    assert.strictEqual(atts[0].name, 'report.pdf');
    assert.strictEqual(atts[0].sizeText, '20 KB');
    assert.strictEqual(atts[0].status, 'ready');
    assert.strictEqual(atts[0].confidence, 'high');
  });

  run('readAttachments treats file with title and .vq as ready', () => {
    const doc = setupMockDocument(`
      <div role="dialog">
        <div role="listitem" title="report.pdf">
          <span class="vq"></span>
        </div>
      </div>
    `);
    const root = doc.querySelector('[role="dialog"]');
    const atts = domLayer.readAttachments(root, doc);
    assert.strictEqual(atts.length, 1);
    assert.strictEqual(atts[0].name, 'report.pdf');
    assert.strictEqual(atts[0].status, 'ready');
    assert.strictEqual(atts[0].confidence, 'medium');
  });

  run('readAttachments treats file with title and .vy as ready', () => {
    const doc = setupMockDocument(`
      <div role="dialog">
        <div role="listitem" title="report.pdf">
          <span class="vy"></span>
        </div>
      </div>
    `);
    const root = doc.querySelector('[role="dialog"]');
    const atts = domLayer.readAttachments(root, doc);
    assert.strictEqual(atts.length, 1);
    assert.strictEqual(atts[0].name, 'report.pdf');
    assert.strictEqual(atts[0].status, 'ready');
    assert.strictEqual(atts[0].confidence, 'medium');
  });

  run('readAttachments does not treat .progress class alone as uploading', () => {
    const doc = setupMockDocument(`
      <div role="dialog">
        <div role="listitem" title="report.pdf">
          <span class="progress"></span>
        </div>
      </div>
    `);
    const root = doc.querySelector('[role="dialog"]');
    const atts = domLayer.readAttachments(root, doc);
    assert.strictEqual(atts.length, 1);
    assert.strictEqual(atts[0].status, 'ready');
  });

  run('readAttachments marks explicit uploading text as uploading', () => {
    const doc = setupMockDocument(`
      <div role="dialog">
        <div role="listitem" title="report.pdf">
          <span>アップロード中...</span>
        </div>
      </div>
    `);
    const root = doc.querySelector('[role="dialog"]');
    const atts = domLayer.readAttachments(root, doc);
    assert.strictEqual(atts.length, 1);
    assert.strictEqual(atts[0].status, 'uploading');
  });

  run('readAttachments marks progressbar aria-valuenow 50 as uploading', () => {
    const doc = setupMockDocument(`
      <div role="dialog">
        <div role="listitem" title="file.pdf">
          <div role="progressbar" aria-valuenow="50"></div>
        </div>
      </div>
    `);
    const root = doc.querySelector('[role="dialog"]');
    const atts = domLayer.readAttachments(root, doc);
    assert.strictEqual(atts[0].status, 'uploading');
  });

  run('readAttachments marks progressbar aria-valuenow 100 as ready', () => {
    const doc = setupMockDocument(`
      <div role="dialog">
        <div role="listitem">
          <div aria-label="Remove attachment - file.pdf"></div>
          <div role="progressbar" aria-valuenow="100"></div>
        </div>
      </div>
    `);
    const root = doc.querySelector('[role="dialog"]');
    const atts = domLayer.readAttachments(root, doc);
    assert.strictEqual(atts[0].status, 'ready');
  });

  run('readAttachments marks progress value less than max as uploading', () => {
    const doc = setupMockDocument(`
      <div role="dialog">
        <div role="listitem" title="file.pdf">
          <progress value="50" max="100"></progress>
        </div>
      </div>
    `);
    const root = doc.querySelector('[role="dialog"]');
    const atts = domLayer.readAttachments(root, doc);
    assert.strictEqual(atts[0].status, 'uploading');
  });

  run('readAttachments marks progress value equal max as ready', () => {
    const doc = setupMockDocument(`
      <div role="dialog">
        <div role="listitem">
          <div aria-label="Remove attachment - file.pdf"></div>
          <progress value="100" max="100"></progress>
        </div>
      </div>
    `);
    const root = doc.querySelector('[role="dialog"]');
    const atts = domLayer.readAttachments(root, doc);
    assert.strictEqual(atts[0].status, 'ready');
  });

  run('readAttachments does not leave - prefix from Remove attachment - filename', () => {
    const doc = setupMockDocument(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div aria-label="Message Body" contenteditable="true">Body</div>
        <div role="button" data-tooltip="Send"></div>
        <div role="listitem">
          <div aria-label="Remove attachment - report.pdf"></div>
          <span>50 KB</span>
        </div>
      </div>
    `);
    const root = doc.querySelector('[role="dialog"]');
    const atts = domLayer.readAttachments(root, doc);
    assert.strictEqual(atts.length, 1);
    assert.strictEqual(atts[0].name, 'report.pdf');
    assert.ok(!atts[0].name.startsWith('-'), 'Name should not start with -');
    assert.ok(!atts[0].name.startsWith('- '), 'Name should not start with "- "');
  });

  // === Integration tests with content.js ===

  const createdWindows = [];

  function setupWindowWithScripts(html, settings = {}, storageOptions = {}) {
    const testDom = new JSDOM(`
      <!DOCTYPE html>
      <html>
      <head></head>
      <body>
        ${html}
      </body>
      </html>
    `, { runScripts: "dangerously" });
    createdWindows.push(testDom.window);
    const win = testDom.window;
    
    win.HTMLElement.prototype.getBoundingClientRect = function() {
      return { width: 100, height: 100, top: 0, left: 0, bottom: 100, right: 100 };
    };
    Object.defineProperty(win.HTMLElement.prototype, 'offsetParent', {
      get() { return this.parentNode; }
    });

    const localSettings = Object.prototype.hasOwnProperty.call(storageOptions, 'localSettings')
      ? storageOptions.localSettings
      : settings;
    const storageState = {
      local: { ...(localSettings || {}) }
    };
    const storageChangeListeners = [];

    win.chrome = {
      i18n: {
        getUILanguage: () => 'ja-JP'
      },
      storage: {
        local: {
          get: (keys, cb) => cb({ ...storageState.local }),
          set: (values, cb) => {
            Object.assign(storageState.local, values || {});
            if (cb) cb();
          }
        },
        onChanged: {
          addListener(listener) {
            storageChangeListeners.push(listener);
          }
        }
      }
    };
    win.__gsgStorageState = storageState;
    win.__gsgEmitStorageChange = (changes = {}, area = 'local') => {
      for (const listener of storageChangeListeners) listener(changes, area);
    };

    win.setTimeout = (fn, delay) => {
      fn();
      return 1;
    };

    const i18nCode = fs.readFileSync(path.join(__dirname, '../extension/i18n.js'), 'utf8');
    const checksCode = fs.readFileSync(path.join(__dirname, '../extension/checks.js'), 'utf8');
    const domCode = fs.readFileSync(path.join(__dirname, '../extension/gmail_dom.js'), 'utf8');
    const contentCode = fs.readFileSync(path.join(__dirname, '../extension/content.js'), 'utf8');
    
    const s0 = win.document.createElement('script'); s0.textContent = i18nCode; win.document.head.appendChild(s0);
    const s1 = win.document.createElement('script'); s1.textContent = checksCode; win.document.head.appendChild(s1);
    const s2 = win.document.createElement('script'); s2.textContent = domCode; win.document.head.appendChild(s2);
    win.GmailSendGuardDom.isVisible = () => true;
    const s3 = win.document.createElement('script'); s3.textContent = contentCode; win.document.head.appendChild(s3);

    return win;
  }

  function installQueuedTimers(win) {
    const queue = [];
    win.setTimeout = (callback) => {
      queue.push(callback);
      return queue.length;
    };
    win.clearTimeout = () => {};
    return {
      flush(limit = 100) {
        let count = 0;
        while (queue.length > 0) {
          assert.ok(count < limit, `Timer queue exceeded ${limit} callbacks`);
          const callback = queue.shift();
          count++;
          callback();
        }
      },
      get size() {
        return queue.length;
      }
    };
  }

  run('render logic never displays forbidden reply/forward subject wording', () => {
    // Reply compose without subject input
    const win = setupWindowWithScripts(`
      <div class="reply-compose">
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
        <div contenteditable="true" role="textbox">Reply body</div>
      </div>
    `, { subjectCheckEnabled: true, subjectConfirmationEnabled: true });

    const sendBtn = win.document.getElementById('sendBtn');
    sendBtn.click();
    
    const body = win.document.querySelector('.gsg-modal-body');
    assert.ok(body);
    const text = body.textContent;
    const forbiddenText = ['返信・転送のため', '件名入力欄がありません'].join('');
    assert.ok(!text.includes(forbiddenText), 
      `Modal should not contain forbidden text. Got: "${text}"`);
  });

  run('subject unavailable shows warning text in modal', () => {
    const win = setupWindowWithScripts(`
      <div class="reply-compose">
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
        <div contenteditable="true" role="textbox">Reply body</div>
      </div>
    `, { subjectCheckEnabled: true, subjectConfirmationEnabled: true });

    const sendBtn = win.document.getElementById('sendBtn');
    sendBtn.click();
    
    const body = win.document.querySelector('.gsg-modal-body');
    assert.ok(body);
    assert.ok(body.textContent.includes('件名を取得できませんでした'),
      `Modal should contain warning text. Got: "${body.textContent}"`);
  });

  run('new compose with nested footer still shows subject in modal', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog" id="outer">
        <input name="subjectbox" value="My Important Subject">
        <div aria-label="Message Body" contenteditable="true">Body text</div>
        <div class="footer">
          <div role="button" data-tooltip="Send" id="sendBtn"></div>
        </div>
      </div>
    `, { subjectCheckEnabled: true, subjectConfirmationEnabled: true });

    const sendBtn = win.document.getElementById('sendBtn');
    sendBtn.click();
    
    const body = win.document.querySelector('.gsg-modal-body');
    assert.ok(body);
    assert.ok(body.textContent.includes('My Important Subject'),
      `Modal should display subject. Got: "${body.textContent}"`);
    assert.ok(!body.textContent.includes('件名を取得できませんでした'),
      `Modal should NOT show unavailable warning for new compose with subject`);
  });

  run('confirm after modal triggers original send button once', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div contenteditable="true" role="textbox">Body</div>
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
      </div>
    `, { confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false } });

    let sentCount = 0;
    const sendBtn = win.document.getElementById('sendBtn');
    sendBtn.addEventListener('click', () => {
      sentCount++;
    });

    sendBtn.click();
    assert.strictEqual(sentCount, 0);
    win.document.querySelector('.gsg-btn-confirm').click();
    assert.strictEqual(sentCount, 1);
  });

  run('double clicking send before confirm still sends once after confirmation', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div contenteditable="true" role="textbox">Body</div>
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
      </div>
    `, { confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false } });

    let sentCount = 0;
    const sendBtn = win.document.getElementById('sendBtn');
    sendBtn.addEventListener('click', () => {
      sentCount++;
    });

    sendBtn.click();
    sendBtn.click();
    assert.strictEqual(sentCount, 0);
    win.document.querySelector('.gsg-btn-confirm').click();
    assert.strictEqual(sentCount, 1);
  });

  run('send button click interception stops later same-target capture listener before confirmation', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div contenteditable="true" role="textbox">Body</div>
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
      </div>
    `, { confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false } });

    let leakedSendAttempt = 0;
    let sentCount = 0;
    const sendBtn = win.document.getElementById('sendBtn');
    sendBtn.addEventListener('click', () => {
      leakedSendAttempt++;
    }, true);
    sendBtn.addEventListener('click', () => {
      sentCount++;
    });

    sendBtn.click();
    assert.ok(win.document.querySelector('.gsg-modal-overlay').classList.contains('gsg-active'));
    assert.strictEqual(leakedSendAttempt, 0);
    assert.strictEqual(sentCount, 0);

    win.document.querySelector('.gsg-btn-confirm').click();
    assert.strictEqual(sentCount, 1);
  });

  run('allowed click after confirmation still reaches original send handler exactly once', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div contenteditable="true" role="textbox">Body</div>
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
      </div>
    `, { confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false } });

    let sentCount = 0;
    const sendBtn = win.document.getElementById('sendBtn');
    sendBtn.addEventListener('click', () => {
      sentCount++;
    });

    sendBtn.click();
    assert.strictEqual(sentCount, 0);
    win.document.querySelector('.gsg-btn-confirm').click();
    assert.strictEqual(sentCount, 1);
    assert.strictEqual(win.document.querySelector('.gsg-modal-overlay').classList.contains('gsg-active'), false);
  });

  run('Ctrl+Enter opens send guard modal and confirms original send once', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div id="bodyBox" contenteditable="true" role="textbox">Body</div>
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
      </div>
    `, { confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false } });

    let sentCount = 0;
    const sendBtn = win.document.getElementById('sendBtn');
    const bodyBox = win.document.getElementById('bodyBox');
    sendBtn.addEventListener('click', () => {
      sentCount++;
    });

    const event = new win.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
      code: 'Enter',
      ctrlKey: true
    });
    bodyBox.dispatchEvent(event);

    assert.strictEqual(sentCount, 0);
    assert.strictEqual(event.defaultPrevented, true);
    assert.ok(win.document.querySelector('.gsg-modal-overlay').classList.contains('gsg-active'));
    assert.strictEqual(win.document.activeElement, win.document.querySelector('.gsg-btn-confirm'));
    win.document.querySelector('.gsg-btn-confirm').click();
    assert.strictEqual(sentCount, 1);
  });

  run('Ctrl+Enter interception stops later document capture listener before confirmation', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div id="bodyBox" contenteditable="true" role="textbox">Body</div>
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
      </div>
    `, { confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false } });

    let leakedKeyboardSendAttempt = 0;
    let sentCount = 0;
    const sendBtn = win.document.getElementById('sendBtn');
    const bodyBox = win.document.getElementById('bodyBox');
    sendBtn.addEventListener('click', () => {
      sentCount++;
    });
    win.document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.ctrlKey) leakedKeyboardSendAttempt++;
    }, true);

    bodyBox.dispatchEvent(new win.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
      code: 'Enter',
      ctrlKey: true
    }));

    assert.ok(win.document.querySelector('.gsg-modal-overlay').classList.contains('gsg-active'));
    assert.strictEqual(leakedKeyboardSendAttempt, 0);
    assert.strictEqual(sentCount, 0);
  });

  run('Cmd+Enter opens send guard modal and confirms original send once', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div id="bodyBox" contenteditable="true" role="textbox">Body</div>
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
      </div>
    `, { confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false } });

    let sentCount = 0;
    const sendBtn = win.document.getElementById('sendBtn');
    const bodyBox = win.document.getElementById('bodyBox');
    sendBtn.addEventListener('click', () => {
      sentCount++;
    });

    const event = new win.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
      code: 'Enter',
      metaKey: true
    });
    bodyBox.dispatchEvent(event);

    assert.strictEqual(sentCount, 0);
    assert.strictEqual(event.defaultPrevented, true);
    assert.ok(win.document.querySelector('.gsg-modal-overlay').classList.contains('gsg-active'));
    assert.strictEqual(win.document.activeElement, win.document.querySelector('.gsg-btn-confirm'));
    win.document.querySelector('.gsg-btn-confirm').click();
    assert.strictEqual(sentCount, 1);
  });

  run('Ctrl+Enter in active modal confirms original send once', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div id="bodyBox" contenteditable="true" role="textbox">Body</div>
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
      </div>
    `, { confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false } });

    let sentCount = 0;
    const sendBtn = win.document.getElementById('sendBtn');
    const bodyBox = win.document.getElementById('bodyBox');
    sendBtn.addEventListener('click', () => {
      sentCount++;
    });

    bodyBox.dispatchEvent(new win.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
      code: 'Enter',
      ctrlKey: true
    }));
    assert.strictEqual(sentCount, 0);
    assert.ok(win.document.querySelector('.gsg-modal-overlay').classList.contains('gsg-active'));

    const confirmEvent = new win.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
      code: 'Enter',
      ctrlKey: true
    });
    win.document.querySelector('.gsg-btn-confirm').dispatchEvent(confirmEvent);

    assert.strictEqual(confirmEvent.defaultPrevented, true);
    assert.strictEqual(sentCount, 1);
    assert.strictEqual(win.document.querySelector('.gsg-modal-overlay').classList.contains('gsg-active'), false);
  });

  run('Ctrl+Enter in active modal stops later document capture listener', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div contenteditable="true" role="textbox">Body</div>
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
      </div>
    `, { confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false } });

    let leakedKeyboardSendAttempt = 0;
    let sentCount = 0;
    const sendBtn = win.document.getElementById('sendBtn');
    sendBtn.addEventListener('click', () => {
      sentCount++;
    });

    sendBtn.click();
    assert.ok(win.document.querySelector('.gsg-modal-overlay').classList.contains('gsg-active'));
    win.document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.ctrlKey) leakedKeyboardSendAttempt++;
    }, true);

    win.document.querySelector('.gsg-btn-confirm').dispatchEvent(new win.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
      code: 'Enter',
      ctrlKey: true
    }));

    assert.strictEqual(leakedKeyboardSendAttempt, 0);
    assert.strictEqual(sentCount, 1);
    assert.strictEqual(win.document.querySelector('.gsg-modal-overlay').classList.contains('gsg-active'), false);
  });

  run('Ctrl+Enter in active modal does not send when final button is disabled', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div id="bodyBox" contenteditable="true" role="textbox">Body</div>
        <div role="listitem" title="file.pdf"><progress value="50" max="100"></progress></div>
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
      </div>
    `, {
      attachmentCheckEnabled: true,
      confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false }
    });

    let sentCount = 0;
    const sendBtn = win.document.getElementById('sendBtn');
    const bodyBox = win.document.getElementById('bodyBox');
    sendBtn.addEventListener('click', () => {
      sentCount++;
    });

    bodyBox.dispatchEvent(new win.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
      code: 'Enter',
      ctrlKey: true
    }));
    const confirmBtn = win.document.querySelector('.gsg-btn-confirm');
    assert.strictEqual(confirmBtn.disabled, true);

    const confirmEvent = new win.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
      code: 'Enter',
      ctrlKey: true
    });
    confirmBtn.dispatchEvent(confirmEvent);

    assert.strictEqual(confirmEvent.defaultPrevented, true);
    assert.strictEqual(sentCount, 0);
    assert.ok(win.document.querySelector('.gsg-modal-overlay').classList.contains('gsg-active'));
  });

  run('Ctrl+Enter in active modal disabled state stops later document capture listener and does not send', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div contenteditable="true" role="textbox">Body</div>
        <div role="listitem" title="file.pdf"><progress value="50" max="100"></progress></div>
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
      </div>
    `, {
      attachmentCheckEnabled: true,
      confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false }
    });

    let leakedKeyboardSendAttempt = 0;
    let sentCount = 0;
    const sendBtn = win.document.getElementById('sendBtn');
    sendBtn.addEventListener('click', () => {
      sentCount++;
    });

    sendBtn.click();
    const confirmBtn = win.document.querySelector('.gsg-btn-confirm');
    assert.strictEqual(confirmBtn.disabled, true);
    win.document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.ctrlKey) leakedKeyboardSendAttempt++;
    }, true);

    confirmBtn.dispatchEvent(new win.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
      code: 'Enter',
      ctrlKey: true
    }));

    assert.strictEqual(leakedKeyboardSendAttempt, 0);
    assert.strictEqual(sentCount, 0);
    assert.ok(win.document.querySelector('.gsg-modal-overlay').classList.contains('gsg-active'));
  });

  run('Ctrl+Enter in active modal calls confirmSendFromModal path', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div id="bodyBox" contenteditable="true" role="textbox">Body</div>
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
      </div>
    `, { confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false } });

    let sentCount = 0;
    let confirmButtonClickEvents = 0;
    const sendBtn = win.document.getElementById('sendBtn');
    const bodyBox = win.document.getElementById('bodyBox');
    sendBtn.addEventListener('click', () => {
      sentCount++;
    });

    bodyBox.dispatchEvent(new win.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
      code: 'Enter',
      ctrlKey: true
    }));

    const confirmBtn = win.document.querySelector('.gsg-btn-confirm');
    confirmBtn.addEventListener('click', () => {
      confirmButtonClickEvents++;
    });

    confirmBtn.dispatchEvent(new win.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
      code: 'Enter',
      ctrlKey: true
    }));

    assert.strictEqual(sentCount, 1);
    assert.strictEqual(confirmButtonClickEvents, 0);
    assert.strictEqual(win.document.querySelector('.gsg-modal-overlay').classList.contains('gsg-active'), false);
  });

  run('Ctrl+Enter in active modal sends exactly once when final button enabled', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div id="bodyBox" contenteditable="true" role="textbox">Body</div>
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
      </div>
    `, { confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false } });

    let sentCount = 0;
    const sendBtn = win.document.getElementById('sendBtn');
    const bodyBox = win.document.getElementById('bodyBox');
    sendBtn.addEventListener('click', () => {
      sentCount++;
    });

    bodyBox.dispatchEvent(new win.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
      code: 'Enter',
      ctrlKey: true
    }));

    const confirmBtn = win.document.querySelector('.gsg-btn-confirm');
    confirmBtn.dispatchEvent(new win.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
      code: 'Enter',
      ctrlKey: true
    }));
    confirmBtn.dispatchEvent(new win.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
      code: 'Enter',
      ctrlKey: true
    }));

    assert.strictEqual(sentCount, 1);
  });

  run('repeated Ctrl+Enter does not double-send', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div id="bodyBox" contenteditable="true" role="textbox">Body</div>
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
      </div>
    `, { confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false } });

    let sentCount = 0;
    const sendBtn = win.document.getElementById('sendBtn');
    const bodyBox = win.document.getElementById('bodyBox');
    sendBtn.addEventListener('click', () => {
      sentCount++;
    });

    bodyBox.dispatchEvent(new win.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
      code: 'Enter',
      ctrlKey: true
    }));

    const confirmBtn = win.document.querySelector('.gsg-btn-confirm');
    confirmBtn.dispatchEvent(new win.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
      code: 'Enter',
      ctrlKey: true
    }));
    confirmBtn.dispatchEvent(new win.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
      code: 'Enter',
      ctrlKey: true,
      repeat: true
    }));

    assert.strictEqual(sentCount, 1);
  });

  run('NumpadEnter with Ctrl is handled like Enter', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div id="bodyBox" contenteditable="true" role="textbox">Body</div>
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
      </div>
    `, { confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false } });

    let sentCount = 0;
    const sendBtn = win.document.getElementById('sendBtn');
    const bodyBox = win.document.getElementById('bodyBox');
    sendBtn.addEventListener('click', () => {
      sentCount++;
    });

    const event = new win.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'NumpadEnter',
      code: 'NumpadEnter',
      ctrlKey: true
    });
    bodyBox.dispatchEvent(event);

    assert.strictEqual(event.defaultPrevented, true);
    assert.ok(win.document.querySelector('.gsg-modal-overlay').classList.contains('gsg-active'));
    win.document.querySelector('.gsg-btn-confirm').click();
    assert.strictEqual(sentCount, 1);
  });

  run('cancel closes modal without sending', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div contenteditable="true" role="textbox">Body</div>
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
      </div>
    `, { confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false } });

    let sentCount = 0;
    const sendBtn = win.document.getElementById('sendBtn');
    sendBtn.addEventListener('click', () => {
      sentCount++;
    });

    sendBtn.click();
    win.document.querySelector('.gsg-btn-cancel').click();
    assert.strictEqual(sentCount, 0);
    assert.strictEqual(win.document.querySelector('.gsg-modal-overlay').classList.contains('gsg-active'), false);
  });

  run('Escape closes modal without sending', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div contenteditable="true" role="textbox">Body</div>
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
      </div>
    `, { confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false } });

    let sentCount = 0;
    const sendBtn = win.document.getElementById('sendBtn');
    sendBtn.addEventListener('click', () => {
      sentCount++;
    });

    sendBtn.click();
    const escapeEvent = new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    win.document.dispatchEvent(escapeEvent);
    assert.strictEqual(escapeEvent.defaultPrevented, true);
    assert.strictEqual(sentCount, 0);
    assert.strictEqual(win.document.querySelector('.gsg-modal-overlay').classList.contains('gsg-active'), false);
  });

  run('attachment keyword warning does not trigger from quoted thread text', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog" id="c1">
        <input name="subjectbox" value="Re: Important">
        <div aria-label="Message Body" contenteditable="true">
          <div>ありがとうございます。</div>
          <div class="gmail_quote">過去のメール：資料を添付します。</div>
        </div>
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
      </div>
    `, { attachmentCheckEnabled: true, customAttachmentKeywords: ['添付'] });

    const sendBtn = win.document.getElementById('sendBtn');
    sendBtn.click();
    
    // modal displays normally, no warning
    const body = win.document.querySelector('.gsg-modal-body');
    assert.ok(body);
    // キーワードなし扱いになり、添付漏れ警告が出ない
    assert.ok(!body.textContent.includes('添付：本文または件名に「添付」がありますが、添付ファイルなし'));
  });

  run('attachment keyword warning triggers when current compose body contains 添付', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog" id="c1">
        <input name="subjectbox" value="Re: Important">
        <div aria-label="Message Body" contenteditable="true">
          <div>資料を添付します。</div>
          <div class="gmail_quote">過去のメール：よろしくお願いします。</div>
        </div>
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
      </div>
    `, { attachmentCheckEnabled: true, customAttachmentKeywords: ['添付'] });

    const sendBtn = win.document.getElementById('sendBtn');
    sendBtn.click();
    
    const body = win.document.querySelector('.gsg-modal-body');
    assert.ok(body.textContent.includes('添付：本文または件名に「添付」がありますが、添付ファイルなし'));
  });

  run('attachment keyword warning triggers when subject contains 添付', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog" id="c1">
        <input name="subjectbox" value="Re: 添付の件">
        <div aria-label="Message Body" contenteditable="true">
          <div>ありがとうございます。</div>
          <div class="gmail_quote">過去のメール：よろしくお願いします。</div>
        </div>
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
      </div>
    `, { attachmentCheckEnabled: true, customAttachmentKeywords: ['添付'] });

    const sendBtn = win.document.getElementById('sendBtn');
    sendBtn.click();
    
    const body = win.document.querySelector('.gsg-modal-body');
    assert.ok(body.textContent.includes('添付：本文または件名に「添付」がありますが、添付ファイルなし'));
  });

  run('attachment keyword warning does not trigger when only old quoted body contains 添付', () => {
    const win = setupWindowWithScripts(`
      <div class="reply-compose">
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
        <div contenteditable="true" role="textbox">
          <div>承知いたしました。</div>
          <div class="gmail_quote">昨日の添付ファイルをご確認ください。</div>
        </div>
      </div>
    `, { attachmentCheckEnabled: true, subjectCheckEnabled: false, customAttachmentKeywords: ['添付'] });

    const sendBtn = win.document.getElementById('sendBtn');
    sendBtn.click();
    
    const body = win.document.querySelector('.gsg-modal-body');
    assert.ok(!body.textContent.includes('添付：本文または件名に「添付」がありますが、添付ファイルなし'));
  });

  run('attachment keyword warning triggers when body contains 添付 and only recipient chip exists', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Re: Important">
        <div aria-label="To">
          <div role="listitem" class="recipient-chip">
            <span email="client@example.com">client@example.com</span>
            <span aria-label="client@example.com を削除"></span>
          </div>
        </div>
        <div contenteditable="true" role="textbox">本文に添付と書いています。</div>
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
      </div>
    `, {
      attachmentCheckEnabled: true,
      confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false }
    });

    win.document.getElementById('sendBtn').click();
    const body = win.document.querySelector('.gsg-modal-body');
    assert.ok(body.textContent.includes('添付：本文または件名に「添付」がありますが、添付ファイルなし'));
  });

  run('attachment keyword warning triggers when subject contains 添付 and only recipient chip exists', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="資料を添付します">
        <div aria-label="To">
          <div role="listitem" class="recipient-chip">
            <span email="client@example.com">client@example.com</span>
            <span aria-label="client@example.com を削除"></span>
          </div>
        </div>
        <div contenteditable="true" role="textbox">よろしくお願いいたします。</div>
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
      </div>
    `, {
      attachmentCheckEnabled: true,
      confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false }
    });

    win.document.getElementById('sendBtn').click();
    const body = win.document.querySelector('.gsg-modal-body');
    assert.ok(body.textContent.includes('添付：本文または件名に「添付」がありますが、添付ファイルなし'));
  });

  run('real attachment still suppresses attachment keyword warning', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="資料を添付します">
        <div aria-label="To">
          <div role="listitem" class="recipient-chip">
            <span email="client@example.com">client@example.com</span>
            <span aria-label="client@example.com を削除"></span>
          </div>
        </div>
        <div contenteditable="true" role="textbox">よろしくお願いいたします。</div>
        <div role="listitem">
          <span aria-label="Remove attachment - report.pdf"></span>
          <span>86 KB</span>
        </div>
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
      </div>
    `, {
      attachmentCheckEnabled: true,
      confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false }
    });

    win.document.getElementById('sendBtn').click();
    const body = win.document.querySelector('.gsg-modal-body');
    assert.ok(!body.textContent.includes('添付：本文または件名に「添付」がありますが、添付ファイルなし'));
    assert.ok(body.textContent.includes('report.pdf'));
  });

  run('final send button is disabled while autoBcc pending', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog" id="c1">
        <input name="subjectbox" value="Test Subject">
        <div aria-label="Message Body" contenteditable="true">Body</div>
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
      </div>
    `, { autoBccEnabled: true, autoBccAddress: 'test@example.com' });

    win.GmailSendGuardChecks.evaluateAutoBccState = () => ({ status: 'warn', reason: 'pending' });
    
    const sendBtn = win.document.getElementById('sendBtn');
    sendBtn.click();
    
    const confirmBtn = win.document.querySelector('.gsg-btn-confirm');
    assert.ok(confirmBtn);
    assert.strictEqual(confirmBtn.disabled, true);
    assert.strictEqual(confirmBtn.textContent, 'BCC追加確認中...');
  });

  run('final send button remains warning when subject confirmation is required', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog" id="c1">
        <input name="subjectbox" value="Test Subject">
        <div aria-label="Message Body" contenteditable="true">Body</div>
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
      </div>
    `, { autoBccEnabled: true, autoBccAddress: 'test@example.com' });

    win.GmailSendGuardChecks.evaluateAutoBccState = () => ({ status: 'ok', reason: 'present', target: 'test@example.com' });
    
    const sendBtn = win.document.getElementById('sendBtn');
    sendBtn.click();
    
    const confirmBtn = win.document.querySelector('.gsg-btn-confirm');
    assert.ok(confirmBtn);
    assert.strictEqual(confirmBtn.disabled, false);
    assert.strictEqual(confirmBtn.textContent, 'それでも送信する');
  });

  run('autoBcc OK re-enables final send', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog" id="c1">
        <input name="subjectbox" value="Test Subject">
        <div aria-label="Message Body" contenteditable="true">Body</div>
        <div aria-label="Bcc"><span email="test@example.com">test</span></div>
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
      </div>
    `, {
      autoBccEnabled: true,
      autoBccAddress: 'test@example.com',
      confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false }
    });

    const sendBtn = win.document.getElementById('sendBtn');
    sendBtn.click();

    const confirmBtn = win.document.querySelector('.gsg-btn-confirm');
    assert.ok(confirmBtn);
    assert.strictEqual(confirmBtn.disabled, false);
    assert.strictEqual(confirmBtn.textContent, '送信する');
  });

  run('modal groups Auto CC and Auto BCC detail addresses by domain accordions', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog" id="c1">
        <input name="subjectbox" value="Test Subject">
        <div aria-label="Message Body" contenteditable="true">Body</div>
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
      </div>
    `, {
      autoCcEnabled: true,
      autoCcAddresses: ['copy1@example.com', 'copy2@example.com', 'copy@example.org'],
      autoBccEnabled: true,
      autoBccAddresses: ['archive@example.com', 'audit@example.net'],
      confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoCc: false, autoBcc: false }
    });

    win.GmailSendGuardChecks.evaluateAutoCcState = () => ({
      status: 'ok',
      reason: 'present',
      targets: ['copy1@example.com', 'copy2@example.com', 'copy@example.org']
    });
    win.GmailSendGuardChecks.evaluateAutoBccState = () => ({
      status: 'ok',
      reason: 'present',
      targets: ['archive@example.com', 'audit@example.net']
    });
    win.document.getElementById('sendBtn').click();

    const items = Array.from(win.document.querySelectorAll('.gsg-check-item'));
    const autoCcItem = items.find((item) => item.querySelector('.gsg-check-title')?.textContent === '自動CC');
    const autoBccItem = items.find((item) => item.querySelector('.gsg-check-title')?.textContent === '自動BCC');
    assert.ok(autoCcItem);
    assert.ok(autoBccItem);
    assert.strictEqual(autoCcItem.querySelectorAll('.gsg-domain-accordion').length, 2);
    assert.strictEqual(autoBccItem.querySelectorAll('.gsg-domain-accordion').length, 2);
    assert.deepStrictEqual(
      Array.from(autoCcItem.querySelectorAll('.gsg-domain-details li'), (node) => node.textContent).sort(),
      ['copy1@example.com', 'copy2@example.com', 'copy@example.org'].sort()
    );
    assert.deepStrictEqual(
      Array.from(autoBccItem.querySelectorAll('.gsg-domain-details li'), (node) => node.textContent).sort(),
      ['archive@example.com', 'audit@example.net'].sort()
    );
    assert.ok(Array.from(autoCcItem.querySelectorAll('.gsg-domain-badge')).every((node) => node.textContent === '自動CC'));
    assert.ok(Array.from(autoBccItem.querySelectorAll('.gsg-domain-badge')).every((node) => node.textContent === '自動BCC'));
    assert.ok(autoCcItem.textContent.includes('example.com'));
    assert.ok(autoCcItem.textContent.includes('2件'));
  });

  run('Auto BCC warning keeps configured detail addresses visible in domain accordions', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog" id="c1">
        <input name="subjectbox" value="Test Subject">
        <div aria-label="Message Body" contenteditable="true">Body</div>
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
      </div>
    `, {
      autoBccEnabled: true,
      autoBccAddresses: ['archive@example.com', 'audit@example.net'],
      confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoCc: false, autoBcc: false }
    });

    win.GmailSendGuardChecks.evaluateAutoBccState = () => ({
      status: 'warn',
      reason: 'missing',
      targets: ['archive@example.com', 'audit@example.net'],
      missingTargets: ['audit@example.net']
    });
    win.document.getElementById('sendBtn').click();
    const items = Array.from(win.document.querySelectorAll('.gsg-check-item'));
    const autoBccItem = items.find((item) => item.querySelector('.gsg-check-title')?.textContent === '自動BCC');
    assert.ok(autoBccItem.textContent.includes('設定済みBCCアドレスの一部が追加されていません。'));
    assert.strictEqual(autoBccItem.querySelectorAll('.gsg-domain-accordion').length, 2);
    assert.deepStrictEqual(
      Array.from(autoBccItem.querySelectorAll('.gsg-domain-details li'), (node) => node.textContent).sort(),
      ['archive@example.com', 'audit@example.net'].sort()
    );
  });

  run('reply autoBcc expands collapsed recipients and injects without manual recipient click', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog" id="replyCompose">
        <input name="subjectbox" value="Reply Subject">
        <div class="reply-recipient-summary" id="recipientSummary" aria-label="宛先">
          To: client@example.com
        </div>
        <div id="recipientEditor" hidden>
          <button id="bccToggle" aria-label="Bcc">Bcc</button>
          <div id="bccRow" hidden>
            <input aria-label="Bcc" id="bccInput">
          </div>
          <div aria-label="Bcc" id="bccChips"></div>
        </div>
        <div contenteditable="true" role="textbox">Reply body</div>
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
      </div>
    `, {
      subjectCheckEnabled: false,
      autoBccEnabled: true,
      autoBccAddress: 'archive@example.com',
      confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false }
    });
    const timers = installQueuedTimers(win);
    let recipientExpanded = false;
    let bccOpened = false;

    const recipientSummary = win.document.getElementById('recipientSummary');
    const recipientEditor = win.document.getElementById('recipientEditor');
    const bccToggle = win.document.getElementById('bccToggle');
    const bccRow = win.document.getElementById('bccRow');
    const bccInput = win.document.getElementById('bccInput');
    const bccChips = win.document.getElementById('bccChips');

    recipientSummary.addEventListener('click', () => {
      recipientExpanded = true;
      recipientEditor.hidden = false;
    });
    bccToggle.addEventListener('click', () => {
      bccOpened = true;
      bccRow.hidden = false;
    });
    bccInput.addEventListener('keydown', (event) => {
      if ((event.key !== 'Enter' && event.key !== 'Tab') || !bccInput.value) return;
      if (bccChips.querySelector('[email="archive@example.com"]')) return;
      const chip = win.document.createElement('span');
      chip.setAttribute('email', bccInput.value);
      chip.textContent = bccInput.value;
      bccChips.appendChild(chip);
    });

    win.GmailSendGuardTestHooks.scanComposesForTest();
    timers.flush();

    assert.strictEqual(recipientExpanded, true);
    assert.strictEqual(bccOpened, true);
    assert.ok(bccChips.querySelector('[email="archive@example.com"]'));
    win.document.getElementById('sendBtn').click();
    const confirmBtn = win.document.querySelector('.gsg-btn-confirm');
    assert.strictEqual(confirmBtn.disabled, false);
    assert.strictEqual(confirmBtn.textContent, '送信する');
  });

  run('reply autoBcc does not double click async Bcc toggle before input appears', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog" id="replyCompose">
        <input name="subjectbox" value="Reply Subject">
        <span id="bccToggle" class="gO aQY">Bcc</span>
        <div id="bccMount"></div>
        <div contenteditable="true" role="textbox">Reply body</div>
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
      </div>
    `, {
      subjectCheckEnabled: false,
      autoBccEnabled: true,
      autoBccAddress: 'archive@example.com',
      confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false }
    });
    const timers = installQueuedTimers(win);
    let bccToggleClickCount = 0;
    const bccToggle = win.document.getElementById('bccToggle');
    const bccMount = win.document.getElementById('bccMount');

    bccToggle.addEventListener('click', () => {
      bccToggleClickCount++;
      win.setTimeout(() => {
        if (win.document.getElementById('bccInput')) return;
        const input = win.document.createElement('input');
        input.id = 'bccInput';
        input.setAttribute('aria-label', 'Bcc');
        const chips = win.document.createElement('div');
        chips.id = 'bccChips';
        chips.setAttribute('aria-label', 'Bcc');
        input.addEventListener('keydown', (event) => {
          if ((event.key !== 'Enter' && event.key !== 'Tab') || !input.value) return;
          const chip = win.document.createElement('span');
          chip.setAttribute('email', input.value);
          chips.appendChild(chip);
        });
        bccMount.appendChild(input);
        bccMount.appendChild(chips);
      });
    });

    win.GmailSendGuardTestHooks.scanComposesForTest();
    assert.strictEqual(bccToggleClickCount, 1);

    timers.flush();

    assert.strictEqual(bccToggleClickCount, 1);
    assert.ok(win.document.querySelector('#bccChips [email="archive@example.com"]'));
    win.document.getElementById('sendBtn').click();
    const confirmBtn = win.document.querySelector('.gsg-btn-confirm');
    assert.strictEqual(confirmBtn.disabled, false);
    assert.strictEqual(confirmBtn.textContent, '送信する');
  });

  run('reply autoBcc expands outer recipient controls when send button is in nested body area', () => {
    const win = setupWindowWithScripts(`
      <div class="reply-compose" id="outerReply">
        <div id="recipientSummary">To: client@example.com</div>
        <div id="recipientEditor" hidden>
          <button id="bccToggle">Bcc</button>
          <div id="bccMount"></div>
        </div>
        <div id="replyBodyArea">
          <div contenteditable="true" role="textbox" aria-label="本文">Reply body</div>
          <div role="button" data-tooltip="送信" id="sendBtn"></div>
        </div>
      </div>
    `, {
      subjectCheckEnabled: false,
      autoBccEnabled: true,
      autoBccAddress: 'archive@example.com',
      confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false }
    });
    const timers = installQueuedTimers(win);
    let recipientExpanded = false;
    let bccOpened = false;

    const recipientSummary = win.document.getElementById('recipientSummary');
    const recipientEditor = win.document.getElementById('recipientEditor');
    const bccToggle = win.document.getElementById('bccToggle');
    const bccMount = win.document.getElementById('bccMount');

    recipientSummary.addEventListener('click', () => {
      recipientExpanded = true;
      recipientEditor.hidden = false;
    });
    bccToggle.addEventListener('click', () => {
      if (win.document.getElementById('bccInput')) return;
      bccOpened = true;
      const input = win.document.createElement('input');
      input.id = 'bccInput';
      input.setAttribute('aria-label', 'Bcc');
      const chips = win.document.createElement('div');
      chips.id = 'bccChips';
      chips.setAttribute('aria-label', 'Bcc');
      input.addEventListener('keydown', (event) => {
        if ((event.key !== 'Enter' && event.key !== 'Tab') || !input.value) return;
        if (chips.querySelector('[email="archive@example.com"]')) return;
        const chip = win.document.createElement('span');
        chip.setAttribute('email', input.value);
        chip.textContent = input.value;
        chips.appendChild(chip);
      });
      bccMount.appendChild(input);
      bccMount.appendChild(chips);
    });

    win.GmailSendGuardTestHooks.scanComposesForTest();
    timers.flush();

    assert.strictEqual(recipientExpanded, true);
    assert.strictEqual(bccOpened, true);
    assert.ok(win.document.querySelector('#bccChips [email="archive@example.com"]'));
    win.document.getElementById('sendBtn').click();
    const confirmBtn = win.document.querySelector('.gsg-btn-confirm');
    assert.strictEqual(confirmBtn.disabled, false);
    assert.strictEqual(confirmBtn.textContent, '送信する');
  });

  run('autoBcc injects multiple configured addresses and enables send after all are present', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog" id="compose">
        <input name="subjectbox" value="Test Subject">
        <div id="bccArea">
          <input aria-label="Bcc" id="bccInput">
          <div aria-label="Bcc" id="bccChips"></div>
        </div>
        <div contenteditable="true" role="textbox">Body</div>
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
      </div>
    `, {
      autoBccEnabled: true,
      autoBccAddresses: ['archive1@example.com', 'archive2@example.com'],
      confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false }
    });

    const bccInput = win.document.getElementById('bccInput');
    const bccChips = win.document.getElementById('bccChips');
    bccInput.addEventListener('keydown', (event) => {
      if ((event.key !== 'Enter' && event.key !== 'Tab') || !bccInput.value) return;
      if (bccChips.querySelector(`[email="${bccInput.value}"]`)) return;
      const chip = win.document.createElement('span');
      chip.setAttribute('email', bccInput.value);
      chip.textContent = bccInput.value;
      bccChips.appendChild(chip);
    });

    win.GmailSendGuardTestHooks.scanComposesForTest();

    assert.ok(bccChips.querySelector('[email="archive1@example.com"]'));
    assert.ok(bccChips.querySelector('[email="archive2@example.com"]'));
    win.document.getElementById('sendBtn').click();
    const confirmBtn = win.document.querySelector('.gsg-btn-confirm');
    assert.strictEqual(confirmBtn.disabled, false);
    assert.strictEqual(confirmBtn.textContent, '送信する');
    assert.ok(win.document.querySelector('.gsg-modal-body').textContent.includes('設定済みBCCアドレス（2件）'));
  });

  run('autoCc injects multiple configured addresses on compose scan', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog" id="compose">
        <input name="subjectbox" value="Test Subject">
        <div id="ccArea">
          <input aria-label="Cc" id="ccInput">
          <div aria-label="Cc" id="ccChips"></div>
        </div>
        <div contenteditable="true" role="textbox">Body</div>
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
      </div>
    `, {
      autoCcEnabled: true,
      autoCcAddresses: ['copy1@example.com', 'copy2@example.com'],
      confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoCc: false, autoBcc: false }
    });

    const ccInput = win.document.getElementById('ccInput');
    const ccChips = win.document.getElementById('ccChips');
    ccInput.addEventListener('keydown', (event) => {
      if ((event.key !== 'Enter' && event.key !== 'Tab') || !ccInput.value) return;
      if (ccChips.querySelector(`[email="${ccInput.value}"]`)) return;
      const chip = win.document.createElement('span');
      chip.setAttribute('email', ccInput.value);
      chip.textContent = ccInput.value;
      ccChips.appendChild(chip);
    });

    win.GmailSendGuardTestHooks.scanComposesForTest();

    assert.ok(ccChips.querySelector('[email="copy1@example.com"]'));
    assert.ok(ccChips.querySelector('[email="copy2@example.com"]'));
    win.document.getElementById('sendBtn').click();
    const confirmBtn = win.document.querySelector('.gsg-btn-confirm');
    assert.strictEqual(confirmBtn.disabled, false);
    assert.strictEqual(confirmBtn.textContent, '送信する');
    assert.ok(win.document.querySelector('.gsg-modal-body').textContent.includes('設定済みCCアドレス（2件）'));
  });

  run('reply autoCc expands collapsed recipients and injects without opening modal', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog" id="replyCompose">
        <input name="subjectbox" value="Reply Subject">
        <div class="reply-recipient-summary" id="recipientSummary" aria-label="宛先">To: client@example.com</div>
        <div id="recipientEditor" hidden>
          <button id="ccToggle" aria-label="Cc">Cc</button>
          <div id="ccRow" hidden>
            <input aria-label="Cc" id="ccInput">
          </div>
          <div aria-label="Cc" id="ccChips"></div>
        </div>
        <div contenteditable="true" role="textbox">Reply body</div>
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
      </div>
    `, {
      subjectCheckEnabled: false,
      autoCcEnabled: true,
      autoCcAddress: 'copy@example.com',
      confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoCc: false, autoBcc: false }
    });
    const timers = installQueuedTimers(win);
    let recipientExpanded = false;
    let ccOpened = false;

    const recipientSummary = win.document.getElementById('recipientSummary');
    const recipientEditor = win.document.getElementById('recipientEditor');
    const ccToggle = win.document.getElementById('ccToggle');
    const ccRow = win.document.getElementById('ccRow');
    const ccInput = win.document.getElementById('ccInput');
    const ccChips = win.document.getElementById('ccChips');

    recipientSummary.addEventListener('click', () => {
      recipientExpanded = true;
      recipientEditor.hidden = false;
    });
    ccToggle.addEventListener('click', () => {
      ccOpened = true;
      ccRow.hidden = false;
    });
    ccInput.addEventListener('keydown', (event) => {
      if ((event.key !== 'Enter' && event.key !== 'Tab') || !ccInput.value) return;
      if (ccChips.querySelector('[email="copy@example.com"]')) return;
      const chip = win.document.createElement('span');
      chip.setAttribute('email', ccInput.value);
      chip.textContent = ccInput.value;
      ccChips.appendChild(chip);
    });

    win.GmailSendGuardTestHooks.scanComposesForTest();
    timers.flush();

    assert.strictEqual(recipientExpanded, true);
    assert.strictEqual(ccOpened, true);
    assert.ok(ccChips.querySelector('[email="copy@example.com"]'));
    assert.strictEqual(win.document.querySelector('.gsg-modal-overlay').classList.contains('gsg-active'), false);
  });

  run('reply autoCc and autoBcc prefer add controls over recipient summary', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog" id="replyCompose">
        <input name="subjectbox" value="Reply Subject">
        <div class="aoD hl" id="recipientSummary" tabindex="1">
          <span email="client@example.com">Client</span>
        </div>
        <div id="recipientActions">
          <span id="ccAdd" class="aB gQ pE" role="link" tabindex="1" aria-label="Cc の宛先を追加">Cc</span>
          <span id="bccAdd" class="aB gQ pB" role="link" tabindex="1" aria-label="Bcc の宛先を追加">Bcc</span>
        </div>
        <div id="ccMount"></div>
        <div id="bccMount"></div>
        <div contenteditable="true" role="textbox">Reply body</div>
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
      </div>
    `, {
      subjectCheckEnabled: false,
      autoCcEnabled: true,
      autoCcAddress: 'copy@example.com',
      autoBccEnabled: true,
      autoBccAddress: 'archive@example.com',
      confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoCc: false, autoBcc: false }
    });
    const timers = installQueuedTimers(win);
    const events = [];
    let recipientExpanded = false;

    const recipientSummary = win.document.getElementById('recipientSummary');
    const ccAdd = win.document.getElementById('ccAdd');
    const bccAdd = win.document.getElementById('bccAdd');
    const ccMount = win.document.getElementById('ccMount');
    const bccMount = win.document.getElementById('bccMount');

    function mountRecipientInput(mount, field, expectedEmail) {
      if (mount.querySelector('input')) return;
      const input = win.document.createElement('input');
      input.setAttribute('aria-label', field);
      const chips = win.document.createElement('div');
      chips.setAttribute('aria-label', field);
      input.addEventListener('keydown', (event) => {
        if ((event.key !== 'Enter' && event.key !== 'Tab') || !input.value) return;
        if (chips.querySelector(`[email="${expectedEmail}"]`)) return;
        const chip = win.document.createElement('span');
        chip.setAttribute('email', input.value);
        chip.textContent = input.value;
        chips.appendChild(chip);
      });
      mount.appendChild(input);
      mount.appendChild(chips);
    }

    recipientSummary.addEventListener('click', () => {
      recipientExpanded = true;
      events.push('expand');
    });
    ccAdd.addEventListener('click', () => {
      events.push('cc');
      mountRecipientInput(ccMount, 'Cc', 'copy@example.com');
    });
    bccAdd.addEventListener('click', () => {
      events.push('bcc');
      mountRecipientInput(bccMount, 'Bcc', 'archive@example.com');
    });

    win.GmailSendGuardTestHooks.scanComposesForTest();
    timers.flush();

    assert.strictEqual(recipientExpanded, false);
    assert.deepStrictEqual(events, ['cc', 'bcc']);
    assert.ok(ccMount.querySelector('[email="copy@example.com"]'));
    assert.ok(bccMount.querySelector('[email="archive@example.com"]'));
    assert.strictEqual(win.document.querySelector('.gsg-modal-overlay').classList.contains('gsg-active'), false);
  });

  run('reply autoCc and autoBcc inject when compose recipients appear before send button', () => {
    const win = setupWindowWithScripts(`
      <div class="reply-compose" id="replyCompose">
        <div class="aoD hl" id="recipientSummary" tabindex="1">
          <span email="client@example.com">Client</span>
        </div>
        <span id="ccAdd" class="aB gQ pE" role="link" tabindex="1" aria-label="Cc の宛先を追加">Cc</span>
        <span id="bccAdd" class="aB gQ pB" role="link" tabindex="1" aria-label="Bcc の宛先を追加">Bcc</span>
        <div id="ccMount"></div>
        <div id="bccMount"></div>
        <div contenteditable="true" role="textbox">Reply body</div>
      </div>
    `, {
      subjectCheckEnabled: false,
      autoCcEnabled: true,
      autoCcAddress: 'copy@example.com',
      autoBccEnabled: true,
      autoBccAddress: 'archive@example.com',
      confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoCc: false, autoBcc: false }
    });
    const timers = installQueuedTimers(win);
    let recipientExpanded = false;

    function mountRecipientInput(mountId, field) {
      const mount = win.document.getElementById(mountId);
      if (mount.querySelector('input')) return;
      const input = win.document.createElement('input');
      input.setAttribute('aria-label', field);
      const chips = win.document.createElement('div');
      chips.setAttribute('aria-label', field);
      input.addEventListener('keydown', (event) => {
        if ((event.key !== 'Enter' && event.key !== 'Tab') || !input.value) return;
        const chip = win.document.createElement('span');
        chip.setAttribute('email', input.value);
        chip.textContent = input.value;
        chips.appendChild(chip);
      });
      mount.appendChild(input);
      mount.appendChild(chips);
    }

    win.document.getElementById('recipientSummary').addEventListener('click', () => {
      recipientExpanded = true;
    });
    win.document.getElementById('ccAdd').addEventListener('click', () => {
      mountRecipientInput('ccMount', 'Cc');
    });
    win.document.getElementById('bccAdd').addEventListener('click', () => {
      mountRecipientInput('bccMount', 'Bcc');
    });

    win.GmailSendGuardTestHooks.scanComposesForTest();
    timers.flush();

    assert.strictEqual(recipientExpanded, false);
    assert.ok(win.document.querySelector('#ccMount [email="copy@example.com"]'));
    assert.ok(win.document.querySelector('#bccMount [email="archive@example.com"]'));
    assert.strictEqual(win.document.querySelector('.gsg-modal-overlay').classList.contains('gsg-active'), false);
  });

  run('autoBcc failure clears pending and enables send with warning', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog" id="replyCompose">
        <input name="subjectbox" value="Reply Subject">
        <div class="reply-recipient-summary" id="recipientSummary" aria-label="宛先">
          To: client@example.com
        </div>
        <div contenteditable="true" role="textbox">Reply body</div>
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
      </div>
    `, {
      autoBccEnabled: true,
      autoBccAddress: 'archive@example.com',
      confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false }
    });
    const timers = installQueuedTimers(win);

    win.GmailSendGuardTestHooks.scanComposesForTest();
    win.document.getElementById('sendBtn').click();
    let confirmBtn = win.document.querySelector('.gsg-btn-confirm');
    assert.strictEqual(confirmBtn.disabled, true);
    assert.strictEqual(confirmBtn.textContent, 'BCC追加確認中...');

    timers.flush();

    confirmBtn = win.document.querySelector('.gsg-btn-confirm');
    assert.strictEqual(confirmBtn.disabled, false);
    assert.strictEqual(confirmBtn.textContent, 'それでも送信する');
    assert.ok(win.document.querySelector('.gsg-modal-body').textContent.includes('BCCの自動追加に失敗しました。'));
  });

  run('Auto BCC modal distinguishes enabled without an address from disabled Auto CC', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Subject">
        <div contenteditable="true" role="textbox">Body</div>
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
      </div>
    `, {
      autoBccEnabled: true,
      confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false }
    });

    win.document.getElementById('sendBtn').click();
    const modalText = win.document.querySelector('.gsg-modal-body').textContent;
    assert.ok(modalText.includes('自動CCは無効です。'));
    assert.ok(modalText.includes('自動BCCは有効ですが、アドレスが登録されていません。'));
    assert.strictEqual(win.document.querySelector('.gsg-btn-confirm').textContent, 'それでも送信する');
  });

  run('final send button is enabled with warning after autoBcc missing', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog" id="c1">
        <input name="subjectbox" value="Test Subject">
        <div aria-label="Message Body" contenteditable="true">Body</div>
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
      </div>
    `, { autoBccEnabled: true, autoBccAddress: 'test@example.com' });

    win.GmailSendGuardChecks.evaluateAutoBccState = () => ({ status: 'warn', reason: 'missing', target: 'test@example.com' });
    
    const sendBtn = win.document.getElementById('sendBtn');
    sendBtn.click();
    
    const confirmBtn = win.document.querySelector('.gsg-btn-confirm');
    assert.ok(confirmBtn);
    assert.strictEqual(confirmBtn.disabled, false);
    assert.strictEqual(confirmBtn.textContent, 'それでも送信する');
    assert.ok(win.document.querySelector('.gsg-modal-body').textContent.includes('設定済みBCCアドレスの一部または全部が追加されていません。'));
  });

  run('modal displays filename and size', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog" id="c1">
        <input name="subjectbox" value="Test Subject">
        <div aria-label="Message Body" contenteditable="true">Body</div>
        <div role="listitem">
          <span aria-label="Remove attachment doc.pdf"></span>
          <span>12 KB</span>
        </div>
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
      </div>
    `, { attachmentCheckEnabled: true });

    const sendBtn = win.document.getElementById('sendBtn');
    sendBtn.click();
    
    const body = win.document.querySelector('.gsg-modal-body');
    assert.ok(body);
    assert.ok(body.textContent.includes('doc.pdf'));
    assert.ok(body.textContent.includes('12 KB'));
  });

  run('modal displays サイズ不明 when sizeText is empty', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog" id="c1">
        <input name="subjectbox" value="Test Subject">
        <div aria-label="Message Body" contenteditable="true">Body</div>
        <div role="listitem" title="doc.pdf">
          <!-- no size -->
        </div>
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
      </div>
    `, { attachmentCheckEnabled: true });

    const sendBtn = win.document.getElementById('sendBtn');
    sendBtn.click();
    
    const body = win.document.querySelector('.gsg-modal-body');
    assert.ok(body.textContent.includes('doc.pdf / サイズ不明'));
  });

  run('modal displays アップロード中 when status is uploading', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog" id="c1">
        <input name="subjectbox" value="Test Subject">
        <div aria-label="Message Body" contenteditable="true">Body</div>
        <div role="listitem" title="doc.pdf">
          <div role="progressbar"></div>
        </div>
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
      </div>
    `, { attachmentCheckEnabled: true });

    const sendBtn = win.document.getElementById('sendBtn');
    sendBtn.click();
    
    const body = win.document.querySelector('.gsg-modal-body');
    assert.ok(body.textContent.includes('doc.pdf / アップロード中'));
    
    const confirmBtn = win.document.querySelector('.gsg-btn-confirm');
    assert.ok(confirmBtn);
    assert.strictEqual(confirmBtn.disabled, true);
    assert.strictEqual(confirmBtn.textContent, '添付アップロード中...');
  });

  run('ready attachment with .vq does not disable final send button', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog" id="c1">
        <input name="subjectbox" value="Test Subject">
        <div aria-label="Message Body" contenteditable="true">Body</div>
        <div role="listitem" title="report.pdf">
          <span class="vq"></span>
          <span>20 KB</span>
        </div>
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
      </div>
    `, {
      attachmentCheckEnabled: true,
      confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false }
    });

    win.document.getElementById('sendBtn').click();
    const confirmBtn = win.document.querySelector('.gsg-btn-confirm');
    assert.strictEqual(confirmBtn.disabled, false);
    assert.strictEqual(confirmBtn.textContent, '送信する');
    assert.ok(win.document.querySelector('.gsg-modal-body').textContent.includes('report.pdf / 20 KB'));
  });

  run('ready attachment with .vy does not disable final send button', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog" id="c1">
        <input name="subjectbox" value="Test Subject">
        <div aria-label="Message Body" contenteditable="true">Body</div>
        <div role="listitem" title="report.pdf">
          <span class="vy"></span>
          <span>20 KB</span>
        </div>
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
      </div>
    `, {
      attachmentCheckEnabled: true,
      confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false }
    });

    win.document.getElementById('sendBtn').click();
    const confirmBtn = win.document.querySelector('.gsg-btn-confirm');
    assert.strictEqual(confirmBtn.disabled, false);
    assert.strictEqual(confirmBtn.textContent, '送信する');
    assert.ok(win.document.querySelector('.gsg-modal-body').textContent.includes('report.pdf / 20 KB'));
  });

  run('snapshot used for attachment check does not include quoted body', () => {
    const win = setupWindowWithScripts(`
      <div class="reply-compose">
        <input name="subjectbox" value="Sub">
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
        <div contenteditable="true" role="textbox">
          <div>New Body</div>
          <div class="gmail_quote">Quoted</div>
        </div>
      </div>
    `, { attachmentCheckEnabled: true });
    
    // Intercept checks.evaluateAttachment to capture arguments
    let capturedCurrentBody = null;
    const originalEval = win.GmailSendGuardChecks.evaluateAttachment;
    win.GmailSendGuardChecks.evaluateAttachment = function(subj, body, count, keywords) {
      capturedCurrentBody = body; // This is the second argument
      return originalEval.apply(this, arguments);
    };

    const sendBtn = win.document.getElementById('sendBtn');
    sendBtn.click();
    
    assert.strictEqual(capturedCurrentBody.trim(), 'New Body');
  });

  run('attachment evaluation path uses currentBody, not readBody', () => {
    const win = setupWindowWithScripts(`
      <div class="reply-compose">
        <input name="subjectbox" value="Sub">
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
        <div contenteditable="true" role="textbox">
          <div>New Body</div>
          <div class="gmail_quote">Quoted 添付</div>
        </div>
      </div>
    `, { attachmentCheckEnabled: true });

    win.GmailSendGuardDom.readBody = () => 'Quoted 添付';
    win.GmailSendGuardDom.readCurrentComposeBody = () => 'New Body';
    let evaluatedBody = '';
    const originalEval = win.GmailSendGuardChecks.evaluateAttachment;
    win.GmailSendGuardChecks.evaluateAttachment = function(subj, body, count, keywords) {
      evaluatedBody = body;
      return originalEval.apply(this, arguments);
    };

    win.document.getElementById('sendBtn').click();
    assert.strictEqual(evaluatedBody, 'New Body');
    assert.notStrictEqual(evaluatedBody, 'Quoted 添付');
  });

  run('send guard modal renders Japanese labels when language=ja', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="件名">
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
        <div contenteditable="true" role="textbox">本文</div>
      </div>
    `, {
      language: 'ja',
      confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false }
    });

    win.document.getElementById('sendBtn').click();
    assert.ok(win.document.querySelector('.gsg-modal-header').textContent.includes('送信前チェック'));
    assert.ok(win.document.querySelector('.gsg-modal-body').textContent.includes('件名の確認'));
  });

  run('send guard modal renders English labels when language=en', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Subject">
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
        <div contenteditable="true" role="textbox">Body</div>
      </div>
    `, {
      language: 'en',
      confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false }
    });

    win.document.getElementById('sendBtn').click();
    assert.ok(win.document.querySelector('.gsg-modal-header').textContent.includes('Pre-send Check'));
    assert.ok(win.document.querySelector('.gsg-modal-body').textContent.includes('Subject check'));
  });

  run('modal button text changes by language', () => {
    const jaWin = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="件名">
        <div role="button" data-tooltip="送信" id="sendJa"></div>
        <div contenteditable="true" role="textbox">本文</div>
      </div>
    `, {
      language: 'ja',
      confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false }
    });
    jaWin.document.getElementById('sendJa').click();
    assert.strictEqual(jaWin.document.querySelector('.gsg-btn-confirm').textContent, '送信する');

    const enWin = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Subject">
        <div role="button" data-tooltip="送信" id="sendEn"></div>
        <div contenteditable="true" role="textbox">Body</div>
      </div>
    `, {
      language: 'en',
      confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false }
    });
    enWin.document.getElementById('sendEn').click();
    assert.strictEqual(enWin.document.querySelector('.gsg-btn-confirm').textContent, 'Send');
  });

  run('dynamic attachment keyword warning is localized', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Subject">
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
        <div contenteditable="true" role="textbox">添付します。</div>
      </div>
    `, {
      language: 'en',
      attachmentCheckEnabled: true,
      confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false }
    });

    win.document.getElementById('sendBtn').click();
    const modalText = win.document.querySelector('.gsg-modal-body').textContent;
    assert.ok(modalText.includes('The subject or current message contains "添付", but no attachment was found.'));
  });

  run('user-derived subject/domain/attachment text is rendered safely', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="&lt;b&gt;Subject&lt;/b&gt;">
        <div aria-label="To"><span email="user@example.com">user@example.com</span></div>
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
        <div contenteditable="true" role="textbox">Body</div>
        <div role="listitem" title="report&lt;svg&gt;.pdf"><span>20 KB</span></div>
      </div>
    `, {
      language: 'en',
      attachmentCheckEnabled: true,
      confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false }
    });

    win.document.getElementById('sendBtn').click();
    const modal = win.document.querySelector('.gsg-modal-body');
    assert.ok(modal.textContent.includes('<b>Subject</b>'));
    assert.ok(modal.textContent.includes('example.com'));
    assert.ok(modal.textContent.includes('report<svg>.pdf'));
    assert.strictEqual(modal.querySelector('b'), null);
    assert.strictEqual(modal.querySelector('svg'), null);
  });

  run('Ctrl+Enter/Cmd+Enter flow still works with Japanese UI', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="件名">
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
        <div contenteditable="true" role="textbox" id="bodyBox">本文</div>
      </div>
    `, {
      language: 'ja',
      confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false }
    });

    let sentCount = 0;
    win.document.getElementById('sendBtn').addEventListener('click', () => {
      sentCount++;
    });
    const bodyBox = win.document.getElementById('bodyBox');
    bodyBox.focus();
    bodyBox.dispatchEvent(new win.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
      code: 'Enter',
      ctrlKey: true
    }));
    assert.ok(win.document.querySelector('.gsg-modal-header').textContent.includes('送信前チェック'));
    win.document.querySelector('.gsg-btn-confirm').click();
    assert.strictEqual(sentCount, 1);
  });

  run('Ctrl+Enter/Cmd+Enter flow still works with English UI', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Subject">
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
        <div contenteditable="true" role="textbox" id="bodyBox">Body</div>
      </div>
    `, {
      language: 'en',
      confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false }
    });

    let sentCount = 0;
    win.document.getElementById('sendBtn').addEventListener('click', () => {
      sentCount++;
    });
    const bodyBox = win.document.getElementById('bodyBox');
    bodyBox.focus();
    bodyBox.dispatchEvent(new win.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
      code: 'Enter',
      metaKey: true
    }));
    assert.ok(win.document.querySelector('.gsg-modal-header').textContent.includes('Pre-send Check'));
    win.document.querySelector('.gsg-btn-confirm').click();
    assert.strictEqual(sentCount, 1);
  });

  run('performance counters are not degraded by language selection', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Subject">
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
        <div contenteditable="true" role="textbox">Body</div>
      </div>
    `, {
      language: 'en',
      confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false }
    });

    const hooks = win.GmailSendGuardTestHooks;
    hooks.resetMetrics();
    win.document.getElementById('sendBtn').click();
    const metrics = hooks.getMetrics();
    assert.strictEqual(metrics.snapshotReadCount, 1);
    assert.strictEqual(metrics.readCurrentComposeBodyCallCount, 1);
    assert.strictEqual(metrics.readAttachmentsCallCount, 1);
  });

  run('modal refreshes from 添付アップロード中 to 送信する after upload completes', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
        <div contenteditable="true" role="textbox">Body</div>
        <div id="att-container">
          <div role="listitem" title="file.pdf"><progress value="50" max="100"></progress></div>
        </div>
      </div>
    `, { 
        attachmentCheckEnabled: true,
        confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false } 
    });

    let timeoutCb = null;
    win.setTimeout = (cb, ms) => {
        timeoutCb = cb;
        return 123;
    };
    win.clearTimeout = () => {};

    const sendBtn = win.document.getElementById('sendBtn');
    sendBtn.click();
    
    let confirmBtn = win.document.querySelector('.gsg-btn-confirm');
    assert.strictEqual(confirmBtn.disabled, true);
    assert.strictEqual(confirmBtn.textContent, '添付アップロード中...');

    // Simulate upload finish
    const container = win.document.getElementById('att-container');
    const readyItem = win.document.createElement('div');
    readyItem.setAttribute('role', 'listitem');
    const removeButton = win.document.createElement('div');
    removeButton.setAttribute('aria-label', 'Remove attachment - file.pdf');
    const completeProgress = win.document.createElement('progress');
    completeProgress.setAttribute('value', '100');
    completeProgress.setAttribute('max', '100');
    readyItem.appendChild(removeButton);
    readyItem.appendChild(completeProgress);
    container.replaceChildren(readyItem);

    // Trigger timer
    if (timeoutCb) timeoutCb();

    confirmBtn = win.document.querySelector('.gsg-btn-confirm');
    assert.strictEqual(confirmBtn.disabled, false);
    assert.strictEqual(confirmBtn.textContent, '送信する');
  });

  run('modal refresh timer stops when modal is closed', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
        <div contenteditable="true" role="textbox">Body</div>
        <div role="listitem" title="file.pdf"><progress value="50" max="100"></progress></div>
      </div>
    `, {
      attachmentCheckEnabled: true,
      confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false }
    });

    const clearedTimers = [];
    win.setTimeout = () => 777;
    win.clearTimeout = (timerId) => {
      clearedTimers.push(timerId);
    };

    win.document.getElementById('sendBtn').click();
    const btn = win.document.querySelector('.gsg-btn-confirm');
    assert.strictEqual(btn.disabled, true);
    assert.strictEqual(btn.textContent, '添付アップロード中...');

    win.document.querySelector('.gsg-btn-cancel').click();
    assert.ok(clearedTimers.includes(777), `Expected upload refresh timer to be cleared. Got: ${clearedTimers.join(',')}`);
  });

  run('MutationObserver burst schedules at most one scan per debounce window', async () => {
    const win = setupWindowWithScripts(`
      <div role="dialog" id="c1">
        <input name="subjectbox" value="Sub">
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
        <div contenteditable="true" role="textbox">Body</div>
      </div>
    `);

    const hooks = win.GmailSendGuardTestHooks;
    hooks.resetMetrics();
    const scheduled = [];
    win.setTimeout = (callback) => {
      scheduled.push(callback);
      return scheduled.length;
    };
    win.clearTimeout = () => {};

    const container = win.document.getElementById('c1');
    for (let i = 0; i < 100; i++) {
      const span = win.document.createElement('span');
      span.textContent = `tick-${i}`;
      container.appendChild(span);
    }

    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));

    assert.strictEqual(scheduled.length, 1);
    assert.strictEqual(hooks.getMetrics().scanComposesCallCount, 0);
    scheduled[0]();
    assert.strictEqual(hooks.getMetrics().scanComposesCallCount, 1);
  });

  run('scanComposes does not call readCurrentComposeBody', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
        <div contenteditable="true" role="textbox">Body</div>
      </div>
    `);

    let bodyReads = 0;
    win.GmailSendGuardDom.readCurrentComposeBody = () => {
      bodyReads++;
      return 'Body';
    };
    win.GmailSendGuardTestHooks.resetMetrics();
    win.GmailSendGuardTestHooks.scanComposesForTest();

    assert.strictEqual(bodyReads, 0);
    assert.strictEqual(win.GmailSendGuardTestHooks.getMetrics().readCurrentComposeBodyCallCount, 0);
  });

  run('scanComposes does not call readAttachments', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
        <div contenteditable="true" role="textbox">Body</div>
        <div role="listitem"><div aria-label="Remove attachment - a.pdf"></div></div>
      </div>
    `);

    let attachmentReads = 0;
    win.GmailSendGuardDom.readAttachments = () => {
      attachmentReads++;
      return [];
    };
    win.GmailSendGuardTestHooks.resetMetrics();
    win.GmailSendGuardTestHooks.scanComposesForTest();

    assert.strictEqual(attachmentReads, 0);
    assert.strictEqual(win.GmailSendGuardTestHooks.getMetrics().readAttachmentsCallCount, 0);
  });

  run('scanComposes skips Auto CC/BCC root discovery when both features are disabled', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div role="button" data-tooltip="Send" id="sendBtn"></div>
        <div contenteditable="true" role="textbox">Body</div>
      </div>
    `);

    let autoRootDiscoveryCalls = 0;
    win.GmailSendGuardDom.findAutoRecipientComposeRoots = () => {
      autoRootDiscoveryCalls++;
      return [];
    };

    win.GmailSendGuardTestHooks.scanComposesForTest();

    assert.strictEqual(autoRootDiscoveryCalls, 0);
  });

  run('Auto BCC settings changes rescan an already-open Gmail compose', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div role="button" data-tooltip="Send" id="sendBtn"></div>
        <div contenteditable="true" role="textbox">Body</div>
        <div name="bcc"><input name="bcc" id="bccInput"></div>
        <div id="bccChips"></div>
      </div>
    `);

    const bccInput = win.document.getElementById('bccInput');
    bccInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      const chip = win.document.createElement('span');
      chip.setAttribute('email', bccInput.value);
      win.document.getElementById('bccChips').appendChild(chip);
    });

    Object.assign(win.__gsgStorageState.local, {
      autoBccEnabled: true,
      autoBccAddresses: ['archive@example.com']
    });
    win.__gsgEmitStorageChange({ autoBccEnabled: { newValue: true } });

    assert.strictEqual(win.document.querySelector('#bccChips [email]')?.getAttribute('email'), 'archive@example.com');
  });

  run('send click creates exactly one snapshot before modal render', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
        <div contenteditable="true" role="textbox">Body</div>
      </div>
    `, { confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false } });

    const hooks = win.GmailSendGuardTestHooks;
    hooks.resetMetrics();
    win.document.getElementById('sendBtn').click();
    const metrics = hooks.getMetrics();

    assert.strictEqual(metrics.snapshotReadCount, 1);
    assert.strictEqual(metrics.readCurrentComposeBodyCallCount, 1);
    assert.strictEqual(metrics.readAttachmentsCallCount, 1);
  });

  run('Ctrl+Enter creates exactly one snapshot before modal render', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
        <div contenteditable="true" role="textbox" id="bodyBox">Body</div>
      </div>
    `, { confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false } });

    const hooks = win.GmailSendGuardTestHooks;
    hooks.resetMetrics();
    const bodyBox = win.document.getElementById('bodyBox');
    bodyBox.focus();
    bodyBox.dispatchEvent(new win.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
      code: 'Enter',
      ctrlKey: true
    }));
    const metrics = hooks.getMetrics();

    assert.strictEqual(metrics.snapshotReadCount, 1);
    assert.strictEqual(metrics.readCurrentComposeBodyCallCount, 1);
    assert.strictEqual(metrics.readAttachmentsCallCount, 1);
  });

  run('modal refresh timer starts only when attachment uploading exists', () => {
    const readyWin = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div role="button" data-tooltip="送信" id="sendReady"></div>
        <div contenteditable="true" role="textbox">Body</div>
        <div role="listitem" title="ready.pdf"><span>20 KB</span></div>
      </div>
    `, { confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false } });
    readyWin.setTimeout = () => 101;
    readyWin.GmailSendGuardTestHooks.resetMetrics();
    readyWin.document.getElementById('sendReady').click();
    assert.strictEqual(readyWin.GmailSendGuardTestHooks.getMetrics().modalRefreshTimerStartCount, 0);
    assert.strictEqual(readyWin.GmailSendGuardTestHooks.getMetrics().activeModalRefreshTimerCount, 0);

    const uploadingWin = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div role="button" data-tooltip="送信" id="sendUploading"></div>
        <div contenteditable="true" role="textbox">Body</div>
        <div role="listitem" title="uploading.pdf"><progress value="50" max="100"></progress></div>
      </div>
    `, { confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false } });
    uploadingWin.setTimeout = () => 202;
    uploadingWin.clearTimeout = () => {};
    uploadingWin.GmailSendGuardTestHooks.resetMetrics();
    uploadingWin.document.getElementById('sendUploading').click();
    assert.strictEqual(uploadingWin.GmailSendGuardTestHooks.getMetrics().modalRefreshTimerStartCount, 1);
    assert.strictEqual(uploadingWin.GmailSendGuardTestHooks.getMetrics().activeModalRefreshTimerCount, 1);
  });

  run('modal refresh timer stops when upload becomes ready', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
        <div contenteditable="true" role="textbox">Body</div>
        <div id="att-container">
          <div role="listitem" title="file.pdf"><progress value="50" max="100"></progress></div>
        </div>
      </div>
    `, { confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false } });

    let timeoutCallback = null;
    win.setTimeout = (callback) => {
      timeoutCallback = callback;
      return 303;
    };
    win.clearTimeout = () => {};
    const hooks = win.GmailSendGuardTestHooks;
    hooks.resetMetrics();

    win.document.getElementById('sendBtn').click();
    assert.strictEqual(hooks.getMetrics().activeModalRefreshTimerCount, 1);

    const readyItem = win.document.createElement('div');
    readyItem.setAttribute('role', 'listitem');
    readyItem.setAttribute('title', 'file.pdf');
    const size = win.document.createElement('span');
    size.textContent = '20 KB';
    readyItem.appendChild(size);
    win.document.getElementById('att-container').replaceChildren(readyItem);

    timeoutCallback();
    const metrics = hooks.getMetrics();
    assert.strictEqual(metrics.activeModalRefreshTimerCount, 0);
    assert.ok(metrics.modalRefreshTimerStopCount >= 1);
    assert.strictEqual(win.document.querySelector('.gsg-btn-confirm').disabled, false);
  });

  run('modal refresh timer stops on cancel', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
        <div contenteditable="true" role="textbox">Body</div>
        <div role="listitem" title="file.pdf"><progress value="50" max="100"></progress></div>
      </div>
    `, { confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false } });

    win.setTimeout = () => 404;
    win.clearTimeout = () => {};
    const hooks = win.GmailSendGuardTestHooks;
    hooks.resetMetrics();

    win.document.getElementById('sendBtn').click();
    assert.strictEqual(hooks.getMetrics().activeModalRefreshTimerCount, 1);
    win.document.querySelector('.gsg-btn-cancel').click();
    assert.strictEqual(hooks.getMetrics().activeModalRefreshTimerCount, 0);
    assert.strictEqual(hooks.getMetrics().modalRefreshTimerStopCount, 1);
  });

  run('modal refresh timer stops on Escape', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
        <div contenteditable="true" role="textbox">Body</div>
        <div role="listitem" title="file.pdf"><progress value="50" max="100"></progress></div>
      </div>
    `, { confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false } });

    win.setTimeout = () => 505;
    win.clearTimeout = () => {};
    const hooks = win.GmailSendGuardTestHooks;
    hooks.resetMetrics();

    win.document.getElementById('sendBtn').click();
    assert.strictEqual(hooks.getMetrics().activeModalRefreshTimerCount, 1);
    win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.strictEqual(hooks.getMetrics().activeModalRefreshTimerCount, 0);
    assert.strictEqual(hooks.getMetrics().modalRefreshTimerStopCount, 1);
  });

  run('modal refresh timer stops after confirmed send', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
        <div contenteditable="true" role="textbox">Body</div>
        <div role="listitem" title="file.pdf"><progress value="50" max="100"></progress></div>
      </div>
    `, { confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false } });

    let sentCount = 0;
    win.document.getElementById('sendBtn').addEventListener('click', () => {
      sentCount++;
    });
    win.setTimeout = () => 606;
    win.clearTimeout = () => {};
    const hooks = win.GmailSendGuardTestHooks;
    hooks.resetMetrics();

    win.document.getElementById('sendBtn').click();
    const confirmBtn = win.document.querySelector('.gsg-btn-confirm');
    assert.strictEqual(hooks.getMetrics().activeModalRefreshTimerCount, 1);
    confirmBtn.disabled = false;
    confirmBtn.click();

    assert.strictEqual(hooks.getMetrics().activeModalRefreshTimerCount, 0);
    assert.strictEqual(hooks.getMetrics().modalRefreshTimerStopCount, 1);
    assert.strictEqual(sentCount, 1);
  });

  run('long quoted thread currentBody extraction completes within smoke budget', () => {
    const quoted = Array.from({ length: 400 }, (_, i) => `<div class="gmail_quote">quoted ${i} 添付</div>`).join('');
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
        <div contenteditable="true" role="textbox"><div>Current body</div>${quoted}</div>
      </div>
    `, { attachmentCheckEnabled: true, confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false } });

    const hooks = win.GmailSendGuardTestHooks;
    hooks.resetMetrics();
    const startedAt = Date.now();
    win.document.getElementById('sendBtn').click();
    const elapsed = Date.now() - startedAt;

    assert.strictEqual(hooks.getMetrics().readCurrentComposeBodyCallCount, 1);
    assert.ok(elapsed < 1500, `long quoted thread smoke exceeded budget: ${elapsed}ms`);
    assert.ok(!win.document.querySelector('.gsg-modal-body').textContent.includes('添付：本文または件名に「添付」がありますが、添付ファイルなし'));
  });

  run('many recipients grouping completes within smoke budget', () => {
    const recipients = Array.from({ length: 100 }, (_, i) => `<span email="user${i}@example.com">user${i}</span>`).join('');
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div aria-label="To">${recipients}</div>
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
        <div contenteditable="true" role="textbox">Body</div>
      </div>
    `, { confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false } });

    const startedAt = Date.now();
    win.document.getElementById('sendBtn').click();
    const elapsed = Date.now() - startedAt;

    assert.ok(elapsed < 1500, `many recipients smoke exceeded budget: ${elapsed}ms`);
    assert.ok(win.document.querySelector('.gsg-modal-body').textContent.includes('100件'));
  });

  run('many attachments rendering completes within smoke budget', () => {
    const attachments = Array.from({ length: 20 }, (_, i) => `
      <div role="listitem">
        <span aria-label="Remove attachment - file-${i + 1}.pdf"></span>
        <span>${i + 1} KB</span>
      </div>
    `).join('');
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
        <div contenteditable="true" role="textbox">Body</div>
        ${attachments}
      </div>
    `, { attachmentCheckEnabled: true, confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false } });

    const startedAt = Date.now();
    win.document.getElementById('sendBtn').click();
    const elapsed = Date.now() - startedAt;

    assert.ok(elapsed < 1500, `many attachments smoke exceeded budget: ${elapsed}ms`);
    assert.ok(win.document.querySelector('.gsg-modal-body').textContent.includes('file-20.pdf'));
  });

  run('multiple compose states remain isolated after performance optimization', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog" id="c1">
        <input name="subjectbox" value="Sub1">
        <div role="button" data-tooltip="送信" id="send1"></div>
        <div contenteditable="true" role="textbox">Body 1</div>
      </div>
      <div role="dialog" id="c2">
        <input name="subjectbox" value="Sub2">
        <div role="button" data-tooltip="送信" id="send2"></div>
        <div contenteditable="true" role="textbox">Body 2</div>
      </div>
    `, { confirmationCheckboxes: { subject: true, domains: false, attachments: false, autoBcc: false } });

    win.document.getElementById('send1').click();
    let checkbox = win.document.getElementById('gsg-subject-confirm-chk');
    checkbox.checked = true;
    checkbox.dispatchEvent(new win.Event('change', { bubbles: true }));
    win.document.querySelector('.gsg-btn-cancel').click();

    win.document.getElementById('send2').click();
    checkbox = win.document.getElementById('gsg-subject-confirm-chk');
    assert.strictEqual(checkbox.checked, false);
    checkbox.checked = true;
    checkbox.dispatchEvent(new win.Event('change', { bubbles: true }));
    win.document.querySelector('.gsg-btn-cancel').click();

    win.document.querySelector('#c2 input[name="subjectbox"]').value = 'Sub2 changed';
    win.document.getElementById('send1').click();
    checkbox = win.document.getElementById('gsg-subject-confirm-chk');
    assert.strictEqual(checkbox.checked, true);
  });

  run('confirmation checkbox can be enabled per section', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
        <div contenteditable="true" role="textbox">Body</div>
        <div aria-label="Cc"><span email="cc@example.com">cc</span></div>
        <div aria-label="Bcc"><span email="bcc@example.com">bcc</span></div>
      </div>
    `, { 
        confirmationCheckboxes: { subject: true, domains: false, attachments: false, autoCc: true, autoBcc: true },
        autoCcEnabled: true,
        autoCcAddress: 'copy@example.com',
        autoBccEnabled: true,
        autoBccAddress: 'test@example.com'
    });
    
    win.GmailSendGuardChecks.evaluateAutoCcState = () => ({ status: 'ok', reason: 'present', target: 'copy@example.com' });
    win.GmailSendGuardChecks.evaluateAutoBccState = () => ({ status: 'ok', reason: 'present', target: 'test@example.com' });

    const sendBtn = win.document.getElementById('sendBtn');
    sendBtn.click();
    
    const subjectChk = win.document.getElementById('gsg-subject-confirm-chk');
    const domainChk = win.document.getElementById('gsg-domains-confirm-chk');
    const autoCcChk = win.document.getElementById('gsg-autocc-confirm-chk');
    const autoBccChk = win.document.getElementById('gsg-autobcc-confirm-chk');
    
    assert.ok(subjectChk);
    assert.ok(!domainChk);
    assert.ok(autoCcChk);
    assert.ok(autoBccChk);
  });

  run('subject confirmation checkbox follows confirmationCheckboxes.subject setting', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
        <div contenteditable="true" role="textbox">Body</div>
      </div>
    `, { confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false } });

    win.document.getElementById('sendBtn').click();
    assert.strictEqual(win.document.getElementById('gsg-subject-confirm-chk'), null);
    const btn = win.document.querySelector('.gsg-btn-confirm');
    assert.strictEqual(btn.textContent, '送信する');
  });

  run('unchecked subject confirmation makes final button warning', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
        <div contenteditable="true" role="textbox">Body</div>
      </div>
    `, { confirmationCheckboxes: { subject: true, domains: false, attachments: false, autoBcc: false } });

    win.document.getElementById('sendBtn').click();
    const btn = win.document.querySelector('.gsg-btn-confirm');
    assert.strictEqual(btn.textContent, 'それでも送信する');
  });

  run('unchecked domain confirmation makes final button warning when enabled', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
        <div contenteditable="true" role="textbox">Body</div>
        <div aria-label="To"><span email="test@example.com">test</span></div>
      </div>
    `, { confirmationCheckboxes: { subject: false, domains: true, attachments: false, autoBcc: false } });

    win.document.getElementById('sendBtn').click();
    const btn = win.document.querySelector('.gsg-btn-confirm');
    assert.strictEqual(btn.textContent, 'それでも送信する');
  });

  run('unchecked attachment confirmation makes final button warning when enabled', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
        <div contenteditable="true" role="textbox">Body</div>
        <div role="listitem"><div aria-label="Remove attachment - a.pdf"></div></div>
      </div>
    `, { confirmationCheckboxes: { subject: false, domains: false, attachments: true, autoBcc: false } });

    win.document.getElementById('sendBtn').click();
    const btn = win.document.querySelector('.gsg-btn-confirm');
    assert.strictEqual(btn.textContent, 'それでも送信する');
  });

  run('unchecked autoBcc confirmation makes final button warning when enabled', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
        <div contenteditable="true" role="textbox">Body</div>
      </div>
    `, { 
        autoBccEnabled: true,
        confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: true } 
    });
    
    win.GmailSendGuardChecks.evaluateAutoBccState = () => ({ status: 'ok', reason: 'present' });

    win.document.getElementById('sendBtn').click();
    const btn = win.document.querySelector('.gsg-btn-confirm');
    assert.strictEqual(btn.textContent, 'それでも送信する');
  });

  run('unchecked autoCc confirmation makes final button warning when enabled', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
        <div contenteditable="true" role="textbox">Body</div>
      </div>
    `, {
        autoCcEnabled: true,
        confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoCc: true, autoBcc: false }
    });

    win.GmailSendGuardChecks.evaluateAutoCcState = () => ({ status: 'ok', reason: 'present' });

    win.document.getElementById('sendBtn').click();
    const btn = win.document.querySelector('.gsg-btn-confirm');
    assert.strictEqual(btn.textContent, 'それでも送信する');
  });

  run('disabled confirmation checkbox does not affect final button', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
        <div contenteditable="true" role="textbox">Body</div>
      </div>
    `, { confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false } });

    win.document.getElementById('sendBtn').click();
    const btn = win.document.querySelector('.gsg-btn-confirm');
    assert.strictEqual(btn.textContent, '送信する');
  });

  run('requireAllEnabledConfirmations disables final send button when any enabled confirmation is unchecked', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
        <div contenteditable="true" role="textbox">Body</div>
      </div>
    `, { 
        confirmationCheckboxes: { subject: true, domains: false, attachments: false, autoBcc: false },
        requireAllEnabledConfirmations: true
    });

    win.document.getElementById('sendBtn').click();
    const btn = win.document.querySelector('.gsg-btn-confirm');
    assert.strictEqual(btn.disabled, true);
    assert.strictEqual(btn.textContent, '未確認項目があります');
  });

  run('final button says 送信する when all checks pass and all enabled confirmations are checked', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
        <div contenteditable="true" role="textbox">Body</div>
      </div>
    `, { confirmationCheckboxes: { subject: true, domains: false, attachments: false, autoBcc: false } });

    win.document.getElementById('sendBtn').click();
    
    const chk = win.document.getElementById('gsg-subject-confirm-chk');
    chk.checked = true;
    chk.dispatchEvent(new win.Event('change', { bubbles: true }));

    const btn = win.document.querySelector('.gsg-btn-confirm');
    assert.strictEqual(btn.disabled, false);
    assert.strictEqual(btn.textContent, '送信する');
  });

  run('subject change resets subjectConfirmed', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog" id="c1">
        <input name="subjectbox" value="Sub1">
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
        <div contenteditable="true" role="textbox">Body</div>
      </div>
    `, { confirmationCheckboxes: { subject: true } });

    win.document.getElementById('sendBtn').click();
    const chk = win.document.getElementById('gsg-subject-confirm-chk');
    chk.checked = true;
    chk.dispatchEvent(new win.Event('change', { bubbles: true }));
    
    win.document.querySelector('.gsg-btn-cancel').click(); // close modal

    // Change subject
    win.document.querySelector('input[name="subjectbox"]').value = "Sub2";
    
    win.document.getElementById('sendBtn').click(); // re-open modal
    
    const chk2 = win.document.getElementById('gsg-subject-confirm-chk');
    assert.strictEqual(chk2.checked, false);
  });

  run('recipient change resets domainsConfirmed', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog" id="c1">
        <input name="subjectbox" value="Sub">
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
        <div contenteditable="true" role="textbox">Body</div>
        <div aria-label="To" id="to-list"><span email="a@example.com">a</span></div>
      </div>
    `, { confirmationCheckboxes: { subject: false, domains: true, attachments: false, autoBcc: false } });

    win.document.getElementById('sendBtn').click();
    const chk = win.document.getElementById('gsg-domains-confirm-chk');
    chk.checked = true;
    chk.dispatchEvent(new win.Event('change', { bubbles: true }));
    win.document.querySelector('.gsg-btn-cancel').click();

    const added = win.document.createElement('span');
    added.setAttribute('email', 'b@example.org');
    added.textContent = 'b';
    win.document.getElementById('to-list').appendChild(added);

    win.document.getElementById('sendBtn').click();
    const chk2 = win.document.getElementById('gsg-domains-confirm-chk');
    assert.strictEqual(chk2.checked, false);
  });

  run('attachment change resets attachmentsConfirmed', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog" id="c1">
        <input name="subjectbox" value="Sub">
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
        <div contenteditable="true" role="textbox">Body</div>
        <div id="attachments"><div role="listitem"><div aria-label="Remove attachment - a.pdf"></div></div></div>
      </div>
    `, { confirmationCheckboxes: { subject: false, domains: false, attachments: true, autoBcc: false } });

    win.document.getElementById('sendBtn').click();
    const chk = win.document.getElementById('gsg-attachments-confirm-chk');
    chk.checked = true;
    chk.dispatchEvent(new win.Event('change', { bubbles: true }));
    win.document.querySelector('.gsg-btn-cancel').click();

    const added = win.document.createElement('div');
    added.setAttribute('role', 'listitem');
    const removeButton = win.document.createElement('div');
    removeButton.setAttribute('aria-label', 'Remove attachment - b.pdf');
    added.appendChild(removeButton);
    win.document.getElementById('attachments').appendChild(added);

    win.document.getElementById('sendBtn').click();
    const chk2 = win.document.getElementById('gsg-attachments-confirm-chk');
    assert.strictEqual(chk2.checked, false);
  });

  run('autoCc state change resets autoCcConfirmed', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog" id="c1">
        <input name="subjectbox" value="Sub">
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
        <div contenteditable="true" role="textbox">Body</div>
        <div aria-label="Cc" id="cc-list"><span email="self@example.com">self</span></div>
      </div>
    `, {
      autoCcEnabled: true,
      autoCcAddress: 'self@example.com',
      confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoCc: true, autoBcc: false }
    });

    win.document.getElementById('sendBtn').click();
    const chk = win.document.getElementById('gsg-autocc-confirm-chk');
    chk.checked = true;
    chk.dispatchEvent(new win.Event('change', { bubbles: true }));
    win.document.querySelector('.gsg-btn-cancel').click();

    win.document.getElementById('cc-list').replaceChildren();
    win.document.getElementById('sendBtn').click();
    const chk2 = win.document.getElementById('gsg-autocc-confirm-chk');
    assert.strictEqual(chk2.checked, false);
  });

  run('autoBcc state change resets autoBccConfirmed', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog" id="c1">
        <input name="subjectbox" value="Sub">
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
        <div contenteditable="true" role="textbox">Body</div>
        <div aria-label="Bcc" id="bcc-list"><span email="self@example.com">self</span></div>
      </div>
    `, {
      autoBccEnabled: true,
      autoBccAddress: 'self@example.com',
      confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: true }
    });

    win.document.getElementById('sendBtn').click();
    const chk = win.document.getElementById('gsg-autobcc-confirm-chk');
    chk.checked = true;
    chk.dispatchEvent(new win.Event('change', { bubbles: true }));
    win.document.querySelector('.gsg-btn-cancel').click();

    win.document.getElementById('bcc-list').replaceChildren();
    win.document.getElementById('sendBtn').click();
    const chk2 = win.document.getElementById('gsg-autobcc-confirm-chk');
    assert.strictEqual(chk2.checked, false);
  });

  run('send guard modal exposes dialog semantics and disabled state to assistive technology', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div contenteditable="true" role="textbox">Body</div>
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
      </div>
    `, {
      confirmationCheckboxes: { subject: true, domains: false, attachments: false, autoBcc: false },
      requireAllEnabledConfirmations: true
    });

    const sendBtn = win.document.getElementById('sendBtn');
    sendBtn.tabIndex = 0;
    sendBtn.focus();
    sendBtn.click();

    const overlay = win.document.querySelector('.gsg-modal-overlay');
    const dialog = win.document.getElementById('gsg-modal-dialog');
    const confirmBtn = win.document.querySelector('.gsg-btn-confirm');
    assert.strictEqual(dialog.getAttribute('role'), 'dialog');
    assert.strictEqual(dialog.getAttribute('aria-modal'), 'true');
    assert.strictEqual(dialog.getAttribute('aria-labelledby'), 'gsg-modal-title');
    assert.strictEqual(dialog.getAttribute('aria-describedby'), 'gsg-modal-description');
    assert.strictEqual(overlay.getAttribute('aria-hidden'), 'false');
    assert.strictEqual(confirmBtn.disabled, true);
    assert.strictEqual(confirmBtn.getAttribute('aria-disabled'), 'true');
    assert.strictEqual(win.document.activeElement, win.document.querySelector('.gsg-btn-cancel'));
  });

  run('send guard modal traps Tab focus and restores the original send control on cancel', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog">
        <input name="subjectbox" value="Sub">
        <div contenteditable="true" role="textbox">Body</div>
        <div role="button" data-tooltip="送信" id="sendBtn"></div>
      </div>
    `, { confirmationCheckboxes: { subject: false, domains: false, attachments: false, autoBcc: false } });

    const sendBtn = win.document.getElementById('sendBtn');
    sendBtn.tabIndex = 0;
    sendBtn.focus();
    sendBtn.click();
    const confirmBtn = win.document.querySelector('.gsg-btn-confirm');
    const cancelBtn = win.document.querySelector('.gsg-btn-cancel');
    assert.strictEqual(win.document.activeElement, confirmBtn);

    confirmBtn.dispatchEvent(new win.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Tab' }));
    assert.strictEqual(win.document.activeElement, cancelBtn);
    cancelBtn.dispatchEvent(new win.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Tab', shiftKey: true }));
    assert.strictEqual(win.document.activeElement, confirmBtn);

    cancelBtn.click();
    assert.strictEqual(win.document.querySelector('.gsg-modal-overlay').getAttribute('aria-hidden'), 'true');
    assert.strictEqual(win.document.activeElement, sendBtn);
  });

  run('TestHooks expose only aggregate metrics and operational test controls', () => {
    const win = setupWindowWithScripts(`
      <div role="dialog"><div role="button" data-tooltip="送信" id="sendBtn"></div></div>
    `);
    const hooks = win.GmailSendGuardTestHooks;
    assert.deepStrictEqual(Array.from(Object.keys(hooks)).sort(), [
      'disconnectObserver',
      'getMetrics',
      'resetMetrics',
      'scanComposesForTest',
      'scheduleScanForTest'
    ]);
    for (const value of Object.values(hooks.getMetrics())) {
      assert.strictEqual(typeof value, 'number');
    }
  });

  // Since we have async tests, we need to run cleanupWindows after all tests.
  // We'll return a Promise if necessary or handle it simply.
  // Wait, the test runner is completely synchronous except for that one Promise we just added!
  // It won't wait for the promise! We need to handle async test runners or just mock the timer.
  // Since we're in jsdom, we can mock setTimeout for the timer test to avoid making the runner async.


  // Cleanup all test windows
  function cleanupWindows() {
    for (const win of createdWindows) {
      if (win.GmailSendGuardTestHooks && win.GmailSendGuardTestHooks.disconnectObserver) {
        win.GmailSendGuardTestHooks.disconnectObserver();
      }
      if (typeof win.close === 'function') {
        win.close();
      }
    }
    createdWindows.length = 0; // clear array
  }
  await Promise.all(promises);
  cleanupWindows();

  if (failed > 0) {
    console.error(`\nTests failed: ${failed}`);
    process.exit(1);
  } else {
    console.log(`\nAll ${passed} tests passed!`);
  }
}

runTests().catch(e => {
    console.error("Fatal error:", e);
    process.exit(1);
});
