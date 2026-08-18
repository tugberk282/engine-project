const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('node:crypto');
const { atomicWriteJson, atomicWriteText, contentHash } = require('./architecture/persistence');
const { ProjectCapabilities, normalizeWriteData } = require('./security/project-capabilities');
const { ConfinedFileSystem } = require('./security/confined-filesystem');
const { ProjectTrustStore } = require('./security/project-trust');
const { TrustGatedExecutionBroker } = require('./security/execution-broker');
const { writeRecovery, readRecovery, discardRecovery } = require('./architecture/recovery');
const {
    COMMANDS,
} = require('./architecture/contract');
const { createVersionedHandler } = require('./architecture/ipc-router');
const { ProtocolGrants } = require('./architecture/protocol-grants');
const { ProjectService } = require('./platform/project-service');
const { AssetService } = require('./platform/asset-service');
const { ProjectAssetTransactionService } = require('./platform/project-asset-transaction-service');
const { RecentProjectService } = require('./platform/recent-project-service');
const { DiagnosticStore } = require('./diagnostics/diagnostic-store');
const { ShutdownCoordinator } = require('./lifecycle/shutdown-coordinator');
const { StartupRecovery } = require('./lifecycle/startup-recovery');
const { RuntimeSupervisor } = require('./runtime/runtime-supervisor');

const projectCapabilities = new ProjectCapabilities();
const confinedFileSystem = new ConfinedFileSystem();
const protocolGrants = new ProtocolGrants(projectCapabilities);
const projectService = new ProjectService({ grants: protocolGrants });
const assetService = new AssetService({ projectService });
const projectAssetTransactions = new ProjectAssetTransactionService({ projectService });
const protocolGrantCleanupSenders = new Set();
const assetScansByOwner = new Map();
let editorWebContentsId = null;
let projectTrustStore = null;
let editorDirty = false;
let closePromptActive = false;
let allowEditorClose = false;
const DEVELOPMENT_RENDERER_ORIGIN = 'http://localhost:5174';
const RENDERER_AUTH_FRAGMENT = '__tugberk_renderer_auth';

if (typeof process.env.ENGINE_USER_DATA_PATH === 'string' && process.env.ENGINE_USER_DATA_PATH.length > 0) {
    app.setPath('userData', path.resolve(process.env.ENGINE_USER_DATA_PATH));
}

const recentProjectService = new RecentProjectService(
    path.join(app.getPath('userData'), 'recent-projects.json')
);
const diagnostics = new DiagnosticStore({
    directory: path.join(app.getPath('userData'), 'diagnostics')
});
const startupRecovery = new StartupRecovery(path.join(app.getPath('userData'), 'startup-state.json'));
const startupDecision = startupRecovery.begin();
const shutdownCoordinator = new ShutdownCoordinator({
    onEvent: (event) => diagnostics.record({ processRole: 'main', ...event })
});
const runtimeSupervisor = new RuntimeSupervisor({
    onDiagnostic: (event) => diagnostics.record({ processRole: 'runtime', ...event })
});
const executionBroker = new TrustGatedExecutionBroker({
    trustStore: { get: (projectPath) => getProjectTrustStore().get(projectPath) }
});
shutdownCoordinator.register('protocol-grants', async () => protocolGrants.revokeAll());
shutdownCoordinator.register('play-runtime', async () => runtimeSupervisor.shutdown());
shutdownCoordinator.register('project-execution', async () => executionBroker.shutdown());
shutdownCoordinator.register('startup-marker', async () => startupRecovery.markClean());
diagnostics.record({
    processRole: 'main',
    operation: 'startup',
    outcome: startupDecision.safeMode ? 'safe-mode' : 'normal',
    details: startupDecision
});

function getTrustedProjectsStorePath() {
    return path.join(app.getPath('userData'), 'trusted-project-roots.json');
}

function getProjectTrustStore() {
    if (!projectTrustStore) projectTrustStore = new ProjectTrustStore(getTrustedProjectsStorePath());
    return projectTrustStore;
}

function openProjectInCurrentTrustMode(projectPath, { grant = false } = {}) {
    const root = grant ? projectPath : projectCapabilities.requireRoot(projectPath);
    const status = getProjectTrustStore().get(root);
    projectCapabilities.grant(status.root, {
        writable: status.trusted || process.env.ENGINE_SMOKE_TEST === '1'
    });
    return status;
}

function requireEditorSender(event) {
    if (!event?.sender || event.sender.id !== editorWebContentsId || event.sender.isDestroyed()) {
        throw Object.assign(new Error('IPC request rejected: untrusted sender'), { code: 'UNTRUSTED_SENDER' });
    }
}

function createProtocolGrant(sender, projectPath, options) {
    const grant = protocolGrants.create(sender.id, projectPath, options);
    if (!protocolGrantCleanupSenders.has(sender.id)) {
        protocolGrantCleanupSenders.add(sender.id);
        sender.once('destroyed', () => {
            abortAssetScansForOwner(sender.id);
            protocolGrants.revokeAllForOwner(sender.id);
            protocolGrantCleanupSenders.delete(sender.id);
        });
    }
    return grant;
}

function validateProjectRoot(projectPath) {
    let status;
    try {
        status = getProjectTrustStore().get(projectPath);
    } catch (error) {
        throw Object.assign(new Error('Project folder does not exist or cannot be opened'), {
            code: 'PROJECT_NOT_FOUND', cause: error
        });
    }
    const manifestPath = path.join(status.root, 'project.json');
    try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.scenes)) throw new Error();
    } catch (error) {
        throw Object.assign(new Error('Folder is not a valid Tugberk Engine project'), {
            code: 'PROJECT_INVALID', cause: error
        });
    }
    return status;
}

function protocolProjectResult(sender, status) {
    const grant = createProtocolGrant(sender, status.root, {
        writable: status.trusted || process.env.ENGINE_SMOKE_TEST === '1'
    });
    return { grantId: grant.grantId, root: status.root, name: path.basename(status.root), trust: status };
}

async function requestTrust(event, projectPath) {
    const status = getProjectTrustStore().get(projectPath);
    if (status.trusted) return status;
    const result = await dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender), {
        type: 'warning', buttons: ['Open in Safe Mode', 'Trust Project'], defaultId: 0, cancelId: 0,
        noLink: true, title: 'Trust this project?', message: `Trust “${path.basename(status.root)}”?`,
        detail: 'Trusted projects may write files and run project scripts, packages, plugins, and build steps. Only trust projects whose contents and dependencies you understand.'
    });
    return result.response === 1 ? getProjectTrustStore().trust(status.root) : status;
}

function initializeProjectStructure(projectPath) {
    const root = getProjectTrustStore().get(projectPath).root;
    for (const folder of ['Assets', 'Assets/Scenes', 'Assets/Scripts', 'Assets/Materials', 'ProjectSettings', 'Library', 'Temp']) {
        fs.mkdirSync(path.join(root, folder), { recursive: true });
    }
    const scenePath = path.join(root, 'Assets', 'Scenes', 'SampleScene.json');
    let sceneId = randomUUID();
    if (!fs.existsSync(scenePath)) atomicWriteJson(scenePath, { formatVersion: 1, sceneId, name: 'SampleScene', version: '1.4', environment: {}, gameObjects: [] });
    else {
        try { sceneId = JSON.parse(fs.readFileSync(scenePath, 'utf8')).sceneId || sceneId; } catch {}
    }
    const manifest = { formatVersion: 1, projectId: randomUUID(), name: path.basename(root), scenes: [{ sceneId, path: 'Assets/Scenes/SampleScene.json' }] };
    for (const manifestPath of [path.join(root, 'project.json'), path.join(root, 'ProjectSettings', 'Project.json')]) {
        if (!fs.existsSync(manifestPath)) atomicWriteJson(manifestPath, manifest);
    }
    return root;
}

function abortAssetScansForOwner(ownerId) {
    const scans = assetScansByOwner.get(ownerId);
    if (!scans) return;
    for (const controller of scans.values()) controller.abort();
    assetScansByOwner.delete(ownerId);
}

async function executeAssetScan(event, request) {
    let scans = assetScansByOwner.get(event.sender.id);
    if (!scans) {
        scans = new Map();
        assetScansByOwner.set(event.sender.id, scans);
    }
    const controller = new AbortController();
    scans.set(request.requestId, controller);
    try {
        return await assetService.scan(event.sender.id, request.payload, {
            signal: controller.signal,
            onProgress: (progress) => {
                if (!event.sender.isDestroyed()) {
                    event.sender.send('tugberk:v1:asset-scan-progress', request.requestId, progress);
                }
            }
        });
    } finally {
        scans.delete(request.requestId);
        if (scans.size === 0) assetScansByOwner.delete(event.sender.id);
    }
}

function resolveProtocolPath(sender, grantId, relativePath, options) {
    return protocolGrants.resolve(sender.id, grantId, relativePath, options);
}

async function writeWithCapabilityLease(targetPath, data, encoding) {
    const lease = projectCapabilities.lease();
    await confinedFileSystem.atomicWrite(
        projectCapabilities.authorizeMutation(targetPath),
        data,
        encoding,
        () => projectCapabilities.assertLease(lease)
    );
    projectCapabilities.assertLease(lease);
}

async function copyWithCapabilityLease(sourcePath, targetPath) {
    const lease = projectCapabilities.lease();
    await confinedFileSystem.copy(
        projectCapabilities.authorizeMutation(sourcePath, { mustExist: true, write: false }),
        projectCapabilities.authorizeMutation(targetPath)
    );
    projectCapabilities.assertLease(lease);
}

async function executeProtocolCommand(event, request) {
    switch (request.command) {
        case COMMANDS.DIALOG_OPEN_PROJECT: {
            const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
                title: 'Open Project',
                properties: ['openDirectory']
            });
            if (result.canceled || !result.filePaths[0]) return { canceled: true };
            const trust = await requestTrust(event, validateProjectRoot(result.filePaths[0]).root);
            return { canceled: false, ...protocolProjectResult(event.sender, trust) };
        }
        case COMMANDS.DIALOG_CREATE_PROJECT: {
            const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
                title: 'Select Folder for New Project', properties: ['openDirectory', 'createDirectory']
            });
            if (result.canceled || !result.filePaths[0]) return { canceled: true };
            const trust = await requestTrust(event, result.filePaths[0]);
            if (!trust.trusted) throw Object.assign(new Error('Project creation requires trust'), { code: 'TRUST_CANCELLED' });
            initializeProjectStructure(trust.root);
            return { canceled: false, ...protocolProjectResult(event.sender, trust) };
        }
        case COMMANDS.PROJECT_OPEN:
            return protocolProjectResult(event.sender, validateProjectRoot(request.payload.path));
        case COMMANDS.PROJECT_GET_TRUST:
            return protocolProjectResult(event.sender, validateProjectRoot(request.payload.path));
        case COMMANDS.PROJECT_REQUEST_TRUST: {
            const status = validateProjectRoot(request.payload.path);
            return protocolProjectResult(event.sender, await requestTrust(event, status.root));
        }
        case COMMANDS.PROJECT_REVOKE_TRUST: {
            const status = getProjectTrustStore().revoke(request.payload.path);
            await executionBroker.revokeProject(status.root);
            protocolGrants.revokeAllForOwner(event.sender.id);
            return protocolProjectResult(event.sender, status);
        }
        case COMMANDS.RECENT_PROJECTS_LOAD:
            return recentProjectService.load();
        case COMMANDS.RECENT_PROJECTS_SAVE:
            return recentProjectService.save(request.payload.projects);
        case COMMANDS.PROJECT_READ_TEXT: {
            return projectService.readText(event.sender.id, request.payload);
        }
        case COMMANDS.PROJECT_WRITE_TEXT: {
            return projectService.writeText(event.sender.id, request.payload, request.payload.content);
        }
        case COMMANDS.PROJECT_LIST_DIRECTORY: {
            return projectService.listDirectory(event.sender.id, request.payload);
        }
        case COMMANDS.ASSET_SCAN:
            return executeAssetScan(event, request);
        case COMMANDS.ASSET_CANCEL_SCAN: {
            assetScansByOwner.get(event.sender.id)?.get(request.payload.scanRequestId)?.abort();
            return true;
        }
        case COMMANDS.ASSET_MOVE:
            return assetService.move(
                event.sender.id,
                request.payload,
                { grantId: request.payload.grantId, path: request.payload.destinationPath }
            );
        case COMMANDS.ASSET_TRANSACTION:
            return projectAssetTransactions.transact(event.sender.id, request.payload);
        case COMMANDS.ASSET_WRITE_METADATA:
            return assetService.writeMetadata(event.sender.id, request.payload, request.payload.metadata);
        case COMMANDS.PROJECT_REVOKE_GRANT:
            abortAssetScansForOwner(event.sender.id);
            protocolGrants.revoke(event.sender.id, request.payload.grantId);
            return true;
        case COMMANDS.TELEMETRY_RECORD:
            console.info(JSON.stringify({
                type: 'renderer-telemetry',
                name: request.payload.name,
                fields: request.payload.fields,
                requestId: request.requestId
            }));
            return true;
        case COMMANDS.RUNTIME_START:
            return runtimeSupervisor.start(request.payload.snapshot);
        case COMMANDS.RUNTIME_PAUSE:
            return runtimeSupervisor.pause();
        case COMMANDS.RUNTIME_RESUME:
            return runtimeSupervisor.resume();
        case COMMANDS.RUNTIME_TICK:
            return runtimeSupervisor.tick(request.payload.deltaTime);
        case COMMANDS.RUNTIME_STOP:
            return runtimeSupervisor.stop();
        default:
            throw Object.assign(new Error('Unknown command'), { code: 'UNKNOWN_COMMAND' });
    }
}

ipcMain.handle('tugberk:v1:request', createVersionedHandler({
    authenticate: requireEditorSender,
    execute: executeProtocolCommand,
    onDiagnostic: (event) => diagnostics.record(event)
}));

async function runSmokeTest(mainWindow) {
    const outputPath = process.env.ENGINE_SMOKE_TEST_OUTPUT
        || path.join(process.cwd(), 'smoke-test-result.json');
    const expectLauncherFailure = process.env.ENGINE_SMOKE_EXPECT_LAUNCHER_FAILURE === '1';
    const expectedSceneTransaction = process.env.ENGINE_SMOKE_EXPECT_SCENE_TRANSACTION || null;
    if (!expectLauncherFailure && process.env.ENGINE_AUTO_OPEN_PROJECT_PATH) {
        projectCapabilities.setWritable(process.env.ENGINE_AUTO_OPEN_PROJECT_PATH, true);
    }
    const result = await mainWindow.webContents.executeJavaScript(`
        (async () => {
            const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const failures = [];
            const checks = [];
            const record = (name, pass, details) => {
                checks.push({ name, pass, details });
                if (!pass) failures.push({ name, details });
            };
            const commandRevision = (editor) => Number(editor?.dirtyState?.commandRevision);
            const dispatchHistoryShortcut = async (key, shiftKey = false) => {
                window.dispatchEvent(new KeyboardEvent('keydown', {
                    key,
                    code: key === 'z' ? 'KeyZ' : 'KeyY',
                    ctrlKey: true,
                    shiftKey,
                    bubbles: true,
                    cancelable: true
                }));
                await wait(75);
            };
            const sceneIdentity = (scene) => {
                const parsed = JSON.parse(scene.toJSON());
                const objects = Array.isArray(parsed.gameObjects) ? parsed.gameObjects : [];
                const identity = [];
                const visit = (entry, parentId, siblingIndex) => {
                    identity.push({ id: entry.id, name: entry.name, parentId, siblingIndex });
                    const children = Array.isArray(entry.children) ? entry.children : [];
                    children.forEach((child, index) => visit(child, entry.id, index));
                };
                objects.forEach((entry, index) => visit(entry, null, index));
                return identity;
            };

            const getEditor = () => window.Editor?.instance ?? null;
            const waitForEditor = async () => {
                for (let i = 0; i < ${expectLauncherFailure ? 40 : 120}; i += 1) {
                    const editor = getEditor();
                    if (editor?.scene && document.getElementById('hierarchy-content')) {
                        return editor;
                    }
                    await wait(100);
                }
                return null;
            };

            const editor = await waitForEditor();
            if (!editor) {
                const launcher = document.getElementById('launcher-container');
                const launcherStatus = document.getElementById('launcher-status');
                const launcherVisible = !!launcher && getComputedStyle(launcher).display !== 'none';
                const failureVisible = launcherStatus?.classList.contains('error') === true
                    && (launcherStatus.textContent?.trim().length ?? 0) > 0;
                if (${JSON.stringify(expectLauncherFailure)}) {
                    return {
                        ok: launcherVisible && failureVisible,
                        failures: launcherVisible && failureVisible ? [] : [{
                            name: 'launcher failure remains recoverable',
                            details: 'launcherVisible=' + launcherVisible + ', status=' + (launcherStatus?.textContent ?? '')
                        }],
                        checks: [
                            { name: 'launcher remains visible after project failure', pass: launcherVisible },
                            { name: 'launcher exposes visible project failure', pass: failureVisible }
                        ],
                        snapshot: {
                            launchError: window.__engineLaunchError ?? null,
                            launcherVisible,
                            launcherStatus: launcherStatus?.textContent ?? null
                        }
                    };
                }
                return {
                    ok: false,
                    failures: [{ name: 'editor booted', details: 'Editor instance was not created' }],
                    checks: [],
                    snapshot: {
                        hasElectronApi: !!window.electronAPI,
                        bootstrapError: window.__engineBootstrapError ?? null,
                        launchError: window.__engineLaunchError ?? null,
                        launchArgs: window.electronAPI?.launchArgs ?? null,
                        launcherVisible: getComputedStyle(document.getElementById('launcher-container')).display,
                        editorVisible: getComputedStyle(document.getElementById('editor-container')).display,
                        launcherProjectListCount: document.querySelectorAll('#launcher-project-list .project-item').length,
                        appText: document.body.innerText.slice(0, 500)
                    }
                };
            }
            await wait(250);

            const expectedTransaction = ${JSON.stringify(expectedSceneTransaction)};
            if (expectedTransaction) {
                const expected = JSON.parse(expectedTransaction);
                const actualIdentity = sceneIdentity(editor.scene);
                record('saved scene transaction survives editor relaunch with stable IDs and order',
                    JSON.stringify(actualIdentity) === JSON.stringify(expected.identity),
                    'Expected ' + expected.identity.length + ' serialized objects after relaunch; found ' + actualIdentity.length);
                return {
                    ok: failures.length === 0,
                    failures,
                    checks,
                    snapshot: { identity: actualIdentity }
                };
            }

            const sceneView = document.getElementById('scene-view');
            const hierarchyContent = document.getElementById('hierarchy-content');
            const inspectorContent = document.getElementById('inspector-content');
            const initialObjects = Array.isArray(editor.scene?.gameObjects) ? editor.scene.gameObjects.length : -1;
            const beforeCreateBytes = editor.scene.toJSON();
            const beforeCreateRevision = commandRevision(editor);
            record('editor booted', !!editor, 'window.Editor.instance exists');
            record('scene view exists', !!sceneView, '#scene-view present');
            record('hierarchy content exists', !!hierarchyContent, '#hierarchy-content present');
            record('inspector content exists', !!inspectorContent, '#inspector-content present');
            record('default scene objects visible to runtime', initialObjects >= 2, 'scene.gameObjects should contain demo scene + editor camera');

            document.getElementById('hierarchy-add-btn')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await wait(100);
            const cubeItem = Array.from(document.querySelectorAll('#hierarchy-context-menu div'))
                .find((node) => node.textContent?.trim() === 'Cube');
            record('hierarchy create menu opens', !!cubeItem, 'Cube item visible after pressing +');
            cubeItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await wait(150);

            const afterCreateObjects = Array.isArray(editor.scene?.gameObjects) ? editor.scene.gameObjects.length : -1;
            const hierarchyLabels = Array.from(document.querySelectorAll('#hierarchy-content [data-id] span'))
                .map((node) => node.textContent?.trim())
                .filter(Boolean);
            const selected = editor.getSelectedGameObjects?.() ?? [];
            const createdCube = selected[selected.length - 1] ?? null;

            record('cube creation changes scene object count', afterCreateObjects > initialObjects, 'scene object count should increase');
            record('cube becomes active selection', createdCube?.name === 'Cube', createdCube ? 'Cube selected' : 'no selected object');
            record('hierarchy renders created cube row', hierarchyLabels.includes('Cube'), 'Cube label should appear in hierarchy');
            const afterCreateBytes = editor.scene.toJSON();
            const afterCreateRevision = commandRevision(editor);
            await dispatchHistoryShortcut('z');
            const createUndoPass = editor.scene.toJSON() === beforeCreateBytes
                && commandRevision(editor) === beforeCreateRevision;
            await dispatchHistoryShortcut('y');
            record('rendered create is exactly one undo unit',
                afterCreateRevision === beforeCreateRevision + 1
                    && createUndoPass
                    && editor.scene.toJSON() === afterCreateBytes
                    && commandRevision(editor) === afterCreateRevision,
                beforeCreateRevision + ' -> ' + afterCreateRevision + ' with byte-identical undo/redo');

            hierarchyContent?.focus();
            const beforeKeyboardCreate = editor.scene.gameObjects.length;
            const beforeKeyboardCreateBytes = editor.scene.toJSON();
            const beforeKeyboardCreateRevision = commandRevision(editor);
            window.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'N', code: 'KeyN', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true
            }));
            await wait(100);
            const keyboardCreated = (editor.getSelectedGameObjects?.() ?? []).at(-1) ?? null;
            record('keyboard shortcut creates and selects GameObject',
                editor.scene.gameObjects.length === beforeKeyboardCreate + 1 && keyboardCreated?.name === 'New GameObject',
                'Ctrl+Shift+N should create exactly one selected GameObject');
            const afterKeyboardCreateBytes = editor.scene.toJSON();
            const afterKeyboardCreateRevision = commandRevision(editor);
            await dispatchHistoryShortcut('z');
            const keyboardCreateUndoPass = editor.scene.toJSON() === beforeKeyboardCreateBytes
                && commandRevision(editor) === beforeKeyboardCreateRevision;
            await dispatchHistoryShortcut('y');
            record('keyboard create is exactly one undo unit',
                afterKeyboardCreateRevision === beforeKeyboardCreateRevision + 1
                    && keyboardCreateUndoPass
                    && editor.scene.toJSON() === afterKeyboardCreateBytes
                    && commandRevision(editor) === afterKeyboardCreateRevision,
                beforeKeyboardCreateRevision + ' -> ' + afterKeyboardCreateRevision + ' with byte-identical undo/redo');

            hierarchyContent?.focus();
            const beforeRenameBytes = editor.scene.toJSON();
            const beforeRenameRevision = commandRevision(editor);
            hierarchyContent?.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'F2', bubbles: true, cancelable: true
            }));
            await wait(50);
            const renameInput = hierarchyContent?.querySelector('input');
            if (renameInput) {
                renameInput.value = 'Keyboard Authored';
                renameInput.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'Enter', bubbles: true, cancelable: true
                }));
            }
            await wait(100);
            record('keyboard rename commits and returns hierarchy focus',
                keyboardCreated?.name === 'Keyboard Authored' && document.activeElement === hierarchyContent,
                'F2, text, Enter should rename and return focus to the hierarchy tree');
            const afterRenameBytes = editor.scene.toJSON();
            const afterRenameRevision = commandRevision(editor);
            await dispatchHistoryShortcut('z');
            const renameUndoPass = editor.scene.toJSON() === beforeRenameBytes
                && commandRevision(editor) === beforeRenameRevision;
            await dispatchHistoryShortcut('y');
            record('rendered rename is exactly one undo unit',
                afterRenameRevision === beforeRenameRevision + 1
                    && renameUndoPass
                    && editor.scene.toJSON() === afterRenameBytes
                    && commandRevision(editor) === afterRenameRevision,
                beforeRenameRevision + ' -> ' + afterRenameRevision + ' with byte-identical undo/redo');

            hierarchyContent?.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'ContextMenu', bubbles: true, cancelable: true
            }));
            await wait(50);
            const keyboardMenu = document.getElementById('hierarchy-context-menu');
            const keyboardMenuFocused = document.activeElement?.getAttribute('role') === 'menuitem';
            keyboardMenu?.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Escape', bubbles: true, cancelable: true
            }));
            await wait(50);
            record('hierarchy context menu traps and returns keyboard focus',
                keyboardMenuFocused && !document.getElementById('hierarchy-context-menu') && document.activeElement === hierarchyContent,
                'ContextMenu should focus an action; Escape should dismiss and restore the tree');

            const hierarchyRows = Array.from(hierarchyContent?.querySelectorAll('[data-id]') ?? []);
            if (hierarchyRows.length >= 2) {
                hierarchyRows[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
                hierarchyRows[hierarchyRows.length - 1].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
                await wait(50);
            }
            record('hierarchy shift click selects a visible range',
                hierarchyRows.length >= 2 && (editor.getSelectedGameObjects?.() ?? []).length >= 2,
                'Shift+click should extend selection across visible hierarchy rows');

            editor.selectGameObject(keyboardCreated, false);
            hierarchyContent?.focus();
            hierarchyContent?.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'F2', bubbles: true, cancelable: true
            }));
            await wait(25);
            const cancelledRenameInput = hierarchyContent?.querySelector('input');
            if (cancelledRenameInput) {
                cancelledRenameInput.value = 'Cancelled Rename';
                cancelledRenameInput.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'Escape', bubbles: true, cancelable: true
                }));
            }
            await wait(50);
            record('hierarchy rename Escape preserves model and returns focus',
                keyboardCreated?.name === 'Keyboard Authored' && document.activeElement === hierarchyContent,
                'Escape should discard the staged rename and restore tree focus');

            const dragBetweenRows = async (sourceId, targetId, { drop = true, escape = false } = {}) => {
                const sourceRow = hierarchyContent?.querySelector('[data-id="' + sourceId + '"]');
                const targetRow = hierarchyContent?.querySelector('[data-id="' + targetId + '"]');
                if (!sourceRow || !targetRow || typeof DataTransfer !== 'function' || typeof DragEvent !== 'function') {
                    return { sourceRow, targetRow, supported: false };
                }
                const transfer = new DataTransfer();
                sourceRow.dispatchEvent(new DragEvent('dragstart', {
                    bubbles: true, cancelable: true, dataTransfer: transfer
                }));
                targetRow.dispatchEvent(new DragEvent('dragover', {
                    bubbles: true, cancelable: true, dataTransfer: transfer
                }));
                if (escape) {
                    window.dispatchEvent(new KeyboardEvent('keydown', {
                        key: 'Escape', bubbles: true, cancelable: true
                    }));
                } else if (drop) {
                    targetRow.dispatchEvent(new DragEvent('drop', {
                        bubbles: true, cancelable: true, dataTransfer: transfer
                    }));
                }
                sourceRow.dispatchEvent(new DragEvent('dragend', {
                    bubbles: true, cancelable: true, dataTransfer: transfer
                }));
                await wait(75);
                return { sourceRow, targetRow, supported: true };
            };

            editor.selectGameObject(keyboardCreated, false);
            editor.hierarchyWindow?.refresh?.();
            await wait(50);
            const beforeReparentBytes = editor.scene.toJSON();
            const beforeReparentRevision = commandRevision(editor);
            const reparentDrag = await dragBetweenRows(keyboardCreated.id, createdCube.id);
            const afterReparentBytes = editor.scene.toJSON();
            const afterReparentRevision = commandRevision(editor);
            const reparented = keyboardCreated.transform.parent?.gameObject === createdCube;
            await dispatchHistoryShortcut('z');
            const reparentUndoPass = editor.scene.toJSON() === beforeReparentBytes
                && commandRevision(editor) === beforeReparentRevision;
            await dispatchHistoryShortcut('y');
            record('rendered reparent is exactly one undo unit',
                reparentDrag.supported
                    && reparented
                    && afterReparentRevision === beforeReparentRevision + 1
                    && reparentUndoPass
                    && editor.scene.toJSON() === afterReparentBytes
                    && commandRevision(editor) === afterReparentRevision,
                beforeReparentRevision + ' -> ' + afterReparentRevision + ' with byte-identical undo/redo');

            editor.hierarchyWindow?.refresh?.();
            await wait(50);
            const beforeInvalidDropBytes = editor.scene.toJSON();
            const beforeInvalidDropRevision = commandRevision(editor);
            const beforeInvalidDropDirty = editor.dirtyState?.isDirty;
            const invalidDrop = await dragBetweenRows(createdCube.id, keyboardCreated.id);
            record('invalid descendant drop leaves scene, history, and dirty checkpoint unchanged',
                invalidDrop.supported
                    && editor.scene.toJSON() === beforeInvalidDropBytes
                    && commandRevision(editor) === beforeInvalidDropRevision
                    && editor.dirtyState?.isDirty === beforeInvalidDropDirty,
                'Parent-to-descendant drop must be rejected without a transaction');

            editor.hierarchyWindow?.refresh?.();
            await wait(50);
            const rootCancellationTarget = editor.scene.gameObjects.find((entry) =>
                entry !== createdCube && entry !== keyboardCreated && entry.transform.parent === null && entry.name !== 'Editor Camera');
            const beforeEscapeBytes = editor.scene.toJSON();
            const beforeEscapeRevision = commandRevision(editor);
            const beforeEscapeDirty = editor.dirtyState?.isDirty;
            const escapeDrag = rootCancellationTarget
                ? await dragBetweenRows(keyboardCreated.id, rootCancellationTarget.id, { drop: false, escape: true })
                : { supported: false, sourceRow: null, targetRow: null };
            record('hierarchy drag Escape clears visual state without mutation',
                escapeDrag.supported
                    && escapeDrag.sourceRow?.getAttribute('aria-grabbed') === null
                    && escapeDrag.sourceRow?.style.opacity === '1'
                    && escapeDrag.targetRow?.dataset.dropTarget === undefined
                    && document.activeElement === hierarchyContent
                    && editor.scene.toJSON() === beforeEscapeBytes
                    && commandRevision(editor) === beforeEscapeRevision
                    && editor.dirtyState?.isDirty === beforeEscapeDirty,
                'Escape must clear grabbed/drop-target state, restore tree focus, and create no transaction');

            editor.selectGameObject(keyboardCreated, false);
            const beforeDuplicateBytes = editor.scene.toJSON();
            const beforeDuplicateRevision = commandRevision(editor);
            window.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'd', code: 'KeyD', ctrlKey: true, bubbles: true, cancelable: true
            }));
            await wait(100);
            const duplicatedObject = (editor.getSelectedGameObjects?.() ?? []).at(-1) ?? null;
            const afterDuplicateBytes = editor.scene.toJSON();
            const afterDuplicateRevision = commandRevision(editor);
            await dispatchHistoryShortcut('z');
            const duplicateUndoPass = editor.scene.toJSON() === beforeDuplicateBytes
                && commandRevision(editor) === beforeDuplicateRevision;
            await dispatchHistoryShortcut('y');
            record('rendered duplicate is exactly one undo unit',
                duplicatedObject
                    && duplicatedObject.id !== keyboardCreated.id
                    && afterDuplicateRevision === beforeDuplicateRevision + 1
                    && duplicateUndoPass
                    && editor.scene.toJSON() === afterDuplicateBytes
                    && commandRevision(editor) === afterDuplicateRevision,
                beforeDuplicateRevision + ' -> ' + afterDuplicateRevision + ' with stable duplicate identity');

            editor.selectGameObject(duplicatedObject, false);
            const beforeDeleteBytes = editor.scene.toJSON();
            const beforeDeleteRevision = commandRevision(editor);
            window.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Delete', code: 'Delete', bubbles: true, cancelable: true
            }));
            await wait(100);
            const afterDeleteBytes = editor.scene.toJSON();
            const afterDeleteRevision = commandRevision(editor);
            await dispatchHistoryShortcut('z');
            const deleteUndoPass = editor.scene.toJSON() === beforeDeleteBytes
                && commandRevision(editor) === beforeDeleteRevision;
            await dispatchHistoryShortcut('y');
            record('rendered delete is exactly one undo unit',
                !editor.scene.gameObjects.includes(duplicatedObject)
                    && afterDeleteRevision === beforeDeleteRevision + 1
                    && deleteUndoPass
                    && editor.scene.toJSON() === afterDeleteBytes
                    && commandRevision(editor) === afterDeleteRevision,
                beforeDeleteRevision + ' -> ' + afterDeleteRevision + ' with byte-identical undo/redo');

            const shortcutGuard = document.createElement('textarea');
            document.body.appendChild(shortcutGuard);
            shortcutGuard.focus();
            const beforeGuardedShortcut = editor.scene.gameObjects.length;
            shortcutGuard.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'N', code: 'KeyN', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true
            }));
            await wait(50);
            record('global authoring shortcut is suppressed while editing text',
                editor.scene.gameObjects.length === beforeGuardedShortcut,
                'Ctrl+Shift+N in a textarea must not create a GameObject');
            shortcutGuard.remove();

            if (createdCube) editor.selectGameObject(createdCube, false);

            let renderableMesh = null;
            createdCube?.object3D?.traverse?.((node) => {
                if (!renderableMesh && node?.isMesh && node.geometry) renderableMesh = node;
            });
            const hasGeometry = Number(renderableMesh?.geometry?.attributes?.position?.count ?? 0) > 0;
            record('created cube has renderable geometry', hasGeometry, hasGeometry ? 'geometry position attribute populated' : 'mesh geometry missing');

            const canvas = sceneView?.querySelector('canvas');
            record('scene canvas attached', !!canvas, 'renderer canvas should be mounted in scene view');
            record('scene canvas has size', (canvas?.clientWidth ?? 0) > 100 && (canvas?.clientHeight ?? 0) > 100, canvas ? String(canvas.clientWidth) + 'x' + String(canvas.clientHeight) : 'no canvas');

            if (createdCube) {
                editor.selectGameObject(createdCube, false);
                await wait(100);
                const nameInput = document.querySelector('#inspector-content #go-name');
                const nameBeforeStagedEdit = createdCube.name;
                if (nameInput) {
                    nameInput.focus();
                    nameInput.value = 'Inspector Staged Name';
                    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
                    nameInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
                }
                record('inspector staged edit is model-nonmutating until commit',
                    createdCube.name === nameBeforeStagedEdit,
                    'Typing without a change commit must not mutate the selected object');

                const commitInput = document.querySelector('#inspector-content #go-name');
                if (commitInput) {
                    commitInput.value = 'Inspector Committed Name';
                    commitInput.dispatchEvent(new Event('change', { bubbles: true }));
                    await wait(50);
                }
                record('inspector change commits through the rendered control',
                    createdCube.name === 'Inspector Committed Name',
                    'A change event should commit the inspector name edit');

                const addComponentButton = Array.from(document.querySelectorAll('#inspector-content button'))
                    .find((node) => node.textContent?.trim() === 'Add Component');
                record('inspector add component button visible', !!addComponentButton, 'Add Component button should exist for selection');
                addComponentButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                await wait(150);
                const menu = document.getElementById('add-component-menu');
                record('add component menu opens', !!menu, '#add-component-menu should appear');
                const componentCount = createdCube.components?.length ?? 0;
                const componentItem = Array.from(menu?.lastElementChild?.children ?? [])
                    .find((node) => typeof node.onclick === 'function' && node.style.opacity !== '0.5');
                const componentName = componentItem?.firstChild?.textContent?.trim() ?? null;
                record('addable component option present', !!componentItem, 'At least one component should be available');
                componentItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                await wait(100);
                const componentAdded = (createdCube.components?.length ?? 0) > componentCount;
                record('component added to cube', componentAdded, componentAdded ? componentName + ' added' : 'component count did not change');
            }

            await editor.projectWindow?.refresh?.();
            await wait(100);
            const assetItems = Array.from(document.querySelectorAll('.project-asset-grid .asset-item'));
            const assetItem = assetItems.find((item) => /\.[a-z0-9]+$/i.test(item.textContent?.trim() ?? ''))
                ?? assetItems[assetItems.length - 1]
                ?? null;
            assetItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await wait(100);
            record('Project async item selection reaches observable state',
                !!assetItem && assetItem.getAttribute('aria-selected') === 'true',
                'Clicking a rendered asset should complete selection after async metadata lookup');
            let dragPayload = null;
            if (assetItem && typeof DataTransfer === 'function' && typeof DragEvent === 'function') {
                const transfer = new DataTransfer();
                assetItem.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
                try { dragPayload = JSON.parse(transfer.getData('text/plain')); } catch {}
            }
            record('Project drag exposes a typed asset payload',
                !!dragPayload?.type && !!dragPayload?.filename && !!dragPayload?.fullPath,
                dragPayload ? JSON.stringify(dragPayload) : 'No drag payload was produced');

            let transactionAssetItem = null;
            for (const candidate of assetItems) {
                const candidatePath = candidate?.dataset?.assetPath;
                if (!candidatePath) continue;
                const candidateStat = await window.electronAPI.fsStat(candidatePath);
                if (candidateStat?.isFile === true) {
                    transactionAssetItem = candidate;
                    break;
                }
            }
            let transactionAssetPath = transactionAssetItem?.dataset?.assetPath ?? null;
            if (!transactionAssetPath) {
                const recursiveAssets = await editor.projectWindow.getAllFilesRecursive(editor.rootPath);
                transactionAssetPath = recursiveAssets.find((entry) => !entry.isDirectory() && entry.name.endsWith('.mat'))?.fullPath
                    ?? recursiveAssets.find((entry) => !entry.isDirectory() && !entry.name.endsWith('.meta'))?.fullPath
                    ?? null;
            }
            if (transactionAssetPath) {
                const sourceAssetPath = transactionAssetPath;
                const duplicateRevisionBefore = commandRevision(editor);
                await editor.projectWindow.duplicateAsset(sourceAssetPath);
                await wait(200);
                const duplicatedItem = document.querySelector('.project-asset-grid .asset-item[aria-selected="true"]');
                const duplicatedPath = duplicatedItem?.dataset?.assetPath ?? null;
                const duplicateRevisionAfter = commandRevision(editor);
                const sourceBytes = await window.electronAPI.fsReadFile(sourceAssetPath);
                const duplicateBytes = duplicatedPath ? await window.electronAPI.fsReadFile(duplicatedPath) : null;
                const sourceMeta = JSON.parse(await window.electronAPI.fsReadFile(sourceAssetPath + '.meta', 'utf8'));
                const duplicateMeta = duplicatedPath
                    ? JSON.parse(await window.electronAPI.fsReadFile(duplicatedPath + '.meta', 'utf8'))
                    : null;
                record('rendered Project duplicate is one global undo unit with fresh GUID',
                    !!duplicatedPath
                        && duplicateRevisionAfter === duplicateRevisionBefore + 1
                        && JSON.stringify(sourceBytes) === JSON.stringify(duplicateBytes)
                        && sourceMeta.guid !== duplicateMeta?.guid,
                    duplicateRevisionBefore + ' -> ' + duplicateRevisionAfter + ', path=' + duplicatedPath);

                await dispatchHistoryShortcut('z');
                await wait(150);
                const duplicateRemovedByUndo = duplicatedPath
                    ? !(await window.electronAPI.fsExists(duplicatedPath))
                        && !(await window.electronAPI.fsExists(duplicatedPath + '.meta'))
                    : false;
                await dispatchHistoryShortcut('y');
                await wait(150);
                const redoMeta = duplicatedPath && await window.electronAPI.fsExists(duplicatedPath + '.meta')
                    ? JSON.parse(await window.electronAPI.fsReadFile(duplicatedPath + '.meta', 'utf8'))
                    : null;
                record('rendered Project duplicate undo and redo are byte-stable',
                    duplicateRemovedByUndo
                        && !!duplicatedPath
                        && JSON.stringify(await window.electronAPI.fsReadFile(duplicatedPath)) === JSON.stringify(duplicateBytes)
                        && redoMeta?.guid === duplicateMeta?.guid,
                    'Undo removed asset/meta and redo restored the retained duplicate GUID');

                const duplicateAfterRedo = Array.from(document.querySelectorAll('.project-asset-grid .asset-item'))
                    .find((item) => item.dataset.assetPath === duplicatedPath);
                const revisionBeforeCancel = commandRevision(editor);
                duplicateAfterRedo?.focus();
                duplicateAfterRedo?.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true }));
                const cancelInput = duplicateAfterRedo?.querySelector('input');
                if (cancelInput) {
                    cancelInput.value = 'Cancelled Rename.asset';
                    cancelInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
                }
                await wait(150);
                record('Project F2 Escape is byte- and history-nonmutating',
                    !!duplicatedPath && await window.electronAPI.fsExists(duplicatedPath)
                        && commandRevision(editor) === revisionBeforeCancel,
                    'Escape retained path and command revision ' + revisionBeforeCancel);

                const duplicateForRename = Array.from(document.querySelectorAll('.project-asset-grid .asset-item'))
                    .find((item) => item.dataset.assetPath === duplicatedPath);
                duplicateForRename?.focus();
                duplicateForRename?.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true }));
                const renameInput = duplicateForRename?.querySelector('input');
                const lastSeparator = duplicatedPath
                    ? Math.max(duplicatedPath.lastIndexOf('/'), duplicatedPath.lastIndexOf(String.fromCharCode(92)))
                    : -1;
                const duplicateFileName = duplicatedPath?.slice(lastSeparator + 1) ?? '';
                const extensionIndex = duplicateFileName.lastIndexOf('.');
                const extension = extensionIndex > 0 ? duplicateFileName.slice(extensionIndex) : '';
                const renamedName = 'Rendered Renamed Asset' + extension;
                const renamedPath = duplicatedPath ? duplicatedPath.slice(0, lastSeparator + 1) + renamedName : null;
                const renameConfirm = window.confirm;
                window.confirm = () => true;
                if (renameInput) {
                    renameInput.value = renamedName;
                    renameInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
                }
                for (let attempt = 0; attempt < 30 && renamedPath && !(await window.electronAPI.fsExists(renamedPath)); attempt += 1) {
                    await wait(100);
                }
                window.confirm = renameConfirm;
                const renameMeta = renamedPath && await window.electronAPI.fsExists(renamedPath + '.meta')
                    ? JSON.parse(await window.electronAPI.fsReadFile(renamedPath + '.meta', 'utf8'))
                    : null;
                record('Project F2 Enter rename preserves GUID and is one global undo unit',
                    !!renamedPath && !(await window.electronAPI.fsExists(duplicatedPath))
                        && await window.electronAPI.fsExists(renamedPath)
                        && renameMeta?.guid === duplicateMeta?.guid
                        && commandRevision(editor) === revisionBeforeCancel + 1,
                    duplicatedPath + ' -> ' + renamedPath);

                if (renamedPath) await editor.projectWindow.focusAssetByPath(renamedPath);
                let renamedItem = null;
                for (let attempt = 0; attempt < 30 && !renamedItem; attempt += 1) {
                    renamedItem = Array.from(document.querySelectorAll('.project-asset-grid .asset-item'))
                        .find((item) => item.dataset.assetPath === renamedPath) ?? null;
                    if (!renamedItem) await wait(100);
                }
                const originalConfirm = window.confirm;
                window.confirm = () => false;
                if (renamedItem) {
                    renamedItem.focus();
                    renamedItem.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
                }
                await wait(200);
                window.confirm = originalConfirm;
                record('Project Delete cancellation preserves bytes, focus policy and history',
                    !!renamedItem && !!renamedPath && await window.electronAPI.fsExists(renamedPath)
                        && commandRevision(editor) === revisionBeforeCancel + 1
                        && document.activeElement?.dataset?.assetPath === renamedPath,
                    'Cancelled confirmation left the renamed asset present');
            }

            console.warn('TUG-40 rendered warning');
            console.error('TUG-40 rendered error');
            editor.consoleWindow?.refresh?.();
            await wait(50);
            const consoleList = document.querySelector('.console-log-container');
            const consoleRows = Array.from(document.querySelectorAll('.console-item'));
            consoleRows[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            const selectedConsoleRow = document.querySelector('.console-item[aria-selected="true"]');
            const errorFilter = document.querySelector('.console-filter-error');
            const errorsBeforeFilter = document.querySelectorAll('.console-item-error').length;
            errorFilter?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await wait(25);
            record('Console supports rendered selection and filtering',
                !!consoleList && !!selectedConsoleRow && errorsBeforeFilter > 0 && document.querySelectorAll('.console-item-error').length === 0,
                'Selecting a log should update aria state and disabling Error should hide error rows');
            errorFilter?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

            const leftSplitter = document.getElementById('left-splitter');
            const splitterBefore = Number(leftSplitter?.getAttribute('aria-valuenow'));
            leftSplitter?.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'ArrowRight', bubbles: true, cancelable: true
            }));
            const splitterAfter = Number(leftSplitter?.getAttribute('aria-valuenow'));
            leftSplitter?.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'ArrowLeft', bubbles: true, cancelable: true
            }));
            const splitterRestored = Number(leftSplitter?.getAttribute('aria-valuenow'));
            record('docking splitter keyboard resize is reversible',
                Number.isFinite(splitterBefore) && splitterAfter !== splitterBefore && splitterRestored === splitterBefore,
                splitterBefore + ' -> ' + splitterAfter + ' -> ' + splitterRestored);

            const persistedScene = {
                bytes: editor.scene.toJSON(),
                identity: sceneIdentity(editor.scene)
            };
            const sceneSaved = await editor.saveActiveScene();
            record('rendered scene transaction saves at a clean checkpoint',
                sceneSaved === true && editor.dirtyState?.isDirty === false,
                'Save should persist the active scene and clear its dirty checkpoint');

            document.getElementById('menu-file')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await wait(50);
            const fileMenuOpen = document.getElementById('menu-file')?.classList.contains('menu-open') === true;
            record('file menu opens on click', fileMenuOpen, 'menu-open class should be applied');

            return {
                ok: failures.length === 0,
                failures,
                checks,
                snapshot: {
                    launchError: window.__engineLaunchError ?? null,
                    bootstrapError: window.__engineBootstrapError ?? null,
                    initialObjects,
                    afterCreateObjects,
                    selectedName: createdCube?.name ?? null,
                    hierarchyLabels,
                    persistedScene
                }
            };
        })();
    `, true);

    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8');
    console.log('Smoke test result written to', outputPath);
    console.log(JSON.stringify(result, null, 2));

    setTimeout(() => {
        app.exit(result.ok ? 0 : 1);
    }, 250);
}

async function runPhase1PersistenceHarness(mainWindow) {
    const phase = process.env.ENGINE_PHASE1_HARNESS_PHASE;
    const outputPath = process.env.ENGINE_SMOKE_TEST_OUTPUT;
    const scenePath = process.env.ENGINE_PHASE1_SCENE_PATH;
    const screenshotPath = process.env.ENGINE_PHASE1_SCREENSHOT_PATH;
    const waitForEditor = `
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const findSceneObject = (items, id) => {
            for (const item of items) {
                if (item.id === id) return item;
                const nested = findSceneObject(item.children ?? [], id);
                if (nested) return nested;
            }
            return null;
        };
        let editor = null;
        for (let i = 0; i < 160; i += 1) {
            editor = window.Editor?.instance ?? null;
            if (editor?.scene && findSceneObject(editor.scene.gameObjects, 'nested-child')) break;
            await wait(100);
        }
        if (!editor) throw new Error('editor did not boot');
        await wait(500);
    `;
    if (phase === 'conflict') {
        await mainWindow.webContents.executeJavaScript(`(async()=>{${waitForEditor} return true;})()`, true);
        const external = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
        external.externalRevisionMarker = 'written-outside-editor';
        fs.writeFileSync(scenePath, JSON.stringify(external, null, 2) + '\n', 'utf8');
    }
    const result = await mainWindow.webContents.executeJavaScript(`
        (async () => {
            ${waitForEditor}
            const click = async (id) => {
                document.getElementById(id)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                await wait(250);
            };
            const child = findSceneObject(editor.scene.gameObjects, 'nested-child');
            if (!child) throw new Error('nested fixture child is missing: ' + JSON.stringify({
                sceneIds: editor.scene.gameObjects.map((item) => item.id),
                projectPath: editor.projectPath,
                launchArgs: window.electronAPI?.launchArgs ?? null,
                launchError: window.__engineLaunchError ?? null,
                bootstrapError: window.__engineBootstrapError ?? null
            }));
            editor.selectGameObject(child, false);
            if (${JSON.stringify(phase)} === 'author') {
                child.name = 'Nested Child Authored';
                child.transform.position.x = 7;
                editor.dirtyState.markChanged();
                editor.hierarchyWindow.refresh();
                await click('menu-file');
                await click('menu-save-scene');
                child.name = 'Nested Child Save As';
                editor.dirtyState.markChanged();
                await click('menu-file');
                await click('menu-save-scene-as');
            } else if (${JSON.stringify(phase)} === 'conflict') {
                window.confirm = () => false;
                child.name = 'Unsaved Stale Edit';
                editor.dirtyState.markChanged();
                await click('menu-file');
                await click('menu-save-scene');
            } else if (${JSON.stringify(phase)} === 'crash') {
                child.name = 'Recovered After Forced Termination';
                child.transform.position.y = 9;
                editor.dirtyState.markChanged();
                void window.electronAPI.writeRecovery(
                    ${JSON.stringify(process.env.ENGINE_AUTO_OPEN_PROJECT_PATH)},
                    ${JSON.stringify(scenePath)},
                    editor.scene.toJSON()
                );
            }
            const selected = editor.getSelectedGameObjects?.().map((item) => item.id) ?? [];
            return {
                phase: ${JSON.stringify(phase)},
                activePath: window.electronAPI ? ${JSON.stringify(scenePath)} : null,
                child: { id: child.id, name: child.name, x: child.transform.position.x, y: child.transform.position.y },
                selected,
                serialized: JSON.parse(editor.scene.toJSON())
            };
        })()
    `, true);
    if (phase === 'crash') {
        writeRecovery(process.env.ENGINE_AUTO_OPEN_PROJECT_PATH, scenePath, JSON.stringify(result.serialized));
    }
    if ((phase === 'reopen' || phase === 'discard') && process.env.ENGINE_PHASE1_CONFIRM_RESPONSE === 'false') {
        discardRecovery(process.env.ENGINE_AUTO_OPEN_PROJECT_PATH);
    }
    if (screenshotPath) {
        const image = await mainWindow.webContents.capturePage();
        fs.writeFileSync(screenshotPath, image.toPNG());
    }
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8');
    if (phase !== 'crash') setTimeout(() => app.exit(0), 200);
}

// IPC Handlers for Native Dialogs
ipcMain.handle('show-save-dialog', async (event, options) => {
    requireEditorSender(event);
    if (process.env.ENGINE_PHASE1_SAVE_AS_PATH) {
        const filePath = process.env.ENGINE_PHASE1_SAVE_AS_PATH;
        projectCapabilities.grantFile(filePath, { writable: true });
        return { canceled: false, filePath };
    }
    const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), options);
    if (!result.canceled && typeof result.filePath === 'string') {
        projectCapabilities.grantFile(result.filePath, { writable: true });
    }
    return result;
});

ipcMain.handle('show-open-dialog', async (event, options) => {
    requireEditorSender(event);
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), options);
    if (!result.canceled && Array.isArray(result.filePaths)) {
        const grantsDirectories = options?.properties?.includes('openDirectory');
        result.filePaths.forEach((selectedPath) => {
            if (grantsDirectories) openProjectInCurrentTrustMode(selectedPath, { grant: true });
            else projectCapabilities.grantFile(selectedPath, { writable: false });
        });
    }
    return result;
});

ipcMain.handle('get-project-trust', async (event, projectPath) => {
    requireEditorSender(event);
    return openProjectInCurrentTrustMode(projectPath);
});

ipcMain.handle('request-project-trust', async (event, projectPath) => {
    requireEditorSender(event);
    const status = openProjectInCurrentTrustMode(projectPath);
    if (status.trusted) return status;
    const result = await dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender), {
        type: 'warning',
        buttons: ['Open in Safe Mode', 'Trust Project'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        title: 'Trust this project?',
        message: `Trust “${path.basename(status.root)}”?`,
        detail: 'Trusted projects may write files and run project scripts, packages, plugins, and build steps. Only trust projects whose contents and dependencies you understand.'
    });
    if (result.response !== 1) return status;
    const trusted = getProjectTrustStore().trust(status.root);
    projectCapabilities.setWritable(trusted.root, true);
    return trusted;
});

ipcMain.handle('revoke-project-trust', async (event, projectPath) => {
    requireEditorSender(event);
    const status = getProjectTrustStore().revoke(projectPath);
    await executionBroker.revokeProject(status.root);
    protocolGrants.revokeAll();
    projectCapabilities.grant(status.root, { writable: false });
    return status;
});

ipcMain.handle('initialize-project-structure', async (_event, projectPath) => {
    requireEditorSender(_event);
    projectPath = projectCapabilities.authorize(projectPath, { write: true });

    const folders = [
        'Assets',
        'Library',
        'ProjectSettings',
        path.join('Assets', 'Scenes'),
        path.join('Assets', 'Scripts'),
        path.join('Assets', 'Materials')
    ];

    for (const folder of folders) {
        const target = path.join(projectPath, folder);
        if (!fs.existsSync(target)) {
            fs.mkdirSync(target, { recursive: true });
        }
    }

    const defaultScenePath = path.join(projectPath, 'Assets', 'Scenes', 'SampleScene.json');
    const projectManifestPath = path.join(projectPath, 'ProjectSettings', 'Project.json');
    let sceneId = randomUUID();
    if (!fs.existsSync(defaultScenePath)) {
        atomicWriteJson(defaultScenePath, {
            formatVersion: 1,
            sceneId,
            name: 'SampleScene',
            version: '1.4',
            environment: {},
            gameObjects: []
        });
    } else {
        try {
            const existingScene = JSON.parse(fs.readFileSync(defaultScenePath, 'utf8'));
            if (typeof existingScene.sceneId === 'string' && existingScene.sceneId.length > 0) {
                sceneId = existingScene.sceneId;
            }
        } catch {}
    }
    if (!fs.existsSync(projectManifestPath)) {
        atomicWriteJson(projectManifestPath, {
            formatVersion: 1,
            projectId: randomUUID(),
            name: path.basename(projectPath),
            scenes: [{ sceneId, path: 'Assets/Scenes/SampleScene.json' }]
        });
    }

    return true;
});

ipcMain.handle('read-text-file', async (_event, filePath) => {
    requireEditorSender(_event);
    filePath = projectCapabilities.authorize(filePath, { mustExist: true });
    if (fs.statSync(filePath).size > 16 * 1024 * 1024) throw new Error('Text file exceeds limit');
    return fs.readFileSync(filePath, 'utf8');
});

ipcMain.handle('write-text-file', async (_event, filePath, content) => {
    requireEditorSender(_event);
    filePath = projectCapabilities.authorize(filePath, { write: true });
    normalizeWriteData(content);
    atomicWriteText(filePath, content);
    return true;
});

ipcMain.handle('scene-document-read', async (event, filePath) => {
    requireEditorSender(event);
    filePath = projectCapabilities.authorize(filePath, { mustExist: true });
    if (fs.statSync(filePath).size > 16 * 1024 * 1024) throw new Error('Scene file exceeds limit');
    const text = fs.readFileSync(filePath, 'utf8');
    return { text, revision: contentHash(text) };
});

ipcMain.handle('scene-document-write', async (event, filePath, content, expectedRevision) => {
    requireEditorSender(event);
    filePath = projectCapabilities.authorize(filePath, { write: true });
    normalizeWriteData(content);
    return atomicWriteText(filePath, content, { expectedRevision });
});

ipcMain.on('editor-dirty-state', (event, dirty) => {
    requireEditorSender(event);
    editorDirty = dirty === true;
});

ipcMain.on('editor-close-save-result', (event, saved) => {
    requireEditorSender(event);
    if (saved === true) {
        allowEditorClose = true;
        BrowserWindow.fromWebContents(event.sender)?.close();
    } else {
        closePromptActive = false;
    }
});

ipcMain.handle('recovery-write', async (event, projectPath, scenePath, sceneText) => {
    requireEditorSender(event);
    const root = projectCapabilities.authorize(projectPath, { mustExist: true, write: true });
    return writeRecovery(root, scenePath, sceneText);
});

ipcMain.handle('recovery-read', async (event, projectPath, scenePath) => {
    requireEditorSender(event);
    const root = projectCapabilities.authorize(projectPath, { mustExist: true });
    let modifiedAt = 0;
    if (typeof scenePath === 'string') {
        try {
            const canonical = projectCapabilities.authorize(scenePath, { mustExist: true });
            modifiedAt = fs.statSync(canonical).mtimeMs;
        } catch {}
    }
    return readRecovery(root, modifiedAt);
});

ipcMain.handle('recovery-discard', async (event, projectPath) => {
    requireEditorSender(event);
    const root = projectCapabilities.authorize(projectPath, { mustExist: true, write: true });
    return discardRecovery(root);
});

ipcMain.handle('file-exists', async (_event, filePath) => {
    requireEditorSender(_event);
    try {
        filePath = projectCapabilities.authorize(filePath);
        return fs.existsSync(filePath);
    } catch {
        return false;
    }
});

ipcMain.handle('path-join', async (_event, ...segments) => {
    return path.join(...segments.filter((segment) => typeof segment === 'string'));
});

ipcMain.handle('path-basename', async (_event, targetPath) => {
    if (typeof targetPath !== 'string') return '';
    return path.basename(targetPath);
});

ipcMain.handle('reveal-in-folder', async (_event, targetPath) => {
    requireEditorSender(_event);
    try {
        targetPath = projectCapabilities.authorize(targetPath, { mustExist: true });
        shell.showItemInFolder(targetPath);
        return true;
    } catch {
        return false;
    }
});

function serializeStat(stat) {
    if (!stat) return null;
    return {
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        isDirectory: stat.isDirectory(),
        isFile: stat.isFile()
    };
}

function serializeDirEntry(entry) {
    return {
        name: entry.name,
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile(),
        isSymbolicLink: entry.isSymbolicLink()
    };
}

ipcMain.handle('fs-exists', async (event, targetPath) => {
    requireEditorSender(event);
    return fs.existsSync(projectCapabilities.authorize(targetPath));
});

ipcMain.handle('fs-mkdir', async (event, targetPath, options) => {
    requireEditorSender(event);
    await confinedFileSystem.mkdir(projectCapabilities.authorizeMutation(targetPath), options);
    return true;
});

ipcMain.handle('fs-readdir', async (event, targetPath, options) => {
    requireEditorSender(event);
    const entries = await fs.promises.readdir(projectCapabilities.authorize(targetPath, { mustExist: true }), { withFileTypes: options?.withFileTypes === true });
    return options?.withFileTypes ? entries.map(serializeDirEntry) : entries;
});

ipcMain.handle('fs-stat', async (event, targetPath) => {
    requireEditorSender(event);
    return serializeStat(await fs.promises.stat(projectCapabilities.authorize(targetPath, { mustExist: true })));
});

ipcMain.handle('fs-read-file', async (event, targetPath, encoding) => {
    requireEditorSender(event);
    targetPath = projectCapabilities.authorize(targetPath, { mustExist: true });
    const stat = await fs.promises.stat(targetPath);
    if (stat.size > 64 * 1024 * 1024) throw new Error('Read payload exceeds limit');
    if (typeof encoding === 'string' && encoding.length > 0) return fs.promises.readFile(targetPath, encoding);
    return { __binary: true, data: Array.from(await fs.promises.readFile(targetPath)) };
});

ipcMain.handle('fs-write-file', async (event, targetPath, data, encoding) => {
    requireEditorSender(event);
    targetPath = projectCapabilities.authorize(targetPath, { write: true });
    await writeWithCapabilityLease(targetPath, normalizeWriteData(data), typeof encoding === 'string' ? encoding : undefined);
    return true;
});

ipcMain.handle('fs-copy-file', async (event, sourcePath, targetPath) => {
    requireEditorSender(event);
    const approved = projectCapabilities.authorizeMove(sourcePath, targetPath);
    await copyWithCapabilityLease(approved.source, approved.target);
    return true;
});

ipcMain.handle('fs-rename', async (event, sourcePath, targetPath) => {
    requireEditorSender(event);
    const approved = projectCapabilities.authorizeRename(sourcePath, targetPath);
    await confinedFileSystem.rename(
        projectCapabilities.authorizeMutation(approved.source, { mustExist: true, allowRoot: false }),
        projectCapabilities.authorizeMutation(approved.target, { allowRoot: false })
    );
    return true;
});

ipcMain.handle('fs-rm', async (event, targetPath, options) => {
    requireEditorSender(event);
    await confinedFileSystem.rm(projectCapabilities.authorizeMutation(targetPath, { mustExist: true, allowRoot: false }), {
        recursive: options?.recursive === true,
        force: options?.force === true
    });
    return true;
});

ipcMain.handle('fs-unlink', async (event, targetPath) => {
    requireEditorSender(event);
    await confinedFileSystem.unlink(projectCapabilities.authorizeMutation(targetPath, { mustExist: true, allowRoot: false }));
    return true;
});

ipcMain.on('exit-app', (event) => {
    requireEditorSender(event);
    BrowserWindow.fromWebContents(event.sender)?.close();
});

const createWindow = async () => {
    const isDev = !app.isPackaged;
    const forceDist = process.env.ENGINE_LOAD_DIST === '1';
    const usesDevelopmentRenderer = isDev && !forceDist;
    const rendererAuthToken = usesDevelopmentRenderer ? randomUUID() : null;
    const rendererBootstrapArguments = usesDevelopmentRenderer
        ? [
            '--tugberk-renderer-mode=development',
            `--tugberk-renderer-origin=${DEVELOPMENT_RENDERER_ORIGIN}`,
            `--tugberk-renderer-token=${rendererAuthToken}`
        ]
        : ['--tugberk-renderer-mode=packaged'];
    if (process.env.ENGINE_SMOKE_TEST === '1') {
        rendererBootstrapArguments.push('--tugberk-smoke-test=1');
    }
    if (typeof process.env.ENGINE_AUTO_OPEN_PROJECT_PATH === 'string' && process.env.ENGINE_AUTO_OPEN_PROJECT_PATH.length > 0) {
        rendererBootstrapArguments.push(`--tugberk-auto-open-project=${process.env.ENGINE_AUTO_OPEN_PROJECT_PATH}`);
    }
    if (process.env.ENGINE_PHASE1_CONFIRM_RESPONSE === 'true' || process.env.ENGINE_PHASE1_CONFIRM_RESPONSE === 'false') {
        rendererBootstrapArguments.push(`--tugberk-confirm-response=${process.env.ENGINE_PHASE1_CONFIRM_RESPONSE}`);
    }

    // Create the browser window.
    const mainWindow = new BrowserWindow({
        width: 1280,
        height: 720,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            additionalArguments: rendererBootstrapArguments
        },
        icon: path.join(__dirname, '../public/favicon.ico')
    });
    const editorWebContents = mainWindow.webContents;
    editorWebContents.on('preload-error', (_event, preloadPath, error) => {
        console.error(`Preload failed: ${preloadPath}`, error);
    });
    if (process.env.ENGINE_PHASE1_CONFIRM_RESPONSE === 'true' || process.env.ENGINE_PHASE1_CONFIRM_RESPONSE === 'false') {
        const confirmResponse = process.env.ENGINE_PHASE1_CONFIRM_RESPONSE === 'true';
        editorWebContents.on('dom-ready', () => {
            void editorWebContents.executeJavaScript(`window.confirm = () => ${confirmResponse};`, true);
        });
    }
    const editorOwnerId = editorWebContents.id;
    editorWebContentsId = editorOwnerId;
    mainWindow.on?.('close', async (event) => {
        if (allowEditorClose || !editorDirty) return;
        event.preventDefault();
        if (closePromptActive) return;
        closePromptActive = true;
        const result = await dialog.showMessageBox(mainWindow, {
            type: 'warning',
            buttons: ['Save', "Don't Save", 'Cancel'],
            defaultId: 0,
            cancelId: 2,
            noLink: true,
            title: 'Unsaved changes',
            message: 'Save changes before closing?'
        });
        if (result.response === 1) {
            allowEditorClose = true;
            mainWindow.close();
        } else if (result.response === 0) {
            if (!editorWebContents.isDestroyed()) {
                editorWebContents.send('editor-close-save');
            }
        } else {
            closePromptActive = false;
        }
    });
    if (typeof process.env.ENGINE_AUTO_OPEN_PROJECT_PATH === 'string' && process.env.ENGINE_AUTO_OPEN_PROJECT_PATH.length > 0) {
        projectCapabilities.grant(process.env.ENGINE_AUTO_OPEN_PROJECT_PATH, {
            writable: process.env.ENGINE_SMOKE_TEST === '1'
        });
    }

    editorWebContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    editorWebContents.on('will-navigate', (event, targetUrl) => {
        const currentUrl = editorWebContents.getURL();
        if (currentUrl && targetUrl !== currentUrl) {
            protocolGrants.revokeAllForOwner(editorOwnerId);
            projectCapabilities.clear();
            event.preventDefault();
        }
    });
    editorWebContents.on('destroyed', () => {
        protocolGrants.revokeAllForOwner(editorOwnerId);
        projectCapabilities.clear();
        editorWebContentsId = null;
    });
    editorWebContents.on('render-process-gone', (_event, details) => {
        diagnostics.record({
            processRole: 'renderer',
            operation: 'renderer.terminated',
            outcome: 'failure',
            errorCode: details?.reason === 'clean-exit' ? 'CLEAN_EXIT' : 'RENDERER_GONE',
            details: { reason: details?.reason, exitCode: details?.exitCode }
        });
    });

    // Load the app.
    // In development, we load the Vite dev server
    if (usesDevelopmentRenderer) {
        try {
            const developmentUrl = new URL(DEVELOPMENT_RENDERER_ORIGIN);
            developmentUrl.hash = `${RENDERER_AUTH_FRAGMENT}=${encodeURIComponent(rendererAuthToken)}`;
            await mainWindow.loadURL(developmentUrl.toString());
            mainWindow.webContents.openDevTools();
        } catch (error) {
            console.warn('Dev server unavailable, falling back to dist build.', error?.message ?? error);
            await mainWindow.loadFile(path.join(__dirname, '../dist/index.html'), {
                hash: `${RENDERER_AUTH_FRAGMENT}=${encodeURIComponent(rendererAuthToken)}`
            });
        }
    } else {
        // In production, load the built index.html
        const query = { 'tugberk-renderer-mode': 'packaged' };
        if (process.env.ENGINE_SMOKE_TEST === '1') query['tugberk-smoke-test'] = '1';
        if (typeof process.env.ENGINE_AUTO_OPEN_PROJECT_PATH === 'string' && process.env.ENGINE_AUTO_OPEN_PROJECT_PATH.length > 0) {
            query['tugberk-auto-open-project'] = process.env.ENGINE_AUTO_OPEN_PROJECT_PATH;
        }
        if (process.env.ENGINE_PHASE1_CONFIRM_RESPONSE === 'true' || process.env.ENGINE_PHASE1_CONFIRM_RESPONSE === 'false') {
            query['tugberk-confirm-response'] = process.env.ENGINE_PHASE1_CONFIRM_RESPONSE;
        }
        await mainWindow.loadFile(path.join(__dirname, '../dist/index.html'), { query });
    }

    // Remove menu for a cleaner "app" feel (optional)
    mainWindow.setMenuBarVisibility(false);

    if (process.env.ENGINE_SMOKE_TEST === '1') {
        mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
            console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
        });
        setTimeout(() => {
            const runner = process.env.ENGINE_PHASE1_HARNESS_PHASE
                ? runPhase1PersistenceHarness
                : runSmokeTest;
            runner(mainWindow).catch((error) => {
                console.error('Smoke test failed to execute:', error);
                app.exit(1);
            });
        }, 750);
    }
};

// This method will be called when Electron has finished initialization
app.on('ready', createWindow);

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

let shutdownRequested = false;
app.on('before-quit', (event) => {
    if (shutdownRequested) return;
    event.preventDefault();
    shutdownRequested = true;
    shutdownCoordinator.shutdown('before-quit').finally(() => app.quit());
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
