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

function createAnimatedTriangleGlb() {
    const positions = Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
    const indices = Buffer.from(new Uint16Array([0, 1, 2]).buffer);
    const times = Buffer.from(new Float32Array([0, 1]).buffer);
    const translations = Buffer.from(new Float32Array([0, 0, 0, 0, 0.5, 0]).buffer);
    const binary = Buffer.concat([positions, indices, Buffer.alloc(2), times, translations]);
    const document = {
        asset: { version: '2.0', generator: 'Tugberk Engine test' }, scene: 0,
        scenes: [{ nodes: [0] }], nodes: [{ name: 'AnimatedTriangle', mesh: 0 }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
        animations: [{ name: 'Bounce', samplers: [{ input: 2, output: 3, interpolation: 'LINEAR' }], channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }] }],
        buffers: [{ byteLength: binary.length }],
        bufferViews: [
            { buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 },
            { buffer: 0, byteOffset: 36, byteLength: 6, target: 34963 },
            { buffer: 0, byteOffset: 44, byteLength: 8 },
            { buffer: 0, byteOffset: 52, byteLength: 24 }
        ],
        accessors: [
            { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
            { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR', min: [0], max: [2] },
            { bufferView: 2, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] },
            { bufferView: 3, componentType: 5126, count: 2, type: 'VEC3', min: [0, 0, 0], max: [0, 0.5, 0] }
        ]
    };
    let json = Buffer.from(JSON.stringify(document), 'utf8');
    json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
    const totalLength = 12 + 8 + json.length + 8 + binary.length;
    const header = Buffer.alloc(12);
    header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(totalLength, 8);
    const jsonHeader = Buffer.alloc(8);
    jsonHeader.writeUInt32LE(json.length, 0); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
    const binaryHeader = Buffer.alloc(8);
    binaryHeader.writeUInt32LE(binary.length, 0); binaryHeader.writeUInt32LE(0x004e4942, 4);
    return Buffer.concat([header, jsonHeader, json, binaryHeader, binary]);
}

async function addAnimatedModelFixture(projectRoot) {
    const modelPath = path.join(projectRoot, 'Assets', 'Models', 'AnimatedTriangle.glb');
    await fs.promises.mkdir(path.dirname(modelPath), { recursive: true });
    await fs.promises.writeFile(modelPath, createAnimatedTriangleGlb());
    const externalModelPath = path.join(projectRoot, 'Assets', 'Models', 'ExternalTriangle.gltf');
    const externalBufferPath = path.join(projectRoot, 'Assets', 'Models', 'ExternalTriangle.bin');
    const externalBinary = Buffer.concat([
        Buffer.from(new Float32Array([0, 0, 0, -1, 0, 0, 0, 1, 0]).buffer),
        Buffer.from(new Uint16Array([0, 1, 2]).buffer)
    ]);
    await fs.promises.writeFile(externalBufferPath, externalBinary);
    await fs.promises.writeFile(externalModelPath, `${JSON.stringify({
        asset: { version: '2.0', generator: 'Tugberk Engine external GLTF test' },
        scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: 'ExternalTriangle', mesh: 0 }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
        buffers: [{ uri: 'ExternalTriangle.bin', byteLength: externalBinary.length }],
        bufferViews: [
            { buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 },
            { buffer: 0, byteOffset: 36, byteLength: 6, target: 34963 }
        ],
        accessors: [
            { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-1, 0, 0], max: [0, 1, 0] },
            { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR', min: [0], max: [2] }
        ]
    })}\n`, 'utf8');
    const scenePath = path.join(projectRoot, 'Assets', 'Scenes', 'Main.scene.json');
    const scene = JSON.parse(await fs.promises.readFile(scenePath, 'utf8'));
    scene.gameObjects.push({
        id: 'object-animated-model', name: 'Animated Model', enabled: true,
        sourceAssetType: 'model', sourceAssetPath: 'Assets/Models/AnimatedTriangle.glb', sourceAssetGuid: null,
        transform: { position: [0, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        children: [{
            id: 'object-animated-model-node', name: 'AnimatedTriangle', enabled: true,
            transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1.5, 1.5, 1.5] },
            components: [], children: []
        }],
        components: [{ type: 'Animator', data: { currentAnimation: 'Bounce', speed: 1, loop: true, playOnAwake: true } }]
    });
    scene.gameObjects.push({
        id: 'object-external-model', name: 'External Model', enabled: true,
        sourceAssetType: 'model', sourceAssetPath: 'Assets/Models/ExternalTriangle.gltf', sourceAssetGuid: null,
        transform: { position: [2, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        children: [{
            id: 'object-external-model-node', name: 'ExternalTriangle', enabled: true,
            transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
            components: [], children: []
        }],
        components: []
    });
    scene.gameObjects.push({
        id: 'object-particle-fixture', name: 'Particle Fixture', enabled: true,
        transform: { position: [0, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, children: [],
        components: [{ type: 'ParticleSystem', data: {
            emissionRate: 20, duration: 1, startLifetime: 2, startSize: 0.15, startSpeed: 1,
            gravity: [0, -0.5, 0], startColor: [1, 0.5, 0], endColor: [1, 0, 0],
            maxParticles: 30, loop: true, playOnAwake: true
        } }]
    });
    scene.gameObjects.push({
        id: 'object-layout-canvas', name: 'Layout Canvas', enabled: true,
        components: [{ type: 'Canvas', data: {} }],
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        children: [{
            id: 'object-layout-panel', name: 'Layout Panel', enabled: true,
            components: [
                { type: 'RectTransform', data: { sizeDelta: [300, 100], anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0.5, 0.5] } },
                { type: 'VerticalLayoutGroup', data: { paddingLeft: 10, paddingRight: 10, paddingTop: 10, paddingBottom: 10, spacing: 5, childAlignment: 'UpperCenter', childControlWidth: true, childForceExpandWidth: true, childForceExpandHeight: false } }
            ],
            transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
            children: [
                { id: 'object-layout-restart', name: 'Layout Restart', enabled: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, children: [], components: [{ type: 'RectTransform', data: { sizeDelta: [120, 30] } }, { type: 'UIButton', data: { label: 'Layout Restart', eventName: 'Restart' } }] },
                { id: 'object-layout-secondary', name: 'Layout Secondary', enabled: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, children: [], components: [{ type: 'RectTransform', data: { sizeDelta: [120, 30] } }, { type: 'UIButton', data: { label: 'Secondary', eventName: '' } }] }
            ]
        }, {
            id: 'object-scroll-viewport', name: 'Scroll Viewport', enabled: true,
            transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
            components: [
                { type: 'RectTransform', data: { sizeDelta: [200, 100], anchorMin: [0.8, 0.5], anchorMax: [0.8, 0.5], pivot: [0.5, 0.5] } },
                { type: 'UIScrollRect', data: { content: { __ref: 'object-scroll-content' }, viewport: { __ref: 'object-scroll-viewport' }, horizontal: false, vertical: true, movementType: 'Clamped', inertia: false, scrollSensitivity: 20, verticalNormalizedPosition: 1, verticalScrollbar: { __ref: 'object-scrollbar' } } }
            ],
            children: [{
                id: 'object-scroll-content', name: 'Scroll Content', enabled: true,
                transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
                components: [{ type: 'RectTransform', data: { sizeDelta: [200, 300] } }],
                children: [{
                    id: 'object-scroll-item', name: 'Scroll Item', enabled: true,
                    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, children: [],
                    components: [{ type: 'RectTransform', data: { sizeDelta: [180, 30] } }, { type: 'UIText', data: { text: 'Scrollable Item', fontSize: 18 } }]
                }]
            }]
        }, {
            id: 'object-scrollbar', name: 'Vertical Scrollbar', enabled: true,
            transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, children: [],
            components: [
                { type: 'RectTransform', data: { sizeDelta: [20, 100], anchorMin: [0.95, 0.5], anchorMax: [0.95, 0.5], pivot: [0.5, 0.5] } },
                { type: 'UIScrollbar', data: { value: 1, size: 0.333333, direction: 'BottomToTop' } }
            ]
        }, {
            id: 'object-filled-image', name: 'Filled Image', enabled: true,
            transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, children: [],
            components: [
                { type: 'RectTransform', data: { sizeDelta: [160, 40], anchorMin: [0.2, 0.8], anchorMax: [0.2, 0.8], pivot: [0.5, 0.5] } },
                { type: 'UIImage', data: { color: '#22cc88', raycastTarget: false, imageType: 'Filled', preserveAspect: true, fillMethod: 'Horizontal', fillOrigin: 0, fillAmount: 0.4 } }
            ]
        }]
    });
    await fs.promises.writeFile(scenePath, `${JSON.stringify(scene, null, 2)}\n`, 'utf8');
    const projectPath = path.join(projectRoot, 'project.json');
    const project = JSON.parse(await fs.promises.readFile(projectPath, 'utf8'));
    const main = project.scenes.find((entry) => entry.path.replaceAll('\\', '/') === 'Assets/Scenes/Main.scene.json');
    if (main) main.revision = crypto.createHash('sha256').update(await fs.promises.readFile(scenePath)).digest('hex');
    await fs.promises.writeFile(projectPath, `${JSON.stringify(project, null, 2)}\n`, 'utf8');
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
    await addAnimatedModelFixture(projectRoot);
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
    assert.equal(fs.existsSync(path.join(root, 'first', 'resources', 'app', 'player-model.mjs')), true);
    assert.equal(fs.existsSync(path.join(root, 'first', 'resources', 'app', 'gltf-loader.js')), true);
    assert.equal(fs.existsSync(path.join(root, 'first', 'resources', 'app', 'buffer-geometry-utils.js')), true);
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
        assert.equal(smoke.ok, true, JSON.stringify(smoke, null, 2));
        assert.equal(smoke.sceneId, 'scene-vertical-slice-main');
        assert.equal(smoke.objectCount, runA.objectCount);
        assert.equal(smoke.modelCount, 2);
        assert.equal(smoke.modelMeshCount, 2);
        assert.equal(smoke.animatedModelCount, 1);
        assert.equal(smoke.modelBindingCount, 2);
        assert.equal(smoke.particleSystemCount, 1);
        assert.ok(smoke.liveParticleCount > 0);
        assert.deepEqual(smoke.checks, {
            renderedScene: true, shadowPipeline: true, authoredMaterial: true, authoredUiEvent: true, authoredLayout: true, authoredScrollRect: true, authoredFilledImage: true, authoredModel: true, authoredModelHierarchy: true, authoredParticleSystem: true, configuredInput: true, configuredJump: true, movement: true, jump: true, look: true, collision: true, trigger: true, ui: true
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
    const behaviourPath = path.join(projectRoot, 'Assets', 'Scripts', 'BuildMove.behaviour.json');
    const behaviourSource = JSON.stringify({ version: 1, update: [{ op: 'translate', value: [1, 0, 0] }] });
    await fs.promises.mkdir(path.dirname(behaviourPath), { recursive: true });
    await fs.promises.writeFile(behaviourPath, behaviourSource, 'utf8');
    const topDownPath = path.join(projectRoot, 'Assets', 'Scenes', 'TopDown.scene.json');
    const topDownScene = JSON.parse(await fs.promises.readFile(topDownPath, 'utf8'));
    topDownScene.gameObjects[0].components.push({
        type: 'BehaviourScript', data: {
            assetPath: 'Assets/Scripts/BuildMove.behaviour.json',
            program: '{"version":1,"update":[]}'
        }
    });
    await fs.promises.writeFile(topDownPath, JSON.stringify(topDownScene), 'utf8');
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
    assert.ok(result.manifest.files.some((file) => file.path === 'Assets/Scripts/BuildMove.behaviour.json'));
    const packagedScene = JSON.parse(await fs.promises.readFile(path.join(
        root, 'output', 'content', 'Assets', 'Scenes', 'TopDown.scene.json'
    ), 'utf8'));
    const packagedBehaviour = packagedScene.gameObjects[0].components.find((component) => component.type === 'BehaviourScript');
    assert.equal(packagedBehaviour.data.program, behaviourSource, 'build must inline current reusable script bytes instead of stale scene cache');
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
