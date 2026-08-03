'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

test('preload exposes a frozen v1 request API and validates before invoking main', async () => {
    const exposed = {};
    const invocations = [];
    const listeners = {};
    const context = {
        URLSearchParams,
        console,
        document: { getElementById: () => null },
        process: {
            argv: ['electron', '--tugberk-renderer-mode=packaged'],
            cwd: () => root,
            platform: 'win32',
            versions: {}
        },
        window: {
            addEventListener: (name, callback) => { listeners[name] = callback; },
            location: { origin: 'null', protocol: 'file:', hash: '', pathname: '/', search: '' },
            history: { replaceState() {} }
        },
        require(id) {
            if (id === 'electron') return {
                contextBridge: { exposeInMainWorld: (name, value) => { exposed[name] = value; } },
                ipcRenderer: {
                    invoke: async (channel, request) => {
                        invocations.push({ channel, request });
                        return { protocolVersion: 1, requestId: request.requestId, ok: true, value: 'ok' };
                    },
                    on() {},
                    send() {}
                }
            };
            if (id === './architecture/contract') return require('../electron/architecture/contract');
            throw new Error(`Unexpected require: ${id}`);
        }
    };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'electron/preload.js'), 'utf8'), context);

    assert.equal(Object.isFrozen(exposed.tugberk), true);
    assert.equal(Object.isFrozen(exposed.tugberk.v1), true);
    assert.equal(await exposed.tugberk.v1.request('telemetry.record', { name: 'boot', fields: {} }), 'ok');
    assert.equal(invocations[0].channel, 'tugberk:v1:request');
    await assert.rejects(
        exposed.tugberk.v1.request('fs.rm', {}),
        (error) => error.code === 'UNKNOWN_COMMAND'
    );
    assert.equal(invocations.length, 1);

    const validRecent = [{ name: 'Game', path: 'C:\\Projects\\Game', lastOpened: 1 }];
    assert.equal(
        await exposed.tugberk.v1.request('recentProjects.save', { projects: validRecent }),
        'ok'
    );
    assert.equal(invocations.at(-1).request.command, 'recentProjects.save');
    const invocationCount = invocations.length;
    await assert.rejects(
        exposed.tugberk.v1.request('recentProjects.save', { projects: [{ ...validRecent[0], extra: true }] }),
        (error) => error.code === 'INVALID_PAYLOAD'
    );
    assert.equal(invocations.length, invocationCount, 'preload rejects malformed recents before IPC');
});

test('main registers the authenticated versioned envelope handler', () => {
    const source = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8');
    assert.match(source, /ipcMain\.handle\('tugberk:v1:request', createVersionedHandler/);
    assert.match(source, /authenticate: requireEditorSender/);
    assert.match(source, /execute: executeProtocolCommand/);
});

test('persisted trust history is not restored as a live startup capability', () => {
    const source = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8');
    assert.doesNotMatch(source, /restoreTrustedProjects/);
    assert.doesNotMatch(source, /getProjectTrustStore\(\)\.list\(\).*projectCapabilities\.grant/s);
});

test('open-project v1 grants preserve the main-process trust decision', () => {
    const source = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8');
    const openProjectCommand = source.match(
        /case COMMANDS\.DIALOG_OPEN_PROJECT:[\s\S]*?case COMMANDS\.PROJECT_READ_TEXT:/
    )?.[0] ?? '';

    assert.match(openProjectCommand, /validateProjectRoot\(result\.filePaths\[0\]\)/);
    assert.match(
        openProjectCommand,
        /protocolProjectResult\(event\.sender, trust\)/
    );
    assert.doesNotMatch(openProjectCommand, /createProtocolGrant\([^;]*writable: false/);
});

test('legacy adapter inventory is frozen so new positional IPC channels fail the gate', () => {
    const preload = fs.readFileSync(path.join(root, 'electron/preload.js'), 'utf8');
    const channels = [...preload.matchAll(/ipcRenderer\.(?:invoke|send)\('([^']+)'/g)]
        .map((match) => match[1])
        .filter((channel) => channel !== 'tugberk:v1:request')
        .sort();
    assert.deepEqual(channels, [
        'editor-close-save-result',
        'editor-dirty-state',
        'exit-app',
        'file-exists',
        'fs-copy-file',
        'fs-exists',
        'fs-mkdir',
        'fs-read-file',
        'fs-readdir',
        'fs-rename',
        'fs-rm',
        'fs-stat',
        'fs-unlink',
        'fs-write-file',
        'path-basename',
        'path-join',
        'read-text-file',
        'recovery-discard',
        'recovery-read',
        'recovery-write',
        'reveal-in-folder',
        'scene-document-read',
        'scene-document-write',
        'show-open-dialog',
        'show-save-dialog',
        'write-text-file'
    ].sort());
    assert.equal(channels.length, 26, 'legacy adapter count must only decrease');
});

test('renderer production code cannot call Electron IPC directly', () => {
    const sourceFiles = [];
    const visit = (directory) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const target = path.join(directory, entry.name);
            if (entry.isDirectory()) visit(target);
            else if (/\.(?:ts|js)$/.test(entry.name)) sourceFiles.push(target);
        }
    };
    visit(path.join(root, 'src'));
    for (const file of sourceFiles) {
        const source = fs.readFileSync(file, 'utf8');
        assert.doesNotMatch(source, /\bipcRenderer\b|\brequire\(['"]electron['"]\)/, path.relative(root, file));
    }
});
