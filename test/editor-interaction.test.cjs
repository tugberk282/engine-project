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
    timeout: 60_000
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
        'cube becomes active selection',
        'hierarchy renders created cube row',
        'keyboard shortcut creates and selects GameObject',
        'keyboard rename commits and returns hierarchy focus',
        'hierarchy context menu traps and returns keyboard focus',
        'global authoring shortcut is suppressed while editing text',
        'created cube has renderable geometry',
        'inspector add component button visible',
        'add component menu opens',
        'component added to cube',
        'file menu opens on click'
    ]) {
        assert.equal(checks.get(name)?.pass, true, `missing or failed interaction: ${name}`);
    }
});
