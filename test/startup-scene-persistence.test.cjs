'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const editor = fs.readFileSync(path.join(root, 'src', 'editor', 'Editor.ts'), 'utf8');

test('startup reopens the first scene declared by project.json before offering recovery', () => {
    assert.match(editor, /resolveStartupScenePath\(\)/);
    assert.match(editor, /pathJoin\(this\.projectPath, 'project\.json'\)/);
    assert.match(editor, /project\.scenes\?\.find/);
    assert.match(editor, /SceneManager\.getInstance\(\)\.loadScene\(defaultPath\)/);
    assert.ok(
        editor.indexOf('await this.restorePersistedSceneOnStartup()')
            < editor.indexOf('await this.offerRecovery()'),
        'canonical scene must load before recovery is offered'
    );
});

test('configured startup scenes are confined to safe project-relative paths', () => {
    assert.match(editor, /!normalized\.startsWith\('\/'\)/);
    assert.ok(editor.includes("!/^[A-Za-z]:/.test(normalized)"));
    assert.match(editor, /segment\) => segment !== '\.\.'/);
    assert.match(editor, /fileExists\(candidate\)/);
});

test('legacy SampleScene projects retain their startup fallback', () => {
    assert.match(editor, /'SampleScene\.json'/);
    assert.match(editor, /fileExists\(legacyPath\) \? legacyPath : null/);
});
