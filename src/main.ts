import { Editor } from './editor/Editor';
import { ThemeManager } from './editor/ThemeManager';
import { DesktopBridge } from './platform/DesktopBridge';

// Initialize the Editor directly bypassing the Hub/Launcher
window.addEventListener('DOMContentLoaded', () => {
    ThemeManager.init();

    const desktopBridge = new DesktopBridge();
    const projectPath = desktopBridge.getCurrentWorkingDirectory();

    new Editor(projectPath);
    console.log("TugberkEngine Initialized in Pure Mode");
});
