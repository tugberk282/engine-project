import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EditorSelection } from '../src/editor/EditorSelection.ts';
import {
    describeObjectReference,
    parseObjectReferenceDropPayload,
    sameObjectReference
} from '../src/editor/ObjectReference.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('one stable scene selection transaction publishes ordered IDs and active identity', () => {
    const selection = new EditorSelection();
    const changes = [];
    selection.subscribe((next, previous) => changes.push({ next, previous }));

    selection.selectScene(['child', 'root', 'child'], 'root', 'hierarchy', {
        panel: 'hierarchy', controlId: 'hierarchy-item-root'
    });

    assert.deepEqual(selection.snapshot, {
        kind: 'scene', revision: 1, source: 'hierarchy',
        focus: { panel: 'hierarchy', controlId: 'hierarchy-item-root' },
        objectIds: ['child', 'root'], activeObjectId: 'root'
    });
    assert.equal(changes.length, 1);
    assert.equal(changes[0].previous.kind, 'none');
});

test('asset selection follows GUID moves and retains a recoverable missing reference', () => {
    const selection = new EditorSelection();
    selection.selectAsset('guid-material', 'Assets/Old.mat', 'project');
    selection.reconcileAsset((guid) => guid === 'guid-material' ? 'Assets/New.mat' : null);
    assert.equal(selection.snapshot.kind, 'asset');
    assert.equal(selection.snapshot.path, 'Assets/New.mat');
    assert.equal(selection.snapshot.resolved, true);

    selection.reconcileAsset(() => null);
    assert.equal(selection.snapshot.kind, 'asset');
    assert.equal(selection.snapshot.guid, 'guid-material');
    assert.equal(selection.snapshot.lastKnownPath, 'Assets/New.mat');
    assert.equal(selection.snapshot.resolved, false);

    selection.reconcileAsset(() => 'Assets/Restored.mat');
    assert.equal(selection.snapshot.path, 'Assets/Restored.mat');
    assert.equal(selection.snapshot.resolved, true);
});

test('scene reconciliation removes stale IDs and clears when the last object is deleted', () => {
    const selection = new EditorSelection();
    selection.selectScene(['root', 'child'], 'child', 'scene');
    selection.reconcileScene((id) => id === 'root');
    assert.deepEqual(selection.snapshot.objectIds, ['root']);
    assert.equal(selection.snapshot.activeObjectId, 'root');
    selection.reconcileScene(() => false);
    assert.equal(selection.snapshot.kind, 'none');
});

test('reference drops reject malformed payloads and preserve stable asset GUID identity', () => {
    assert.equal(parseObjectReferenceDropPayload('{broken'), null);
    assert.equal(parseObjectReferenceDropPayload(JSON.stringify({ type: 'prefab', fullPath: 'Assets/a.prefab' })), null);
    assert.deepEqual(parseObjectReferenceDropPayload(JSON.stringify({
        type: 'material', guid: 'mat-guid', fullPath: 'Assets/a.mat', name: 'a'
    })), {
        type: 'material', id: null, guid: 'mat-guid', fullPath: 'Assets/a.mat', name: 'a'
    });

    const before = { assetGuid: 'mat-guid', assetPath: 'Assets/a.mat' };
    const moved = { assetGuid: 'mat-guid', assetPath: 'Assets/a.mat' };
    assert.deepEqual(describeObjectReference(before), {
        kind: 'asset', guid: 'mat-guid', lastKnownPath: 'Assets/a.mat'
    });
    assert.equal(sameObjectReference(before, moved), true);
});

test('editor panels route selection through the typed authority and reference UI is cancellable', () => {
    const editor = source('src/editor/Editor.ts');
    const project = source('src/editor/ProjectWindow.ts');
    const inspectors = source('src/editor/EditorInspectors.ts');

    assert.match(editor, /readonly selection = new EditorSelection\(\)/);
    assert.match(editor, /selection\.selectScene\(normalizedTargets\.map/);
    assert.match(editor, /selection\.selectAsset\(asset\.meta\.guid/);
    assert.match(editor, /selection\.reconcileAsset\(\(guid\) => AssetDatabase\.getInstance\(\)\.getPath\(guid\)/);
    assert.match(project, /selectProjectAsset\(await this\.buildAssetSelection/);
    assert.match(project, /guid: AssetDatabase\.getInstance\(\)\.getGuid\(fullPath\)/);
    assert.match(inspectors, /aria-keyshortcuts', 'Delete Backspace'/);
    assert.match(inspectors, /if \(event\.key === 'Delete' \|\| event\.key === 'Backspace'\)/);
    assert.match(inspectors, /else if \(event\.key === 'Escape'\)/);
    assert.match(inspectors, /AssetDatabase\.getInstance\(\)\.getPath\(payload\.guid\)/);
});
