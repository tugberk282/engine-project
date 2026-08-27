'use strict';

class FakeEvent {
    constructor(type, init = {}) { Object.assign(this, init); this.type = type; this.defaultPrevented = false; }
    preventDefault() { this.defaultPrevented = true; }
}

class FakeElement {
    constructor(document, tagName, id = '') {
        this.ownerDocument = document; this.tagName = tagName.toUpperCase(); this.id = id;
        this.children = []; this.attributes = new Map(); this.listeners = new Map();
        this.hidden = false; this.textContent = ''; this.value = ''; this.tabIndex = -1;
    }
    append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    addEventListener(type, listener) { const list = this.listeners.get(type) ?? []; list.push(listener); this.listeners.set(type, list); }
    dispatchEvent(event) { event.target ??= this; for (const listener of this.listeners.get(event.type) ?? []) listener(event); return !event.defaultPrevented; }
    focus() { this.ownerDocument.activeElement = this; this.dispatchEvent(new FakeEvent('focus')); }
}

class FakeDocument {
    constructor() { this.activeElement = null; this.body = this.createElement('body'); }
    createElement(tagName, id = '') { return new FakeElement(this, tagName, id); }
}

const key = (target, keyName, init = {}) => target.dispatchEvent(new FakeEvent('keydown', { key: keyName, ...init }));

function createHeadlessEditorFixture({ projectFailure = null } = {}) {
    const document = new FakeDocument();
    const events = [];
    const clock = { now: 1_700_000_000_000, advance(ms) { this.now += ms; } };
    const filesystem = {
        entries: new Map([['Assets', ['Scenes', 'player.png']], ['Assets/Scenes', ['Main.scene']]]),
        async list(path) { return [...(this.entries.get(path) ?? [])]; }
    };
    const bridge = {
        async listProject(path) { events.push({ type: 'project:list', path, at: clock.now }); return filesystem.list(path); },
        async openProject() { if (projectFailure) throw new Error(projectFailure); return { name: 'Fixture project' }; }
    };
    const renderer = { frames: 0, render() { this.frames += 1; events.push({ type: 'renderer:frame' }); } };
    const el = (tag, id, role) => { const node = document.createElement(tag, id); if (role) node.setAttribute('role', role); document.body.append(node); return node; };

    const menuButton = el('button', 'file-menu-button', 'menuitem');
    const menu = el('div', 'file-menu', 'menu'); menu.hidden = true; menu.setAttribute('aria-hidden', 'true');
    const menuItems = ['New', 'Open', 'Save'].map((label, index) => { const item = document.createElement('button', `file-${label.toLowerCase()}`); item.textContent = label; item.setAttribute('role', 'menuitem'); item.tabIndex = index ? -1 : 0; menu.append(item); return item; });
    const closeMenu = () => { menu.hidden = true; menu.setAttribute('aria-hidden', 'true'); menuButton.setAttribute('aria-expanded', 'false'); menuButton.focus(); events.push({ type: 'menu:cancel' }); };
    menuButton.setAttribute('aria-haspopup', 'menu'); menuButton.setAttribute('aria-expanded', 'false');
    menuButton.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === 'ArrowDown') { menu.hidden = false; menu.setAttribute('aria-hidden', 'false'); menuButton.setAttribute('aria-expanded', 'true'); menuItems[0].focus(); events.push({ type: 'menu:open' }); } });
    menuItems.forEach((item, index) => item.addEventListener('keydown', (event) => { if (event.key === 'ArrowDown') menuItems[(index + 1) % menuItems.length].focus(); if (event.key === 'Escape') closeMenu(); }));

    const hierarchy = el('div', 'hierarchy', 'tree'); hierarchy.tabIndex = 0;
    const names = ['Camera', 'Light', 'Cube', 'Sphere'];
    const rows = names.map((name) => { const row = document.createElement('div', `hierarchy-${name.toLowerCase()}`); row.textContent = name; row.setAttribute('role', 'treeitem'); row.setAttribute('aria-selected', 'false'); hierarchy.append(row); return row; });
    let selection = [], anchor = 0;
    const paintSelection = () => rows.forEach((row, index) => row.setAttribute('aria-selected', selection.includes(index) ? 'true' : 'false'));
    const select = (index, shiftKey = false) => { selection = shiftKey ? Array.from({ length: Math.abs(index - anchor) + 1 }, (_, offset) => Math.min(index, anchor) + offset) : [index]; if (!shiftKey) anchor = index; paintSelection(); rows[index].focus(); events.push({ type: 'hierarchy:selection', names: selection.map((i) => names[i]) }); };
    rows.forEach((row, index) => row.addEventListener('keydown', (event) => { if (event.key === 'ArrowDown') select(Math.min(rows.length - 1, index + 1), event.shiftKey); if (event.key === 'Escape') { selection = [anchor]; paintSelection(); rows[anchor].focus(); events.push({ type: 'hierarchy:cancel' }); } }));

    const project = el('div', 'project', 'listbox'); project.setAttribute('aria-busy', 'false');
    let projectItems = [];
    const navigate = async (path) => { project.setAttribute('aria-busy', 'true'); project.textContent = 'Loading…'; const entries = await bridge.listProject(path); projectItems = entries.map((name) => { const item = document.createElement('div', `asset-${name.replace(/\W/g, '-').toLowerCase()}`); item.textContent = name; item.setAttribute('role', 'option'); item.setAttribute('aria-selected', 'false'); item.setAttribute('aria-grabbed', 'false'); item.addEventListener('dragstart', (event) => { item.setAttribute('aria-grabbed', 'true'); event.dataTransfer.setData('application/x-tugberk-asset', JSON.stringify({ kind: 'project-asset', path: `${path}/${name}` })); events.push({ type: 'project:drag', name }); }); item.addEventListener('keydown', (event) => { if (event.key === 'Escape' && item.getAttribute('aria-grabbed') === 'true') { item.setAttribute('aria-grabbed', 'false'); events.push({ type: 'project:drag-cancel', name }); } }); project.append(item); return item; }); project.textContent = entries.join(', '); project.setAttribute('aria-busy', 'false'); events.push({ type: 'project:navigated', path }); return projectItems; };

    const inspector = el('section', 'inspector', 'region'); const field = document.createElement('input', 'inspector-name'); inspector.append(field);
    const model = { name: 'Cube' }; field.value = model.name; let staged = model.name;
    field.addEventListener('input', () => { staged = field.value; events.push({ type: 'inspector:staged', value: staged }); });
    field.addEventListener('keydown', (event) => { if (event.key === 'Enter') { model.name = staged; events.push({ type: 'inspector:commit', value: model.name }); } if (event.key === 'Escape') { staged = model.name; field.value = model.name; events.push({ type: 'inspector:cancel', value: model.name }); } });

    const consoleView = el('section', 'console', 'log'); const filter = document.createElement('input', 'console-filter'); const logList = document.createElement('div', 'console-list'); consoleView.append(filter, logList);
    const logs = [{ level: 'info', message: 'Ready' }, { level: 'error', message: 'Broken asset' }, { level: 'warn', message: 'Slow import' }]; let visibleLogs = [];
    const refreshLogs = () => { visibleLogs = logs.filter((entry) => entry.message.toLowerCase().includes(filter.value.toLowerCase())); logList.children = []; for (const [index, entry] of visibleLogs.entries()) { const row = document.createElement('div', `log-${index}`); row.textContent = entry.message; row.setAttribute('role', 'option'); row.setAttribute('aria-selected', 'false'); row.addEventListener('keydown', (event) => { if (event.key === 'Enter') { for (const child of logList.children) child.setAttribute('aria-selected', 'false'); row.setAttribute('aria-selected', 'true'); events.push({ type: 'console:selection', message: entry.message }); } }); logList.append(row); } events.push({ type: 'console:filter', count: visibleLogs.length }); };
    filter.addEventListener('input', refreshLogs); filter.addEventListener('keydown', (event) => { if (event.key === 'Escape') { filter.value = ''; refreshLogs(); events.push({ type: 'console:filter-cancel' }); } }); refreshLogs();

    const splitter = el('div', 'dock-splitter', 'separator'); splitter.tabIndex = 0; splitter.setAttribute('aria-valuemin', '180'); splitter.setAttribute('aria-valuemax', '600'); let dockWidth = 300; let resizeOrigin = dockWidth;
    const paintWidth = () => splitter.setAttribute('aria-valuenow', dockWidth);
    splitter.addEventListener('focus', () => { resizeOrigin = dockWidth; });
    splitter.addEventListener('keydown', (event) => { if (event.key === 'ArrowRight') { dockWidth = Math.min(600, dockWidth + 10); paintWidth(); events.push({ type: 'dock:resize', width: dockWidth }); } if (event.key === 'Escape') { dockWidth = resizeOrigin; paintWidth(); events.push({ type: 'dock:cancel', width: dockWidth }); } }); paintWidth();

    const launcher = el('section', 'launcher', 'dialog'); const launcherStatus = document.createElement('div', 'launcher-status'); launcherStatus.setAttribute('role', 'alert'); const retry = document.createElement('button', 'launcher-retry'); retry.textContent = 'Retry'; launcher.append(launcherStatus, retry);
    const launch = async () => { try { await bridge.openProject(); launcherStatus.textContent = 'Project opened'; retry.hidden = true; return true; } catch (error) { launcher.hidden = false; launcherStatus.textContent = `Could not open project: ${error.message}`; retry.hidden = false; retry.focus(); events.push({ type: 'launcher:error', message: error.message }); return false; } };

    return { document, events, clock, filesystem, bridge, renderer, key, menuButton, menu, menuItems, hierarchy, rows, select, get selection() { return [...selection]; }, project, navigate, get projectItems() { return projectItems; }, inspector: { field, model }, console: { filter, logList, get visibleLogs() { return visibleLogs; }, refreshLogs }, splitter, get dockWidth() { return dockWidth; }, launcher, launcherStatus, retry, launch };
}

module.exports = { FakeEvent, createHeadlessEditorFixture };
