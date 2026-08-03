const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');

function loadPreload({
    argv = ['electron', '--tugberk-renderer-mode=packaged'],
    href = 'file:///editor/index.html'
} = {}) {
    const exposed = new Map();
    const calls = [];
    const electron = {
        contextBridge: {
            exposeInMainWorld(name, value) {
                exposed.set(name, value);
            }
        },
        ipcRenderer: {
            invoke(channel, ...args) {
                calls.push({ kind: 'invoke', channel, args });
                return Promise.resolve();
            },
            send(channel, ...args) {
                calls.push({ kind: 'send', channel, args });
            },
            sendSync(channel, ...args) {
                calls.push({ kind: 'sendSync', channel, args });
                return undefined;
            }
        }
    };
    const source = fs.readFileSync(path.join(root, 'electron/preload.js'), 'utf8');
    let domContentLoaded;
    const context = {
        require(request) {
            if (request === 'electron') return electron;
            if (request === './architecture/contract') return require('../electron/architecture/contract');
            throw new Error(`Unexpected preload dependency: ${request}`);
        },
        process: {
            argv,
            platform: process.platform,
            cwd: () => root,
            env: {},
            versions: { chrome: 'test', node: 'test', electron: 'test' }
        },
        window: {
            location: new URL(href),
            history: { replaceState() {} },
            addEventListener(name, callback) {
                if (name === 'DOMContentLoaded') domContentLoaded = callback;
            }
        },
        document: { getElementById() { return null; } },
        URLSearchParams
    };
    vm.runInNewContext(source, context, { filename: 'electron/preload.js' });
    return {
        api: exposed.get('electronAPI'),
        calls,
        simulateCommittedDocument() {
            exposed.clear();
            context.window.location = new URL('file:///editor/index.html');
            domContentLoaded?.();
            return exposed.get('electronAPI');
        }
    };
}

test('packaged preload rebinds APIs after the transient document is replaced', () => {
    const preload = loadPreload({ href: 'about:blank' });
    assert.equal(preload.api, undefined);
    assert.ok(preload.simulateCommittedDocument());
});

async function loadMain({ selectedProject }) {
    const handles = new Map();
    const listeners = new Map();
    const appListeners = new Map();
    const windows = [];
    let quitCalls = 0;
    const dialog = {
        async showOpenDialog() {
            return { canceled: false, filePaths: [selectedProject] };
        },
        async showSaveDialog() {
            return { canceled: true };
        },
        async showMessageBox() {
            return { response: 0 };
        }
    };

    class BrowserWindow {
        constructor(options) {
            this.options = options;
            this.navigationListeners = new Map();
            this.windowListeners = new Map();
            this.closeCalls = 0;
            let webContentsDestroyed = false;
            this.webContents = {
                get id() {
                    if (webContentsDestroyed) throw new TypeError('Object has been destroyed');
                    return 73;
                },
                isDestroyed: () => webContentsDestroyed,
                getURL: () => 'file:///editor/index.html',
                setWindowOpenHandler: (handler) => { this.windowOpenHandler = handler; },
                on: (name, handler) => { this.navigationListeners.set(name, handler); },
                send: () => {},
                openDevTools() {},
                executeJavaScript: async () => ({ ok: true }),
                destroy: () => {
                    webContentsDestroyed = true;
                    this.navigationListeners.get('destroyed')?.();
                }
            };
            windows.push(this);
        }
        on(name, handler) {
            this.windowListeners.set(name, handler);
        }
        close() {
            this.closeCalls += 1;
            const event = {
                defaultPrevented: false,
                preventDefault() {
                    this.defaultPrevented = true;
                }
            };
            this.lastCloseEvent = event;
            this.windowListeners.get('close')?.(event);
            return event;
        }
        async loadFile() {}
        async loadURL() {}
        setMenuBarVisibility() {}
        static fromWebContents() {
            return windows[0];
        }
        static getAllWindows() {
            return windows;
        }
    }

    const electron = {
        app: {
            isPackaged: true,
            getPath: () => path.join(selectedProject, '.test-user-data'),
            on: (name, handler) => { appListeners.set(name, handler); },
            quit() { quitCalls += 1; },
            exit() {}
        },
        BrowserWindow,
        ipcMain: {
            handle: (channel, handler) => { handles.set(channel, handler); },
            on: (channel, handler) => { listeners.set(channel, handler); }
        },
        dialog,
        shell: { showItemInFolder() {} }
    };

    const filename = path.join(root, 'electron/main.js');
    const source = fs.readFileSync(filename, 'utf8');
    const nativeRequire = createRequire(filename);
    const context = {
        require(request) {
            return request === 'electron' ? electron : nativeRequire(request);
        },
        module: { exports: {} },
        exports: {},
        __filename: filename,
        __dirname: path.dirname(filename),
        process: { ...process, env: {} },
        console,
        Buffer,
        setTimeout,
        clearTimeout
    };
    vm.runInNewContext(source, context, { filename });
    await appListeners.get('ready')();
    return { handles, listeners, window: windows[0], get quitCalls() { return quitCalls; } };
}

test('BrowserWindow preserves renderer isolation and denies new windows and navigation', async (t) => {
    const scratch = fs.mkdtempSync(path.join(process.env.PAPERCLIP_RUN_SCRATCH_DIR || os.tmpdir(), 'tugberk-electron-'));
    t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
    const loaded = await loadMain({ selectedProject: scratch });

    assert.equal(loaded.window.options.webPreferences.nodeIntegration, false);
    assert.equal(loaded.window.options.webPreferences.contextIsolation, true);
    assert.equal(loaded.window.options.webPreferences.webSecurity, true);
    assert.equal(loaded.window.windowOpenHandler({ url: 'https://attacker.invalid' }).action, 'deny');

    let prevented = false;
    loaded.window.navigationListeners.get('will-navigate')(
        { preventDefault() { prevented = true; } },
        'https://attacker.invalid'
    );
    assert.equal(prevented, true);
});

test('renderer destruction cleanup never reads the destroyed webContents object', async (t) => {
    const scratch = fs.mkdtempSync(path.join(process.env.PAPERCLIP_RUN_SCRATCH_DIR || os.tmpdir(), 'tugberk-destroyed-'));
    t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
    const loaded = await loadMain({ selectedProject: scratch });

    assert.doesNotThrow(() => loaded.window.webContents.destroy());
});

test('preload exports only the reviewed API and maps every method to an allowlisted channel', async () => {
    const { api, calls } = loadPreload();
    assert.deepEqual(Object.keys(api).sort(), [
        'currentWorkingDirectory', 'exitApp', 'fileExists', 'fsCopyFile',
        'fsExists', 'fsMkdir', 'fsReadFile', 'fsReaddir',
        'fsRename', 'fsRm', 'fsStat', 'fsUnlink',
        'fsWriteFile', 'isElectron', 'launchArgs', 'onCloseSaveRequested',
        'pathBasename', 'pathJoin', 'platform', 'readRecovery', 'readSceneDocument', 'readTextFile',
        'revealInFolder',
        'setEditorDirty', 'showOpenDialog', 'showSaveDialog', 'versions',
        'writeRecovery', 'writeSceneDocument', 'discardRecovery', 'writeTextFile'
    ].sort());

    const expectedChannels = new Set([
        'show-open-dialog', 'show-save-dialog',
        'read-text-file', 'scene-document-read', 'scene-document-write',
        'write-text-file', 'file-exists', 'fs-exists', 'fs-mkdir',
        'fs-readdir', 'fs-stat', 'fs-read-file',
        'fs-write-file', 'fs-copy-file', 'fs-rename',
        'fs-rm', 'fs-unlink', 'path-join', 'path-basename',
        'reveal-in-folder', 'exit-app', 'editor-dirty-state',
        'recovery-write', 'recovery-read', 'recovery-discard'
    ]);
    for (const [name, value] of Object.entries(api)) {
        if (typeof value !== 'function') continue;
        try { await value(); } catch {}
    }
    assert.deepEqual(new Set(calls.map(({ channel }) => channel)), expectedChannels);
});

test('preload exposes privileged IPC only in main-process-selected renderer modes', () => {
    const token = 'one-time-renderer-token';
    const argv = [
        'electron',
        '--tugberk-renderer-mode=development',
        '--tugberk-renderer-origin=http://localhost:5174',
        `--tugberk-renderer-token=${token}`
    ];

    assert.ok(loadPreload({
        argv,
        href: `http://localhost:5174/#__tugberk_renderer_auth=${token}`
    }).api);
    assert.equal(loadPreload({
        argv,
        href: 'http://localhost:5174/'
    }).api, undefined);
    assert.equal(loadPreload({
        argv,
        href: `http://attacker.invalid/#__tugberk_renderer_auth=${token}`
    }).api, undefined);
    assert.ok(loadPreload({
        argv: ['electron', '--tugberk-renderer-mode=packaged'],
        href: 'file:///editor/index.html'
    }).api);
});

test('CSP denies injected scripts, plugins, frames, forms, and base URL changes', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const match = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i);
    assert.ok(match, 'index.html must define a Content Security Policy');
    const csp = match[1];
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /script-src 'self'/);
    assert.doesNotMatch(csp, /script-src[^;]*(?:'unsafe-inline'|'unsafe-eval'|\*)/);
    for (const directive of ['object-src', 'base-uri', 'frame-src', 'form-action']) {
        assert.match(csp, new RegExp(`${directive} 'none'`));
    }
});

test('privileged IPC rejects foreign senders and confines project filesystem access', async (t) => {
    const scratch = fs.mkdtempSync(path.join(process.env.PAPERCLIP_RUN_SCRATCH_DIR || os.tmpdir(), 'tugberk-ipc-'));
    t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
    const project = path.join(scratch, 'project');
    const outside = path.join(scratch, 'outside.txt');
    fs.mkdirSync(project);
    fs.writeFileSync(path.join(project, 'inside.txt'), 'inside');
    fs.writeFileSync(outside, 'outside');
    const loaded = await loadMain({ selectedProject: project });
    const trustedEvent = { sender: { id: 73, isDestroyed: () => false } };
    const foreignEvent = { sender: { id: 999, isDestroyed: () => false } };

    await assert.rejects(
        loaded.handles.get('read-text-file')(foreignEvent, path.join(project, 'inside.txt')),
        /untrusted sender/
    );
    await assert.rejects(
        loaded.handles.get('get-project-trust')(trustedEvent, scratch),
        /has not been granted by the main process/
    );
    await assert.rejects(
        loaded.handles.get('request-project-trust')(trustedEvent, scratch),
        /has not been granted by the main process/
    );
    await assert.rejects(
        loaded.handles.get('read-text-file')(trustedEvent, outside),
        /outside an approved/
    );
    await loaded.handles.get('show-open-dialog')(trustedEvent, { properties: ['openDirectory'] });
    assert.equal(
        await loaded.handles.get('read-text-file')(trustedEvent, path.join(project, 'inside.txt')),
        'inside'
    );
    await assert.rejects(loaded.handles.get('read-text-file')(trustedEvent, outside), /outside an approved/);
    await assert.rejects(
        loaded.handles.get('write-text-file')(trustedEvent, path.join(project, 'new.txt'), 'data'),
        /safe mode/
    );

    await assert.rejects(
        loaded.handles.get('fs-read-file')(foreignEvent, path.join(project, 'inside.txt'), 'utf8'),
        /untrusted sender/
    );

    loaded.window.navigationListeners.get('will-navigate')(
        { preventDefault() {} },
        'https://attacker.invalid'
    );
    await assert.rejects(
        loaded.handles.get('read-text-file')(trustedEvent, path.join(project, 'inside.txt')),
        (error) => error.code === 'PROJECT_NOT_GRANTED'
    );
});

test('every state-changing IPC endpoint rejects foreign senders and trusted exit uses the dirty-close flow', async (t) => {
    const scratch = fs.mkdtempSync(path.join(process.env.PAPERCLIP_RUN_SCRATCH_DIR || os.tmpdir(), 'tugberk-ipc-state-'));
    t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
    const project = path.join(scratch, 'project');
    fs.mkdirSync(project);
    const loaded = await loadMain({ selectedProject: project });
    const trustedEvent = { sender: { id: 73, isDestroyed: () => false } };
    const foreignEvent = { sender: { id: 999, isDestroyed: () => false } };

    const mutatingHandles = [
        'show-save-dialog', 'show-open-dialog', 'request-project-trust',
        'revoke-project-trust', 'initialize-project-structure',
        'write-text-file', 'recovery-write', 'recovery-discard', 'reveal-in-folder'
    ];
    for (const channel of mutatingHandles) {
        await assert.rejects(
            loaded.handles.get(channel)(foreignEvent),
            /untrusted sender/,
            `${channel} must reject a foreign sender`
        );
    }

    const mutatingFileSystemChannels = [
        'fs-mkdir', 'fs-write-file', 'fs-copy-file',
        'fs-rename', 'fs-rm', 'fs-unlink'
    ];
    for (const channel of mutatingFileSystemChannels) {
        await assert.rejects(
            loaded.handles.get(channel)(foreignEvent),
            /untrusted sender/,
            `${channel} must reject a foreign sender`
        );
    }

    for (const channel of ['editor-dirty-state', 'editor-close-save-result', 'exit-app']) {
        assert.throws(
            () => loaded.listeners.get(channel)(foreignEvent),
            /untrusted sender/,
            `${channel} must reject a foreign sender`
        );
    }
    assert.equal(loaded.window.closeCalls, 0);
    assert.equal(loaded.quitCalls, 0);

    loaded.listeners.get('editor-dirty-state')(trustedEvent, true);
    loaded.listeners.get('exit-app')(trustedEvent);
    assert.equal(loaded.window.closeCalls, 1);
    assert.equal(loaded.window.lastCloseEvent.defaultPrevented, true);
    assert.equal(loaded.quitCalls, 0);
});
