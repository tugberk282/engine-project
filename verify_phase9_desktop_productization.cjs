#!/usr/bin/env node

/**
 * Phase 9: Desktop App Productization Verification Suite
 *
 * Source-backed validation for Electron shell hardening progress,
 * preload bridge canonicalization, and native workspace/project flows.
 */

const fs = require('fs');
const path = require('path');

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    gray: '\x1b[90m'
};

let testsPassed = 0;
let testsFailed = 0;
const failedTests = [];

function log(color, message) {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function test(condition, testName, details = '') {
    if (condition) {
        testsPassed++;
        log('green', `✓ ${testName}`);
        if (details) log('gray', `  ${details}`);
    } else {
        testsFailed++;
        failedTests.push(testName);
        log('red', `✗ ${testName}`);
        if (details) log('gray', `  Expected: ${details}`);
    }
}

function suite(name) {
    log('blue', `\n━━━ ${name} ━━━`);
}

function read(relPath) {
    return fs.readFileSync(path.join(__dirname, relPath), 'utf8');
}

function walkFiles(rootDir) {
    const entries = fs.readdirSync(rootDir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const fullPath = path.join(rootDir, entry.name);
        if (entry.isDirectory()) {
            files.push(...walkFiles(fullPath));
        } else {
            files.push(fullPath);
        }
    }
    return files;
}

function hasAll(content, snippets) {
    return snippets.every((snippet) => content.includes(snippet));
}

log('cyan', '\n╔═══════════════════════════════════════════════════════════════╗');
log('cyan', '║       PHASE 9: DESKTOP APP PRODUCTIZATION TEST SUITE        ║');
log('cyan', '║   Source-backed validation for Electron shell progression   ║');
log('cyan', '╚═══════════════════════════════════════════════════════════════╝\n');

const mainSource = read('electron/main.js');
const preloadSource = read('electron/preload.js');
const recentProjectServiceSource = read('electron/platform/recent-project-service.js');
const bridgeSource = read('src/platform/DesktopBridge.ts');
const fileSystemSource = read('src/platform/DesktopFileSystem.ts');
const pathUtilsSource = read('src/platform/PathUtils.ts');
const editorSource = read('src/editor/Editor.ts');
const launcherSource = read('src/editor/Launcher.ts');
const sceneManagerSource = read('src/engine/SceneManager.ts');
const buildSettingsWindowSource = read('src/editor/BuildSettingsWindow.ts');
const projectWindowSource = read('src/editor/ProjectWindow.ts');
const assetDatabaseSource = read('src/engine/AssetDatabase.ts');
const roadmapSource = read('UNITY_PARITY_ROADMAP.md');
const srcFilePaths = walkFiles(path.join(__dirname, 'src')).filter((filePath) => /\.(ts|js)$/.test(filePath));
const directRendererFsOrPathRequires = srcFilePaths.filter((filePath) => {
    const content = fs.readFileSync(filePath, 'utf8');
    return content.includes("window.require('fs')") || content.includes("window.require('path')");
});
const directRendererRequireCalls = srcFilePaths.filter((filePath) => {
    const content = fs.readFileSync(filePath, 'utf8');
    return content.includes('window.require') || content.includes('(window as any).require');
});

suite('Electron Shell');

test(
    hasAll(mainSource, [
        "ipcMain.handle('show-save-dialog'",
        "ipcMain.handle('show-open-dialog'",
        "ipcMain.handle('tugberk:v1:request'",
        "ipcMain.handle('initialize-project-structure'",
        "ipcMain.handle('read-text-file'",
        "ipcMain.handle('write-text-file'",
        "ipcMain.handle('file-exists'",
        "ipcMain.handle('path-join'",
        "ipcMain.handle('path-basename'",
        "ipcMain.handle('reveal-in-folder'",
        "ipcMain.handle('fs-exists'",
        "ipcMain.handle('fs-mkdir'",
        "ipcMain.handle('fs-readdir'",
        "ipcMain.handle('fs-stat'",
        "ipcMain.handle('fs-read-file'",
        "ipcMain.handle('fs-write-file'",
        "ipcMain.handle('fs-copy-file'",
        "ipcMain.handle('fs-rename'",
        "ipcMain.handle('fs-rm'",
        "ipcMain.handle('fs-unlink'",
        "ipcMain.on('exit-app'"
    ]) && !mainSource.includes("ipcMain.on('fs-"),
    'Electron main process exposes native desktop workspace and file IPC handlers'
);

test(
    mainSource.includes("path.join(app.getPath('userData'), 'recent-projects.json')")
        && hasAll(recentProjectServiceSource, [
            'isRecentProjectsPayload({ projects })',
            'await fs.promises.writeFile',
            'await fs.promises.rename'
        ]),
    'Recent projects persistence uses a bounded asynchronous native userData store'
);

test(
    hasAll(mainSource, [
        'nodeIntegration: false,',
        'contextIsolation: true,',
        'sandbox: true,',
        'webSecurity: true',
        "mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));",
        "mainWindow.webContents.on('will-navigate'"
    ]) &&
        !mainSource.includes('nodeIntegration: true') &&
        !mainSource.includes('contextIsolation: false') &&
        !mainSource.includes('webSecurity: false'),
    'BrowserWindow runs with secure renderer isolation and blocks untrusted navigation'
);

suite('Preload Bridge');

test(
    hasAll(preloadSource, [
        'const { contextBridge, ipcRenderer } = require(\'electron\');',
        'const electronAPI = {',
        'currentWorkingDirectory: process.cwd(),',
        'showOpenDialog: (options) => ipcRenderer.invoke(\'show-open-dialog\', options),',
        'showSaveDialog: (options) => ipcRenderer.invoke(\'show-save-dialog\', options),',
        'loadRecentProjects: () => tugberkV1.request(\'recentProjects.load\', {}),',
        'saveRecentProjects: (projects) => tugberkV1.request(\'recentProjects.save\', { projects }),',
        'initializeProjectStructure: (projectPath) => ipcRenderer.invoke(\'initialize-project-structure\', projectPath),',
        'readTextFile: (filePath) => ipcRenderer.invoke(\'read-text-file\', filePath),',
        'writeTextFile: (filePath, content) => ipcRenderer.invoke(\'write-text-file\', filePath, content),',
        'fileExists: (filePath) => ipcRenderer.invoke(\'file-exists\', filePath),',
        'fsExists: (targetPath) => ipcRenderer.invoke(\'fs-exists\', targetPath),',
        'fsMkdir: (targetPath, options) => ipcRenderer.invoke(\'fs-mkdir\', targetPath, options),',
        'fsReaddir: (targetPath, options) => ipcRenderer.invoke(\'fs-readdir\', targetPath, options),',
        'fsStat: (targetPath) => ipcRenderer.invoke(\'fs-stat\', targetPath),',
        'fsReadFile: (targetPath, encoding) => ipcRenderer.invoke(\'fs-read-file\', targetPath, encoding),',
        'fsWriteFile: (targetPath, data, encoding) => ipcRenderer.invoke(\'fs-write-file\', targetPath, data, encoding),',
        'fsCopyFile: (sourcePath, targetPath) => ipcRenderer.invoke(\'fs-copy-file\', sourcePath, targetPath),',
        'fsRename: (sourcePath, targetPath) => ipcRenderer.invoke(\'fs-rename\', sourcePath, targetPath),',
        'fsRm: (targetPath, options) => ipcRenderer.invoke(\'fs-rm\', targetPath, options),',
        'fsUnlink: (targetPath) => ipcRenderer.invoke(\'fs-unlink\', targetPath),',
        'pathJoin: (...segments) => ipcRenderer.invoke(\'path-join\', ...segments),',
        'pathBasename: (targetPath) => ipcRenderer.invoke(\'path-basename\', targetPath),',
        'revealInFolder: (targetPath) => ipcRenderer.invoke(\'reveal-in-folder\', targetPath),',
        'exitApp: () => ipcRenderer.send(\'exit-app\')'
    ]) && !preloadSource.includes('sendSync'),
    'Preload defines a canonical electronAPI bridge for native desktop actions'
);

test(
    hasAll(preloadSource, [
        'contextBridge.exposeInMainWorld(\'electronAPI\', electronAPI);'
    ]) &&
        !preloadSource.includes('window.electronAPI = electronAPI'),
    'Preload exposes the desktop API only through the isolated context bridge'
);

suite('Renderer Migration');

test(
    hasAll(bridgeSource, [
        'export class DesktopBridge {',
        'currentWorkingDirectory?: string;',
        'public getCurrentWorkingDirectory(): string {',
        'return this.electronAPI?.currentWorkingDirectory ?? \'sample_project\';',
        'public async readTextFile(filePath: string): Promise<string | null> {',
        'public async writeTextFile(filePath: string, content: string): Promise<boolean> {',
        'public async fileExists(filePath: string): Promise<boolean> {',
        'public async pathJoin(...segments: string[]): Promise<string> {',
        'public async pathBasename(targetPath: string): Promise<string> {'
    ]),
    'DesktopBridge provides a canonical renderer-facing abstraction for file and path operations'
);

test(
    hasAll(fileSystemSource, [
        'export class DesktopFileSystem {',
        'this.electronAPI = (window as any).electronAPI ?? null;',
        'private deserializeStat(stat: SerializedStat | null): any {',
        'private deserializeDirEntries(entries: SerializedDirEntry[]): any[] {',
        'public async exists(targetPath: string): Promise<boolean> {',
        'public async mkdir(targetPath: string, options?: any): Promise<void> {',
        'public async readdir(targetPath: string, options?: any): Promise<any[]> {',
        'public async stat(targetPath: string): Promise<any> {',
        'public async readFile(targetPath: string, encoding?: BufferEncoding | string): Promise<any> {',
        'public async writeFile(targetPath: string, data: any, encoding?: BufferEncoding | string): Promise<void> {',
        'public async copyFile(sourcePath: string, targetPath: string): Promise<void> {',
        'public async rename(sourcePath: string, targetPath: string): Promise<void> {',
        'public async rm(targetPath: string, options?: any): Promise<void> {',
        'public async unlink(targetPath: string): Promise<void> {'
    ]) && !fileSystemSource.includes('Sync('),
    'DesktopFileSystem provides a centralized renderer-side filesystem adapter during migration'
);

test(
    hasAll(pathUtilsSource, [
        'export class PathUtils {',
        'public static join(...segments: string[]): string {',
        'public static basename(targetPath: string, suffix?: string): string {',
        'public static dirname(targetPath: string): string {',
        'public static extname(targetPath: string): string {',
        'public static relative(fromPath: string, toPath: string): string {'
    ]),
    'PathUtils provides a renderer-safe path utility layer for desktop migration work'
);

test(
    hasAll(editorSource, [
        'import { DesktopBridge } from \'../platform/DesktopBridge\';',
        'import { DesktopFileSystem } from \'../platform/DesktopFileSystem\';',
        'import { PathUtils } from \'../platform/PathUtils\';',
        'private desktopBridge: DesktopBridge;',
        'private fs: DesktopFileSystem;',
        'this.desktopBridge = new DesktopBridge();',
        'this.fs = new DesktopFileSystem();',
        'this.electronAPI = this.desktopBridge.getElectronAPI();',
        'const data = await this.desktopBridge.readTextFile(selectedPath);',
        'const sceneName = await this.desktopBridge.pathBasename(selectedPath);',
        'const defaultScenePath = this.rootPath ? await this.desktopBridge.pathJoin(this.rootPath, \'Scenes\', \'NewScene.json\') : \'NewScene.json\';',
        'await this.desktopBridge.writeTextFile(result.filePath, json);'
    ]),
    'Editor scene open/save flow has started migrating onto DesktopBridge'
);

test(
    hasAll(sceneManagerSource, [
        'import { DesktopBridge, ProjectResource } from \'../platform/DesktopBridge\';',
        'private desktopBridge: DesktopBridge;',
        'this.desktopBridge = new DesktopBridge();',
        'const data = await this.desktopBridge.readTextFile(filePath);',
        'const saved = await this.desktopBridge.writeTextFile(filePath, json);'
    ]),
    'SceneManager uses DesktopBridge for scene file load/save instead of direct renderer file access'
);

test(
    hasAll(launcherSource, [
        'this.electronAPI = (window as any).electronAPI ?? null;',
        'const loaded = await this.electronAPI.loadRecentProjects();',
        'await this.electronAPI?.saveRecentProjects?.(this.recentProjects);',
        'await this.electronAPI?.initializeProjectStructure?.(projectPath);'
    ]) && !launcherSource.includes('hub_recent_projects'),
    'Launcher recent-project and project-initialization flow uses native bridge storage instead of localStorage'
);

test(
    hasAll(projectWindowSource, [
        'import { DesktopFileSystem } from \'../platform/DesktopFileSystem\';',
        'import { PathUtils } from \'../platform/PathUtils\';',
        'private fs: DesktopFileSystem;',
        'this.fs = new DesktopFileSystem();',
        'footer.innerText = PathUtils.relative(PathUtils.dirname(this.rootPath), this.currentPath).replace(/\\\\/g, \'/\');',
        'fullPath: PathUtils.join(this.currentPath, f.name)',
        'const extension = isFolder ? \'\' : PathUtils.extname(assetPath).toLowerCase();'
    ]),
    'ProjectWindow has started migrating path operations away from renderer path require usage'
);

test(
    hasAll(buildSettingsWindowSource, [
        'import { DesktopFileSystem } from \'../platform/DesktopFileSystem\';',
        'import { PathUtils } from \'../platform/PathUtils\';',
        'private fs: DesktopFileSystem;',
        'this.fs = new DesktopFileSystem();',
        'const rootPath = (window as any).Editor?.instance?.rootPath ?? \'Assets\';',
        'const assetsPath = rootPath;',
        'file = PathUtils.join(dir, file);',
        'const projectRoot = PathUtils.dirname(rootPath);',
        'const relativePath = PathUtils.relative(projectRoot, fullPath);'
    ]) &&
        !buildSettingsWindowSource.includes("window.require('fs')") &&
        !buildSettingsWindowSource.includes("window.require('path')"),
    'BuildSettingsWindow uses shared desktop adapters instead of direct renderer fs/path requires'
);

test(
    hasAll(assetDatabaseSource, [
        'import { DesktopFileSystem } from \'../platform/DesktopFileSystem\';',
        'import { PathUtils } from \'../platform/PathUtils\';',
        'private fs: DesktopFileSystem;',
        'this.fs = new DesktopFileSystem();',
        'await this.scanPath(PathUtils.join(assetPath, entry.name), usedGuids, depth + 1, context);',
        'fileExtension: isDirectory ? \'\' : (PathUtils.extname(assetPath).toLowerCase().replace(\'.\', \'\')),',
        'const ext = PathUtils.extname(assetPath).toLowerCase();'
    ]),
    'AssetDatabase has started migrating path operations to shared renderer-safe utilities'
);

test(
    directRendererFsOrPathRequires.length === 0,
    'Renderer source tree no longer contains direct window.require fs/path calls',
    directRendererFsOrPathRequires.length === 0
        ? ''
        : `Remaining files: ${directRendererFsOrPathRequires.map((filePath) => path.relative(__dirname, filePath)).join(', ')}`
);

test(
    directRendererRequireCalls.length === 0,
    'Renderer source tree no longer contains generic window.require fallback calls',
    directRendererRequireCalls.length === 0
        ? ''
        : `Remaining files: ${directRendererRequireCalls.map((filePath) => path.relative(__dirname, filePath)).join(', ')}`
);

suite('Roadmap');

test(
    hasAll(roadmapSource, [
        '### Faz 9: Desktop App Productization',
        'Electron bridge ilk kez canonical hale getirildi;',
        'Launcher/workspace tarafi desktop\'a daha uygun hale getirildi;',
        'Desktop bridge katmani editor/runtime icine girmeye basladi;',
        'Faz 9 path migrasyonu baslatildi;',
        'Faz 9 fs migrasyonu da baslatildi;',
        'BuildSettingsWindow',
        'sync dosya sistemi IPC',
        'DesktopFileSystem',
        'window.require',
        'currentWorkingDirectory'
    ]),
    'Roadmap records the current desktop productization milestones'
);

log('blue', '\n━━━ TEST SUMMARY ━━━');
log('yellow', `Total Tests: ${testsPassed + testsFailed}`);
log(testsFailed === 0 ? 'green' : 'red', `Passed: ${testsPassed}`);
log(testsFailed === 0 ? 'green' : 'red', `Failed: ${testsFailed}`);

if (testsFailed === 0) {
    log('green', '\n✓ ALL TESTS PASSED - PHASE 9');
} else {
    log('red', '\n✗ SOME TESTS FAILED - PHASE 9');
    failedTests.forEach((name) => log('red', `  - ${name}`));
    process.exitCode = 1;
}
