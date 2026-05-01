type ElectronFileSystemAPI = {
    fsExistsSync?: (targetPath: string) => boolean;
    fsMkdirSync?: (targetPath: string, options?: any) => boolean;
    fsReaddirSync?: (targetPath: string, options?: any) => any[];
    fsStatSync?: (targetPath: string) => any;
    fsReadFileSync?: (targetPath: string, encoding?: BufferEncoding | string) => any;
    fsWriteFileSync?: (targetPath: string, data: any, encoding?: BufferEncoding | string) => boolean;
    fsCopyFileSync?: (sourcePath: string, targetPath: string) => boolean;
    fsRenameSync?: (sourcePath: string, targetPath: string) => boolean;
    fsRmSync?: (targetPath: string, options?: any) => boolean;
    fsUnlinkSync?: (targetPath: string) => boolean;
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
};

export class DesktopFileSystem {
    private electronAPI: ElectronFileSystemAPI | null;

    constructor() {
        this.electronAPI = (window as any).electronAPI ?? null;
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
            isFile: () => entry.isFile === true
        }));
    }

    public existsSync(targetPath: string): boolean {
        return this.electronAPI?.fsExistsSync?.(targetPath) === true;
    }

    public mkdirSync(targetPath: string, options?: any): void {
        this.electronAPI?.fsMkdirSync?.(targetPath, options);
    }

    public readdirSync(targetPath: string, options?: any): any[] {
        const entries = this.electronAPI?.fsReaddirSync?.(targetPath, options) ?? [];
        return options?.withFileTypes ? this.deserializeDirEntries(entries) : entries;
    }

    public statSync(targetPath: string): any {
        return this.deserializeStat(this.electronAPI?.fsStatSync?.(targetPath) ?? null);
    }

    public readFileSync(targetPath: string, encoding?: BufferEncoding | string): any {
        const result = this.electronAPI?.fsReadFileSync?.(targetPath, encoding) ?? null;
        if (result && result.__binary && Array.isArray(result.data)) {
            return Uint8Array.from(result.data);
        }
        return result;
    }

    public writeFileSync(targetPath: string, data: any, encoding?: BufferEncoding | string): void {
        const normalizedData = data instanceof Uint8Array
            ? { __binary: true, data: Array.from(data) }
            : data;
        this.electronAPI?.fsWriteFileSync?.(targetPath, normalizedData, encoding);
    }

    public copyFileSync(sourcePath: string, targetPath: string): void {
        this.electronAPI?.fsCopyFileSync?.(sourcePath, targetPath);
    }

    public renameSync(sourcePath: string, targetPath: string): void {
        this.electronAPI?.fsRenameSync?.(sourcePath, targetPath);
    }

    public rmSync(targetPath: string, options?: any): void {
        this.electronAPI?.fsRmSync?.(targetPath, options);
    }

    public unlinkSync(targetPath: string): void {
        this.electronAPI?.fsUnlinkSync?.(targetPath);
    }
}
