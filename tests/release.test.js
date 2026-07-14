const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  EXTENSION_FILES,
  readZipRecords,
  sha256File,
  writeStoredZip
} = require('../tools/release_common');
const { packageRelease } = require('../tools/release_package');
const { validateZip } = require('../tools/release_validate');

const rootDir = path.resolve(__dirname, '..');
const runningInPublicRepo = path.basename(rootDir) === 'public_repo';
let failed = 0;

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error);
  }
}

function runNode(script, args) {
  childProcess.execFileSync(process.execPath, [script, ...args], {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: 'pipe'
  });
}

function inTempDir(callback) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'send-guard-for-gmail-release-test-'));
  try {
    callback(tempDir);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function extensionEntries() {
  return EXTENSION_FILES.map((name) => ({
    name,
    data: fs.readFileSync(path.join(rootDir, 'extension', name))
  }));
}

function writeTestZip(tempDir, entries) {
  const zipPath = path.join(tempDir, 'test.zip');
  writeStoredZip(zipPath, entries);
  fs.writeFileSync(`${zipPath}.sha256`, `${sha256File(zipPath)}  test.zip\n`, 'utf8');
  return zipPath;
}

run('release package contains no directory entries', () => inTempDir((tempDir) => {
  const zipPath = path.join(tempDir, 'package.zip');
  packageRelease(rootDir, { output: zipPath, checksum: `${zipPath}.sha256` });
  assert.strictEqual(readZipRecords(zipPath).entries.filter((entry) => entry.name.endsWith('/')).length, 0);
}));

run('release package contains exactly the whitelist entries', () => inTempDir((tempDir) => {
  const zipPath = path.join(tempDir, 'package.zip');
  packageRelease(rootDir, { output: zipPath, checksum: `${zipPath}.sha256` });
  const entries = readZipRecords(zipPath).entries.map((entry) => entry.name);
  assert.deepStrictEqual(entries, EXTENSION_FILES);
  assert.strictEqual(validateZip(zipPath).length, 0);
}));

run('release package generated twice is byte-for-byte identical', () => inTempDir((tempDir) => {
  const first = path.join(tempDir, 'first.zip');
  const second = path.join(tempDir, 'second.zip');
  packageRelease(rootDir, { output: first, checksum: `${first}.sha256` });
  packageRelease(rootDir, { output: second, checksum: `${second}.sha256` });
  assert.strictEqual(fs.readFileSync(first).equals(fs.readFileSync(second)), true);
}));

run('release package generated twice has identical SHA-256', () => inTempDir((tempDir) => {
  const first = path.join(tempDir, 'first.zip');
  const second = path.join(tempDir, 'second.zip');
  packageRelease(rootDir, { output: first, checksum: `${first}.sha256` });
  packageRelease(rootDir, { output: second, checksum: `${second}.sha256` });
  assert.strictEqual(sha256File(first), sha256File(second));
}));

run('checksum file matches generated ZIP', () => inTempDir((tempDir) => {
  const zipPath = path.join(tempDir, 'package.zip');
  packageRelease(rootDir, { output: zipPath, checksum: `${zipPath}.sha256` });
  assert.strictEqual(validateZip(zipPath).length, 0);
}));

for (const [name, mutate, expected] of [
  ['validator rejects an extra directory entry', (entries) => [...entries, { name: 'icons/', data: Buffer.alloc(0) }], /directory entries|entry count|whitelist/i],
  ['validator rejects an extra file entry', (entries) => [...entries, { name: 'README.md', data: Buffer.from('no') }], /entry count|whitelist/i],
  ['validator rejects a missing file', (entries) => entries.filter((entry) => entry.name !== 'styles.css'), /entry count|whitelist/i],
  ['validator rejects a duplicate entry', (entries) => [...entries, entries[0]], /duplicate/i],
  ['validator rejects path traversal entry', (entries) => [...entries, { name: '../escape.txt', data: Buffer.from('no') }], /path traversal/i],
  ['validator rejects an absolute path entry', (entries) => [...entries, { name: '/escape.txt', data: Buffer.from('no') }], /absolute path/i],
  ['validator rejects a backslash path entry', (entries) => [...entries, { name: 'icons\\escape.txt', data: Buffer.from('no') }], /backslash path/i]
]) {
  run(name, () => inTempDir((tempDir) => {
    const errors = validateZip(writeTestZip(tempDir, mutate(extensionEntries())));
    assert.ok(errors.some((error) => expected.test(error)), errors.join('\n'));
  }));
}

run('release validator verifies source, package, workspace copies, and checksum', () => inTempDir((tempDir) => {
  const zipPath = path.join(tempDir, 'send-guard-for-gmail-test.zip');
  runNode('tools/release_package.js', ['--source', 'extension', '--output', zipPath]);
  const args = ['--source', 'extension', '--zip', zipPath];
  if (!runningInPublicRepo) args.push('--compare', 'public_repo/extension,extension_package/extension');
  runNode('tools/release_validate.js', args);
}));

if (failed > 0) process.exit(1);
