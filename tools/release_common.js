const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const EXTENSION_FILES = [
  '_locales/en/messages.json',
  '_locales/ja/messages.json',
  'checks.js',
  'content.js',
  'gmail_dom.js',
  'i18n.js',
  'icons/icon128.png',
  'icons/icon16.png',
  'icons/icon32.png',
  'icons/icon48.png',
  'manifest.json',
  'options.css',
  'options.html',
  'options.js',
  'styles.css'
].sort();

const REPRODUCIBLE_TIME = new Date('2000-01-01T00:00:00Z');
const ZIP_DOS_DATE = (20 << 9) | (1 << 5) | 1;
const ZIP_DOS_TIME = 0;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_VERSION_MADE_BY = 0x0314;
const ZIP_VERSION_NEEDED = 10;
const ZIP_STORE = 0;
const ZIP_FILE_ATTRIBUTES = 0x81a40000;

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(data) {
  let value = 0xffffffff;
  for (const byte of data) value = (value >>> 8) ^ CRC32_TABLE[(value ^ byte) & 0xff];
  return (value ^ 0xffffffff) >>> 0;
}

function createStoredZipBuffer(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const checksum = crc32(data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(ZIP_VERSION_NEEDED, 4);
    local.writeUInt16LE(ZIP_UTF8_FLAG, 6);
    local.writeUInt16LE(ZIP_STORE, 8);
    local.writeUInt16LE(ZIP_DOS_TIME, 10);
    local.writeUInt16LE(ZIP_DOS_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    localParts.push(local, data);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(ZIP_VERSION_MADE_BY, 4);
    central.writeUInt16LE(ZIP_VERSION_NEEDED, 6);
    central.writeUInt16LE(ZIP_UTF8_FLAG, 8);
    central.writeUInt16LE(ZIP_STORE, 10);
    central.writeUInt16LE(ZIP_DOS_TIME, 12);
    central.writeUInt16LE(ZIP_DOS_DATE, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(ZIP_FILE_ATTRIBUTES, 38);
    central.writeUInt32LE(localOffset, 42);
    name.copy(central, 46);
    centralParts.push(central);
    localOffset += local.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function writeStoredZip(outputPath, entries) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, createStoredZipBuffer(entries));
}

function writeDeterministicExtensionZip(sourceDir, outputPath) {
  const validation = validateExtensionWhitelist(sourceDir);
  if (validation.errors.length > 0) throw new Error(validation.errors.join('\n'));
  const entries = EXTENSION_FILES.map((name) => ({ name, data: fs.readFileSync(path.join(sourceDir, name)) }));
  writeStoredZip(outputPath, entries);
  return entries.map((entry) => entry.name);
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function listFiles(root) {
  const files = [];
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile()) {
        files.push(toPosix(path.relative(root, fullPath)));
      }
    }
  }
  visit(root);
  return files.sort();
}

function validateExtensionWhitelist(sourceDir) {
  const errors = [];
  if (!fs.existsSync(sourceDir)) {
    return { files: [], errors: [`Missing extension source directory: ${sourceDir}`] };
  }

  const actual = listFiles(sourceDir);
  const expected = new Set(EXTENSION_FILES);
  for (const file of EXTENSION_FILES) {
    if (!actual.includes(file)) errors.push(`Required extension file is missing: ${file}`);
  }
  for (const file of actual) {
    if (!expected.has(file)) errors.push(`Unexpected extension package file: ${file}`);
  }
  return { files: actual, errors };
}

function copyExtensionFiles(sourceDir, targetDir) {
  const validation = validateExtensionWhitelist(sourceDir);
  if (validation.errors.length > 0) {
    throw new Error(validation.errors.join('\n'));
  }
  fs.mkdirSync(targetDir, { recursive: true });
  for (const relativePath of EXTENSION_FILES) {
    const source = path.join(sourceDir, relativePath);
    const target = path.join(targetDir, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    fs.utimesSync(target, REPRODUCIBLE_TIME, REPRODUCIBLE_TIME);
  }
  return EXTENSION_FILES.slice();
}

function recreateKnownWorkspaceDirectory(workspaceRoot, targetDir, allowedRelativePath) {
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(targetDir);
  const allowed = path.resolve(root, allowedRelativePath);
  if (target !== allowed) {
    throw new Error(`Refusing to recreate an unexpected directory: ${target}`);
  }
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to recreate a directory outside the workspace: ${target}`);
  }
  if (fs.existsSync(target)) {
    clearDirectoryContents(target);
  }
  fs.mkdirSync(target, { recursive: true });
}

function clearDirectoryContents(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      clearDirectoryContents(entryPath);
      fs.rmdirSync(entryPath);
    } else {
      fs.unlinkSync(entryPath);
    }
  }
}

function copyFileSet(sourceRoot, targetRoot, relativePaths) {
  for (const relativePath of relativePaths) {
    const source = path.join(sourceRoot, relativePath);
    const target = path.join(targetRoot, relativePath);
    if (!fs.existsSync(source)) throw new Error(`Required public source file is missing: ${relativePath}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function compareExtensionTrees(sourceDir, targetDir) {
  const errors = [];
  const source = validateExtensionWhitelist(sourceDir);
  const target = validateExtensionWhitelist(targetDir);
  errors.push(...source.errors.map((error) => `Source: ${error}`));
  errors.push(...target.errors.map((error) => `Target: ${error}`));
  if (errors.length > 0) return errors;

  for (const relativePath of EXTENSION_FILES) {
    const sourceHash = sha256File(path.join(sourceDir, relativePath));
    const targetHash = sha256File(path.join(targetDir, relativePath));
    if (sourceHash !== targetHash) errors.push(`Extension copy differs: ${relativePath}`);
  }
  return errors;
}

function readZipRecords(zipPath) {
  const data = fs.readFileSync(zipPath);
  const eocdSignature = 0x06054b50;
  const centralSignature = 0x02014b50;
  const minOffset = Math.max(0, data.length - 65557);
  let eocdOffset = -1;
  for (let offset = data.length - 22; offset >= minOffset; offset -= 1) {
    if (data.readUInt32LE(offset) === eocdSignature) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error('ZIP end-of-central-directory record was not found.');

  const diskNumber = data.readUInt16LE(eocdOffset + 4);
  const centralDisk = data.readUInt16LE(eocdOffset + 6);
  const diskEntryCount = data.readUInt16LE(eocdOffset + 8);
  const entryCount = data.readUInt16LE(eocdOffset + 10);
  const archiveCommentLength = data.readUInt16LE(eocdOffset + 20);
  if (eocdOffset + 22 + archiveCommentLength !== data.length) throw new Error('ZIP end record or archive comment is invalid.');
  let offset = data.readUInt32LE(eocdOffset + 16);
  const entries = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (data.readUInt32LE(offset) !== centralSignature) {
      throw new Error('ZIP central-directory record is invalid.');
    }
    const nameLength = data.readUInt16LE(offset + 28);
    const extraLength = data.readUInt16LE(offset + 30);
    const commentLength = data.readUInt16LE(offset + 32);
    const nameStart = offset + 46;
    entries.push({
      name: data.subarray(nameStart, nameStart + nameLength).toString('utf8'),
      versionMadeBy: data.readUInt16LE(offset + 4),
      versionNeeded: data.readUInt16LE(offset + 6),
      flags: data.readUInt16LE(offset + 8),
      method: data.readUInt16LE(offset + 10),
      dosTime: data.readUInt16LE(offset + 12),
      dosDate: data.readUInt16LE(offset + 14),
      crc32: data.readUInt32LE(offset + 16),
      compressedSize: data.readUInt32LE(offset + 20),
      size: data.readUInt32LE(offset + 24),
      extraLength,
      commentLength,
      externalAttributes: data.readUInt32LE(offset + 38),
      localOffset: data.readUInt32LE(offset + 42)
    });
    offset = nameStart + nameLength + extraLength + commentLength;
  }
  if (offset !== eocdOffset) throw new Error('ZIP central-directory size or entry count is invalid.');
  return { archiveCommentLength, centralDisk, diskEntryCount, diskNumber, entries };
}

function readZipEntries(zipPath) {
  return readZipRecords(zipPath).entries.map((entry) => entry.name);
}

function parseCliArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) continue;
    const key = value.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      values[key] = true;
    } else {
      values[key] = next;
      index += 1;
    }
  }
  return values;
}

function getReleasePaths(rootDir, version) {
  const isPublicRepo = path.basename(path.resolve(rootDir)) === 'public_repo';
  const outputDir = path.join(rootDir, isPublicRepo ? 'dist' : 'release', isPublicRepo ? '' : 'artifacts');
  const filename = `send-guard-for-gmail-v${version}.zip`;
  return {
    outputDir,
    zipPath: path.join(outputDir, filename),
    checksumPath: path.join(outputDir, `${filename}.sha256`)
  };
}

module.exports = {
  EXTENSION_FILES,
  REPRODUCIBLE_TIME,
  compareExtensionTrees,
  copyExtensionFiles,
  copyFileSet,
  getReleasePaths,
  listFiles,
  parseCliArgs,
  readZipEntries,
  readZipRecords,
  recreateKnownWorkspaceDirectory,
  sha256File,
  toPosix,
  validateExtensionWhitelist,
  writeDeterministicExtensionZip,
  writeStoredZip
};
