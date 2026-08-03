'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { atomicWriteJson, stableStringify } = require('../electron/architecture/persistence');
const { readRecovery, recoveryPath, writeRecovery } = require('../electron/architecture/recovery');

const root = path.resolve(__dirname, '..');
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('editor restart restores the canonical scene before offering newer recovery', () => {
    const editor = source('src/editor/Editor.ts');
    assert.match(
        editor,
        /await this\.restorePersistedSceneOnStartup\(\);\s+await this\.offerRecovery\(\);/
    );
    assert.match(editor, /SceneManager\.getInstance\(\)\.loadScene\(defaultPath\)/);
});

test('scene saves carry the loaded revision and conflicts preserve dirty edits', () => {
    const manager = source('src/engine/SceneManager.ts');
    const editor = source('src/editor/Editor.ts');
    const main = source('electron/main.js');

    assert.match(manager, /writeSceneDocument\(filePath,\s*json,\s*this\.activeSceneRevision\)/);
    assert.match(main, /atomicWriteText\(filePath,\s*content,\s*\{\s*expectedRevision\s*\}\)/);
    assert.match(editor, /code\?: string[^]*REVISION_CONFLICT/);
    assert.match(editor, /Your edits were not overwritten/);
    assert.doesNotMatch(
        editor.match(/if \(\(error as \{ code\?: string \}\)[^]*?return false;/)?.[0] ?? '',
        /markPersisted/
    );
});

test('accepted recovery loads nested scene data and remains dirty until explicit save', () => {
    const editor = source('src/editor/Editor.ts');
    assert.match(editor, /this\.scene\.loadFromJSON\(JSON\.stringify\(recovery\.scene\)\)/);
    assert.match(editor, /this\.hierarchyWindow\.refresh\(\);\s+this\.inspectorWindow\.refresh\(\);\s+this\.dirtyState\.markChanged\(\)/);
});

test('New and every Open entry point preserve recovery until replacement commits', () => {
    const editor = source('src/editor/Editor.ts');
    const projectWindow = source('src/editor/ProjectWindow.ts');
    const replacementGuard = editor.match(
        /private async confirmSceneReplacement[^]*?\n    }\n\n    public async newScene/
    )?.[0] ?? '';
    const dialogOpen = editor.match(
        /private async showOpenSceneDialog\(\)[^]*?\n    }\n\n    private async showSaveSceneAsDialog/
    )?.[0] ?? '';

    assert.match(editor, /confirmSceneReplacement\(action: 'create a new scene' \| 'open another scene'\)/);
    assert.match(editor, /if \(!this\.dirtyState\.isDirty\) return true/);
    assert.match(editor, /return await this\.saveActiveScene\(\)/);
    assert.doesNotMatch(replacementGuard, /discardRecovery/);
    assert.match(editor, /newScene\(\): Promise<void>[^]*confirmSceneReplacement\('create a new scene'\)/);
    assert.match(
        editor,
        /openScene\(scenePath: string\): Promise<boolean>[^]*prepareScene\(scenePath\)[^]*confirmSceneReplacement\('open another scene'\)[^]*activatePreparedScene\(prepared\)[^]*setScene\(scene\)[^]*discardRecovery\(this\.projectPath\)/
    );
    assert.match(
        dialogOpen,
        /showOpenDialog[^]*if \(!result\.canceled && selectedPath\)[^]*prepareScene\(selectedPath\)[^]*confirmSceneReplacement\('open another scene'\)[^]*activatePreparedScene\(prepared\)[^]*setScene\(scene\)[^]*discardRecovery\(this\.projectPath\)/
    );
    assert.doesNotMatch(
        dialogOpen.match(/private async showOpenSceneDialog\(\)[^]*?if \(!result\.canceled && selectedPath\)/)?.[0] ?? '',
        /confirmSceneReplacement/
    );
    assert.match(projectWindow, /this\.editor\.openScene\(fullPath\)/);
    assert.doesNotMatch(projectWindow, /SceneManager\.getInstance\(\)\.loadScene\(fullPath\)/);
});

test('nested recovery survives restart while a stale save leaves the canonical file untouched', (t) => {
    const scratchRoot = process.env.PAPERCLIP_RUN_SCRATCH_DIR || process.env.TEMP;
    const projectRoot = fs.mkdtempSync(path.join(scratchRoot, 'tugberk-scene-safety-'));
    t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

    const scenePath = path.join(projectRoot, 'Assets', 'Scenes', 'SampleScene.json');
    const original = {
        formatVersion: 1,
        sceneId: 'nested-scene',
        name: 'SampleScene',
        gameObjects: [{
            id: 'parent',
            name: 'Parent',
            children: [{ id: 'child', name: 'Unsaved Child', children: [] }]
        }]
    };
    const first = atomicWriteJson(scenePath, original);
    const recoveryScene = structuredClone(original);
    recoveryScene.gameObjects[0].children[0].name = 'Recovered Child';
    writeRecovery(projectRoot, scenePath, stableStringify(recoveryScene), Date.now() + 1000);
    const recoveryBytes = fs.readFileSync(recoveryPath(projectRoot));

    const recovered = readRecovery(projectRoot, fs.statSync(scenePath).mtimeMs);
    assert.equal(recovered.scene.gameObjects[0].children[0].name, 'Recovered Child');

    const external = structuredClone(original);
    external.name = 'External Edit';
    atomicWriteJson(scenePath, external);
    const canonicalBytes = fs.readFileSync(scenePath);
    assert.throws(
        () => atomicWriteJson(scenePath, recoveryScene, { expectedRevision: first.revision }),
        { code: 'REVISION_CONFLICT' }
    );
    assert.deepEqual(fs.readFileSync(scenePath), canonicalBytes);
    assert.deepEqual(fs.readFileSync(recoveryPath(projectRoot)), recoveryBytes);
});
