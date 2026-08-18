'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { runExecutable } = require('../scripts/packaged-smoke.cjs');

const root = path.resolve(__dirname, '..');
const electronExecutable = path.join(
    root,
    'node_modules',
    'electron',
    'dist',
    process.platform === 'win32' ? 'electron.exe' : 'electron'
);

test('rendered editor interactions create, select, inspect, and expose menu state', {
    skip: process.platform !== 'win32' ? 'The desktop editor interaction lane currently qualifies Windows only.' : false,
    timeout: 120_000
}, async (t) => {
    assert.ok(fs.existsSync(path.join(root, 'dist', 'index.html')),
        'dist/index.html is missing; run npm run build before the interaction test');
    assert.ok(fs.existsSync(electronExecutable), `Electron executable is missing: ${electronExecutable}`);

    const scratchRoot = process.env.PAPERCLIP_RUN_SCRATCH_DIR
        || process.env.PAPERCLIP_SCRATCH_DIR
        || os.tmpdir();
    const workDirectory = fs.mkdtempSync(path.join(scratchRoot, 'editor-interaction-'));
    const output = path.join(workDirectory, 'result.json');
    const project = path.join(workDirectory, 'project');
    fs.cpSync(path.join(root, 'samples', 'vertical-slice'), project, { recursive: true });
    t.after(() => fs.rmSync(workDirectory, { recursive: true, force: true }));

    await runExecutable(electronExecutable, {
        args: ['.'],
        cwd: root,
        env: {
            ELECTRON_RUN_AS_NODE: undefined,
            ENGINE_LOAD_DIST: '1',
            ENGINE_SMOKE_TEST: '1',
            ENGINE_SMOKE_TEST_OUTPUT: output,
            ENGINE_AUTO_OPEN_PROJECT_PATH: project,
            ENGINE_USER_DATA_PATH: path.join(workDirectory, 'user-data')
        },
        timeoutMs: 45_000
    });

    const result = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(result.ok, true, JSON.stringify(result.failures ?? result, null, 2));

    const checks = new Map(result.checks.map((check) => [check.name, check]));
    for (const name of [
        'hierarchy create menu opens',
        'cube creation changes scene object count',
        'rendered create is exactly one undo unit',
        'cube becomes active selection',
        'hierarchy renders created cube row',
        'keyboard shortcut creates and selects GameObject',
        'keyboard create is exactly one undo unit',
        'keyboard rename commits and returns hierarchy focus',
        'rendered rename is exactly one undo unit',
        'hierarchy context menu traps and returns keyboard focus',
        'hierarchy shift click selects a visible range',
        'hierarchy rename Escape preserves model and returns focus',
        'rendered reparent is exactly one undo unit',
        'invalid descendant drop leaves scene, history, and dirty checkpoint unchanged',
        'hierarchy drag Escape clears visual state without mutation',
        'rendered duplicate is exactly one undo unit',
        'rendered delete is exactly one undo unit',
        'global authoring shortcut is suppressed while editing text',
        'created cube has renderable geometry',
        'inspector staged edit is model-nonmutating until commit',
        'inspector change commits through the rendered control',
        'inspector add component button visible',
        'add component menu opens',
        'component added to cube',
        'Project async item selection reaches observable state',
        'Project drag exposes a typed asset payload',
        'rendered Project duplicate is one global undo unit with fresh GUID',
        'rendered Project duplicate undo and redo are byte-stable',
        'Project F2 Escape is byte- and history-nonmutating',
        'Project F2 Enter rename preserves GUID and is one global undo unit',
        'Project Delete cancellation preserves bytes, focus policy and history',
        'Console supports rendered selection and filtering',
        'docking splitter keyboard resize is reversible',
        'rendered scene transaction saves at a clean checkpoint',
        'file menu opens on click'
    ]) {
        assert.equal(checks.get(name)?.pass, true, `missing or failed interaction: ${name}`);
    }

    const restartOutput = path.join(workDirectory, 'restart-result.json');
    await runExecutable(electronExecutable, {
        args: ['.'],
        cwd: root,
        env: {
            ELECTRON_RUN_AS_NODE: undefined,
            ENGINE_LOAD_DIST: '1',
            ENGINE_SMOKE_TEST: '1',
            ENGINE_SMOKE_TEST_OUTPUT: restartOutput,
            ENGINE_SMOKE_EXPECT_SCENE_TRANSACTION: JSON.stringify(result.snapshot.persistedScene),
            ENGINE_AUTO_OPEN_PROJECT_PATH: project,
            ENGINE_USER_DATA_PATH: path.join(workDirectory, 'user-data')
        },
        timeoutMs: 45_000
    });
    const restartResult = JSON.parse(fs.readFileSync(restartOutput, 'utf8'));
    assert.equal(restartResult.ok, true, JSON.stringify(restartResult.failures ?? restartResult, null, 2));
    const restartChecks = new Map(restartResult.checks.map((check) => [check.name, check]));
    assert.equal(restartChecks.get('saved scene transaction survives editor relaunch with stable IDs and order')?.pass, true);
});

test('launcher keeps a visible recoverable error after project bootstrap failure', {
    skip: process.platform !== 'win32' ? 'The desktop editor interaction lane currently qualifies Windows only.' : false,
    timeout: 60_000
}, async (t) => {
    const scratchRoot = process.env.PAPERCLIP_RUN_SCRATCH_DIR
        || process.env.PAPERCLIP_SCRATCH_DIR
        || os.tmpdir();
    const workDirectory = fs.mkdtempSync(path.join(scratchRoot, 'launcher-interaction-'));
    const output = path.join(workDirectory, 'result.json');
    const project = path.join(workDirectory, 'broken-project');
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(path.join(project, 'project.json'), '{ broken json', 'utf8');
    t.after(() => fs.rmSync(workDirectory, { recursive: true, force: true }));

    await runExecutable(electronExecutable, {
        args: ['.'],
        cwd: root,
        env: {
            ELECTRON_RUN_AS_NODE: undefined,
            ENGINE_LOAD_DIST: '1',
            ENGINE_SMOKE_TEST: '1',
            ENGINE_SMOKE_EXPECT_LAUNCHER_FAILURE: '1',
            ENGINE_SMOKE_TEST_OUTPUT: output,
            ENGINE_AUTO_OPEN_PROJECT_PATH: project,
            ENGINE_USER_DATA_PATH: path.join(workDirectory, 'user-data')
        },
        timeoutMs: 45_000
    });

    const result = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(result.ok, true, JSON.stringify(result.failures ?? result, null, 2));
    const checks = new Map(result.checks.map((check) => [check.name, check]));
    assert.equal(checks.get('launcher remains visible after project failure')?.pass, true);
    assert.equal(checks.get('launcher exposes visible project failure')?.pass, true);
});
