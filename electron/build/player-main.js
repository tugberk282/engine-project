'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { readBuiltScene, selectBuiltScene } = require('./player-content');

const buildRoot = path.resolve(__dirname, '..', '..');
let verifiedBuild = null;
let activeScenePath = null;

// Headless Windows smoke hosts may not expose a stable Chromium GPU process.
// Keep normal player builds accelerated and make only the explicit smoke lane
// use deterministic software compositing.
if (process.env.TUGBERK_PLAYER_SMOKE === '1' || process.env.TUGBERK_PLAYER_SCENE_SWITCH_SMOKE === '1') {
    app.commandLine.appendSwitch('in-process-gpu');
    app.commandLine.appendSwitch('no-sandbox');
}

// Chromium cache/session files are disposable. Isolating them per player
// process avoids stale locks and corrupted shared cache state across runs.
const sessionDataRoot = path.join(app.getPath('temp'), 'tugberk-engine-player', String(process.pid));
fs.mkdirSync(sessionDataRoot, { recursive: true });
app.setPath('sessionData', sessionDataRoot);

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
    const selected = readBuiltScene(buildRoot, manifest, activeScenePath || manifest.entryScene);
    return {
        manifest, scenePath: selected.path, scene: selected.value,
        smoke: process.env.TUGBERK_PLAYER_SMOKE === '1',
        sceneSwitchSmoke: process.env.TUGBERK_PLAYER_SCENE_SWITCH_SMOKE === '1'
    };
}

function readJsonAsset(relativePath) {
    if (!verifiedBuild || typeof relativePath !== 'string') throw new Error('Player is not initialized');
    const normalized = relativePath.replaceAll('\\', '/');
    const entry = verifiedBuild.manifest.files.find((file) => file.path === normalized);
    if (!entry || !normalized.startsWith('Assets/') || !normalized.endsWith('.json') || entry.bytes > 1024 * 1024) {
        throw new Error('Asset is not an allowed JSON build resource');
    }
    const contentRoot = path.resolve(buildRoot, 'content');
    const filePath = path.resolve(contentRoot, normalized);
    if (!filePath.startsWith(`${contentRoot}${path.sep}`)) throw new Error('Asset escapes build content');
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readAudioAsset(relativePath) {
    if (!verifiedBuild || typeof relativePath !== 'string') throw new Error('Player is not initialized');
    const normalized = relativePath.replaceAll('\\', '/');
    const entry = verifiedBuild.manifest.files.find((file) => file.path === normalized);
    if (!entry || !normalized.startsWith('Assets/') || !/\.(wav|mp3|ogg|m4a|flac)$/i.test(normalized) || entry.bytes > 32 * 1024 * 1024) {
        throw new Error('Asset is not an allowed audio build resource');
    }
    const contentRoot = path.resolve(buildRoot, 'content');
    const filePath = path.resolve(contentRoot, normalized);
    if (!filePath.startsWith(`${contentRoot}${path.sep}`)) throw new Error('Asset escapes build content');
    return fs.readFileSync(filePath);
}

ipcMain.handle('player:bootstrap', () => {
    verifiedBuild = readBuild();
    return verifiedBuild;
});
ipcMain.handle('player:activate-scene', (event, requestedPath) => {
    if (!verifiedBuild) verifiedBuild = readBuild();
    activeScenePath = selectBuiltScene(verifiedBuild.manifest, requestedPath);
    event.sender.reload();
    return true;
});
ipcMain.handle('player:read-json-asset', (_event, relativePath) => readJsonAsset(relativePath));
ipcMain.handle('player:read-audio-asset', (_event, relativePath) => readAudioAsset(relativePath));
ipcMain.handle('player:read-image-asset', (_event, relativePath) => {
    if (!verifiedBuild || typeof relativePath !== 'string') throw new Error('Player is not initialized');
    const normalized = relativePath.replaceAll('\\', '/');
    const entry = verifiedBuild.manifest.files.find((file) => file.path === normalized);
    if (!entry || !normalized.startsWith('Assets/') || !/\.(png|jpe?g|webp)$/i.test(normalized) || entry.bytes > 16 * 1024 * 1024) {
        throw new Error('Asset is not an allowed image build resource');
    }
    const contentRoot = path.resolve(buildRoot, 'content');
    const filePath = path.resolve(contentRoot, normalized);
    if (!filePath.startsWith(`${contentRoot}${path.sep}`)) throw new Error('Asset escapes build content');
    return fs.readFileSync(filePath);
});
ipcMain.handle('player:smoke-complete', (_event, result) => {
    const output = process.env.TUGBERK_PLAYER_SMOKE_OUTPUT;
    if (!output) return false;
    fs.writeFileSync(output, JSON.stringify(result), 'utf8');
    app.quit();
    return true;
});

app.whenReady().then(() => {
    const window = new BrowserWindow({
        width: 1280, height: 720,
        show: process.env.TUGBERK_PLAYER_SMOKE !== '1' && process.env.TUGBERK_PLAYER_SCENE_SWITCH_SMOKE !== '1',
        webPreferences: {
            preload: path.join(__dirname, 'player-preload.js'), contextIsolation: true,
            nodeIntegration: false, sandbox: true
        }
    });
    window.removeMenu();
    if (process.env.TUGBERK_PLAYER_SMOKE === '1' || process.env.TUGBERK_PLAYER_SCENE_SWITCH_SMOKE === '1') {
        window.webContents.on('console-message', (_event, level, message) => {
            process.stderr.write(`[player-renderer:${level}] ${message}\n`);
        });
        window.webContents.on('did-fail-load', (_event, code, description) => {
            process.stderr.write(`[player-load-failed:${code}] ${description}\n`);
        });
        window.webContents.on('render-process-gone', (_event, details) => {
            process.stderr.write(`[player-renderer-gone] ${JSON.stringify(details)}\n`);
        });
    }
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.loadFile(path.join(__dirname, 'player.html'));
});

app.on('window-all-closed', () => app.quit());
