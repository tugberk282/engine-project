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

test('rendered Build Settings publishes and executes the Game View-qualified Windows runtime slice', {
    skip: process.platform !== 'win32' ? 'The rendered desktop build lane currently qualifies Windows only.' : false,
    timeout: 150_000
}, async (t) => {
    const workDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'build-settings-rendered-'));
    const output = path.join(workDirectory, 'result.json');
    const project = path.join(workDirectory, 'project');
    const successRoot = path.join(workDirectory, 'published');
    const failureRoot = path.join(workDirectory, 'not-a-directory');
    const playerOutput = path.join(workDirectory, 'player-result.json');
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

    const playerExecutable = path.join(successRoot, 'TugberkEngine Game-Windows', 'Tugberk Player.exe');
    await runExecutable(playerExecutable, {
        cwd: path.dirname(playerExecutable),
        env: {
            ELECTRON_RUN_AS_NODE: undefined,
            TUGBERK_PLAYER_SMOKE: '1',
            TUGBERK_PLAYER_SMOKE_OUTPUT: playerOutput
        },
        timeoutMs: 60_000
    });

    assert.ok(fs.existsSync(playerOutput), 'exported Windows player did not write its runtime smoke result');
    const playerResult = JSON.parse(fs.readFileSync(playerOutput, 'utf8'));
    assert.equal(playerResult.sceneId, 'scene-vertical-slice-main');
    assert.ok(playerResult.objectCount >= 6, 'exported player did not load the authored scene');
    for (const name of [
        'renderedScene',
        'shadowPipeline',
        'authoredMaterial',
        'configuredInput',
        'configuredJump',
        'movement',
        'jump',
        'look',
        'collision',
        'trigger',
        'ui'
    ]) assert.equal(playerResult.checks?.[name], true, `exported player runtime check failed: ${name}`);

    assert.deepEqual({
        movement: playerResult.checks?.movement,
        jump: playerResult.checks?.jump,
        look: playerResult.checks?.look,
        collision: playerResult.checks?.collision
    }, {
        movement: true,
        jump: true,
        look: true,
        collision: true
    }, 'exported player must preserve the Game View-qualified input and physics slice');
});
