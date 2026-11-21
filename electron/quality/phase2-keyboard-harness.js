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
    const uncaughtRendererErrors = [];
    webContents.on('console-message', (event) => {
        if (event.level === 'error' && /^Uncaught\b/.test(event.message)) {
            uncaughtRendererErrors.push({ message: event.message, source: event.sourceId, line: event.lineNumber });
        }
    });
    if (phase === 'layout-bounds' || phase === 'layout-negative') {
        mainWindow.setContentSize(900, 600);
        webContents.setZoomFactor(1.5);
    }
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

    const layoutState = () => evaluate(`(() => {
        const panel = document.getElementById('hierarchy-panel');
        const rect = panel.getBoundingClientRect();
        const header = panel.querySelector('.panel-window-dock').getBoundingClientRect();
        return { floating: panel.classList.contains('floating-panel'),
            pressed: panel.querySelector('.panel-window-dock')?.getAttribute('aria-pressed'),
            width: rect.width, height: rect.height, x: rect.x, y: rect.y,
            visible: rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.x < innerWidth && rect.y < innerHeight,
            headerAccessible: header.width > 0 && header.height > 0 && header.x >= 0 && header.y >= 0 && header.right <= innerWidth && header.bottom <= innerHeight,
            viewportWidth: innerWidth, viewportHeight: innerHeight };
    })()`);
    const stageFloating = (geometry) => evaluate(`(() => {
        const key = 'tugberkengine_editor_settings';
        const saved = JSON.parse(localStorage.getItem(key + '_lkg'));
        saved.floatingPanels['hierarchy-panel'] = ${JSON.stringify({ floating: true, ...geometry })};
        localStorage.setItem(key, JSON.stringify(saved));
        return true;
    })()`);
    const floatingGesture = async (resize, cancellation = 'Escape') => {
        let focusSink = null;
        if (cancellation === 'blur') {
            const { BrowserWindow } = require('electron');
            focusSink = new BrowserWindow({ width: 240, height: 120, show: false,
                skipTaskbar: true, title: 'Layout qualification focus target',
                webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } });
            await focusSink.loadURL('data:text/html,<title>Layout qualification focus target</title>');
        }
        mainWindow.focus(); webContents.focus();
        await wait(200);
        if (cancellation === 'blur') {
            record('native window is focused before blur gesture', mainWindow.isFocused() && webContents.isFocused(), 'focus transition completed');
            await evaluate("window.__layoutBlurCount = 0; window.addEventListener('blur', () => { window.__layoutBlurCount += 1; }, { once: true })");
        }
        const before = await layoutState();
        const saved = await evaluate("localStorage.getItem('tugberkengine_editor_settings')");
        const selector = resize ? '#hierarchy-panel .floating-resize-handle' : '#hierarchy-panel-header';
        const point = await evaluate(`(() => { const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
            return { x:r.x+${resize ? 'r.width/2' : '20'}, y:r.y+r.height/2 }; })()`);
        const start = { x: Math.round(point.x), y: Math.round(point.y) };
        // Release the move over the workspace, clear of the left-side dock guide.
        const end = { x: start.x + (!resize && cancellation === 'release' ? 360 : 40), y: start.y + 25 };
        webContents.sendInputEvent({ type: 'mouseDown', ...start, button: 'left', clickCount: 1 });
        webContents.sendInputEvent({ type: 'mouseMove', ...end, button: 'left', modifiers: ['leftButtonDown'] });
        await wait(100);
        const during = await layoutState();
        if (cancellation === 'release') {
            record('floating gesture keeps saved layout unchanged before release',
                saved === await evaluate("localStorage.getItem('tugberkengine_editor_settings')"), JSON.stringify({ before, during }));
        }
        if (cancellation === 'blur') {
            focusSink.show(); focusSink.focus(); focusSink.webContents.focus(); await wait(200);
            record('native window blur reaches renderer', await evaluate('window.__layoutBlurCount > 0'), 'actual window blur event');
        }
        else if (cancellation === 'Escape') await key('ESCAPE');
        webContents.sendInputEvent({ type: 'mouseUp', ...end, button: 'left', clickCount: 1 });
        focusSink?.destroy();
        mainWindow.focus(); webContents.focus();
        await wait(100);
        const after = await layoutState();
        const fields = resize ? ['width', 'height'] : ['x', 'y'];
        record(`native floating ${resize ? 'resize' : 'move'} mutates live geometry`, fields.some((field) => Math.abs(during[field]-before[field]) >= 10), JSON.stringify({ before, during }));
        if (cancellation === 'release') {
            const persisted = await evaluate("JSON.parse(localStorage.getItem('tugberkengine_editor_settings')).floatingPanels['hierarchy-panel']");
            record(`pointer release saves floating ${resize ? 'resize' : 'move'}`,
                after.floating && persisted.floating && fields.every((field) => Math.abs(after[field] - during[field]) < 2)
                && saved !== await evaluate("localStorage.getItem('tugberkengine_editor_settings')"), JSON.stringify({ during, after, persisted }));
            return after;
        }
        record(`${cancellation} restores floating ${resize ? 'resize' : 'move'} without persistence`, fields.every((field) => Math.abs(after[field]-before[field]) < 2)
            && saved === await evaluate("localStorage.getItem('tugberkengine_editor_settings')"), JSON.stringify({ before, after }));
        await capture(`floating-${resize ? 'resize' : 'move'}-${cancellation}-cancel`);
    };
    if (phase !== 'author') {
        const state = await evaluate(`(() => {
            const editor = window.Editor.instance;
            const visit = (items) => items.flatMap((item) => [item, ...visit(item.transform?.children?.map((child) => child.gameObject) ?? [])]);
            const objects = visit(editor.scene.gameObjects ?? []);
            return { names: objects.map((item) => item.name), clean: editor.dirtyState?.isDirty === false };
        })()`);
        record('keyboard-authored nested objects persist after relaunch', state.names.includes('Keyboard Root') && state.names.includes('Keyboard Child'), JSON.stringify(state));
        await evaluate("document.getElementById('hierarchy-content')?.focus()");
        await capture('reopen-persisted-focus');
        const layout = await layoutState();
        const expectedFloating = ['reopen', 'layout-bounds', 'layout-negative', 'tab-dock', 'tab-dock-reopen'].includes(phase);
        record('panel layout persists across packaged restart', layout.floating === expectedFloating
            && layout.pressed === String(expectedFloating) && layout.visible, JSON.stringify(layout));
        if (phase === 'reopen') {
            const committed = await evaluate("JSON.parse(localStorage.getItem('v1-floating-release-geometry'))");
            record('pointer-committed geometry survives packaged restart', committed &&
                ['x', 'y', 'width', 'height'].every((field) => Math.abs(layout[field] - committed[field]) < 2),
                JSON.stringify({ committed, layout }));
            await floatingGesture(false);
            await floatingGesture(true);
            await floatingGesture(false, 'blur');
            await floatingGesture(true, 'blur');
            mainWindow.focus();
            webContents.focus();
            await evaluate("document.querySelector('#hierarchy-panel .panel-window-dock')?.focus()");
            const focused = await evaluate("document.activeElement === document.querySelector('#hierarchy-panel .panel-window-dock')");
            record('floating panel dock button receives keyboard focus', focused, 'DOM focus survives floating panel activation');
            record('floating document receives native keyboard input', await evaluate('document.hasFocus()'), 'webContents focused after accessibility capture');
            await key('SPACE');
            const docked = await layoutState();
            record('native keyboard panel button restores docked layout', !docked.floating && docked.visible, JSON.stringify(docked));
            const pointIn = (selector, inset) => evaluate(`(() => {
                const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
                return { x: Math.round(r.left + (${inset} ?? r.width / 2)), y: Math.round(r.top + r.height / 2) };
            })()`);
            for (const side of ['left', 'right']) {
            await evaluate("document.querySelector('#hierarchy-panel .panel-window-dock').focus()");
            await key('SPACE');
            const start = await pointIn('#hierarchy-panel-header', 20);
            webContents.sendInputEvent({ type: 'mouseDown', ...start, button: 'left', clickCount: 1 });
            webContents.sendInputEvent({ type: 'mouseMove', x: start.x + 12, y: start.y + 8, modifiers: ['leftButtonDown'] });
            await wait(100);
            const guide = `#floating-dock-guide-hierarchy-panel-${side}`;
            const target = await pointIn(guide, null);
            webContents.sendInputEvent({ type: 'mouseMove', ...target, modifiers: ['leftButtonDown'] });
            await wait(100);
            record(`pointer activates ${side} dock guide before release`,
                await evaluate(`document.querySelector('${guide}').classList.contains('active')`), JSON.stringify(target));
            webContents.sendInputEvent({ type: 'mouseUp', ...target, button: 'left', clickCount: 1 });
            await wait(100);
            const pointerDocked = await layoutState();
            const dockSaved = await evaluate(`(() => {
                const saved = JSON.parse(localStorage.getItem('tugberkengine_editor_settings'));
                return !saved.floatingPanels['hierarchy-panel'].floating && saved.sidePanelSlots['hierarchy-panel'] === '${side}';
            })()`);
            record(`pointer drop docks hierarchy on the ${side} and saves layout`,
                !pointerDocked.floating && pointerDocked.visible && dockSaved, JSON.stringify(pointerDocked));
            }
        }
        if (phase === 'tab-dock') {
            webContents.setZoomFactor(1);
            mainWindow.focus();
            webContents.focus();
            await evaluate("document.querySelector('#assets-panel .panel-window-dock').focus()");
            await key('SPACE');
            const start = await evaluate(`(() => {
                const r = document.getElementById('bottom-panel-header').getBoundingClientRect();
                const y = Math.round(r.top + r.height / 2);
                for (let x = Math.ceil(r.right) - 4; x > r.left; x -= 4) {
                    if (document.elementFromPoint(x, y)?.id === 'bottom-panel-header') return { x, y };
                }
                throw new Error('No unobstructed bottom panel header point');
            })()`);
            webContents.sendInputEvent({ type: 'mouseDown', ...start, button: 'left', clickCount: 1 });
            webContents.sendInputEvent({ type: 'mouseMove', x: start.x, y: start.y - 12, modifiers: ['leftButtonDown'] });
            await wait(100);
            const target = await evaluate(`(() => {
                const r = document.getElementById('floating-dock-guide-assets-panel-viewport').getBoundingClientRect();
                return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
            })()`);
            webContents.sendInputEvent({ type: 'mouseMove', ...target, modifiers: ['leftButtonDown'] });
            await wait(100);
            record('pointer activates viewport dock guide', await evaluate("document.getElementById('floating-dock-guide-assets-panel-viewport').classList.contains('active')"), JSON.stringify(target));
            webContents.sendInputEvent({ type: 'mouseUp', ...target, button: 'left', clickCount: 1 });
            await wait(150);
        }
        if (phase === 'tab-dock' || phase === 'tab-dock-reopen') {
            const tabHost = await evaluate(`(() => ({
                parent: document.getElementById('tab-assets').parentElement.id,
                saved: JSON.parse(localStorage.getItem('tugberkengine_editor_settings')).viewHosts.project
            }))()`);
            record('Project tab is hosted and saved in viewport', tabHost.parent === 'viewport-dock-tabs' && tabHost.saved === 'viewport', JSON.stringify(tabHost));
        }
        await capture('layout-restart-state');
        if (phase === 'layout-recovery') {
            const expectedWidth = await evaluate("Number(localStorage.getItem('v1-layout-recovery-width'))");
            record('recovery restores the saved nondefault panel width', expectedWidth > 0 && Math.abs(layout.width - expectedWidth) < 2,
                JSON.stringify({ expectedWidth, actualWidth: layout.width }));
            record('oversized offscreen floating fixture staged', await stageFloating({ x: 50000, y: 50000, width: 9000, height: 9000 }), 'isolated settings');
        }
        if (phase === 'layout-bounds' || phase === 'layout-negative') {
            record('floating panel controls remain accessible in reduced zoomed viewport', layout.floating && layout.headerAccessible, JSON.stringify(layout));
            if (phase === 'layout-bounds') record('negative-coordinate floating fixture staged', await stageFloating({ x: -50000, y: -50000, width: 400, height: 350 }), 'isolated settings');
        }
        if (phase === 'layout-reopen') {
            mainWindow.focus(); webContents.focus();
            const inspectorX = await evaluate("document.getElementById('inspector-panel').getBoundingClientRect().x");
            record('right-docked hierarchy restores to the right of Inspector', layout.x > inspectorX, JSON.stringify({ layout, inspectorX }));
            await evaluate("document.getElementById('right-splitter')?.focus()");
            const beforeResize = await layoutState();
            await key('LEFT', ['shift']);
            const afterResize = await layoutState();
            record('recovery fixture has nondefault native splitter geometry', Math.abs(afterResize.width - beforeResize.width) >= 10, JSON.stringify({ beforeResize, afterResize }));
            await evaluate(`localStorage.setItem('v1-layout-recovery-width', ${afterResize.width})`);
            const staged = await evaluate(`(() => {
                const key = 'tugberkengine_editor_settings';
                const backup = localStorage.getItem(key + '_lkg');
                if (!backup) return false;
                const saved = JSON.parse(backup);
                const primary = JSON.parse(localStorage.getItem(key));
                localStorage.setItem(key, '{broken-layout-primary');
                return { staged: localStorage.getItem(key) === '{broken-layout-primary',
                    primaryWidths: primary.sidePanelWidths, backupWidths: saved.sidePanelWidths,
                    primaryLegacy: primary.hierarchyWidth, backupLegacy: saved.hierarchyWidth };
            })()`);
            record('corrupt primary layout staged with valid recovery backup', staged?.staged === true, JSON.stringify(staged));
        }
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
        await evaluate("document.querySelector('#hierarchy-panel .panel-window-dock')?.focus()");
        await key('SPACE');
        const floating = await layoutState();
        record('native panel button floats hierarchy within viewport', floating.floating && floating.pressed === 'true' && floating.visible, JSON.stringify(floating));
        await capture('floating-hierarchy');
        await floatingGesture(false, 'release');
        const committed = await floatingGesture(true, 'release');
        await evaluate(`localStorage.setItem('v1-floating-release-geometry', JSON.stringify(${JSON.stringify(committed)}))`);
    }

    record('renderer completes without uncaught exceptions', uncaughtRendererErrors.length === 0,
        JSON.stringify(uncaughtRendererErrors));
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
