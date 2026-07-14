const path = require('path');
const {
  compareExtensionTrees,
  copyExtensionFiles,
  copyFileSet,
  recreateKnownWorkspaceDirectory,
  validateExtensionWhitelist
} = require('./release_common');

const PUBLIC_FILES = [
  '.github/workflows/ci.yml',
  '.gitignore',
  'CHANGELOG.md',
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'PRIVACY.md',
  'README.md',
  'SECURITY.md',
  'docs/ENTERPRISE_REVIEW.md',
  'docs/INSTALL_LOCAL.md',
  'docs/THREAT_MODEL.md',
  'package-lock.json',
  'package.json',
  'tests/checks.test.js',
  'tests/gmail_dom.test.js',
  'tests/i18n.test.js',
  'tests/release.test.js',
  'tests/security.test.js',
  'tools/basic_static_check.js',
  'tools/release_common.js',
  'tools/release_package.js',
  'tools/release_reproducibility.js',
  'tools/release_validate.js',
  'tools/sync_release_assets.js'
];

function main() {
  const rootDir = path.resolve(__dirname, '..');
  const sourceDir = path.join(rootDir, 'extension');
  const sourceValidation = validateExtensionWhitelist(sourceDir);
  if (sourceValidation.errors.length > 0) throw new Error(sourceValidation.errors.join('\n'));

  if (path.basename(rootDir) === 'public_repo') {
    console.log('PASS public source repository is already the package source.');
    return;
  }

  const publicRoot = path.join(rootDir, 'public_repo');
  const packageRoot = path.join(rootDir, 'extension_package', 'extension');
  recreateKnownWorkspaceDirectory(rootDir, publicRoot, 'public_repo');
  copyFileSet(rootDir, publicRoot, PUBLIC_FILES);
  copyExtensionFiles(sourceDir, path.join(publicRoot, 'extension'));

  recreateKnownWorkspaceDirectory(rootDir, packageRoot, path.join('extension_package', 'extension'));
  copyExtensionFiles(sourceDir, packageRoot);

  const errors = [
    ...compareExtensionTrees(sourceDir, path.join(publicRoot, 'extension')),
    ...compareExtensionTrees(sourceDir, packageRoot)
  ];
  if (errors.length > 0) throw new Error(errors.join('\n'));
  console.log('PASS release assets synchronized from extension/ to public_repo/extension and extension_package/extension.');
}

try {
  main();
} catch (error) {
  console.error(`ERROR release sync: ${error.message}`);
  process.exit(1);
}
