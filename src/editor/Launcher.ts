import { Editor } from './Editor';
import { DesktopBridge, ProjectGrant } from '../platform/DesktopBridge';

type RecentProject = { name: string; path: string; lastOpened: number };

export class Launcher {
    private electronAPI: any;
    private desktopBridge = new DesktopBridge();
    private recentProjects: RecentProject[] = [];
    private busy = false;

    constructor() {
        this.electronAPI = (window as any).electronAPI ?? null;
        void this.start();
    }

    private async start() {
        this.bindActions();
        if (!this.electronAPI) {
            this.renderProjectList();
            this.showError('The project launcher requires the Tugberk Engine desktop app.');
            this.setBusy(false);
            return;
        }
        this.setBusy(true, 'Loading recent projects…');
        try {
            await this.loadRecentProjects();
            this.renderProjectList();
            this.setStatus('');
        } catch (error) {
            this.recentProjects = [];
            this.renderProjectList();
            this.showError('Recent projects could not be loaded.', error, () => this.reloadRecentProjects());
        } finally {
            this.setBusy(false);
        }

        const autoOpenProjectPath = this.electronAPI?.launchArgs?.autoOpenProjectPath;
        if (typeof autoOpenProjectPath === 'string' && autoOpenProjectPath.length > 0) {
            const requestConsent = this.electronAPI?.launchArgs?.smokeTest !== true;
            await this.runAction(() => this.launchProject(autoOpenProjectPath, requestConsent));
        }
    }

    private async reloadRecentProjects() {
        await this.loadRecentProjects();
        this.renderProjectList();
        this.setStatus('');
    }

    private bindActions() {
        const btnOpen = document.getElementById('btn-open-project');
        const btnNew = document.getElementById('btn-new-project');
        if (btnOpen) btnOpen.onclick = () => void this.runAction(() => this.handleOpenProject());
        if (btnNew) btnNew.onclick = () => void this.runAction(() => this.handleNewProject());
    }

    private async loadRecentProjects() {
        if (!this.electronAPI?.loadRecentProjects) return;
        const loaded = await this.desktopBridge.loadRecentProjects();
        this.recentProjects = Array.isArray(loaded) ? loaded : [];
    }

    private async saveRecentProjects() {
        await this.desktopBridge.saveRecentProjects(this.recentProjects);
    }

    private async handleOpenProject() {
        if (!this.electronAPI) throw new Error('Desktop project services are unavailable.');
        const project = await this.desktopBridge.openProject();
        if (project) await this.launchProjectGrant(project);
    }

    private async handleNewProject() {
        if (!this.electronAPI) throw new Error('Desktop project services are unavailable.');
        const project = await this.desktopBridge.createProject();
        if (project) await this.launchProjectGrant(project);
    }

    private async launchProject(projectPath: string, requestConsent = true) {
        this.setStatus(`Opening ${this.getPathBaseName(projectPath)}…`);
        const project = requestConsent
            ? await this.desktopBridge.requestProjectTrust(projectPath)
            : await this.desktopBridge.openProjectPath(projectPath);
        await this.launchProjectGrant(project);
    }

    private async launchProjectGrant(project: ProjectGrant) {
        const projectPath = project.root;
        const trust = project.trust;
        (window as any).__projectSecurity = Object.freeze({
            mode: trust?.trusted ? 'trusted' : 'safe',
            trusted: trust?.trusted === true,
            projectIdentity: trust?.identity ?? null,
            allowsProjectExecution: trust?.trusted === true,
            grantId: project.grantId,
            root: project.root
        });

        const projectName = this.getPathBaseName(projectPath);
        const launcher = document.getElementById('launcher-container');
        const editor = document.getElementById('editor-container');
        console.log(`Launching project: ${projectName} at ${projectPath}`);
        try {
            new Editor(projectPath);
            this.recentProjects = this.recentProjects.filter(p => p.path !== projectPath);
            this.recentProjects.unshift({ name: projectName, path: projectPath, lastOpened: Date.now() });
            this.recentProjects = this.recentProjects.slice(0, 10);
            try {
                await this.saveRecentProjects();
            } catch (error) {
                console.warn('Launcher could not save recent projects:', error);
            }
            if (launcher) launcher.style.display = 'none';
            if (editor) editor.style.display = 'flex';
        } catch (error) {
            (window as any).__engineLaunchError = error instanceof Error
                ? { name: error.name, message: error.message, stack: error.stack ?? null }
                : { name: 'UnknownError', message: String(error), stack: null };
            console.error('Launcher failed to create Editor:', error);
            if (editor) editor.style.display = 'none';
            if (launcher) launcher.style.display = 'flex';
            this.showError(
                `Could not open “${projectName}”. Check that the project is valid and try again.`,
                error,
                () => this.launchProject(projectPath)
            );
        }
    }

    private async runAction(action: () => Promise<void>) {
        if (this.busy) return;
        this.setBusy(true);
        try {
            await action();
        } catch (error) {
            this.showError('The launcher could not complete that action.', error);
        } finally {
            this.setBusy(false);
        }
    }

    private setBusy(busy: boolean, message?: string) {
        this.busy = busy;
        document.getElementById('launcher-project-list')?.setAttribute('aria-busy', String(busy));
        for (const id of ['btn-open-project', 'btn-new-project']) {
            const button = document.getElementById(id) as HTMLButtonElement | null;
            if (button) button.disabled = busy;
        }
        document.querySelectorAll<HTMLButtonElement>('.project-item').forEach(item => item.disabled = busy);
        if (message) this.setStatus(message);
    }

    private setStatus(message: string, isError = false, retry?: () => Promise<void>) {
        const status = document.getElementById('launcher-status');
        if (!status) return;
        status.replaceChildren(document.createTextNode(message));
        status.classList.toggle('error', isError);
        status.tabIndex = isError ? -1 : 0;
        if (retry) {
            const retryButton = document.createElement('button');
            retryButton.type = 'button';
            retryButton.className = 'launcher-status-action';
            retryButton.textContent = 'Retry';
            retryButton.onclick = () => void this.runAction(retry);
            status.append(' ', retryButton);
        }
        if (isError) status.focus();
    }

    private showError(message: string, error?: unknown, retry?: () => Promise<void>) {
        const detail = error instanceof Error ? error.message : error == null ? '' : String(error);
        this.setStatus(detail && detail !== message ? `${message} ${detail}` : message, true, retry);
        if (error) console.error(message, error);
    }

    private getPathBaseName(projectPath: string): string {
        const normalized = projectPath.replace(/[\\/]+$/, '');
        const parts = normalized.split(/[\\/]/);
        return parts[parts.length - 1] || projectPath;
    }

    private renderProjectList() {
        const list = document.getElementById('launcher-project-list');
        if (!list) return;
        list.replaceChildren();

        if (this.recentProjects.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'project-list-empty';
            empty.textContent = 'No recent projects. Create a project or open an existing one.';
            list.appendChild(empty);
            return;
        }

        this.recentProjects.forEach(p => {
            const row = document.createElement('div');
            row.className = 'project-row';
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'project-item';
            item.setAttribute('aria-label', `Open ${p.name}, ${p.path}`);

            const info = document.createElement('div');
            info.className = 'project-info';
            const name = document.createElement('div');
            name.className = 'project-name';
            name.textContent = p.name;
            const projectPath = document.createElement('div');
            projectPath.className = 'project-path';
            projectPath.textContent = p.path;
            info.append(name, projectPath);

            const date = document.createElement('div');
            date.className = 'project-date';
            date.textContent = new Date(p.lastOpened).toLocaleDateString();
            item.append(info, date);
            item.onclick = () => void this.runAction(() => this.launchProject(p.path));
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'project-remove';
            remove.textContent = 'Remove';
            remove.setAttribute('aria-label', `Remove ${p.name} from recent projects`);
            remove.onclick = () => void this.removeRecentProject(p.path, item);
            row.append(item, remove);
            list.appendChild(row);
        });
    }

    private async removeRecentProject(projectPath: string, returnFocusTo: HTMLElement) {
        const index = this.recentProjects.findIndex(project => project.path === projectPath);
        if (index < 0) return;
        const fallbackIndex = Math.min(index, this.recentProjects.length - 2);
        this.recentProjects.splice(index, 1);
        await this.saveRecentProjects();
        this.renderProjectList();
        const items = document.querySelectorAll<HTMLButtonElement>('.project-item');
        (items[fallbackIndex] ?? document.getElementById('btn-open-project') ?? returnFocusTo).focus();
        this.setStatus('Project removed from recent projects.');
    }
}
