'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const directory = path.join(root, 'electron', 'resources', 'win32-x64');
const executable = path.join(directory, 'tugberk-play-sandbox.exe');
const manifest = path.join(directory, 'tugberk-play-sandbox.manifest.json');

if (!fs.existsSync(executable)) throw new Error(`Native helper is missing: ${executable}`);
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(executable)).digest('hex');
fs.writeFileSync(manifest, `${JSON.stringify({
  schemaVersion: 1,
  platform: 'win32',
  architecture: 'x64',
  file: path.basename(executable),
  sha256,
}, null, 2)}\n`, 'utf8');
console.log(`Recorded helper digest ${sha256}`);
