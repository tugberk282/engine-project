const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const projectWindow = fs.readFileSync(path.join(root, 'src/editor/ProjectWindow.ts'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src/style.css'), 'utf8');

test('project asset grid exposes selection semantics and complete keyboard workflow', () => {
    assert.match(projectWindow, /setAttribute\('role', 'grid'\)/);
    assert.match(projectWindow, /setAttribute\('role', 'gridcell'\)/);
    assert.match(projectWindow, /setAttribute\('aria-selected'/);
    assert.match(projectWindow, /item\.tabIndex = -1/);
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', 'F2', 'Delete', 'ContextMenu', 'F10']) {
        assert.ok(projectWindow.includes(`'${key}'`), `missing asset key handling for ${key}`);
    }
    assert.match(projectWindow, /getGridColumnCount\(items\)/);
    assert.match(projectWindow, /deleteAssetFromKeyboard/);
});

test('project folder tree supports roving focus, expansion and traversal', () => {
    assert.match(projectWindow, /setAttribute\('role', 'tree'\)/);
    assert.match(projectWindow, /setAttribute\('role', 'treeitem'\)/);
    assert.match(projectWindow, /setAttribute\('aria-expanded'/);
    assert.match(projectWindow, /setAttribute\('aria-level'/);
    assert.match(projectWindow, /focusAdjacentFolder/);
    assert.match(projectWindow, /focusParentFolder/);
    assert.match(projectWindow, /focusFolderBoundary/);
});

test('project search and rename preserve intentional focus', () => {
    assert.match(projectWindow, /dataset\.projectSearch = 'true'/);
    assert.match(projectWindow, /searchInput\.setSelectionRange/);
    assert.match(projectWindow, /let settled = false/);
    assert.match(projectWindow, /target\?\.focus\(\)/);
    assert.match(styles, /\.project-asset-grid \.asset-item:focus-visible/);
    assert.match(styles, /\.project-folder-tree \.project-folder-item:focus-visible/);
});
