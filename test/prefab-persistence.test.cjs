'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('vite');

global.window = {};

let server;
let GameObject;
let PrefabManager;
let Component;
let ScriptRegistry;

test.before(async () => {
    server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
    ({ GameObject } = await server.ssrLoadModule('/src/engine/GameObject.ts'));
    ({ PrefabManager } = await server.ssrLoadModule('/src/engine/Prefab.ts'));
    ({ Component } = await server.ssrLoadModule('/src/engine/Component.ts'));
    ({ ScriptRegistry } = await server.ssrLoadModule('/src/engine/ScriptRegistry.ts'));
});

test('prefab refresh preserves forward-compatible fields on registered components', () => {
    class AuthoredMover extends Component {
        static _serializableFields = ['speed'];
        speed = 0;
    }
    ScriptRegistry.register(AuthoredMover, 'AuthoredMover');
    const root = new GameObject('Existing');
    const componentData = {
        type: 'AuthoredMover',
        data: { speed: 12, futureTuning: { acceleration: 4 } },
        importerRevision: 8
    };

    PrefabManager.applySerializedData(root, serializedNode({ components: [componentData] }));

    const serialized = root.serialize();
    assert.equal(root.getComponent(AuthoredMover).speed, 12);
    assert.deepEqual(serialized.components, [componentData]);
});

test.after(async () => {
    await server?.close();
});

const serializedNode = (overrides = {}) => ({
    id: 'prefab-root',
    name: 'Prefab Root',
    tag: 'Untagged',
    layer: 0,
    isStatic: false,
    enabled: true,
    prefabSource: 'CustomPrefab',
    sourceAssetPath: 'Assets/CustomPrefab.prefab',
    sourceAssetGuid: 'prefab-guid',
    sourceAssetType: 'prefab',
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    components: [],
    children: [],
    ...overrides
});

test('prefab refresh preserves unavailable component payloads on roots and children', () => {
    const root = new GameObject('Existing');
    const unknownRoot = { type: 'MissingRootScript', data: { speed: 7 }, scriptGuid: 'root-script-guid' };
    const unknownChild = { type: 'MissingChildScript', data: { target: { __ref: 'prefab-root' } }, revision: 3 };
    const data = serializedNode({
        editorExtension: { folded: true },
        components: [unknownRoot],
        children: [serializedNode({
            id: 'prefab-child',
            name: 'Child',
            prefabSource: null,
            sourceAssetPath: null,
            sourceAssetGuid: null,
            sourceAssetType: null,
            components: [unknownChild]
        })]
    });

    PrefabManager.applySerializedData(root, data, { preserveSourceLink: true });

    const serialized = root.serialize();
    assert.deepEqual(serialized.components, [unknownRoot]);
    assert.deepEqual(serialized.children[0].components, [unknownChild]);
    assert.deepEqual(serialized.editorExtension, { folded: true });
});
