const { contextBridge, ipcRenderer } = require('electron');
// Sandboxed preloads may only require Electron's allowlisted built-ins. Keep the
// renderer-side envelope checks self-contained; the main process performs the
// authoritative command-specific validation in architecture/contract.js.
const PROTOCOL_VERSION = 1;
const PROTOCOL_COMMANDS = new Set([
    'project.readText', 'project.writeText', 'project.listDirectory', 'project.revokeGrant',
    'asset.scan', 'asset.cancelScan', 'asset.move', 'asset.transaction', 'asset.writeMetadata',
    'dialog.openProject', 'dialog.createProject', 'project.open', 'project.getTrust',
    'project.requestTrust', 'project.revokeTrust', 'recentProjects.load',
    'recentProjects.save', 'telemetry.record', 'runtime.start', 'runtime.pause',
    'runtime.resume', 'runtime.tick', 'runtime.step', 'runtime.stop', 'build.start', 'build.cancel'
]);
const PROTOCOL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function validateRequest(message) {
    if (!isRecord(message) || message.protocolVersion !== PROTOCOL_VERSION) return { ok: false, code: 'INVALID_ENVELOPE' };
    if (!PROTOCOL_ID.test(message.requestId || '')) return { ok: false, code: 'INVALID_REQUEST_ID' };
    if (!PROTOCOL_COMMANDS.has(message.command)) return { ok: false, code: 'UNKNOWN_COMMAND' };
    if (!isRecord(message.payload)) return { ok: false, code: 'INVALID_PAYLOAD' };
    if (message.command === 'recentProjects.save') {
        const projects = message.payload.projects;
        if (Object.keys(message.payload).length !== 1 || !Array.isArray(projects) || projects.length > 10
            || projects.some((project) => !isRecord(project)
                || Object.keys(project).sort().join(',') !== 'lastOpened,name,path'
                || typeof project.name !== 'string' || typeof project.path !== 'string'
                || !Number.isSafeInteger(project.lastOpened) || project.lastOpened < 0)) {
            return { ok: false, code: 'INVALID_PAYLOAD' };
        }
    }
    return { ok: true, value: message };
}
function validateResponse(message, expectedRequestId) {
    if (!isRecord(message) || message.protocolVersion !== PROTOCOL_VERSION
        || message.requestId !== expectedRequestId || !PROTOCOL_ID.test(message.requestId || '')
        || typeof message.ok !== 'boolean') return { ok: false, code: 'INVALID_RESPONSE' };
    if (!message.ok && (!isRecord(message.error) || !PROTOCOL_ID.test(message.error.code || '')
        || typeof message.error.message !== 'string')) return { ok: false, code: 'INVALID_RESPONSE' };
    return { ok: true, value: message };
}

const RENDERER_AUTH_FRAGMENT = '__tugberk_renderer_auth';

function readBootstrapArgument(name) {
    if (window.location?.protocol === 'file:') {
        const queryValue = new URLSearchParams(window.location.search).get(name);
        if (queryValue !== null) return queryValue;
    }
    const prefix = `--${name}=`;
    const argument = process.argv.find((value) => typeof value === 'string' && value.startsWith(prefix));
    return argument ? argument.slice(prefix.length) : null;
}

function authenticateRenderer() {
    const mode = readBootstrapArgument('tugberk-renderer-mode');
    if (mode === 'packaged') {
        // This argument is injected only by the main process into the locked-down
        // packaged BrowserWindow. Navigation and new-window creation are denied
        // in main.js, so an untrusted renderer cannot opt into this mode.
        return window.location?.protocol === 'file:';
    }
    if (mode !== 'development') return false;

    const expectedOrigin = readBootstrapArgument('tugberk-renderer-origin');
    const expectedToken = readBootstrapArgument('tugberk-renderer-token');
    const isExpectedLocation = window.location?.origin === expectedOrigin
        || window.location?.protocol === 'file:';
    if (!expectedOrigin || !expectedToken || !isExpectedLocation) return false;

    const fragment = new URLSearchParams(window.location.hash.slice(1));
    if (fragment.get(RENDERER_AUTH_FRAGMENT) !== expectedToken) return false;

    fragment.delete(RENDERER_AUTH_FRAGMENT);
    const remainingFragment = fragment.toString();
    window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${window.location.search}${remainingFragment ? `#${remainingFragment}` : ''}`
    );
    return true;
}

const electronAPI = {
    isElectron: true,
    platform: process.platform,
    currentWorkingDirectory: typeof process.cwd === 'function' ? process.cwd() : '.',
    launchArgs: {
        smokeTest: readBootstrapArgument('tugberk-smoke-test') === '1',
        autoOpenProjectPath: readBootstrapArgument('tugberk-auto-open-project'),
        confirmResponse: readBootstrapArgument('tugberk-confirm-response')
    },
    versions: {
        chrome: process.versions.chrome || 'unknown',
        node: process.versions.node || 'unknown',
        electron: process.versions.electron || 'unknown'
    },
    showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
    showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
    readTextFile: (filePath) => ipcRenderer.invoke('read-text-file', filePath),
    writeTextFile: (filePath, content) => ipcRenderer.invoke('write-text-file', filePath, content),
    readSceneDocument: (filePath) => ipcRenderer.invoke('scene-document-read', filePath),
    writeSceneDocument: (filePath, content, expectedRevision) =>
        ipcRenderer.invoke('scene-document-write', filePath, content, expectedRevision),
    fileExists: (filePath) => ipcRenderer.invoke('file-exists', filePath),
    fsExists: (targetPath) => ipcRenderer.invoke('fs-exists', targetPath),
    fsMkdir: (targetPath, options) => ipcRenderer.invoke('fs-mkdir', targetPath, options),
    fsReaddir: (targetPath, options) => ipcRenderer.invoke('fs-readdir', targetPath, options),
    fsStat: (targetPath) => ipcRenderer.invoke('fs-stat', targetPath),
    fsReadFile: (targetPath, encoding) => ipcRenderer.invoke('fs-read-file', targetPath, encoding),
    fsWriteFile: (targetPath, data, encoding) => ipcRenderer.invoke('fs-write-file', targetPath, data, encoding),
    fsCopyFile: (sourcePath, targetPath) => ipcRenderer.invoke('fs-copy-file', sourcePath, targetPath),
    fsRename: (sourcePath, targetPath) => ipcRenderer.invoke('fs-rename', sourcePath, targetPath),
    fsRm: (targetPath, options) => ipcRenderer.invoke('fs-rm', targetPath, options),
    fsUnlink: (targetPath) => ipcRenderer.invoke('fs-unlink', targetPath),
    pathJoin: (...segments) => ipcRenderer.invoke('path-join', ...segments),
    pathBasename: (targetPath) => ipcRenderer.invoke('path-basename', targetPath),
    setEditorDirty: (dirty) => ipcRenderer.send('editor-dirty-state', dirty === true),
    writeRecovery: (projectPath, scenePath, sceneText) => ipcRenderer.invoke('recovery-write', projectPath, scenePath, sceneText),
    readRecovery: (projectPath, scenePath) => ipcRenderer.invoke('recovery-read', projectPath, scenePath),
    discardRecovery: (projectPath) => ipcRenderer.invoke('recovery-discard', projectPath),
    onCloseSaveRequested: (callback) => ipcRenderer.on('editor-close-save', async () => {
        let saved = false;
        try { saved = (await callback()) === true; } catch {}
        ipcRenderer.send('editor-close-save-result', saved);
    }),
    revealInFolder: (targetPath) => ipcRenderer.invoke('reveal-in-folder', targetPath),
    exitApp: () => ipcRenderer.send('exit-app')
};

let nextRequestId = 0;
const tugberkV1 = Object.freeze({
    request: async (command, payload) => {
        const request = Object.freeze({
            protocolVersion: PROTOCOL_VERSION,
            requestId: `renderer-${Date.now().toString(36)}-${++nextRequestId}`,
            command,
            payload
        });
        const validation = validateRequest(request);
        if (!validation.ok) {
            throw Object.assign(new Error('IPC request rejected by preload'), { code: validation.code });
        }
        const response = await ipcRenderer.invoke('tugberk:v1:request', request);
        const responseValidation = validateResponse(response, request.requestId);
        if (!responseValidation.ok) {
            throw Object.assign(new Error('Invalid IPC response'), { code: responseValidation.code });
        }
        if (!response.ok) {
            throw Object.assign(new Error(response.error?.message || 'Request failed'), {
                code: response.error?.code || 'REQUEST_FAILED'
            });
        }
        return response.value;
    },
    scanAssets: (resource, { onProgress, signal } = {}) => {
        const requestId = `renderer-${Date.now().toString(36)}-${++nextRequestId}`;
        if (signal?.aborted) {
            return Promise.reject(Object.assign(new Error('Asset scan was cancelled'), {
                code: 'REQUEST_CANCELLED'
            }));
        }
        const progressListener = (_event, progressRequestId, progress) => {
            if (progressRequestId === requestId) onProgress?.(progress);
        };
        ipcRenderer.on('tugberk:v1:asset-scan-progress', progressListener);
        const cancel = () => tugberkV1.request('asset.cancelScan', { scanRequestId: requestId }).catch(() => {});
        signal?.addEventListener('abort', cancel, { once: true });
        const request = Object.freeze({
            protocolVersion: PROTOCOL_VERSION,
            requestId,
            command: 'asset.scan',
            payload: resource
        });
        return ipcRenderer.invoke('tugberk:v1:request', request).then((response) => {
            const validation = validateResponse(response, requestId);
            if (!validation.ok) throw Object.assign(new Error('Invalid IPC response'), { code: validation.code });
            if (!response.ok) throw Object.assign(new Error(response.error.message), { code: response.error.code });
            return response.value;
        }).finally(() => {
            ipcRenderer.removeListener('tugberk:v1:asset-scan-progress', progressListener);
            signal?.removeEventListener('abort', cancel);
        });
    },
    onBuildProgress: (callback) => {
        const listener = (_event, buildId, progress) => callback(buildId, progress);
        ipcRenderer.on('tugberk:v1:build-progress', listener);
        return () => ipcRenderer.removeListener('tugberk:v1:build-progress', listener);
    }
});

function exposeElectronAPI() {
    if (!authenticateRenderer()) return;
    try {
        contextBridge.exposeInMainWorld('electronAPI', electronAPI);
        contextBridge.exposeInMainWorld('tugberk', Object.freeze({ v1: tugberkV1 }));
    } catch {
        // The bindings already exist in this document. A later committed
        // document still gets its own DOMContentLoaded retry below.
    }
}

exposeElectronAPI();

// A sandboxed packaged preload can run against about:blank before loadFile()
// commits. Poll briefly so the document-scoped bridge is installed into the
// committed renderer even when that transition does not dispatch this world's
// DOMContentLoaded listener.
if (typeof window.setInterval === 'function') {
    let bridgeAttempts = 0;
    const bridgeTimer = window.setInterval(() => {
        bridgeAttempts += 1;
        if (window.location?.protocol === 'file:') {
            exposeElectronAPI();
            window.clearInterval(bridgeTimer);
        } else if (bridgeAttempts >= 200) {
            window.clearInterval(bridgeTimer);
        }
    }, 10);
}

window.addEventListener('DOMContentLoaded', () => {
    // Sandboxed packaged preloads can initially observe about:blank. Recheck once
    // the committed file URL is visible, before renderer DOMContentLoaded handlers.
    exposeElectronAPI();
    const replaceText = (selector, text) => {
        const element = document.getElementById(selector);
        if (element) element.innerText = text;
    };

    for (const dependency of ['chrome', 'node', 'electron']) {
        replaceText(`${dependency}-version`, electronAPI.versions[dependency] || 'unknown');
    }
});
