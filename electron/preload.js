const { contextBridge, ipcRenderer } = require('electron');

const electronAPI = {
    isElectron: true,
    platform: process.platform,
    currentWorkingDirectory: process.cwd(),
    versions: {
        chrome: process.versions.chrome || 'unknown',
        node: process.versions.node || 'unknown',
        electron: process.versions.electron || 'unknown'
    },
    showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
    showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
    loadRecentProjects: () => ipcRenderer.invoke('load-recent-projects'),
    saveRecentProjects: (projects) => ipcRenderer.invoke('save-recent-projects', projects),
    initializeProjectStructure: (projectPath) => ipcRenderer.invoke('initialize-project-structure', projectPath),
    readTextFile: (filePath) => ipcRenderer.invoke('read-text-file', filePath),
    writeTextFile: (filePath, content) => ipcRenderer.invoke('write-text-file', filePath, content),
    fileExists: (filePath) => ipcRenderer.invoke('file-exists', filePath),
    fsExistsSync: (targetPath) => ipcRenderer.sendSync('fs-exists-sync', targetPath),
    fsMkdirSync: (targetPath, options) => ipcRenderer.sendSync('fs-mkdir-sync', targetPath, options),
    fsReaddirSync: (targetPath, options) => ipcRenderer.sendSync('fs-readdir-sync', targetPath, options),
    fsStatSync: (targetPath) => ipcRenderer.sendSync('fs-stat-sync', targetPath),
    fsReadFileSync: (targetPath, encoding) => ipcRenderer.sendSync('fs-read-file-sync', targetPath, encoding),
    fsWriteFileSync: (targetPath, data, encoding) => ipcRenderer.sendSync('fs-write-file-sync', targetPath, data, encoding),
    fsCopyFileSync: (sourcePath, targetPath) => ipcRenderer.sendSync('fs-copy-file-sync', sourcePath, targetPath),
    fsRenameSync: (sourcePath, targetPath) => ipcRenderer.sendSync('fs-rename-sync', sourcePath, targetPath),
    fsRmSync: (targetPath, options) => ipcRenderer.sendSync('fs-rm-sync', targetPath, options),
    fsUnlinkSync: (targetPath) => ipcRenderer.sendSync('fs-unlink-sync', targetPath),
    pathJoin: (...segments) => ipcRenderer.invoke('path-join', ...segments),
    pathBasename: (targetPath) => ipcRenderer.invoke('path-basename', targetPath),
    revealInFolder: (targetPath) => ipcRenderer.invoke('reveal-in-folder', targetPath),
    exitApp: () => ipcRenderer.send('exit-app')
};

if (process.contextIsolated) {
    contextBridge.exposeInMainWorld('electronAPI', electronAPI);
} else {
    window.electronAPI = electronAPI;
}

window.addEventListener('DOMContentLoaded', () => {
    const replaceText = (selector, text) => {
        const element = document.getElementById(selector);
        if (element) element.innerText = text;
    };

    for (const dependency of ['chrome', 'node', 'electron']) {
        replaceText(`${dependency}-version`, electronAPI.versions[dependency] || 'unknown');
    }
});
