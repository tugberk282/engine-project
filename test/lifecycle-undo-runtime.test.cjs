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
        GroupCommand,
        DuplicateGameObjectCommand
    } = await server.ssrLoadModule('/src/editor/Command.ts');
    const {
        ReparentGameObjectCommand,
        ReorderComponentCommand,
        CreateGameObjectCommand,
        DeleteGameObjectCommand,
        AddComponentCommand,
        AddSerializedComponentCommand,
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
        GroupCommand,
        DuplicateGameObjectCommand,
        ReparentGameObjectCommand,
        ReorderComponentCommand,
        CreateGameObjectCommand,
        DeleteGameObjectCommand,
        AddComponentCommand,
        AddSerializedComponentCommand,
        RemoveComponentCommand,
        ResetComponentCommand,
        DeserializeComponentCommand,
        DirtyState
    };
});

test.after(async () => {
    await server?.close();
});

test('async commands enter global history only after commit and retain retry-safe undo/redo', async () => {
    const { CommandHistory } = modules;
    CommandHistory.clear();
    const values = [];
    let release;
    const command = {
        name: 'Async Project Asset',
        execute: async () => {
            await new Promise((resolve) => { release = resolve; });
            values.push('asset');
        },
        undo: async () => { values.pop(); }
    };

    const committing = CommandHistory.execute(command);
    assert.equal(CommandHistory.canUndo(), false);
    assert.throws(() => CommandHistory.execute({ name: 'Overlap', execute() {}, undo() {} }), /already in progress/);
    release();
    await committing;
    assert.equal(CommandHistory.canUndo(), true);
    assert.deepEqual(values, ['asset']);

    await CommandHistory.undo();
    assert.deepEqual(values, []);
    assert.equal(CommandHistory.canRedo(), true);

    // Redo uses a fresh async execution and becomes the same single history entry.
    const redoing = CommandHistory.redo();
    release();
    await redoing;
    assert.deepEqual(values, ['asset']);
    assert.equal(CommandHistory.getUndoName(), 'Async Project Asset');
});

test('failed command groups roll back completed mutations without creating undo state', () => {
    const { CommandHistory, GroupCommand } = modules;
    const model = { value: 0 };
    CommandHistory.clear();

    const group = new GroupCommand('Atomic failure', [
        {
            name: 'Increment',
            execute: () => { model.value += 1; },
            undo: () => { model.value -= 1; }
        },
        {
            name: 'Fail',
            execute: () => { throw new Error('expected failure'); },
            undo: () => { throw new Error('must not run'); }
        }
    ]);

    assert.throws(() => CommandHistory.execute(group), /expected failure/);
    assert.equal(model.value, 0);
    assert.equal(CommandHistory.canUndo(), false);
    assert.equal(CommandHistory.canRedo(), false);
});

test('failed grouped undo restores already-undone mutations and remains retryable', () => {
    const { CommandHistory, GroupCommand } = modules;
    const model = [];
    let failFirstUndo = true;
    const first = {
        name: 'First',
        execute: () => { model.push('first'); },
        undo: () => {
            if (failFirstUndo) throw new Error('expected undo failure');
            assert.equal(model.pop(), 'first');
        }
    };
    const second = {
        name: 'Second',
        execute: () => { model.push('second'); },
        undo: () => { assert.equal(model.pop(), 'second'); }
    };

    CommandHistory.clear();
    CommandHistory.execute(new GroupCommand('Atomic undo', [first, second]));
    assert.deepEqual(model, ['first', 'second']);
    assert.throws(() => CommandHistory.undo(), /expected undo failure/);
    assert.deepEqual(model, ['first', 'second']);
    assert.equal(CommandHistory.canUndo(), true);

    failFirstUndo = false;
    CommandHistory.undo();
    assert.deepEqual(model, []);
    assert.equal(CommandHistory.canUndo(), false);
    assert.equal(CommandHistory.canRedo(), true);
});

test('failed undo and redo preserve their history entry for a safe retry', () => {
    const { CommandHistory } = modules;
    const model = { value: 0 };
    let failExecute = false;
    let failUndo = false;
    const command = {
        name: 'Retryable',
        execute: () => {
            if (failExecute) throw new Error('redo failure');
            model.value += 1;
        },
        undo: () => {
            if (failUndo) throw new Error('undo failure');
            model.value -= 1;
        }
    };

    CommandHistory.clear();
    CommandHistory.execute(command);
    failUndo = true;
    assert.throws(() => CommandHistory.undo(), /undo failure/);
    assert.equal(model.value, 1);
    assert.equal(CommandHistory.canUndo(), true);
    assert.equal(CommandHistory.canRedo(), false);

    failUndo = false;
    CommandHistory.undo();
    failExecute = true;
    assert.throws(() => CommandHistory.redo(), /redo failure/);
    assert.equal(model.value, 0);
    assert.equal(CommandHistory.canUndo(), false);
    assert.equal(CommandHistory.canRedo(), true);

    failExecute = false;
    CommandHistory.redo();
    assert.equal(model.value, 1);
    assert.equal(CommandHistory.canUndo(), true);
    assert.equal(CommandHistory.canRedo(), false);
});

test('serialized component paste is one undo unit and reuses identity on redo', () => {
    const { GameObject, Component, CommandHistory, AddSerializedComponentCommand } = modules;
    class Pasted extends Component {
        static _serializableFields = ['count', 'label'];
        count = 0;
        label = '';
    }
    const go = new GameObject('Target');
    const command = new AddSerializedComponentCommand(go, Pasted, { count: 42, label: 'copied' });
    CommandHistory.clear();

    CommandHistory.execute(command);
    const pasted = go.getComponent(Pasted);
    assert.ok(pasted);
    assert.deepEqual(pasted.captureSerializableState(), { count: 42, label: 'copied' });
    assert.equal(go.getComponents(Pasted).length, 1);

    CommandHistory.undo();
    assert.equal(go.getComponent(Pasted), undefined);
    CommandHistory.redo();
    assert.equal(go.getComponent(Pasted), pasted);
    assert.equal(go.getComponents(Pasted).length, 1);
    assert.deepEqual(go.getComponent(Pasted).captureSerializableState(), { count: 42, label: 'copied' });
});

test('component lifecycle failure leaves the model and command history unchanged', () => {
    const { GameObject, Component, CommandHistory, AddComponentCommand } = modules;
    class Broken extends Component {
        awake() { throw new Error('broken awake'); }
    }
    const go = new GameObject('Target');
    CommandHistory.clear();

    assert.throws(() => CommandHistory.execute(new AddComponentCommand(go, Broken)), /broken awake/);
    assert.equal(go.getComponent(Broken), undefined);
    assert.equal(CommandHistory.canUndo(), false);
    assert.equal(CommandHistory.canRedo(), false);
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

test('canonical hierarchy mutations survive a fresh scene load with stable IDs and order', () => {
    const {
        Scene, GameObject, CommandHistory,
        DuplicateGameObjectCommand, ReparentGameObjectCommand
    } = modules;
    const scene = new Scene();
    scene.name = 'Restart Round Trip';
    const parent = new GameObject('Parent');
    const source = new GameObject('Source');
    const child = new GameObject('Child');
    scene.addGameObject(parent);
    scene.addGameObject(source);
    scene.addGameObject(child);

    CommandHistory.clear();
    const duplicateCommand = new DuplicateGameObjectCommand(scene, source);
    CommandHistory.execute(duplicateCommand);
    const duplicate = duplicateCommand.getDuplicatedGameObject();
    assert.ok(duplicate);
    CommandHistory.execute(new ReparentGameObjectCommand(child, parent.transform));

    const saved = scene.toJSON();
    const savedData = JSON.parse(saved);
    const restarted = new Scene();
    restarted.loadFromJSON(saved);
    const restartedData = JSON.parse(restarted.toJSON());

    assert.deepEqual(restartedData, savedData, 'a fresh load must preserve the canonical scene bytes');
    assert.equal(restarted.sceneId, scene.sceneId);
    assert.deepEqual(
        restartedData.gameObjects.map((entry) => [entry.id, entry.name]),
        [
            [parent.id, 'Parent'],
            [source.id, 'Source'],
            [duplicate.id, 'Source (Copy)']
        ]
    );
    assert.deepEqual(
        restartedData.gameObjects[0].children.map((entry) => [entry.id, entry.name]),
        [[child.id, 'Child']]
    );
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
