const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

function getRecentProjectsStorePath() {
    return path.join(app.getPath('userData'), 'recent-projects.json');
}

function readRecentProjects() {
    const storePath = getRecentProjectsStorePath();
    if (!fs.existsSync(storePath)) return [];
    try {
        const raw = fs.readFileSync(storePath, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function writeRecentProjects(projects) {
    const storePath = getRecentProjectsStorePath();
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, JSON.stringify(projects, null, 2), 'utf8');
}

// IPC Handlers for Native Dialogs
ipcMain.handle('show-save-dialog', async (event, options) => {
    const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), options);
    return result;
});

ipcMain.handle('show-open-dialog', async (event, options) => {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), options);
    return result;
});

ipcMain.handle('load-recent-projects', async () => {
    return readRecentProjects();
});

ipcMain.handle('save-recent-projects', async (_event, projects) => {
    if (!Array.isArray(projects)) return false;
    writeRecentProjects(projects);
    return true;
});

ipcMain.handle('initialize-project-structure', async (_event, projectPath) => {
    if (typeof projectPath !== 'string' || projectPath.length === 0) return false;

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
    if (!fs.existsSync(defaultScenePath)) {
        fs.writeFileSync(defaultScenePath, JSON.stringify({
            name: 'SampleScene',
            gameObjects: []
        }, null, 2), 'utf8');
    }

    return true;
});

ipcMain.handle('read-text-file', async (_event, filePath) => {
    if (typeof filePath !== 'string' || filePath.length === 0 || !fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf8');
});

ipcMain.handle('write-text-file', async (_event, filePath, content) => {
    if (typeof filePath !== 'string' || filePath.length === 0 || typeof content !== 'string') return false;
    fs.writeFileSync(filePath, content, 'utf8');
    return true;
});

ipcMain.handle('file-exists', async (_event, filePath) => {
    if (typeof filePath !== 'string' || filePath.length === 0) return false;
    return fs.existsSync(filePath);
});

ipcMain.handle('path-join', async (_event, ...segments) => {
    return path.join(...segments.filter((segment) => typeof segment === 'string'));
});

ipcMain.handle('path-basename', async (_event, targetPath) => {
    if (typeof targetPath !== 'string') return '';
    return path.basename(targetPath);
});

ipcMain.handle('reveal-in-folder', async (_event, targetPath) => {
    if (typeof targetPath === 'string' && targetPath.length > 0) {
        shell.showItemInFolder(targetPath);
        return true;
    }
    return false;
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
        isFile: entry.isFile()
    };
}

ipcMain.on('fs-exists-sync', (event, targetPath) => {
    event.returnValue = typeof targetPath === 'string' && targetPath.length > 0 ? fs.existsSync(targetPath) : false;
});

ipcMain.on('fs-mkdir-sync', (event, targetPath, options) => {
    if (typeof targetPath !== 'string' || targetPath.length === 0) {
        event.returnValue = false;
        return;
    }
    fs.mkdirSync(targetPath, options);
    event.returnValue = true;
});

ipcMain.on('fs-readdir-sync', (event, targetPath, options) => {
    if (typeof targetPath !== 'string' || targetPath.length === 0 || !fs.existsSync(targetPath)) {
        event.returnValue = [];
        return;
    }
    const entries = fs.readdirSync(targetPath, options);
    if (options?.withFileTypes) {
        event.returnValue = entries.map(serializeDirEntry);
        return;
    }
    event.returnValue = entries;
});

ipcMain.on('fs-stat-sync', (event, targetPath) => {
    if (typeof targetPath !== 'string' || targetPath.length === 0 || !fs.existsSync(targetPath)) {
        event.returnValue = null;
        return;
    }
    event.returnValue = serializeStat(fs.statSync(targetPath));
});

ipcMain.on('fs-read-file-sync', (event, targetPath, encoding) => {
    if (typeof targetPath !== 'string' || targetPath.length === 0 || !fs.existsSync(targetPath)) {
        event.returnValue = null;
        return;
    }
    if (typeof encoding === 'string' && encoding.length > 0) {
        event.returnValue = fs.readFileSync(targetPath, encoding);
        return;
    }
    const buffer = fs.readFileSync(targetPath);
    event.returnValue = {
        __binary: true,
        data: Array.from(buffer)
    };
});

ipcMain.on('fs-write-file-sync', (event, targetPath, data, encoding) => {
    if (typeof targetPath !== 'string' || targetPath.length === 0) {
        event.returnValue = false;
        return;
    }
    const normalizedData = data && data.__binary && Array.isArray(data.data)
        ? Buffer.from(data.data)
        : data;
    if (typeof encoding === 'string' && encoding.length > 0) {
        fs.writeFileSync(targetPath, normalizedData, encoding);
    } else {
        fs.writeFileSync(targetPath, normalizedData);
    }
    event.returnValue = true;
});

ipcMain.on('fs-copy-file-sync', (event, sourcePath, targetPath) => {
    if (typeof sourcePath !== 'string' || typeof targetPath !== 'string' || sourcePath.length === 0 || targetPath.length === 0) {
        event.returnValue = false;
        return;
    }
    fs.copyFileSync(sourcePath, targetPath);
    event.returnValue = true;
});

ipcMain.on('fs-rename-sync', (event, sourcePath, targetPath) => {
    if (typeof sourcePath !== 'string' || typeof targetPath !== 'string' || sourcePath.length === 0 || targetPath.length === 0) {
        event.returnValue = false;
        return;
    }
    fs.renameSync(sourcePath, targetPath);
    event.returnValue = true;
});

ipcMain.on('fs-rm-sync', (event, targetPath, options) => {
    if (typeof targetPath !== 'string' || targetPath.length === 0) {
        event.returnValue = false;
        return;
    }
    fs.rmSync(targetPath, options);
    event.returnValue = true;
});

ipcMain.on('fs-unlink-sync', (event, targetPath) => {
    if (typeof targetPath !== 'string' || targetPath.length === 0) {
        event.returnValue = false;
        return;
    }
    fs.unlinkSync(targetPath);
    event.returnValue = true;
});

ipcMain.on('exit-app', () => {
    app.quit();
});

const createWindow = () => {
    // Create the browser window.
    const mainWindow = new BrowserWindow({
        width: 1280,
        height: 720,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: true,
            contextIsolation: false, // For easier prototyping; secure apps should use true
            webSecurity: false // To allow loading local resources comfortably
        },
        icon: path.join(__dirname, '../public/favicon.ico')
    });

    // Load the app.
    // In development, we load the Vite dev server
    const isDev = !app.isPackaged;
    if (isDev) {
        mainWindow.loadURL('http://localhost:5174');
        mainWindow.webContents.openDevTools();
    } else {
        // In production, load the built index.html
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }

    // Remove menu for a cleaner "app" feel (optional)
    mainWindow.setMenuBarVisibility(false);
};

// This method will be called when Electron has finished initialization
app.on('ready', createWindow);

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
