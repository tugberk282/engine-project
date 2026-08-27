'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { FakeEvent, createHeadlessEditorFixture } = require('./fixtures/headless-editor-fixture.cjs');

test('menu keyboard open, navigation, and Escape are observable', () => {
    const view = createHeadlessEditorFixture(); view.menuButton.focus(); view.key(view.menuButton, 'Enter');
    assert.equal(view.menuButton.getAttribute('aria-expanded'), 'true'); assert.equal(view.document.activeElement.textContent, 'New');
    view.key(view.document.activeElement, 'ArrowDown'); assert.equal(view.document.activeElement.textContent, 'Open');
    view.key(view.document.activeElement, 'Escape'); assert.equal(view.menu.hidden, true); assert.equal(view.document.activeElement, view.menuButton); assert.equal(view.events.at(-1).type, 'menu:cancel');
});

test('Hierarchy keyboard range and cancel restore selection and focus', () => {
    const view = createHeadlessEditorFixture(); view.select(1); view.key(view.rows[1], 'ArrowDown', { shiftKey: true });
    assert.deepEqual(view.selection, [1, 2]); assert.equal(view.rows[2].getAttribute('aria-selected'), 'true'); assert.equal(view.document.activeElement, view.rows[2]);
    view.key(view.rows[2], 'Escape'); assert.deepEqual(view.selection, [1]); assert.equal(view.rows[2].getAttribute('aria-selected'), 'false'); assert.equal(view.events.at(-1).type, 'hierarchy:cancel');
});

test('Project async navigation settles and drag publishes a typed payload', async () => {
    const view = createHeadlessEditorFixture(); const pending = view.navigate('Assets'); assert.equal(view.project.getAttribute('aria-busy'), 'true');
    const items = await pending; assert.equal(view.project.getAttribute('aria-busy'), 'false'); assert.match(view.project.textContent, /player\.png/); assert.equal(view.events.some((event) => event.type === 'project:navigated'), true);
    const transfer = { values: new Map(), setData(type, value) { this.values.set(type, value); } }; items[1].dispatchEvent(new FakeEvent('dragstart', { dataTransfer: transfer }));
    assert.deepEqual(JSON.parse(transfer.values.get('application/x-tugberk-asset')), { kind: 'project-asset', path: 'Assets/player.png' });
    assert.equal(items[1].getAttribute('aria-grabbed'), 'true'); view.key(items[1], 'Escape'); assert.equal(items[1].getAttribute('aria-grabbed'), 'false'); assert.equal(view.events.at(-1).type, 'project:drag-cancel');
});

test('Inspector staged edit commits and Escape restores field and model', () => {
    const view = createHeadlessEditorFixture(); const { field, model } = view.inspector; field.value = 'Hero'; field.dispatchEvent(new FakeEvent('input'));
    assert.equal(model.name, 'Cube'); view.key(field, 'Enter'); assert.equal(model.name, 'Hero'); assert.equal(view.events.at(-1).type, 'inspector:commit');
    field.value = 'Discarded'; field.dispatchEvent(new FakeEvent('input')); view.key(field, 'Escape'); assert.equal(field.value, 'Hero'); assert.equal(model.name, 'Hero'); assert.equal(view.events.at(-1).type, 'inspector:cancel');
});

test('Console filtering and keyboard selection update visible state', () => {
    const view = createHeadlessEditorFixture(); view.console.filter.value = 'broken'; view.console.filter.dispatchEvent(new FakeEvent('input'));
    assert.equal(view.console.visibleLogs.length, 1); assert.equal(view.console.logList.children[0].textContent, 'Broken asset');
    const row = view.console.logList.children[0]; row.focus(); view.key(row, 'Enter'); assert.equal(row.getAttribute('aria-selected'), 'true'); assert.deepEqual(view.events.at(-1), { type: 'console:selection', message: 'Broken asset' });
    view.key(view.console.filter, 'Escape'); assert.equal(view.console.filter.value, ''); assert.equal(view.console.visibleLogs.length, 3); assert.equal(view.events.at(-1).type, 'console:filter-cancel');
});

test('docking keyboard resize exposes value and Escape restores origin', () => {
    const view = createHeadlessEditorFixture(); view.splitter.focus(); view.key(view.splitter, 'ArrowRight');
    assert.equal(view.dockWidth, 310); assert.equal(view.splitter.getAttribute('aria-valuenow'), '310'); assert.equal(view.events.at(-1).type, 'dock:resize');
    view.key(view.splitter, 'Escape'); assert.equal(view.dockWidth, 300); assert.equal(view.splitter.getAttribute('aria-valuenow'), '300'); assert.equal(view.events.at(-1).type, 'dock:cancel');
});

test('launcher failure stays visible, announced, and recoverable', async () => {
    const view = createHeadlessEditorFixture({ projectFailure: 'invalid project manifest' }); assert.equal(await view.launch(), false);
    assert.equal(view.launcher.hidden, false); assert.equal(view.launcherStatus.getAttribute('role'), 'alert'); assert.match(view.launcherStatus.textContent, /invalid project manifest/); assert.equal(view.retry.hidden, false); assert.equal(view.document.activeElement, view.retry); assert.equal(view.events.at(-1).type, 'launcher:error');
});

test('fixture seams are deterministic and never launch Electron', async () => {
    const view = createHeadlessEditorFixture(); view.clock.advance(25); await view.navigate('Assets/Scenes'); view.renderer.render();
    assert.equal(view.clock.now, 1_700_000_000_025); assert.deepEqual(view.projectItems.map((item) => item.textContent), ['Main.scene']); assert.equal(view.renderer.frames, 1); assert.deepEqual(view.events.map((event) => event.type).slice(-3), ['project:list', 'project:navigated', 'renderer:frame']);
});
