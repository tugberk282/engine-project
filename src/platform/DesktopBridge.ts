type ElectronBridgeAPI = {
    currentWorkingDirectory?: string;
    showOpenDialog?: (options: any) => Promise<any>;
    showSaveDialog?: (options: any) => Promise<any>;
    loadRecentProjects?: () => Promise<any>;
    saveRecentProjects?: (projects: any[]) => Promise<boolean>;
    initializeProjectStructure?: (projectPath: string) => Promise<boolean>;
    revealInFolder?: (targetPath: string) => Promise<boolean>;
    exitApp?: () => void;
    readTextFile?: (filePath: string) => Promise<string | null>;
    writeTextFile?: (filePath: string, content: string) => Promise<boolean>;
    fileExists?: (filePath: string) => Promise<boolean>;
    pathJoin?: (...segments: string[]) => Promise<string>;
    pathBasename?: (targetPath: string) => Promise<string>;
};

export class DesktopBridge {
    private electronAPI: ElectronBridgeAPI | null;

    constructor() {
        this.electronAPI = (window as any).electronAPI ?? null;
    }

    public getElectronAPI(): ElectronBridgeAPI | null {
        return this.electronAPI;
    }

    public getCurrentWorkingDirectory(): string {
        return this.electronAPI?.currentWorkingDirectory ?? 'sample_project';
    }

    public async readTextFile(filePath: string): Promise<string | null> {
        if (this.electronAPI?.readTextFile) {
            return this.electronAPI.readTextFile(filePath);
        }
        return null;
    }

    public async writeTextFile(filePath: string, content: string): Promise<boolean> {
        if (this.electronAPI?.writeTextFile) {
            return this.electronAPI.writeTextFile(filePath, content);
        }
        return false;
    }

    public async fileExists(filePath: string): Promise<boolean> {
        if (this.electronAPI?.fileExists) {
            return this.electronAPI.fileExists(filePath);
        }
        return false;
    }

    public async pathJoin(...segments: string[]): Promise<string> {
        if (this.electronAPI?.pathJoin) {
            return this.electronAPI.pathJoin(...segments);
        }
        return segments.join('/');
    }

    public async pathBasename(targetPath: string): Promise<string> {
        if (this.electronAPI?.pathBasename) {
            return this.electronAPI.pathBasename(targetPath);
        }
        const parts = targetPath.split(/[\\/]/);
        return parts[parts.length - 1] || targetPath;
    }
}
