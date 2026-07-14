const fs = require('fs');
const path = require('path');
const {
  getReleasePaths,
  parseCliArgs,
  sha256File,
  writeDeterministicExtensionZip
} = require('./release_common');

function packageRelease(rootDir, args = {}) {
  const sourceDir = path.resolve(rootDir, args.source || 'extension');
  const manifest = JSON.parse(fs.readFileSync(path.join(sourceDir, 'manifest.json'), 'utf8'));
  const defaults = getReleasePaths(rootDir, manifest.version);
  const outputPath = path.resolve(rootDir, args.output || defaults.zipPath);
  const checksumPath = path.resolve(rootDir, args.checksum || `${outputPath}.sha256`);
  if (fs.existsSync(outputPath) && !fs.statSync(outputPath).isFile()) throw new Error(`Release output is not a file: ${outputPath}`);
  writeDeterministicExtensionZip(sourceDir, outputPath);
  const hash = sha256File(outputPath);
  fs.writeFileSync(checksumPath, `${hash}  ${path.basename(outputPath)}\n`, 'utf8');
  return { checksumPath, hash, outputPath };
}

function main() {
  const rootDir = path.resolve(__dirname, '..');
  const result = packageRelease(rootDir, parseCliArgs(process.argv.slice(2)));
  console.log(`PASS release package created: ${result.outputPath}`);
  console.log(`SHA-256: ${result.hash}`);
}

module.exports = { packageRelease };

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`ERROR release package: ${error.message}`);
    process.exit(1);
  }
}
