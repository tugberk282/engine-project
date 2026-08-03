'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('production scene persistence is available through grant-scoped v1 resources', () => {
    const bridge = fs.readFileSync(path.join(root, 'src/platform/DesktopBridge.ts'), 'utf8');
    const scenes = fs.readFileSync(path.join(root, 'src/engine/SceneManager.ts'), 'utf8');

    assert.match(bridge, /request\('project\.readText', resource\)/);
    assert.match(bridge, /request\('project\.writeText', \{ \.\.\.resource, content \}\)/);
    assert.match(scenes, /loadProjectScene\(resource: ProjectResource\)/);
    assert.match(scenes, /saveProjectScene\(resource: ProjectResource\)/);
    assert.doesNotMatch(
        scenes.match(/public async loadProjectScene[\s\S]*?^    }/m)?.[0] ?? '',
        /readTextFile/
    );
    assert.doesNotMatch(
        scenes.match(/public async saveProjectScene[\s\S]*?^    }/m)?.[0] ?? '',
        /writeTextFile/
    );
});

test('production asset list and read flow uses only v1 grant-relative commands', () => {
    const source = fs.readFileSync(path.join(root, 'src/platform/DesktopFileSystem.ts'), 'utf8');
    const readFlow = source.match(/public async readProjectFile[\s\S]*?^    }/m)?.[0] ?? '';
    const listFlow = source.match(/public async listProjectDirectory[\s\S]*?^    }/m)?.[0] ?? '';

    assert.match(readFlow, /request\('project\.readText'/);
    assert.match(listFlow, /request\('project\.listDirectory'/);
    assert.doesNotMatch(`${readFlow}\n${listFlow}`, /electronAPI|targetPath/);
});
