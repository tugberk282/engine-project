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

test('rendered Play/Pause/Step/Stop uses the supervised runtime and restores authored bytes', {
    skip: process.platform !== 'win32' ? 'The rendered desktop runtime lane currently qualifies Windows only.' : false,
    timeout: 90_000
}, async (t) => {
    const scratchRoot = process.env.PAPERCLIP_RUN_SCRATCH_DIR || process.env.PAPERCLIP_SCRATCH_DIR || os.tmpdir();
    const workDirectory = fs.mkdtempSync(path.join(scratchRoot, 'playable-runtime-'));
    const output = path.join(workDirectory, 'result.json');
    const project = path.join(workDirectory, 'project');
    fs.cpSync(path.join(root, 'samples', 'playable-runtime'), project, { recursive: true });
    t.after(() => fs.rmSync(workDirectory, { recursive: true, force: true }));

    await runExecutable(electronExecutable, {
        args: ['.'],
        cwd: root,
        env: {
            ELECTRON_RUN_AS_NODE: undefined,
            ENGINE_LOAD_DIST: '1',
            ENGINE_SMOKE_TEST: '1',
            ENGINE_PLAYABLE_RUNTIME_SMOKE: '1',
            ENGINE_SMOKE_TEST_OUTPUT: output,
            ENGINE_AUTO_OPEN_PROJECT_PATH: project,
            ENGINE_USER_DATA_PATH: path.join(workDirectory, 'user-data')
        },
        timeoutMs: 60_000
    });

    const result = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(result.ok, true, JSON.stringify(result.failures ?? result, null, 2));
    const checks = new Map(result.checks.map((check) => [check.name, check.pass]));
    for (const name of [
        'retained playable scene loads an authored object',
        'child runtime visibly advances authored Update and fixed-step state',
        'Pause freezes runtime-authored state',
        'Step advances one paused runtime frame',
        'Stop restores edit scene byte-for-byte'
    ]) assert.equal(checks.get(name), true, `missing or failed rendered check: ${name}`);
});

test('a child-runtime crash is visible and leaves the rendered editor usable', {
    skip: process.platform !== 'win32' ? 'The rendered desktop runtime lane currently qualifies Windows only.' : false,
    timeout: 90_000
}, async (t) => {
    const scratchRoot = process.env.PAPERCLIP_RUN_SCRATCH_DIR || process.env.PAPERCLIP_SCRATCH_DIR || os.tmpdir();
    const workDirectory = fs.mkdtempSync(path.join(scratchRoot, 'playable-runtime-crash-'));
    const output = path.join(workDirectory, 'result.json');
    const project = path.join(workDirectory, 'project');
    fs.cpSync(path.join(root, 'samples', 'playable-runtime'), project, { recursive: true });
    t.after(() => fs.rmSync(workDirectory, { recursive: true, force: true }));

    await runExecutable(electronExecutable, {
        args: ['.'], cwd: root,
        env: {
            ELECTRON_RUN_AS_NODE: undefined,
            ENGINE_LOAD_DIST: '1',
            ENGINE_SMOKE_TEST: '1',
            ENGINE_PLAYABLE_RUNTIME_SMOKE: '1',
            ENGINE_PLAYABLE_RUNTIME_CRASH_SMOKE: '1',
            ENGINE_SMOKE_TEST_OUTPUT: output,
            ENGINE_AUTO_OPEN_PROJECT_PATH: project,
            ENGINE_USER_DATA_PATH: path.join(workDirectory, 'user-data')
        },
        timeoutMs: 60_000
    });

    const result = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(result.ok, true, JSON.stringify(result.failures ?? result, null, 2));
    const checks = new Map(result.checks.map((check) => [check.name, check.pass]));
    assert.equal(checks.get('runtime crash exits Play without terminating the editor'), true);
    assert.equal(checks.get('runtime crash surfaces a visible bounded error'), true);
});
