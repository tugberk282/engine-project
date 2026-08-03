import { Editor } from './editor/Editor';
import { Launcher } from './editor/Launcher';
import { ThemeManager } from './editor/ThemeManager';
import { DesktopBridge } from './platform/DesktopBridge';

window.addEventListener('DOMContentLoaded', () => {
    try {
        ThemeManager.init();

        const desktopBridge = new DesktopBridge();
        const electronAPI = desktopBridge.getElectronAPI();
        const launcherContainer = document.getElementById('launcher-container');
        const editorContainer = document.getElementById('editor-container');

        if (electronAPI) {
            if (launcherContainer) launcherContainer.style.display = 'flex';
            if (editorContainer) editorContainer.style.display = 'none';
            new Launcher();
            console.log('Engine Project initialized with launcher flow');
            return;
        }

        const projectPath = desktopBridge.getCurrentWorkingDirectory();
        if (launcherContainer) launcherContainer.style.display = 'none';
        if (editorContainer) editorContainer.style.display = 'flex';
        new Editor(projectPath);
        console.log('Engine Project initialized in direct editor mode');
    } catch (error) {
        (window as any).__engineBootstrapError = error instanceof Error
            ? { message: error.message, stack: error.stack ?? null }
            : { message: String(error), stack: null };
        console.error('Engine bootstrap failed:', error);
    }
});
