const fs = require('fs');
const path = require('path');

const distIndexPath = path.join(__dirname, '..', 'dist', 'index.html');

if (!fs.existsSync(distIndexPath)) {
    console.warn(`fix-dist-paths: ${distIndexPath} not found, skipping.`);
    process.exit(0);
}

const original = fs.readFileSync(distIndexPath, 'utf8');
const updated = original.replace(/(["'])\/assets\//g, '$1./assets/');

if (updated !== original) {
    fs.writeFileSync(distIndexPath, updated, 'utf8');
    console.log('fix-dist-paths: rewrote absolute dist asset paths to relative paths.');
} else {
    console.log('fix-dist-paths: no absolute asset paths found.');
}
