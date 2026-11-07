'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('scene save and reopen use the canonical versioned persistence shape', () => {
    const scene = source('src/engine/Scene.ts');
    const serialization = source('src/engine/Serialization.ts');

    assert.match(scene, /formatVersion:\s*SCENE_FORMAT_VERSION/);
    assert.match(scene, /sceneId:\s*this\.sceneId/);
    assert.match(scene, /normalizeSceneData\(parsed\)/);
    assert.match(scene, /resolveSerializedReferences/);
    assert.match(serialization, /export const SCENE_FORMAT_VERSION/);
    assert.match(serialization, /stableStringify/);
});

test('unknown serialized fields and unregistered components have explicit passthrough storage', () => {
    const component = source('src/engine/Component.ts');
    const scene = source('src/engine/Scene.ts');
    const gameObject = source('src/engine/GameObject.ts');
    const serialization = source('src/engine/Serialization.ts');

    assert.match(serialization, /mergePreservingUnknown/);
    assert.match(serialization, /const preserved = asObject\(normalizeArbitraryData/);
    assert.match(component, /private serializedTemplate:\s*SerializedComponentData \| null/);
    assert.match(component, /mergePreservingUnknown\(this\.serializedTemplate,\s*data\)/);
    assert.match(scene, /entry\.component\.preserveSerializedData\?\.\(entry\.template\)/);
    assert.match(scene, /unknownComponents\.push\(compData\)/);
    assert.match(scene, /go\.preserveSerializedData\(goData, unknownComponents\)/);
    assert.match(gameObject, /\.concat\(this\.unknownSerializedComponents\)/);
});

test('lifecycle undo commands detach without destruction and restore retained instances', () => {
    const commands = source('src/editor/LifecycleCommands.ts');

    assert.match(commands, /removeGameObject\(this\.go,\s*\{\s*destroy:\s*false\s*\}\)/);
    assert.match(commands, /this\.scene\.addGameObject\(this\.go,\s*\{\s*start:\s*false\s*\}\)/);
    assert.match(commands, /removeComponent\(this\.component,\s*\{\s*destroy:\s*false\s*\}\)/);
    assert.match(commands, /this\.go\.addComponent\(this\.component,\s*\{\s*index:\s*this\.index,\s*invokeLifecycle:\s*false\s*\}\)/);
});

test('undo and redo dirty state follows branch-safe command checkpoints', () => {
    const commands = source('src/editor/Command.ts');
    const dirtyState = source('src/editor/DirtyState.ts');
    const editor = source('src/editor/Editor.ts');

    assert.match(commands, /beforeState:\s*number;\s*afterState:\s*number/);
    assert.match(commands, /this\.currentState = entry\.beforeState/);
    assert.match(commands, /this\.currentState = entry\.afterState/);
    assert.match(commands, /const afterState = this\.nextState\+\+/);
    assert.match(dirtyState, /commandRevision !== this\.persistedCommandRevision/);
    assert.match(dirtyState, /this\.persistedCommandRevision = this\.commandRevision/);
    assert.match(editor, /setCommandRevision\(state\)/);
});

test('component reset and pasted serialized fields participate in undo and dirty checkpoints', () => {
    const commands = source('src/editor/LifecycleCommands.ts');
    const inspector = source('src/editor/InspectorWindow.ts');

    assert.match(commands, /class ResetComponentCommand implements Command/);
    assert.match(commands, /this\.beforeData = component\.captureSerializableState\(\)/);
    assert.match(commands, /this\.component\.reset\(\)/);
    assert.match(commands, /this\.component\.restoreSerializableState\(this\.beforeData\)/);
    assert.match(commands, /class DeserializeComponentCommand implements Command/);
    assert.match(commands, /this\.afterData = structuredClone\(data\)/);
    assert.match(commands, /this\.appliedData = this\.component\.captureSerializableState\(\)/);
    assert.match(inspector, /CommandHistory\.execute\(new ResetComponentCommand/);
    assert.match(inspector, /CommandHistory\.execute\(new DeserializeComponentCommand/);
});

test('component command snapshots preserve live references and clone mutable field containers', () => {
    const component = source('src/engine/Component.ts');

    assert.match(component, /captureSerializableState\(\)/);
    assert.match(component, /restoreSerializableState\(state:/);
    assert.match(component, /value instanceof GameObject \|\| value instanceof Component/);
    assert.match(component, /seen\.has\(value\)/);
    assert.match(component, /value instanceof Map/);
    assert.match(component, /value instanceof Set/);
});

test('missing serialized components are recoverable and surfaced in the inspector', () => {
    const gameObject = source('src/engine/GameObject.ts');
    const inspector = source('src/editor/InspectorWindow.ts');

    assert.match(gameObject, /getUnknownSerializedComponents\(\)/);
    assert.match(inspector, /Missing Component:/);
    assert.match(inspector, /serialized data is preserved/);
    assert.match(inspector, /JSON\.stringify\(serializedComponent,\s*null,\s*2\)/);
});

test('transform parenting rejects self and descendant cycles before mutating hierarchy', () => {
    const transform = source('src/engine/components/Transform.ts');
    const guard = transform.indexOf("throw new Error('TRANSFORM_PARENT_CYCLE");
    const mutation = transform.indexOf('// Remove from old parent');

    assert.ok(guard >= 0, 'cycle rejection must be explicit');
    assert.ok(guard < mutation, 'cycle rejection must happen before hierarchy mutation');
    assert.match(transform, /parent === this \|\| \(parent && parent\.isChildOf\(this\)\)/);
});

test('renderer normalization enforces deterministic cycles, unique IDs, and one mandatory Transform', () => {
    const serialization = source('src/engine/Serialization.ts');
    const gameObject = source('src/engine/GameObject.ts');

    assert.match(serialization, /if \(seen\.has\(value\)\) return null/);
    assert.match(serialization, /SCENE_DUPLICATE_GAMEOBJECT_ID/);
    assert.match(serialization, /entry\.type !== 'Transform'/);
    assert.match(gameObject, /this\.transform = this\.addComponent\(Transform\)/);
});

test('activation changes propagate lifecycle state through enabled descendants', () => {
    const gameObject = source('src/engine/GameObject.ts');

    assert.match(gameObject, /const hierarchy = this\.collectSelfAndDescendants\(\)/);
    assert.match(gameObject, /previousStates = new Map/);
    assert.match(gameObject, /if \(wasActive === isActive\) continue/);
    assert.match(gameObject, /if \(!component\.enabled\) continue/);
    assert.match(gameObject, /public isActiveInHierarchy\(\): boolean/);
    assert.match(gameObject, /this\.transform\?\.parent \?\? null/);
});

test('Game View camera discovery traverses active child hierarchies deterministically', () => {
    const editor = source('src/editor/Editor.ts');
    assert.match(editor, /private getRuntimeCameraEntries\(\)/,
        'camera entry collector must remain a dedicated bounded method');
    assert.match(editor, /let hierarchyIndex = 0/);
    assert.match(editor, /go\.isActiveInHierarchy\(\)/);
    assert.match(editor, /go\.transform\.children\.forEach\(\(child\) => visit\(child\.gameObject\)\)/);
    assert.match(editor, /depthDelta/);
    assert.match(editor, /left\.index - right\.index/);
});

test('CapsuleCollider Inspector authors bounded radius and height through undoable setters', () => {
    const inspectors = source('src/editor/EditorInspectors.ts');
    const inspectorWindow = source('src/editor/InspectorWindow.ts');
    const capsule = source('src/engine/components/CapsuleCollider.ts');
    assert.match(inspectorWindow, /compName === 'BoxCollider' \|\| compName === 'SphereCollider' \|\| compName === 'CapsuleCollider'/);
    assert.match(inspectors, /const isCapsule = colliderType === 'CapsuleCollider'/);
    assert.match(inspectors, /Change Capsule Collider Radius/);
    assert.match(inspectors, /collider\.setRadius\(newVal\)/);
    assert.match(inspectors, /recordOverride\(collider, 'radius'\)/);
    assert.match(inspectors, /Change Capsule Collider Height/);
    assert.match(inspectors, /collider\.setHeight\(newVal\)/);
    assert.match(inspectors, /recordOverride\(collider, 'height'\)/);
    assert.match(capsule, /this\.radius = Math\.max\(0\.0001, radius\)/);
    assert.match(capsule, /this\.height = Math\.max\(this\.radius \* 2, height\)/);
});

test('UIEventAction Inspector exposes an undoable authored LoadScene path', () => {
    const inspectors = source('src/editor/EditorInspectors.ts');
    const inspectorWindow = source('src/editor/InspectorWindow.ts');
    const component = source('src/engine/components/UIEventAction.ts');
    assert.match(inspectorWindow, /compName === 'UIEventAction'/);
    assert.match(inspectorWindow, /createUIEventActionInspector\(sectionContent, comp\)/);
    assert.match(inspectors, /'SetText', 'LoadScene'/);
    assert.match(inspectors, /action\.action === 'LoadScene'/);
    assert.match(inspectors, /'Scene Path'/);
    assert.match(inspectors, /recordOverride\(action, field\)/);
    assert.match(component, /window\.dispatchEvent\(new CustomEvent\('tugberk-runtime-load-scene'/);
    assert.match(component, /@serialize public scenePath: string/);
});

test('broken prefab sources expose safe repair and undoable unpack actions', () => {
    const editor = source('src/editor/Editor.ts');
    const inspector = source('src/editor/InspectorWindow.ts');

    assert.match(editor, /public async getPrefabSourceStatus/);
    assert.match(editor, /public async repairPrefabSource/);
    assert.match(editor, /Prefab repair requires a \.prefab asset inside the current project Assets folder/);
    assert.match(editor, /public unpackPrefabInstance\(gameObject: GameObject, completely = false\)/);
    assert.match(editor, /Unpack Prefab Completely/);
    assert.match(editor, /this\.executeSceneMutationCommand\(/);
    assert.match(inspector, /id="prefab-source-status" role="status" aria-live="polite"/);
    assert.match(inspector, /id="prefab-repair">Repair/);
    assert.match(inspector, /id="prefab-unpack">Unpack/);
    assert.match(inspector, /id="prefab-unpack-completely">Unpack Completely/);
    assert.match(inspector, /openBtn\.disabled = !connected/);
    assert.match(inspector, /applyBtn\.disabled = !connected/);
    assert.match(inspector, /revertBtn\.disabled = !connected/);
});
