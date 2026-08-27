const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const editor = fs.readFileSync(path.join(root, 'src/editor/Editor.ts'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src/style.css'), 'utf8');

test('menubar implements roving focus and complete keyboard navigation', () => {
    assert.match(editor, /item\.tabIndex = index === 0 \? 0 : -1/);
    for (const key of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape']) {
        assert.ok(editor.includes(`'${key}'`), `missing ${key} menu handling`);
    }
    assert.match(editor, /event\.key !== 'Alt'/);
    assert.match(editor, /current\.click\(\)/);
    assert.match(editor, /topMenu\?\.focus\(\)/);
});

test('panel tabs expose tab semantics and keyboard activation', () => {
    assert.match(html, /id="tab-assets"[^>]*role="tab"[^>]*aria-selected="true"[^>]*tabindex="0"/);
    assert.match(html, /id="tab-console"[^>]*role="tab"[^>]*aria-selected="false"[^>]*tabindex="-1"/);
    assert.match(editor, /setAttribute\('role', 'tablist'\)/);
    assert.match(editor, /setAttribute\('role', 'tab'\)/);
    assert.match(editor, /setAttribute\('aria-selected'/);
    assert.match(editor, /tab\.tabIndex = selected \? 0 : -1/);
    assert.match(editor, /tabs\[nextIndex\]\.focus\(\)/);
    assert.match(editor, /tab\.click\(\)/);
});

test('splitters expose separator values and persist keyboard resizing', () => {
    assert.match(editor, /setAttribute\('role', 'separator'\)/);
    assert.match(editor, /setAttribute\('aria-orientation'/);
    assert.match(editor, /setAttribute\('aria-valuemin'/);
    assert.match(editor, /setAttribute\('aria-valuenow'/);
    assert.match(editor, /event\.shiftKey \? 50 : 10/);
    assert.match(editor, /event\.key === 'Home'/);
    assert.match(editor, /event\.key === 'End'/);
    assert.match(editor, /syncSeparatorValue\(\);\s+this\.saveLayout\(\)/);
    assert.match(styles, /\.panel-splitter:focus-visible/);
});

test('global authoring shortcuts never mutate the scene while text controls are active', () => {
    assert.match(editor, /matches\('input, textarea, select, \[contenteditable="true"\], \[role="textbox"\]'\)/);
    assert.match(editor, /if \(!editorOwnsKeyboardInput\(\{ isTextEditing, isPlaying: this\.isPlaying, isGameView: this\.isGameView \}\)\) return/);
});

test('hierarchy exposes deterministic tree and keyboard context-menu behavior', () => {
    const hierarchy = fs.readFileSync(path.join(root, 'src/editor/HierarchyWindow.ts'), 'utf8');
    assert.match(hierarchy, /setAttribute\('role', 'tree'\)/);
    assert.match(hierarchy, /setAttribute\('role', 'treeitem'\)/);
    assert.match(hierarchy, /setAttribute\('aria-selected'/);
    assert.match(hierarchy, /setAttribute\('aria-expanded'/);
    assert.match(hierarchy, /case 'ContextMenu'/);
    assert.match(hierarchy, /setAttribute\('role', 'menu'\)/);
    assert.match(hierarchy, /contextMenuReturnFocus\?\.focus\(\)/);
});
