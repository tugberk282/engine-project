type ElectronFileSystemAPI = {
    fsExists?: (targetPath: string) => Promise<boolean>;
    fsMkdir?: (targetPath: string, options?: any) => Promise<boolean>;
    fsReaddir?: (targetPath: string, options?: any) => Promise<any[]>;
    fsStat?: (targetPath: string) => Promise<any>;
    fsReadFile?: (targetPath: string, encoding?: BufferEncoding | string) => Promise<any>;
    fsWriteFile?: (targetPath: string, data: any, encoding?: BufferEncoding | string) => Promise<boolean>;
    fsCopyFile?: (sourcePath: string, targetPath: string) => Promise<boolean>;
    fsRename?: (sourcePath: string, targetPath: string) => Promise<boolean>;
    fsRm?: (targetPath: string, options?: any) => Promise<boolean>;
    fsUnlink?: (targetPath: string) => Promise<boolean>;
};

type TugberkV1API = {
    request: (command: string, payload: Record<string, unknown>) => Promise<unknown>;
};

type SerializedStat = {
    size: number;
    mtimeMs: number;
    isDirectory: boolean;
    isFile: boolean;
};

type SerializedDirEntry = {
    name: string;
    isDirectory: boolean;
    isFile: boolean;
    isSymbolicLink: boolean;
};

export class DesktopFileSystem {
    private electronAPI: ElectronFileSystemAPI | null;
    private protocol: TugberkV1API | null;

    constructor() {
        this.electronAPI = (window as any).electronAPI ?? null;
        this.protocol = (window as any).tugberk?.v1 ?? null;
    }

    private deserializeStat(stat: SerializedStat | null): any {
        if (!stat) return null;
        return {
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            isDirectory: () => stat.isDirectory === true,
            isFile: () => stat.isFile === true
        };
    }

    private deserializeDirEntries(entries: SerializedDirEntry[]): any[] {
        return entries.map((entry) => ({
            name: entry.name,
            isDirectory: () => entry.isDirectory === true,
            isFile: () => entry.isFile === true,
            isSymbolicLink: () => entry.isSymbolicLink === true
        }));
    }

    public async exists(targetPath: string): Promise<boolean> {
        return await this.electronAPI?.fsExists?.(targetPath) === true;
    }

    public async mkdir(targetPath: string, options?: any): Promise<void> {
        await this.electronAPI?.fsMkdir?.(targetPath, options);
    }

    public async readdir(targetPath: string, options?: any): Promise<any[]> {
        const entries = await this.electronAPI?.fsReaddir?.(targetPath, options) ?? [];
        return options?.withFileTypes ? this.deserializeDirEntries(entries) : entries;
    }

    public async stat(targetPath: string): Promise<any> {
        return this.deserializeStat(await this.electronAPI?.fsStat?.(targetPath) ?? null);
    }

    public async readFile(targetPath: string, encoding?: BufferEncoding | string): Promise<any> {
        const result = await this.electronAPI?.fsReadFile?.(targetPath, encoding) ?? null;
        if (result && result.__binary && Array.isArray(result.data)) {
            return Uint8Array.from(result.data);
        }
        return result;
    }

    public async writeFile(targetPath: string, data: any, encoding?: BufferEncoding | string): Promise<void> {
        const normalizedData = data instanceof Uint8Array
            ? { __binary: true, data: Array.from(data) }
            : data;
        await this.electronAPI?.fsWriteFile?.(targetPath, normalizedData, encoding);
    }

    public async copyFile(sourcePath: string, targetPath: string): Promise<void> {
        await this.electronAPI?.fsCopyFile?.(sourcePath, targetPath);
    }

    public async rename(sourcePath: string, targetPath: string): Promise<void> {
        await this.electronAPI?.fsRename?.(sourcePath, targetPath);
    }

    public async rm(targetPath: string, options?: any): Promise<void> {
        await this.electronAPI?.fsRm?.(targetPath, options);
    }

    public async unlink(targetPath: string): Promise<void> {
        await this.electronAPI?.fsUnlink?.(targetPath);
    }

    public async readProjectFile(grantId: string, relativePath: string): Promise<string> {
        if (!this.protocol) throw new Error('Versioned desktop protocol is unavailable');
        return await this.protocol.request('project.readText', {
            grantId,
            path: relativePath
        }) as string;
    }

    public async listProjectDirectory(grantId: string, relativePath: string): Promise<any[]> {
        if (!this.protocol) throw new Error('Versioned desktop protocol is unavailable');
        const entries = await this.protocol.request('project.listDirectory', {
            grantId,
            path: relativePath
        }) as SerializedDirEntry[];
        return this.deserializeDirEntries(entries);
    }
}
