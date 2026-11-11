'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('vite');

global.window = {};

let server;
let AssetImporter;
let GameObject;
let MeshRenderer;

test.before(async () => {
    server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
    ({ AssetImporter } = await server.ssrLoadModule('/src/engine/AssetImporter.ts'));
    ({ GameObject } = await server.ssrLoadModule('/src/engine/GameObject.ts'));
    ({ MeshRenderer } = await server.ssrLoadModule('/src/engine/components/MeshRenderer.ts'));
});

test.after(async () => {
    await server?.close();
});

test('model rehydration restores runtime mesh data without replacing authored hierarchy state', () => {
    const importedRoot = new GameObject('Model');
    const importedBody = new GameObject('Body');
    importedBody.transform.setParent(importedRoot.transform, false);
    const importedRenderer = importedBody.addComponent(MeshRenderer, { invokeLifecycle: false });
    importedRenderer.color = '#00ff00';
    const importedGeometry = importedRenderer.mesh.geometry;

    const targetRoot = new GameObject('Model Instance');
    targetRoot.id = 'stable-root';
    targetRoot.sourceAssetType = 'model';
    targetRoot.sourceAssetPath = 'Assets/Models/Model.glb';
    const targetBody = new GameObject('Body');
    targetBody.id = 'stable-body';
    targetBody.transform.position.set(3, 4, 5);
    targetBody.transform.setParent(targetRoot.transform, false);
    const targetRenderer = targetBody.addComponent(MeshRenderer, { invokeLifecycle: false });
    targetRenderer.color = '#ff0000';
    const originalComponent = targetRenderer;

    const hydrated = AssetImporter.rehydrateModelInstance(targetRoot, importedRoot);

    assert.equal(hydrated, 1);
    assert.equal(targetRoot.id, 'stable-root');
    assert.equal(targetBody.id, 'stable-body');
    assert.deepEqual(targetBody.transform.position.toArray(), [3, 4, 5]);
    assert.equal(targetBody.getComponent(MeshRenderer), originalComponent);
    assert.notEqual(targetRenderer.mesh.geometry, importedGeometry);
    assert.equal(targetRenderer.mesh.geometry.isBufferGeometry, true);
    assert.equal(targetRenderer.color, '#ff0000');

    importedRoot.onDestroy();
    targetRoot.onDestroy();
});
