'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createServer } = require('vite');

global.window = {};

let server;
let modules;

test.before(async () => {
    server = await createServer({
        server: { middlewareMode: true },
        appType: 'custom',
        logLevel: 'silent'
    });
    // Keep circular GameObject/Component/Transform evaluation deterministic.
    const { Scene } = await server.ssrLoadModule('/src/engine/Scene.ts');
    const { GameObject } = await server.ssrLoadModule('/src/engine/GameObject.ts');
    const { Component } = await server.ssrLoadModule('/src/engine/Component.ts');
    const {
        CommandHistory,
        DuplicateGameObjectCommand
    } = await server.ssrLoadModule('/src/editor/Command.ts');
    const {
        ReparentGameObjectCommand,
        ReorderComponentCommand,
        CreateGameObjectCommand,
        DeleteGameObjectCommand,
        AddComponentCommand,
        RemoveComponentCommand,
        ResetComponentCommand,
        DeserializeComponentCommand
    } = await server.ssrLoadModule('/src/editor/LifecycleCommands.ts');
    const { DirtyState } = await server.ssrLoadModule('/src/editor/DirtyState.ts');
    modules = {
        Scene,
        GameObject,
        Component,
        CommandHistory,
        DuplicateGameObjectCommand,
        ReparentGameObjectCommand,
        ReorderComponentCommand,
        CreateGameObjectCommand,
        DeleteGameObjectCommand,
        AddComponentCommand,
        RemoveComponentCommand,
        ResetComponentCommand,
        DeserializeComponentCommand,
        DirtyState
    };
});

test.after(async () => {
    await server?.close();
});

test('duplicate undo/redo preserves unknown payloads, stable ordering, and dirty checkpoints', () => {
    const {
        Scene,
        GameObject,
        CommandHistory,
        DuplicateGameObjectCommand,
        DirtyState
    } = modules;
    const scene = new Scene();
    const source = new GameObject('Source');
    source.preserveSerializedData({
        ...source.serialize(),
        futureObjectField: { keep: true }
    }, [{
        type: 'FutureComponent',
        data: { nested: ['keep', 42] },
        futureMetadata: 'preserved'
    }]);
    scene.addGameObject(source);

    const dirty = new DirtyState();
    CommandHistory.clear();
    CommandHistory.addMutationListener((revision) => dirty.setCommandRevision(revision));
    dirty.markPersisted();

    const command = new DuplicateGameObjectCommand(scene, source);
    CommandHistory.execute(command);
    const duplicate = command.getDuplicatedGameObject();
    assert.ok(duplicate);
    assert.notEqual(duplicate.id, source.id);
    assert.deepEqual(
        scene.gameObjects.filter((go) => go.transform.parent === null).map((go) => go.name),
        ['Source', 'Source (Copy)']
    );
    const serialized = duplicate.serialize();
    assert.deepEqual(serialized.futureObjectField, { keep: true });
    assert.deepEqual(serialized.components.at(-1), {
        type: 'FutureComponent',
        data: { nested: ['keep', 42] },
        futureMetadata: 'preserved'
    });
    assert.equal(dirty.isDirty, true);

    CommandHistory.undo();
    assert.equal(scene.gameObjects.includes(duplicate), false);
    assert.equal(dirty.isDirty, false);

    CommandHistory.redo();
    assert.equal(scene.gameObjects.includes(duplicate), true);
    assert.deepEqual(JSON.parse(scene.toJSON()).gameObjects[1].components.at(-1), {
        data: { nested: ['keep', 42] },
        futureMetadata: 'preserved',
        type: 'FutureComponent'
    });
    assert.equal(dirty.isDirty, true);
});

test('reparent undo/redo preserves world transforms and serialized hierarchy', () => {
    const { Scene, GameObject, CommandHistory, ReparentGameObjectCommand, DirtyState } = modules;
    const scene = new Scene();
    const parent = new GameObject('Parent');
    const child = new GameObject('Child');
    parent.transform.position.set(10, -2, 3);
    parent.transform.rotation.set(0.2, 0.4, -0.1);
    parent.transform.scale.set(2, 3, 4);
    child.transform.position.set(4, 5, 6);
    scene.addGameObject(parent);
    scene.addGameObject(child);
    scene.threeScene.updateMatrixWorld(true);
    const before = child.object3D.getWorldPosition(child.transform.position.clone());

    const dirty = new DirtyState();
    CommandHistory.clear();
    CommandHistory.addMutationListener((revision) => dirty.setCommandRevision(revision));
    dirty.markPersisted();
    const command = new ReparentGameObjectCommand(child, parent.transform);
    CommandHistory.execute(command);
    scene.threeScene.updateMatrixWorld(true);
    assert.ok(child.object3D.getWorldPosition(child.transform.position.clone()).distanceTo(before) < 1e-9);
    assert.equal(JSON.parse(scene.toJSON()).gameObjects[0].children[0].name, 'Child');
    assert.equal(dirty.isDirty, true);

    CommandHistory.undo();
    scene.threeScene.updateMatrixWorld(true);
    assert.equal(child.transform.parent, null);
    assert.ok(child.object3D.getWorldPosition(child.transform.position.clone()).distanceTo(before) < 1e-9);
    assert.equal(dirty.isDirty, false);

    CommandHistory.redo();
    scene.threeScene.updateMatrixWorld(true);
    assert.ok(child.object3D.getWorldPosition(child.transform.position.clone()).distanceTo(before) < 1e-9);
    assert.equal(dirty.isDirty, true);
});

test('component reorder undo/redo preserves mandatory Transform and persistence order', () => {
    const { GameObject, Component, CommandHistory, ReorderComponentCommand, DirtyState } = modules;
    class Alpha extends Component {}
    class Beta extends Component {}
    const go = new GameObject('Ordered');
    const alpha = go.addComponent(Alpha);
    const beta = go.addComponent(Beta);
    const dirty = new DirtyState();
    CommandHistory.clear();
    CommandHistory.addMutationListener((revision) => dirty.setCommandRevision(revision));
    dirty.markPersisted();
    const command = new ReorderComponentCommand(go, 2, 1);

    CommandHistory.execute(command);
    assert.deepEqual(go.components, [go.transform, beta, alpha]);
    assert.deepEqual(go.serialize().components.map((entry) => entry.type), ['Beta', 'Alpha']);
    assert.equal(dirty.isDirty, true);

    CommandHistory.undo();
    assert.deepEqual(go.components, [go.transform, alpha, beta]);
    assert.equal(dirty.isDirty, false);

    CommandHistory.redo();
    assert.equal(go.components[0], go.transform);
    assert.deepEqual(go.serialize().components.map((entry) => entry.type), ['Beta', 'Alpha']);
    assert.equal(dirty.isDirty, true);
});

test('create and delete undo/redo preserve retained objects, persistence, and dirty checkpoints', () => {
    const {
        Scene, GameObject, Component, CommandHistory,
        CreateGameObjectCommand, DeleteGameObjectCommand, DirtyState
    } = modules;
    const lifecycle = [];
    class RetainedProbe extends Component {
        onDestroy() { lifecycle.push('destroy'); }
    }
    const scene = new Scene();
    const go = new GameObject('Retained');
    const probe = go.addComponent(RetainedProbe);
    const dirty = new DirtyState();
    CommandHistory.clear();
    CommandHistory.addMutationListener((revision) => dirty.setCommandRevision(revision));
    dirty.markPersisted();

    CommandHistory.execute(new CreateGameObjectCommand(go, scene));
    assert.equal(scene.findGameObjectByID(go.id), go);
    assert.equal(JSON.parse(scene.toJSON()).gameObjects[0].name, 'Retained');
    assert.equal(dirty.isDirty, true);
    CommandHistory.undo();
    assert.equal(scene.findGameObjectByID(go.id), undefined);
    assert.deepEqual(lifecycle, []);
    assert.equal(dirty.isDirty, false);
    CommandHistory.redo();
    assert.equal(scene.findGameObjectByID(go.id), go);
    assert.equal(go.getComponent(RetainedProbe), probe);
    dirty.markPersisted();

    CommandHistory.execute(new DeleteGameObjectCommand(go, scene));
    assert.equal(scene.findGameObjectByID(go.id), undefined);
    assert.deepEqual(lifecycle, []);
    assert.equal(dirty.isDirty, true);
    CommandHistory.undo();
    assert.equal(scene.findGameObjectByID(go.id), go);
    assert.equal(go.getComponent(RetainedProbe), probe);
    assert.equal(JSON.parse(scene.toJSON()).gameObjects[0].components[0].type, 'RetainedProbe');
    assert.equal(dirty.isDirty, false);
    CommandHistory.redo();
    assert.equal(scene.findGameObjectByID(go.id), undefined);
    assert.deepEqual(lifecycle, []);
    assert.equal(dirty.isDirty, true);
});

test('add and remove component undo/redo preserve identity, order, persistence, and dirty checkpoints', () => {
    const {
        Scene, GameObject, Component, CommandHistory,
        AddComponentCommand, RemoveComponentCommand, DirtyState
    } = modules;
    class Alpha extends Component {}
    class Beta extends Component {}
    const scene = new Scene();
    const go = new GameObject('Components');
    const alpha = go.addComponent(Alpha);
    scene.addGameObject(go);
    const dirty = new DirtyState();
    CommandHistory.clear();
    CommandHistory.addMutationListener((revision) => dirty.setCommandRevision(revision));
    dirty.markPersisted();

    CommandHistory.execute(new AddComponentCommand(go, Beta));
    const beta = go.getComponent(Beta);
    assert.ok(beta);
    assert.deepEqual(go.serialize().components.map((entry) => entry.type), ['Alpha', 'Beta']);
    assert.equal(dirty.isDirty, true);
    CommandHistory.undo();
    assert.equal(go.getComponent(Beta), undefined);
    assert.equal(dirty.isDirty, false);
    CommandHistory.redo();
    assert.equal(go.getComponent(Beta), beta);
    assert.deepEqual(JSON.parse(scene.toJSON()).gameObjects[0].components.map((entry) => entry.type), ['Alpha', 'Beta']);
    dirty.markPersisted();

    CommandHistory.execute(new RemoveComponentCommand(go, alpha));
    assert.equal(go.getComponent(Alpha), undefined);
    assert.equal(dirty.isDirty, true);
    CommandHistory.undo();
    assert.equal(go.getComponent(Alpha), alpha);
    assert.deepEqual(go.components, [go.transform, alpha, beta]);
    assert.equal(dirty.isDirty, false);
    CommandHistory.redo();
    assert.equal(go.getComponent(Alpha), undefined);
    assert.deepEqual(JSON.parse(scene.toJSON()).gameObjects[0].components.map((entry) => entry.type), ['Beta']);
    assert.equal(dirty.isDirty, true);
});

test('reset and serialized field edits round-trip through undo/redo and scene persistence', () => {
    const {
        Scene, GameObject, Component, CommandHistory,
        ResetComponentCommand, DeserializeComponentCommand, DirtyState
    } = modules;
    class Stateful extends Component {
        static _serializableFields = ['count', 'nested'];
        count = 7;
        nested = { label: 'before', values: [1, 2] };
        reset() {
            this.count = 0;
            this.nested = { label: 'reset', values: [] };
        }
    }
    const scene = new Scene();
    const go = new GameObject('Stateful');
    const stateful = go.addComponent(Stateful);
    scene.addGameObject(go);
    const dirty = new DirtyState();
    CommandHistory.clear();
    CommandHistory.addMutationListener((revision) => dirty.setCommandRevision(revision));
    dirty.markPersisted();

    CommandHistory.execute(new ResetComponentCommand(stateful));
    assert.deepEqual(stateful.serialize().data, { count: 0, nested: { label: 'reset', values: [] } });
    assert.equal(dirty.isDirty, true);
    CommandHistory.undo();
    assert.deepEqual(stateful.serialize().data, { count: 7, nested: { label: 'before', values: [1, 2] } });
    assert.equal(dirty.isDirty, false);
    CommandHistory.redo();
    assert.deepEqual(stateful.serialize().data, { count: 0, nested: { label: 'reset', values: [] } });

    dirty.markPersisted();
    CommandHistory.execute(new DeserializeComponentCommand(stateful, {
        count: 42,
        nested: { label: 'pasted', values: [3, 4] }
    }));
    assert.deepEqual(
        JSON.parse(scene.toJSON()).gameObjects[0].components[0].data,
        { count: 42, nested: { label: 'pasted', values: [3, 4] } }
    );
    assert.equal(dirty.isDirty, true);
    CommandHistory.undo();
    assert.deepEqual(stateful.serialize().data, { count: 0, nested: { label: 'reset', values: [] } });
    assert.equal(dirty.isDirty, false);
    CommandHistory.redo();
    assert.deepEqual(stateful.serialize().data, { count: 42, nested: { label: 'pasted', values: [3, 4] } });
    assert.equal(dirty.isDirty, true);
});

test('destructive removal invokes component destruction once in execution order', () => {
    const { Scene, GameObject, Component } = modules;
    const lifecycle = [];
    class First extends Component {
        onDestroy() { lifecycle.push('first'); }
    }
    class Second extends Component {
        onDestroy() { lifecycle.push('second'); }
    }
    const scene = new Scene();
    const go = new GameObject('Destroyed');
    go.addComponent(First);
    go.addComponent(Second);
    scene.addGameObject(go);

    scene.removeGameObject(go);

    assert.deepEqual(lifecycle, ['first', 'second']);
    assert.equal(go.scene, null);
    assert.equal(go.object3D.parent, null);
});
