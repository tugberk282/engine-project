const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const input = fs.readFileSync(path.join(root, 'src', 'engine', 'Input.ts'), 'utf8');
const editor = fs.readFileSync(path.join(root, 'src', 'editor', 'Editor.ts'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'src', 'engine', 'RuntimeBridge.ts'), 'utf8');

test('mapped input owns configuration, frame snapshots, and focus-loss clearing', () => {
    assert.match(input, /public static configure\(map: Partial<InputMap>\)/);
    assert.match(input, /window\.addEventListener\('blur', \(\) => this\.clearHeldState\(\)\)/);
    assert.match(input, /public static snapshot\(\): Record<string, number \| boolean>/);
    assert.match(bridge, /\{ deltaTime, input \}/);
});

test('focused Game view captures pointer focus and bypasses editor shortcuts', () => {
    assert.match(editor, /viewGame\.onpointerdown = \(\) => viewGame\.focus/);
    assert.match(editor, /this\.isGameView && document\.getElementById\('game-view'\)\?\.contains\(document\.activeElement\)/);
    assert.match(editor, /!this\.isGameView && Input\.getKeyDown\('KeyF'\)/);
});
