import { Editor } from './Editor';

export class Launcher {
    private electronAPI: any;
    private recentProjects: { name: string, path: string, lastOpened: number }[] = [];

    constructor() {
        this.electronAPI = (window as any).electronAPI ?? null;

        this.loadRecentProjects().finally(() => this.initializeUI());
    }

    private async loadRecentProjects() {
        if (!this.electronAPI?.loadRecentProjects) return;
        const loaded = await this.electronAPI.loadRecentProjects();
        this.recentProjects = Array.isArray(loaded) ? loaded : [];
    }

    private async saveRecentProjects() {
        await this.electronAPI?.saveRecentProjects?.(this.recentProjects);
    }

    private initializeUI() {
        const btnOpen = document.getElementById('btn-open-project');
        const btnNew = document.getElementById('btn-new-project');

        if (btnOpen) btnOpen.onclick = () => this.handleOpenProject();
        if (btnNew) btnNew.onclick = () => this.handleNewProject();

        this.renderProjectList();
    }

    private async handleOpenProject() {
        if (!this.electronAPI) return;

        const result = await this.electronAPI.showOpenDialog({
            title: 'Open Project',
            properties: ['openDirectory']
        });

        if (!result.canceled && result.filePaths.length > 0) {
            const projectPath = result.filePaths[0];
            this.launchProject(projectPath);
        }
    }

    private async handleNewProject() {
        if (!this.electronAPI) return;

        const result = await this.electronAPI.showOpenDialog({
            title: 'Select Folder for New Project',
            properties: ['openDirectory', 'createDirectory']
        });

        if (!result.canceled && result.filePaths.length > 0) {
            const projectPath = result.filePaths[0];
            await this.initializeFolderStructure(projectPath);
            this.launchProject(projectPath);
        }
    }

    private async initializeFolderStructure(projectPath: string) {
        await this.electronAPI?.initializeProjectStructure?.(projectPath);
    }

    private launchProject(projectPath: string) {
        const projectName = this.getPathBaseName(projectPath);

        // Update recents
        this.recentProjects = this.recentProjects.filter(p => p.path !== projectPath);
        this.recentProjects.unshift({
            name: projectName,
            path: projectPath,
            lastOpened: Date.now()
        });
        if (this.recentProjects.length > 10) this.recentProjects.pop();
        void this.saveRecentProjects();

        // Switch UI
        const launcher = document.getElementById('launcher-container');
        const editor = document.getElementById('editor-container');

        if (launcher) launcher.style.display = 'none';
        if (editor) editor.style.display = 'flex';

        // Initialize Editor with the new rootPath
        console.log(`Launching project: ${projectName} at ${projectPath}`);
        new Editor(projectPath);
    }

    private getPathBaseName(projectPath: string): string {
        const normalized = projectPath.replace(/[\\/]+$/, '');
        const parts = normalized.split(/[\\/]/);
        return parts[parts.length - 1] || projectPath;
    }

    private renderProjectList() {
        const list = document.getElementById('launcher-project-list');
        if (!list) return;

        if (this.recentProjects.length === 0) {
            list.innerHTML = '<div style="padding: 40px; text-align: center; opacity: 0.5;">No recent projects. Click "New" to start.</div>';
            return;
        }

        list.innerHTML = '';
        this.recentProjects.forEach(p => {
            const item = document.createElement('div');
            item.className = 'project-item';
            item.innerHTML = `
                <div class="project-info">
                    <div class="project-name">${p.name}</div>
                    <div class="project-path">${p.path}</div>
                </div>
                <div class="project-date">${new Date(p.lastOpened).toLocaleDateString()}</div>
                <div class="project-options">⋮</div>
            `;
            item.onclick = () => this.launchProject(p.path);
            list.appendChild(item);
        });
    }
}
