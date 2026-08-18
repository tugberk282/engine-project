'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

if (process.platform !== 'win32') {
    console.log('Skipping Windows play-sandbox launcher build on non-Windows host.');
    process.exit(0);
}

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'native', 'play-sandbox-launcher', 'launcher.c');
const outputDirectory = path.join(root, 'electron', 'resources', 'win32-x64');
const output = path.join(outputDirectory, 'tugberk-play-sandbox.exe');
fs.mkdirSync(outputDirectory, { recursive: true });

const compiler = process.env.TUGBERK_MINGW_CC || 'gcc.exe';
const result = spawnSync(compiler, [
    '-std=c11', '-O2', '-Wall', '-Wextra', '-Werror',
    '-D_WIN32_WINNT=0x0A00', '-municode', '-mwindows',
    source, '-o', output, '-luserenv', '-ladvapi32', '-lshell32'
], { cwd: root, stdio: 'inherit', windowsHide: true });

if (result.error) {
    console.error(`Unable to run ${compiler}: ${result.error.message}`);
    process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);
const digest = crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex');
fs.writeFileSync(path.join(outputDirectory, 'tugberk-play-sandbox.manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    platform: 'win32',
    architecture: 'x64',
    file: path.basename(output),
    sha256: digest
}, null, 2)}\n`, { encoding: 'utf8', flag: 'w' });
console.log(`Built ${path.relative(root, output)}`);
