type ElectronBridgeAPI = {
    currentWorkingDirectory?: string;
    showOpenDialog?: (options: any) => Promise<any>;
    showSaveDialog?: (options: any) => Promise<any>;
    revealInFolder?: (targetPath: string) => Promise<boolean>;
    exitApp?: () => void;
    readTextFile?: (filePath: string) => Promise<string | null>;
    writeTextFile?: (filePath: string, content: string) => Promise<boolean>;
    readSceneDocument?: (filePath: string) => Promise<SceneDocumentRead>;
    writeSceneDocument?: (
        filePath: string,
        content: string,
        expectedRevision?: string | null
    ) => Promise<SceneDocumentWrite>;
    fileExists?: (filePath: string) => Promise<boolean>;
    pathJoin?: (...segments: string[]) => Promise<string>;
    pathBasename?: (targetPath: string) => Promise<string>;
    setEditorDirty?: (dirty: boolean) => void;
    writeRecovery?: (projectPath: string, scenePath: string | null, sceneText: string) => Promise<boolean>;
    readRecovery?: (projectPath: string, scenePath: string | null) => Promise<any>;
    discardRecovery?: (projectPath: string) => Promise<boolean>;
    onCloseSaveRequested?: (callback: () => Promise<boolean>) => void;
};

type TugberkV1API = {
    request: (command: string, payload: Record<string, unknown>) => Promise<unknown>;
    scanAssets?: (
        resource: ProjectResource,
        options?: { signal?: AbortSignal; onProgress?: (progress: AssetScanProgress) => void }
    ) => Promise<AssetScanResult>;
};

export type ProjectGrant = {
    grantId: string;
    name: string;
    root: string;
    trust: ProjectTrustStatus;
};

export type ProjectResource = {
    grantId: string;
    path: string;
};

export type AssetScanResult = {
    assets: string[];
    scannedCount: number;
};

export type AssetScanProgress = { visited: number; pending: number };

export type ProjectTrustStatus = {
    root: string;
    identity: string;
    trusted: boolean;
    mode: 'trusted' | 'safe';
};

export type SceneDocumentRead = { text: string; revision: string };
export type SceneDocumentWrite = { revision: string; previousRevision: string | null };

export class DesktopBridge {
    private electronAPI: ElectronBridgeAPI | null;
    private protocol: TugberkV1API | null;

    constructor() {
        this.electronAPI = (window as any).electronAPI ?? null;
        this.protocol = (window as any).tugberk?.v1 ?? null;
    }

    public getElectronAPI(): ElectronBridgeAPI | null {
        return this.electronAPI;
    }

    public getCurrentWorkingDirectory(): string {
        return this.electronAPI?.currentWorkingDirectory ?? 'sample_project';
    }

    public async openProject(): Promise<ProjectGrant | null> {
        if (!this.protocol) return null;
        const result = await this.protocol.request('dialog.openProject', {}) as
            | { canceled: true }
            | ({ canceled: false } & ProjectGrant);
        return result.canceled ? null : result as ProjectGrant;
    }

    public async createProject(): Promise<ProjectGrant | null> {
        if (!this.protocol) throw new Error('Versioned desktop protocol is unavailable');
        const result = await this.protocol.request('dialog.createProject', {}) as { canceled: true } | ProjectGrant;
        return 'canceled' in result && result.canceled ? null : result as ProjectGrant;
    }

    public async openProjectPath(projectPath: string): Promise<ProjectGrant> {
        if (!this.protocol) throw new Error('Versioned desktop protocol is unavailable');
        return await this.protocol.request('project.open', { path: projectPath }) as ProjectGrant;
    }

    public async requestProjectTrust(projectPath: string): Promise<ProjectGrant> {
        if (!this.protocol) throw new Error('Versioned desktop protocol is unavailable');
        return await this.protocol.request('project.requestTrust', { path: projectPath }) as ProjectGrant;
    }

    public async revokeProjectTrust(projectPath: string): Promise<ProjectGrant> {
        if (!this.protocol) throw new Error('Versioned desktop protocol is unavailable');
        return await this.protocol.request('project.revokeTrust', { path: projectPath }) as ProjectGrant;
    }

    public async loadRecentProjects(): Promise<any[]> {
        if (!this.protocol) throw new Error('Versioned desktop protocol is unavailable');
        return await this.protocol.request('recentProjects.load', {}) as any[];
    }

    public async saveRecentProjects(projects: any[]): Promise<void> {
        if (!this.protocol) throw new Error('Versioned desktop protocol is unavailable');
        await this.protocol.request('recentProjects.save', { projects });
    }

    public async readProjectText(resource: ProjectResource): Promise<string> {
        if (!this.protocol) throw new Error('Versioned desktop protocol is unavailable');
        return await this.protocol.request('project.readText', resource) as string;
    }

    public async writeProjectText(resource: ProjectResource, content: string): Promise<void> {
        if (!this.protocol) throw new Error('Versioned desktop protocol is unavailable');
        await this.protocol.request('project.writeText', { ...resource, content });
    }

    public async listProjectDirectory(resource: ProjectResource): Promise<Array<{
        name: string;
        isDirectory: boolean;
        isFile: boolean;
        isSymbolicLink: boolean;
    }>> {
        if (!this.protocol) throw new Error('Versioned desktop protocol is unavailable');
        return await this.protocol.request('project.listDirectory', resource) as Array<{
            name: string;
            isDirectory: boolean;
            isFile: boolean;
            isSymbolicLink: boolean;
        }>;
    }

    public async revokeProjectGrant(grantId: string): Promise<void> {
        if (!this.protocol) return;
        await this.protocol.request('project.revokeGrant', { grantId });
    }

    public async scanAssets(
        resource: ProjectResource,
        options: { signal?: AbortSignal; onProgress?: (progress: AssetScanProgress) => void } = {}
    ): Promise<AssetScanResult> {
        if (!this.protocol) throw new Error('Versioned desktop protocol is unavailable');
        if (this.protocol.scanAssets) return await this.protocol.scanAssets(resource, options);
        return await this.protocol.request('asset.scan', resource) as AssetScanResult;
    }

    public async moveAsset(source: ProjectResource, destinationPath: string): Promise<{
        moved: boolean;
        metadataMoved: boolean;
    }> {
        if (!this.protocol) throw new Error('Versioned desktop protocol is unavailable');
        return await this.protocol.request('asset.move', { ...source, destinationPath }) as {
            moved: boolean;
            metadataMoved: boolean;
        };
    }

    public async writeAssetMetadata(resource: ProjectResource, metadata: Record<string, unknown>): Promise<void> {
        if (!this.protocol) throw new Error('Versioned desktop protocol is unavailable');
        await this.protocol.request('asset.writeMetadata', { ...resource, metadata });
    }

    public async readTextFile(filePath: string): Promise<string | null> {
        if (this.electronAPI?.readTextFile) {
            return await this.electronAPI.readTextFile(filePath);
        }
        return null;
    }

    public async writeTextFile(filePath: string, content: string): Promise<boolean> {
        if (this.electronAPI?.writeTextFile) {
            return await this.electronAPI.writeTextFile(filePath, content);
        }
        return false;
    }

    public async readSceneDocument(filePath: string): Promise<SceneDocumentRead> {
        if (!this.electronAPI?.readSceneDocument) {
            const text = await this.readTextFile(filePath);
            if (text === null) throw new Error(`Scene file missing: ${filePath}`);
            return { text, revision: '' };
        }
        return await this.electronAPI.readSceneDocument(filePath);
    }

    public async writeSceneDocument(
        filePath: string,
        content: string,
        expectedRevision?: string | null
    ): Promise<SceneDocumentWrite> {
        if (!this.electronAPI?.writeSceneDocument) {
            const saved = await this.writeTextFile(filePath, content);
            if (!saved) throw new Error('Desktop bridge rejected the scene write');
            return { revision: '', previousRevision: null };
        }
        return await this.electronAPI.writeSceneDocument(filePath, content, expectedRevision);
    }

    public async fileExists(filePath: string): Promise<boolean> {
        if (this.electronAPI?.fileExists) {
            return await this.electronAPI.fileExists(filePath);
        }
        return false;
    }

    public async pathJoin(...segments: string[]): Promise<string> {
        if (this.electronAPI?.pathJoin) {
            return await this.electronAPI.pathJoin(...segments);
        }
        return segments.join('/');
    }

    public async pathBasename(targetPath: string): Promise<string> {
        if (this.electronAPI?.pathBasename) {
            return await this.electronAPI.pathBasename(targetPath);
        }
        const parts = targetPath.split(/[\\/]/);
        return parts[parts.length - 1] || targetPath;
    }

    public setEditorDirty(dirty: boolean): void {
        this.electronAPI?.setEditorDirty?.(dirty);
    }

    public async writeRecovery(projectPath: string, scenePath: string | null, sceneText: string): Promise<boolean> {
        return await this.electronAPI?.writeRecovery?.(projectPath, scenePath, sceneText) ?? await Promise.resolve(false);
    }

    public async readRecovery(projectPath: string, scenePath: string | null): Promise<any> {
        return await this.electronAPI?.readRecovery?.(projectPath, scenePath) ?? await Promise.resolve(null);
    }

    public async discardRecovery(projectPath: string): Promise<boolean> {
        return await this.electronAPI?.discardRecovery?.(projectPath) ?? await Promise.resolve(false);
    }

    public onCloseSaveRequested(callback: () => Promise<boolean>): void {
        this.electronAPI?.onCloseSaveRequested?.(callback);
    }
}
