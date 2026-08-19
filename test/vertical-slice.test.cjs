const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const { atomicWriteJson } = require('../electron/architecture/persistence');

const sampleRoot = path.join(__dirname, '..', 'samples', 'vertical-slice');
const projectPath = path.join(sampleRoot, 'project.json');
const scenePath = path.join(sampleRoot, 'Assets', 'Scenes', 'Main.scene.json');
const jumpScenePath = path.join(sampleRoot, 'Assets', 'Scenes', 'JumpPractice.scene.json');
const physicsScenePath = path.join(sampleRoot, 'Assets', 'Scenes', 'PhysicsMotion.scene.json');
const topDownScenePath = path.join(sampleRoot, 'Assets', 'Scenes', 'TopDown.scene.json');
const materialPath = path.join(sampleRoot, 'Assets', 'Materials', 'Player.material.json');

function loadJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function createRuntime() {
    const events = [];
    const self = { postMessage: (event) => events.push(event), onmessage: null };
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'engine', 'runtime.worker.js'), 'utf8');
    vm.runInNewContext(source, { self, JSON, Number });
    return {
        send(command, payload = {}) {
            self.onmessage({
                data: {
                    protocolVersion: 1,
                    sessionId: 'vertical-slice',
                    command,
                    payload
                }
            });
            return events.at(-1);
        }
    };
}

test('canonical sample gallery resolves its genre-neutral scenes and shared material', () => {
    const project = loadJson(projectPath);
    const scene = loadJson(scenePath);
    const jumpScene = loadJson(jumpScenePath);
    const physicsScene = loadJson(physicsScenePath);
    const topDownScene = loadJson(topDownScenePath);
    const material = loadJson(materialPath);

    assert.equal(project.formatVersion, 1);
    assert.equal(project.name, 'Simple Game Samples');
    assert.equal(project.scenes.length, 4);
    assert.equal(project.scenes[0].sceneId, scene.sceneId);
    assert.deepEqual(project.scenes.slice(1).map(({ sceneId }) => sceneId), [
        jumpScene.sceneId,
        physicsScene.sceneId,
        topDownScene.sceneId
    ]);
    assert.equal(scene.formatVersion, 1);
    assert.equal(scene.name, 'Movement Goal');
    assert.equal(scene.gameObjects.some((object) => object.name === 'Player'), true);
    assert.equal(scene.gameObjects.some((object) => object.components.some((component) => component.type === 'Camera')), true);
    assert.equal(jumpScene.gameObjects.some((object) => object.name === 'Jump Barrier'), true);
    assert.equal(physicsScene.gameObjects.filter((object) => object.components.some((component) => component.type === 'AutoRotate')).length, 2);
    assert.equal(material.shader, 'Standard');
});

test('the same canonical scene survives edit/save/reopen and produces a runtime frame', () => {
    const sourceScene = loadJson(scenePath);
    const editedScene = structuredClone(sourceScene);
    const player = editedScene.gameObjects.find((object) => object.id === 'object-player');
    player.name = 'Player Edited';
    player.components.find((component) => component.type === 'PlayerController').data.moveSpeed = 6;

    const scratchBase = process.env.PAPERCLIP_RUN_SCRATCH_DIR
        || process.env.PAPERCLIP_SCRATCH_DIR
        || os.tmpdir();
    fs.mkdirSync(scratchBase, { recursive: true });
    const scratchRoot = fs.mkdtempSync(path.join(scratchBase, 'engine-vertical-slice-'));
    const savedPath = path.join(scratchRoot, 'Main.scene.json');
    try {
        atomicWriteJson(savedPath, editedScene);
        const reopened = loadJson(savedPath);
        assert.deepEqual(reopened, editedScene);
        assert.equal(reopened.sceneId, sourceScene.sceneId);
        assert.equal(reopened.gameObjects.find((object) => object.id === 'object-player').id, 'object-player');

        const runtime = createRuntime();
        const started = runtime.send('start', { snapshot: JSON.stringify(reopened) });
        assert.equal(started.state, 'running');

        const inputFrame = runtime.send('tick', {
            deltaTime: 1 / 60,
            input: { Horizontal: 1 }
        });
        assert.equal(inputFrame.state, 'running');
        assert.equal(inputFrame.frame, 1);

        const stopped = runtime.send('stop');
        assert.equal(stopped.state, 'idle');
        assert.deepEqual(reopened, editedScene, 'runtime must not mutate the persisted editor snapshot');
    } finally {
        fs.rmSync(scratchRoot, { recursive: true, force: true });
    }
});

test('playable slice deterministically grounds, jumps once, finishes, and respawns', () => {
    const scene = loadJson(scenePath);
    const runtime = createRuntime();
    runtime.send('start', { snapshot: JSON.stringify(scene) });

    const tick = (input = {}) => runtime.send('tick', { deltaTime: 0.02, input });
    let state;
    for (let index = 0; index < 60; index += 1) state = tick();
    assert.equal(state.gameplay.player.grounded, true);
    assert.equal(state.gameplay.player.position[1], 0.9, 'capsule must not tunnel through the platform');

    let maximumJumpY = state.gameplay.player.position[1];
    for (let index = 0; index < 100; index += 1) {
        state = tick({ Jump: true });
        maximumJumpY = Math.max(maximumJumpY, state.gameplay.player.position[1]);
    }
    assert.ok(maximumJumpY > 2, 'grounded jump should leave the platform');
    assert.equal(state.gameplay.player.grounded, true, 'holding jump must not create unlimited jumps');
    assert.equal(state.gameplay.player.position[1], 0.9);

    tick({ Jump: false });
    let reachedFinish = false;
    for (let index = 0; index < 100; index += 1) {
        state = tick({ Horizontal: 1 });
        reachedFinish ||= state.gameplay.status === 'finished';
    }
    assert.equal(reachedFinish, true);

    for (let index = 0; index < 140 && state.gameplay.respawnCount === 0; index += 1) {
        state = tick({ Horizontal: 1 });
    }
    assert.ok(state.gameplay.respawnCount >= 1, 'falling into the void must respawn the player');
    assert.deepEqual(Array.from(state.gameplay.player.position), [-2, 2, 0]);
});

test('jump-practice sample uses the same mapped controls with distinct tuning and reaches its goal', () => {
    const scene = loadJson(jumpScenePath);
    const runtime = createRuntime();
    runtime.send('start', { snapshot: JSON.stringify(scene) });

    const tick = (input = {}) => runtime.send('tick', { deltaTime: 0.02, input });
    let state;
    for (let index = 0; index < 60; index += 1) state = tick();
    assert.equal(state.gameplay.player.grounded, true);

    let clearedBarrier = false;
    for (let index = 0; index < 180; index += 1) {
        state = tick({ Horizontal: 1, Jump: index < 10 });
        clearedBarrier ||= state.gameplay.player.position[0] > 1;
    }
    assert.equal(clearedBarrier, true);
    assert.equal(state.gameplay.status, 'finished');
});

test('the same primitives support a gravity-free top-down collect and goal scenario', () => {
    const scene = loadJson(topDownScenePath);
    const runtime = createRuntime();
    runtime.send('start', { snapshot: JSON.stringify(scene) });
    const tick = (input = {}) => runtime.send('tick', { deltaTime: 0.02, input });

    let state;
    for (let index = 0; index < 30; index += 1) state = tick({ Vertical: 1 });
    assert.equal(state.gameplay.player.position[2], -0.75, 'static collision must block the top-down player');
    assert.equal(state.gameplay.player.position[1], 0.5, 'gravity is optional and disabled by configuration');

    for (let index = 0; index < 10; index += 1) state = tick({ Vertical: -1 });
    for (let index = 0; index < 60; index += 1) state = tick({ Horizontal: 1 });
    assert.equal(state.gameplay.collectedCount, 1, 'a collect trigger fires once');
    assert.equal(state.gameplay.status, 'finished', 'the goal emits the configured win state after collection');

    runtime.send('start', { snapshot: JSON.stringify(scene) });
    for (let index = 0; index < 30; index += 1) state = tick({ Vertical: -1 });
    assert.equal(state.gameplay.status, 'lost', 'a generic lose trigger works without platformer behavior');
});
