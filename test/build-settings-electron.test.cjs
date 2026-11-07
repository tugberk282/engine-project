'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { runExecutable } = require('../scripts/packaged-smoke.cjs');

const root = path.resolve(__dirname, '..');
const electronExecutable = path.join(root, 'node_modules', 'electron', 'dist',
    process.platform === 'win32' ? 'electron.exe' : 'electron');

test('rendered Build Settings qualifies cancel, progress, success artifact, and backend failure', {
    skip: process.platform !== 'win32' ? 'The rendered desktop build lane currently qualifies Windows only.' : false,
    timeout: 90_000
}, async (t) => {
    const workDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'build-settings-rendered-'));
    const output = path.join(workDirectory, 'result.json');
    const project = path.join(workDirectory, 'project');
    const successRoot = path.join(workDirectory, 'published');
    const failureRoot = path.join(workDirectory, 'not-a-directory');
    fs.cpSync(path.join(root, 'samples', 'vertical-slice'), project, { recursive: true });
    fs.mkdirSync(successRoot, { recursive: true });
    fs.writeFileSync(failureRoot, 'publication must fail below a file', 'utf8');
    t.after(() => fs.rmSync(workDirectory, { recursive: true, force: true }));

    await runExecutable(electronExecutable, {
        args: ['.'], cwd: root,
        env: {
            ELECTRON_RUN_AS_NODE: undefined,
            ENGINE_LOAD_DIST: '1',
            ENGINE_SMOKE_TEST: '1',
            ENGINE_BUILD_SETTINGS_SMOKE: '1',
            ENGINE_BUILD_SETTINGS_SUCCESS_ROOT: successRoot,
            ENGINE_BUILD_SETTINGS_FAILURE_ROOT: failureRoot,
            ENGINE_SMOKE_TEST_OUTPUT: output,
            ENGINE_AUTO_OPEN_PROJECT_PATH: project,
            ENGINE_USER_DATA_PATH: path.join(workDirectory, 'user-data')
        },
        timeoutMs: 75_000
    });

    const result = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(result.ok, true, JSON.stringify(result.failures ?? result, null, 2));
    assert.match(result.snapshot.failureStatus, /^BUILD_PUBLICATION_FAILED: /);
    const checks = new Map(result.checks.map((check) => [check.name, check.pass]));
    for (const name of [
        'Build Settings loads authored project scenes',
        'cancelling the output picker leaves Build Settings idle',
        'rendered Build Settings completes a real Windows player build',
        'rendered Build Settings exposes bounded build progress',
        'rendered Build Settings surfaces backend publication failure and recovers',
        'Build Settings publishes the Windows executable to the selected folder'
    ]) assert.equal(checks.get(name), true, `missing or failed rendered check: ${name}`);
});
