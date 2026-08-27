const fs = require('node:fs');
const path = require('node:path');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runPhase2KeyboardHarness(mainWindow) {
    const outputPath = process.env.ENGINE_SMOKE_TEST_OUTPUT;
    const artifactDirectory = process.env.ENGINE_PHASE2_ARTIFACT_DIR;
    const phase = process.env.ENGINE_PHASE2_KEYBOARD_PHASE || 'author';
    if (!outputPath || !artifactDirectory) throw new Error('Phase 2 output paths are required');
    fs.mkdirSync(artifactDirectory, { recursive: true });
    const webContents = mainWindow.webContents;
    const checks = [];
    const failures = [];
    const record = (name, pass, details) => {
        const entry = { name, pass: Boolean(pass), details };
        checks.push(entry);
        if (!entry.pass) failures.push(entry);
    };
    const evaluate = (source) => webContents.executeJavaScript(source, true);
    const key = async (keyCode, modifiers = []) => {
        webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
        webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
        await wait(80);
    };
    const type = async (value) => {
        for (const character of value) {
            webContents.sendInputEvent({ type: 'char', keyCode: character });
        }
        await wait(80);
    };
    const capture = async (name) => {
        const imagePath = path.join(artifactDirectory, `${name}.png`);
        let image;
        let screenshotError;
        for (let attempt = 0; attempt < 5; attempt += 1) {
            try {
                mainWindow.show();
                mainWindow.focus();
                webContents.invalidate();
                await wait(150);
                image = await webContents.capturePage();
                if (!image.isEmpty()) break;
                screenshotError = new Error('capturePage returned an empty image');
            } catch (error) {
                screenshotError = error;
            }
        }
        if (!image || image.isEmpty()) throw screenshotError ?? new Error('Unable to capture packaged editor');
        fs.writeFileSync(imagePath, image.toPNG());
        const attached = webContents.debugger.isAttached();
        try {
            if (!attached) webContents.debugger.attach('1.3');
            await webContents.debugger.sendCommand('Accessibility.enable');
            const tree = await webContents.debugger.sendCommand('Accessibility.getFullAXTree');
            fs.writeFileSync(path.join(artifactDirectory, `${name}.accessibility.json`), JSON.stringify(tree, null, 2));
        } finally {
            if (!attached && webContents.debugger.isAttached()) webContents.debugger.detach();
        }
    };

    for (let attempt = 0; attempt < 160; attempt += 1) {
        if (await evaluate("Boolean(window.Editor?.instance?.scene && document.getElementById('hierarchy-content'))")) break;
        await wait(100);
    }
    const booted = await evaluate("Boolean(window.Editor?.instance?.scene && document.getElementById('hierarchy-content'))");
    record('packaged editor booted with authoring surfaces', booted, webContents.getURL());
    if (!booted) throw new Error('Packaged editor did not boot');
    mainWindow.show();
    mainWindow.focus();
    webContents.focus();
    await wait(500);

    if (phase === 'reopen') {
        const state = await evaluate(`(() => {
            const editor = window.Editor.instance;
            const visit = (items) => items.flatMap((item) => [item, ...visit(item.transform?.children?.map((child) => child.gameObject) ?? [])]);
            const objects = visit(editor.scene.gameObjects ?? []);
            return { names: objects.map((item) => item.name), clean: editor.dirtyState?.isDirty === false };
        })()`);
        record('keyboard-authored nested objects persist after relaunch', state.names.includes('Keyboard Root') && state.names.includes('Keyboard Child'), JSON.stringify(state));
        await evaluate("document.getElementById('hierarchy-content')?.focus()");
        await capture('reopen-persisted-focus');
    } else {
        await evaluate("document.getElementById('hierarchy-content')?.focus()");
        await key('N', ['control', 'shift']);
        await key('F2');
        await type('Keyboard Root');
        await key('Enter');
        await key('N', ['control', 'alt', 'shift']);
        await key('F2');
        await type('Keyboard Child');
        await key('Enter');
        const hierarchy = await evaluate(`(() => {
            const editor = window.Editor.instance;
            const child = editor.getSelectedGameObjects?.().at(-1);
            return { child: child?.name, parent: child?.transform?.parent?.gameObject?.name, active: document.activeElement?.id, revision: editor.dirtyState?.commandRevision };
        })()`);
        record('native keyboard creates and renames a nested object', hierarchy.child === 'Keyboard Child' && hierarchy.parent === 'Keyboard Root', JSON.stringify(hierarchy));
        record('rename commit returns deterministic tree focus', hierarchy.active === 'hierarchy-content', JSON.stringify(hierarchy));
        await capture('hierarchy-nested-focus');

        const beforeCancel = await evaluate("window.Editor.instance.scene.toJSON()");
        await key('F2');
        await type('Discarded Name');
        await key('Escape');
        const afterCancel = await evaluate("window.Editor.instance.scene.toJSON()");
        record('native Escape cancels rename without model mutation', beforeCancel === afterCancel, `${beforeCancel.length} bytes`);

        await key('F10', ['shift']);
        const menuState = await evaluate("({ role: document.activeElement?.getAttribute('role'), menu: Boolean(document.getElementById('hierarchy-context-menu')) })");
        await capture('hierarchy-context-menu-focus');
        await key('Escape');
        const menuReturn = await evaluate("({ menu: Boolean(document.getElementById('hierarchy-context-menu')), active: document.activeElement?.id })");
        record('context menu traps and returns native keyboard focus', menuState.menu && menuState.role === 'menuitem' && !menuReturn.menu && menuReturn.active === 'hierarchy-content', JSON.stringify({ menuState, menuReturn }));

        const shortcutGuard = await evaluate(`(() => {
            const input = document.getElementById('hierarchy-search');
            input.focus(); input.value = ''; return window.Editor.instance.scene.toJSON();
        })()`);
        await type('w');
        await key('N', ['control', 'shift']);
        const guarded = await evaluate(`(() => ({ bytes: window.Editor.instance.scene.toJSON(), value: document.activeElement?.value, tag: document.activeElement?.tagName }))()`);
        record('global authoring shortcuts are suppressed during text editing', guarded.bytes === shortcutGuard && guarded.value === 'w', JSON.stringify({ value: guarded.value, tag: guarded.tag }));
        await key('Escape');

        await evaluate(`(() => {
            console.warn('TUG-112 retained keyboard console entry');
            window.Editor.instance.consoleWindow?.refresh?.();
            document.getElementById('tab-assets')?.focus();
        })()`);
        await wait(150);
        const projectTabFocus = await evaluate(`(() => {
            const before = document.activeElement?.id;
            const tab = document.getElementById('tab-assets');
            document.activeElement?.blur?.();
            tab?.focus();
            return { before, active: document.activeElement?.id, tabIndex: tab?.tabIndex, visible: tab?.offsetParent !== null };
        })()`);
        record('Project tab accepts deterministic focus entry', projectTabFocus.active === 'tab-assets', JSON.stringify(projectTabFocus));
        // Electron's native input keyCode vocabulary uses RIGHT; Chromium
        // exposes the resulting DOM KeyboardEvent.key as ArrowRight.
        await key('RIGHT');
        const consoleTabFocus = await evaluate(`(() => ({
            active: document.activeElement?.id,
            consoleParent: document.getElementById('tab-console')?.parentElement?.id,
            projectParent: document.getElementById('tab-assets')?.parentElement?.id
        }))()`);
        record('native tablist navigation reaches Console tab', consoleTabFocus.active === 'tab-console', JSON.stringify(consoleTabFocus));
        await key('Enter');
        await wait(150);
        const consoleTab = await evaluate(`(() => ({
            selected: document.getElementById('tab-console')?.getAttribute('aria-selected'),
            visible: getComputedStyle(document.getElementById('console-content')).display !== 'none'
        }))()`);
        record('Console tab activates through native tablist keys', consoleTab.selected === 'true' && consoleTab.visible, JSON.stringify(consoleTab));
        await evaluate("document.querySelector('#console-content .console-log-container')?.focus()");
        await key('End');
        const selectedLog = await evaluate("Boolean(document.querySelector('.console-item[aria-selected=\"true\"]'))");
        record('Console entry is keyboard selectable', selectedLog, 'End selects the last visible log');
        await capture('console-selection-focus');
        await evaluate("document.querySelector('#console-content .console-toolbar button')?.focus()");
        await key('SPACE');
        await wait(100);
        const consoleCleared = await evaluate("window.Editor.instance.consoleWindow?.logs?.length === 0");
        record('Console Clear is keyboard operable', consoleCleared, 'native Space on focused Clear');

        await evaluate("document.getElementById('hierarchy-content')?.focus()");
        await key('S', ['control']);
        for (let attempt = 0; attempt < 80; attempt += 1) {
            if (await evaluate("window.Editor.instance.dirtyState?.isDirty === false")) break;
            await wait(100);
        }
        const saved = await evaluate("window.Editor.instance.dirtyState?.isDirty === false");
        record('native Save reaches a clean checkpoint', saved, 'Ctrl+S');
        await capture('saved-clean-focus');
    }

    const result = {
        ok: failures.length === 0,
        phase,
        checks,
        failures,
        app: { name: require('../../package.json').productName || 'Tugberk Engine', version: appVersion(), packaged: require('electron').app.isPackaged },
        platform: { platform: process.platform, release: require('node:os').release(), scaleFactor: mainWindow.webContents.getZoomFactor(), bounds: mainWindow.getBounds() }
    };
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    setTimeout(() => require('electron').app.exit(result.ok ? 0 : 1), 200);
}

function appVersion() {
    return require('electron').app.getVersion();
}

module.exports = { runPhase2KeyboardHarness };
