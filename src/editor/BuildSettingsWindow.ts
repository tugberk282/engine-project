import { BuildProgress, BuildSettings } from '../engine/BuildSettings';
import { DesktopFileSystem } from '../platform/DesktopFileSystem';
import { PathUtils } from '../platform/PathUtils';
import { EditorWindow } from './EditorWindow';

type SceneSelection = { path: string; included: boolean };

export class BuildSettingsWindow extends EditorWindow {
    private scenes: SceneSelection[] = [];
    private readonly fs = new DesktopFileSystem();
    private readonly builds = new BuildSettings();
    private activeBuildId: string | null = null;
    private status = 'Loading project scenes…';

    constructor(parent: HTMLElement) { super(parent, 'Build Settings'); void this.refreshScenes(); }
    public refresh(): void { this.onGUI(); }

    private projectRoot(): string {
        const assetsRoot = (window as any).Editor?.instance?.rootPath;
        if (!assetsRoot) throw new Error('Open a project before building.');
        return PathUtils.dirname(assetsRoot);
    }

    public async refreshScenes(): Promise<void> {
        try {
            const manifest = JSON.parse(await this.fs.readFile(PathUtils.join(this.projectRoot(), 'project.json'), 'utf8') as string);
            const prior = new Map(this.scenes.map((scene) => [scene.path, scene.included]));
            this.scenes = (manifest.scenes ?? []).map((scene: { path: string }) => ({
                path: scene.path.replace(/\\/g, '/'), included: prior.get(scene.path) ?? true
            }));
            this.status = this.scenes.length ? 'Ready to build.' : 'No authored scenes are listed in project.json.';
        } catch (error) { this.scenes = []; this.status = this.errorMessage(error); }
        this.refresh();
    }

    private async startBuild(outputPath: string): Promise<void> {
        const scenes = this.scenes.filter((scene) => scene.included).map((scene) => scene.path);
        if (!scenes.length) throw new Error('Select at least one scene.');
        const projectRoot = this.projectRoot();
        const projectText = await this.fs.readFile(PathUtils.join(projectRoot, 'project.json'), 'utf8') as string;
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(projectText));
        const projectRevision = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
        const buildId = `build-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
        this.activeBuildId = buildId; this.status = 'Starting build…'; this.refresh();
        const unsubscribe = this.builds.onProgress((id: string, progress: BuildProgress) => {
            if (id === buildId) { this.status = `${progress.stage} (${progress.stageIndex + 1}/${progress.stageCount})`; this.refresh(); }
        });
        try {
            const result = await this.builds.build({ version: 1, buildId, projectRoot, projectRevision, outputPath, target: 'win-x64', scenes });
            this.status = `Build complete: ${result.outputPath}`;
            await (window as any).electronAPI?.revealInFolder?.(result.outputPath);
        } catch (error) { this.status = this.errorMessage(error); }
        finally { unsubscribe(); this.activeBuildId = null; this.refresh(); }
    }

    private errorMessage(error: unknown): string {
        const value = error as { code?: string; message?: string };
        return `${value.code ? `${value.code}: ` : ''}${value.message || 'Build failed.'}`;
    }

    public onGUI(): void {
        const content = this.getContentArea(); content.innerHTML = '';
        content.style.cssText = 'padding:12px;display:flex;flex-direction:column;gap:10px;min-width:520px;min-height:360px';
        const title = document.createElement('strong'); title.innerText = 'Scenes In Build'; content.appendChild(title);
        const list = document.createElement('div'); list.style.cssText = 'flex:1;overflow:auto;border:1px solid var(--unity-border);padding:6px';
        this.scenes.forEach((scene, index) => {
            const row = document.createElement('label'); row.style.cssText = 'display:flex;gap:8px;padding:4px';
            const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = scene.included;
            checkbox.disabled = !!this.activeBuildId; checkbox.onchange = () => { scene.included = checkbox.checked; };
            row.append(checkbox, document.createTextNode(`${index}. ${scene.path}`)); list.appendChild(row);
        });
        content.appendChild(list);
        const status = document.createElement('div'); status.setAttribute('role', 'status'); status.innerText = this.status; content.appendChild(status);
        const actions = document.createElement('div'); actions.style.cssText = 'display:flex;justify-content:flex-end;gap:8px';
        const refresh = document.createElement('button'); refresh.innerText = 'Refresh'; refresh.disabled = !!this.activeBuildId;
        refresh.onclick = () => void this.refreshScenes();
        const build = document.createElement('button'); build.innerText = this.activeBuildId ? 'Cancel Build' : 'Build Windows Player';
        build.disabled = !this.activeBuildId && !this.scenes.some((scene) => scene.included);
        build.onclick = async () => {
            if (this.activeBuildId) { await this.builds.cancel(this.activeBuildId).catch(() => {}); return; }
            const result = await (window as any).electronAPI?.showOpenDialog?.({ title: 'Select Windows build output folder', properties: ['openDirectory', 'createDirectory'] });
            if (!result || result.canceled || !result.filePaths?.[0]) return;
            await this.startBuild(PathUtils.join(result.filePaths[0], `${BuildSettings.productName || 'Tugberk Game'}-Windows`));
        };
        actions.append(refresh, build); content.appendChild(actions);
    }
}
