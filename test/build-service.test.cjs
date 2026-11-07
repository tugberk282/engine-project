'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { BuildService, renameWithRetry } = require('../electron/build/build-service');
const { assertBuildRequest } = require('../electron/build/build-contract');
const { runPackagedPlayer } = require('../electron/build/player-runtime');
const { spawn } = require('node:child_process');

test('build worker is explicitly launched in Node mode for Electron-hosted builds', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'build', 'build-service.js'), 'utf8');
    assert.match(source, /ELECTRON_RUN_AS_NODE: '1'/);
    const worker = fs.readFileSync(path.join(__dirname, '..', 'electron', 'build', 'build-worker.js'), 'utf8');
    assert.match(worker, /process\.noAsar = true/);
});

function revision(projectRoot) {
    return crypto.createHash('sha256').update(
        fs.readFileSync(path.join(projectRoot, 'project.json'), 'utf8')
    ).digest('hex');
}

function request(projectRoot, outputPath) {
    return Object.freeze({
        version: 1, projectRoot, projectRevision: revision(projectRoot),
        outputPath, target: 'win-x64'
    });
}

test('atomic build publication retries bounded Windows rename locks', async () => {
    const attempts = [];
    const delays = [];
    await renameWithRetry('workspace', 'published', {
        rename: async (sourcePath, targetPath) => {
            attempts.push([sourcePath, targetPath]);
            if (attempts.length < 3) throw Object.assign(new Error('temporarily locked'), { code: 'EPERM' });
        },
        wait: async (delayMs) => { delays.push(delayMs); }
    });
    assert.equal(attempts.length, 3);
    assert.deepEqual(delays, [25, 50]);
});

test('atomic build publication does not hide permanent rename failures', async () => {
    let attempts = 0;
    const failure = Object.assign(new Error('target is invalid'), { code: 'EINVAL' });
    await assert.rejects(renameWithRetry('workspace', 'published', {
        rename: async () => { attempts += 1; throw failure; },
        wait: async () => { throw new Error('non-transient failures must not wait'); }
    }), failure);
    assert.equal(attempts, 1);
});

test('canonical sample builds reproducibly and player runs deterministic frames', async (t) => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tugberk-build-test-'));
    t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
    const projectRoot = path.join(root, 'project');
    await fs.promises.cp(path.join(__dirname, '..', 'samples', 'vertical-slice'), projectRoot, { recursive: true });
    const service = new BuildService();
    t.after(() => service.shutdown());
    const stages = [];
    const first = await service.build(request(projectRoot, path.join(root, 'first')), {
        onProgress: ({ stage }) => stages.push(stage)
    });
    const second = await service.build(request(projectRoot, path.join(root, 'second')));
    assert.deepEqual(stages, ['validate', 'resolve', 'import', 'bundle', 'package']);
    assert.equal(first.manifest.manifestHash, second.manifest.manifestHash);
    assert.deepEqual(
        fs.readFileSync(path.join(root, 'first', 'manifest.json')),
        fs.readFileSync(path.join(root, 'second', 'manifest.json'))
    );
    assert.equal(fs.existsSync(path.join(root, 'first', 'resources', 'app', 'player-content.js')), true);
    const runA = await runPackagedPlayer(path.join(root, 'first'), { frames: 120 });
    const runB = await runPackagedPlayer(path.join(root, 'second'), { frames: 120 });
    assert.deepEqual(runA, runB);
    assert.equal(runA.frame, 120);
    assert.equal(runA.sceneId, 'scene-vertical-slice-main');
    if (process.platform === 'win32') {
        const smokeOutput = path.join(root, 'player-smoke.json');
        await new Promise((resolve, reject) => {
            const playerEnvironment = { ...process.env, TUGBERK_PLAYER_SMOKE: '1', TUGBERK_PLAYER_SMOKE_OUTPUT: smokeOutput };
            delete playerEnvironment.ELECTRON_RUN_AS_NODE;
            const child = spawn(path.join(root, 'first', 'Tugberk Player.exe'), [], {
                env: playerEnvironment,
                cwd: path.join(root, 'first'),
                stdio: ['ignore', 'pipe', 'pipe']
            });
            let playerOutput = '';
            child.stdout.on('data', (chunk) => { playerOutput += chunk; });
            child.stderr.on('data', (chunk) => { playerOutput += chunk; });
            const timeout = setTimeout(() => {
                child.kill();
                reject(new Error(`Standalone player smoke timed out\n${playerOutput.trim()}`));
            }, 30_000);
            child.once('error', reject);
            child.once('exit', (code) => {
                clearTimeout(timeout);
                code === 0 ? resolve() : reject(new Error(`Player exited ${code}\n${playerOutput.trim()}`));
            });
        });
        const smoke = JSON.parse(fs.readFileSync(smokeOutput, 'utf8'));
        assert.equal(smoke.ok, true);
        assert.equal(smoke.sceneId, 'scene-vertical-slice-main');
        assert.equal(smoke.objectCount, runA.objectCount);
        assert.deepEqual(smoke.checks, {
            renderedScene: true, shadowPipeline: true, authoredMaterial: true, authoredUiEvent: true, configuredInput: true, configuredJump: true, movement: true, jump: true, look: true, collision: true, trigger: true, ui: true
        });

        const switchOutput = path.join(root, 'player-scene-switch-smoke.json');
        await new Promise((resolve, reject) => {
            const playerEnvironment = {
                ...process.env,
                TUGBERK_PLAYER_SCENE_SWITCH_SMOKE: '1',
                TUGBERK_PLAYER_SMOKE_OUTPUT: switchOutput
            };
            delete playerEnvironment.ELECTRON_RUN_AS_NODE;
            const child = spawn(path.join(root, 'first', 'Tugberk Player.exe'), [], {
                env: playerEnvironment, cwd: path.join(root, 'first'), stdio: ['ignore', 'pipe', 'pipe']
            });
            let playerOutput = '';
            child.stdout.on('data', (chunk) => { playerOutput += chunk; });
            child.stderr.on('data', (chunk) => { playerOutput += chunk; });
            const timeout = setTimeout(() => {
                child.kill();
                reject(new Error(`Standalone scene switch smoke timed out\n${playerOutput.trim()}`));
            }, 30_000);
            child.once('error', reject);
            child.once('exit', (code) => {
                clearTimeout(timeout);
                code === 0 ? resolve() : reject(new Error(`Scene switch player exited ${code}\n${playerOutput.trim()}`));
            });
        });
        const sceneSwitch = JSON.parse(fs.readFileSync(switchOutput, 'utf8'));
        assert.equal(sceneSwitch.ok, true);
        assert.notEqual(sceneSwitch.scenePath, first.manifest.entryScene);
        assert.equal(sceneSwitch.sceneId, sceneSwitch.target.sceneId);
    }
});

test('selected authored scenes define packaged content and entry scene', async (t) => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tugberk-build-scenes-'));
    t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
    const projectRoot = path.join(root, 'project');
    await fs.promises.cp(path.join(__dirname, '..', 'samples', 'vertical-slice'), projectRoot, { recursive: true });
    const prefabPath = path.join(projectRoot, 'Assets', 'Prefabs', 'BuildCrate.prefab');
    await fs.promises.mkdir(path.dirname(prefabPath), { recursive: true });
    await fs.promises.writeFile(prefabPath, JSON.stringify({
        formatVersion: 1, prefabId: 'prefab-build-crate', version: '1.0', name: 'BuildCrate',
        data: { id: 'crate-root', name: 'Build Crate', tag: 'Untagged', layer: 0, enabled: true,
            transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, components: [], children: [] }
    }), 'utf8');
    const audioPath = path.join(projectRoot, 'Assets', 'Audio', 'BuildTheme.flac');
    await fs.promises.mkdir(path.dirname(audioPath), { recursive: true });
    await fs.promises.writeFile(audioPath, Buffer.from('fLaC-build-fixture'));
    const service = new BuildService();
    t.after(() => service.shutdown());
    const selected = { ...request(projectRoot, path.join(root, 'output')), scenes: ['Assets/Scenes/TopDown.scene.json'] };
    const result = await service.build(selected);
    assert.equal(result.manifest.entryScene, 'Assets/Scenes/TopDown.scene.json');
    assert.deepEqual(result.manifest.scenes, [{
        sceneId: 'scene-topdown-primitives', path: 'Assets/Scenes/TopDown.scene.json'
    }], 'manifest must list only scenes that were actually packaged');
    assert.equal(fs.existsSync(path.join(root, 'output', 'content', 'Assets', 'Scenes', 'Main.scene.json')), false,
        'unselected authored scenes are excluded from packaged content');
    const packagedPrefab = path.join(root, 'output', 'content', 'Assets', 'Prefabs', 'BuildCrate.prefab');
    assert.equal(fs.existsSync(packagedPrefab), true, 'prefab assets must be included in the player content bundle');
    assert.ok(result.manifest.files.some((file) => file.path === 'Assets/Prefabs/BuildCrate.prefab'));
    assert.ok(result.manifest.files.some((file) => file.path === 'Assets/Audio/BuildTheme.flac'));
    await assert.rejects(service.build({ ...request(projectRoot, path.join(root, 'bad')), scenes: ['Assets/Scenes/Unknown.scene.json'] }),
        { code: 'SCENE_NOT_IN_PROJECT' });
    assert.equal(fs.existsSync(path.join(root, 'bad')), false);
});

test('stale revision and malicious output fail without partial publication', async (t) => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tugberk-build-failure-'));
    t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
    const projectRoot = path.join(root, 'project');
    await fs.promises.cp(path.join(__dirname, '..', 'samples', 'vertical-slice'), projectRoot, { recursive: true });
    const service = new BuildService();
    t.after(() => service.shutdown());
    const output = path.join(root, 'output');
    const stale = request(projectRoot, output);
    await fs.promises.appendFile(path.join(projectRoot, 'project.json'), ' ');
    await assert.rejects(service.build(stale), { code: 'REVISION_STALE' });
    assert.equal(fs.existsSync(output), false);
    assert.throws(() => assertBuildRequest(request(projectRoot, path.join(projectRoot, 'Build'))),
        { code: 'INVALID_OUTPUT_PATH' });
});

test('cancelled build terminates worker and does not publish', async (t) => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tugberk-build-cancel-'));
    t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
    const projectRoot = path.join(root, 'project');
    await fs.promises.cp(path.join(__dirname, '..', 'samples', 'vertical-slice'), projectRoot, { recursive: true });
    const output = path.join(root, 'output');
    const service = new BuildService();
    t.after(() => service.shutdown());
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(service.build(request(projectRoot, output), { signal: controller.signal }),
        { code: 'BUILD_CANCELLED' });
    assert.equal(fs.existsSync(output), false);
    assert.equal(service.active.size, 0);
});

test('worker crash and hang are typed and leave no output', async (t) => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tugberk-build-worker-'));
    t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
    const projectRoot = path.join(root, 'project');
    await fs.promises.cp(path.join(__dirname, '..', 'samples', 'vertical-slice'), projectRoot, { recursive: true });
    const output = path.join(root, 'output');
    const crash = new BuildService({ workerPath: path.join(__dirname, 'fixtures', 'build-worker-crash.cjs') });
    await assert.rejects(crash.build(request(projectRoot, output)), { code: 'WORKER_CRASHED' });
    assert.equal(fs.existsSync(output), false);
    const hang = new BuildService({
        workerPath: path.join(__dirname, 'fixtures', 'build-worker-hang.cjs'),
        timeoutMs: 25
    });
    await assert.rejects(hang.build(request(projectRoot, output)), { code: 'WORKER_TIMEOUT' });
    assert.equal(fs.existsSync(output), false);
    assert.equal(crash.active.size, 0);
    assert.equal(hang.active.size, 0);
});
