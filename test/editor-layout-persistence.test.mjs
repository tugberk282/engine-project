import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EditorSettings } from '../src/editor/EditorSettings.ts';

class MemoryStorage {
    values = new Map();
    failKey = null;
    getItem(key) { return this.values.get(key) ?? null; }
    removeItem(key) { this.values.delete(key); }
    setItem(key, value) {
        if (key === this.failKey) throw new Error(`injected ${key} write failure`);
        this.values.set(key, String(value));
    }
}

test('layout settings fall back to last-known-good bytes without replacing corrupt primary data', () => {
    const storage = new MemoryStorage();
    globalThis.localStorage = storage;
    const good = JSON.stringify({ hierarchyWidth: 333, layoutPreset: 'custom' });
    storage.setItem('tugberkengine_editor_settings', '{corrupt');
    storage.setItem('tugberkengine_editor_settings_lkg', good);

    EditorSettings.hierarchyWidth = 250;
    EditorSettings.load();

    assert.equal(EditorSettings.hierarchyWidth, 333);
    assert.equal(storage.getItem('tugberkengine_editor_settings'), '{corrupt');
    assert.equal(storage.getItem('tugberkengine_editor_settings_lkg'), good);
});

test('failed publication preserves last-known-good layout and clears staged bytes', () => {
    const storage = new MemoryStorage();
    globalThis.localStorage = storage;
    const good = JSON.stringify({ hierarchyWidth: 280 });
    storage.setItem('tugberkengine_editor_settings_lkg', good);
    storage.failKey = 'tugberkengine_editor_settings';
    EditorSettings.hierarchyWidth = 410;

    assert.throws(() => EditorSettings.save(), /injected/);
    assert.equal(storage.getItem('tugberkengine_editor_settings_lkg'), good);
    assert.equal(storage.getItem('tugberkengine_editor_settings_pending'), null);
});

test('successful publication leaves primary and recovery bytes identical', () => {
    const storage = new MemoryStorage();
    globalThis.localStorage = storage;
    EditorSettings.hierarchyWidth = 375;

    EditorSettings.save();

    const primary = storage.getItem('tugberkengine_editor_settings');
    assert.ok(primary);
    assert.equal(storage.getItem('tugberkengine_editor_settings_lkg'), primary);
    assert.equal(storage.getItem('tugberkengine_editor_settings_pending'), null);
    assert.equal(JSON.parse(primary).hierarchyWidth, 375);
});

test('pointer layout gestures bind cancellation paths and save only successful completion', () => {
    const editor = fs.readFileSync(new URL('../src/editor/Editor.ts', import.meta.url), 'utf8');
    assert.match(editor, /document\.addEventListener\('pointercancel', handleCancel\)/);
    assert.match(editor, /document\.addEventListener\('keydown', handleKeyDown, true\)/);
    assert.match(editor, /window\.addEventListener\('blur', handleBlur\)/);
    assert.match(editor, /if \(keyEvent\.key !== 'Escape'\) return/);
    assert.match(editor, /if \(cancelled\) \{\s+EditorSettings\.floatingPanels\[panelId\] = \{ \.\.\.state\.originalState \}/);
    assert.match(editor, /if \(cancelled\) \{\s+onMove\(new PointerEvent\('pointermove'\), \{ x: 0, y: 0, size: start\.size \}, targetId\)/);
    assert.match(editor, /const handleUp = \(\) => \{\s+cleanup\(false\);\s+this\.saveLayout\(\)/);
});
