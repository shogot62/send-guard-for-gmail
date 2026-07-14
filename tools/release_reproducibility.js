const fs = require('fs');
const os = require('os');
const path = require('path');
const { EXTENSION_FILES, readZipRecords, sha256File } = require('./release_common');
const { packageRelease } = require('./release_package');

function main() {
  const rootDir = path.resolve(__dirname, '..');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'send-guard-for-gmail-repro-'));
  try {
    const firstPath = path.join(tempDir, 'first.zip');
    const secondPath = path.join(tempDir, 'second.zip');
    packageRelease(rootDir, { output: firstPath, checksum: `${firstPath}.sha256` });
    packageRelease(rootDir, { output: secondPath, checksum: `${secondPath}.sha256` });
    const first = fs.readFileSync(firstPath);
    const second = fs.readFileSync(secondPath);
    const firstHash = sha256File(firstPath);
    const secondHash = sha256File(secondPath);
    const firstEntries = readZipRecords(firstPath).entries.map((entry) => entry.name);
    const secondEntries = readZipRecords(secondPath).entries.map((entry) => entry.name);
    const directoryEntries = firstEntries.filter((entry) => entry.endsWith('/'));
    const bufferEqual = first.equals(second);
    const entriesEqual = JSON.stringify(firstEntries) === JSON.stringify(secondEntries);
    if (!bufferEqual || firstHash !== secondHash || !entriesEqual || firstEntries.length !== EXTENSION_FILES.length || directoryEntries.length !== 0) {
      throw new Error('Independent release packages are not reproducible.');
    }
    console.log(`First ZIP SHA-256: ${firstHash}`);
    console.log(`Second ZIP SHA-256: ${secondHash}`);
    console.log(`Buffer equality: ${bufferEqual}`);
    console.log(`ZIP total entries: ${firstEntries.length}`);
    console.log(`Directory entries: ${directoryEntries.length}`);
    console.log('PASS release reproducibility');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(`ERROR release reproducibility: ${error.message}`);
  process.exit(1);
}
