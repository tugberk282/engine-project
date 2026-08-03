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

test('canonical sample project resolves its scene and minimal material asset', () => {
    const project = loadJson(projectPath);
    const scene = loadJson(scenePath);
    const material = loadJson(materialPath);

    assert.equal(project.formatVersion, 1);
    assert.equal(project.scenes.length, 1);
    assert.equal(project.scenes[0].sceneId, scene.sceneId);
    assert.equal(scene.formatVersion, 1);
    assert.equal(scene.gameObjects.some((object) => object.name === 'Player'), true);
    assert.equal(scene.gameObjects.some((object) => object.components.some((component) => component.type === 'Camera')), true);
    assert.equal(material.shader, 'Standard');
});

test('the same canonical scene survives edit/save/reopen and produces a runtime frame', () => {
    const sourceScene = loadJson(scenePath);
    const editedScene = structuredClone(sourceScene);
    const player = editedScene.gameObjects.find((object) => object.id === 'object-player');
    player.name = 'Player Edited';
    player.components.find((component) => component.type === 'PlayerController').speed = 6;

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
