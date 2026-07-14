const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const extDir = path.join(root, 'extension');

// Find all js files in extension/
function findJsFiles(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat && stat.isDirectory()) {
            results = results.concat(findJsFiles(filePath));
        } else if (file.endsWith('.js')) {
            results.push(filePath);
        }
    });
    return results;
}

const jsFiles = findJsFiles(extDir);

let hasErrors = false;

// 1. Check all JS files for forbidden APIs and innerHTML
for (const file of jsFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const relativePath = path.relative(root, file);

    // 1-1. Forbidden APIs
    if (/fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|eval\s*\(|new\s+Function\s*\(/.test(content)) {
        console.error(`ERROR: Forbidden API (fetch, XHR, eval, etc.) used in ${relativePath}`);
        hasErrors = true;
    }

    const syncStoragePattern = new RegExp('chrome\\.storage\\.' + 'sync');
    if (syncStoragePattern.test(content)) {
        console.error(`ERROR: Chrome sync storage must not be used in ${relativePath}`);
        hasErrors = true;
    }

    // 1-2. innerHTML Warning
    if (content.includes('innerHTML')) {
        console.warn(`WARNING: innerHTML used in ${relativePath}. Ensure no user/Gmail data is injected without escape.`);
    }
}

// 2. Manifest check
const manifestPath = path.join(extDir, 'manifest.json');
if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    // Manifest version
    if (manifest.manifest_version !== 3) {
        console.error('ERROR: manifest_version must be 3');
        hasErrors = true;
    }

    // Static content-script matches already scope Gmail injection. Do not request a duplicate host permission.
    if (Object.prototype.hasOwnProperty.call(manifest, 'host_permissions')) {
        console.error('ERROR: host_permissions must be absent');
        hasErrors = true;
    }

    if (!manifest.content_security_policy || manifest.content_security_policy.extension_pages !== "script-src 'self'; object-src 'none'") {
        console.error("ERROR: extension_pages CSP must be script-src 'self'; object-src 'none'");
        hasErrors = true;
    }

    // permissions
    if (!manifest.permissions || manifest.permissions.length !== 1 || manifest.permissions[0] !== 'storage') {
        console.error('ERROR: permissions must be exactly ["storage"]');
        hasErrors = true;
    }

    // icons
    const requiredIcons = {
        16: 'icons/icon16.png',
        32: 'icons/icon32.png',
        48: 'icons/icon48.png',
        128: 'icons/icon128.png'
    };
    for (const [size, iconPath] of Object.entries(requiredIcons)) {
        if (!manifest.icons || manifest.icons[size] !== iconPath) {
            console.error(`ERROR: manifest.icons["${size}"] must be "${iconPath}"`);
            hasErrors = true;
            continue;
        }
        if (!fs.existsSync(path.join(extDir, iconPath))) {
            console.error(`ERROR: icon file missing: ${iconPath}`);
            hasErrors = true;
        }
    }

    // content_scripts load order
    if (manifest.content_scripts && manifest.content_scripts[0] && manifest.content_scripts[0].js) {
        const jsArr = manifest.content_scripts[0].js;
        if (jsArr[0] !== 'i18n.js' || jsArr[1] !== 'checks.js' || jsArr[2] !== 'gmail_dom.js' || jsArr[3] !== 'content.js') {
            console.error('ERROR: content_scripts js order must be i18n.js, checks.js, gmail_dom.js, content.js');
            hasErrors = true;
        }
        if (JSON.stringify(manifest.content_scripts[0].matches || []) !== JSON.stringify(['https://mail.google.com/*'])) {
            console.error('ERROR: content_scripts.matches must be exactly ["https://mail.google.com/*"]');
            hasErrors = true;
        }
        if (!manifest.content_scripts[0].css || manifest.content_scripts[0].css.length !== 1 || manifest.content_scripts[0].css[0] !== 'styles.css') {
            console.error('ERROR: content_scripts.css must be exactly ["styles.css"]');
            hasErrors = true;
        }
    } else {
        console.error('ERROR: content_scripts.js definition missing in manifest.json');
        hasErrors = true;
    }

    if (!fs.existsSync(path.join(extDir, 'options.css'))) {
        console.error('ERROR: options.css not found');
        hasErrors = true;
    }
} else {
    console.error('ERROR: manifest.json not found');
    hasErrors = true;
}

if (hasErrors) {
    process.exit(1);
}

console.log('PASS basic static check');
