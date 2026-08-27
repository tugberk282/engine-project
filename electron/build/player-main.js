'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const buildRoot = path.resolve(__dirname, '..', '..');

function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') return Object.fromEntries(
        Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
    );
    return value;
}

function contentHash(value) {
    return crypto.createHash('sha256').update(`${JSON.stringify(canonicalize(value), null, 2)}\n`, 'utf8').digest('hex');
}

function readBuild() {
    const manifest = JSON.parse(fs.readFileSync(path.join(buildRoot, 'manifest.json'), 'utf8'));
    const { manifestHash, ...core } = manifest;
    if (contentHash(core) !== manifestHash) throw new Error('Build manifest integrity check failed');
    const contentRoot = path.resolve(buildRoot, 'content');
    for (const file of manifest.files) {
        const filePath = path.resolve(contentRoot, file.path);
        if (!filePath.startsWith(`${contentRoot}${path.sep}`)) throw new Error('Build file escapes content root');
        const digest = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
        if (digest !== file.sha256) throw new Error(`Build content integrity check failed: ${file.path}`);
    }
    const scenePath = path.resolve(buildRoot, 'content', manifest.entryScene);
    if (!scenePath.startsWith(`${contentRoot}${path.sep}`)) throw new Error('Entry scene escapes build content');
    return { manifest, scene: JSON.parse(fs.readFileSync(scenePath, 'utf8')), smoke: process.env.TUGBERK_PLAYER_SMOKE === '1' };
}

ipcMain.handle('player:bootstrap', () => readBuild());
ipcMain.handle('player:smoke-complete', (_event, result) => {
    const output = process.env.TUGBERK_PLAYER_SMOKE_OUTPUT;
    if (!output) return false;
    fs.writeFileSync(output, JSON.stringify(result), 'utf8');
    app.quit();
    return true;
});

app.whenReady().then(() => {
    const window = new BrowserWindow({
        width: 1280, height: 720, show: process.env.TUGBERK_PLAYER_SMOKE !== '1',
        webPreferences: {
            preload: path.join(__dirname, 'player-preload.js'), contextIsolation: true,
            nodeIntegration: false, sandbox: true
        }
    });
    window.removeMenu();
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.loadFile(path.join(__dirname, 'player.html'));
});

app.on('window-all-closed', () => app.quit());
