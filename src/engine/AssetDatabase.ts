import { PathUtils } from '../platform/PathUtils';
import { DesktopFileSystem } from '../platform/DesktopFileSystem';
export type AssetType =
    | 'folder'
    | 'script'
    | 'scene'
    | 'prefab'
    | 'material'
    | 'texture'
    | 'model'
    | 'audio'
    | 'scriptableObject'
    | 'unknown';

export interface AssetMetaImporter {
    name: string;
    version: number;
    settings: Record<string, string | number | boolean>;
}

export interface AssetMeta {
    formatVersion: number;
    guid: string;
    assetType: AssetType;
    fileExtension: string;
    timeCreated: number;
    labels: string[];
    userData: Record<string, string>;
    importer: AssetMetaImporter;
}

export interface AssetEntry {
    path: string;
    guid: string;
    meta: AssetMeta;
}

interface AssetFileFingerprint {
    guid: string;
    assetMTimeMs: number;
    assetSize: number;
    metaMTimeMs: number;
    metaSize: number;
    metaSignature: string;
}

export interface AssetRefreshMove {
    guid: string;
    from: string;
    to: string;
}

export interface AssetRefreshResult {
    added: string[];
    removed: string[];
    changed: string[];
    metaChanged: string[];
    metaRepaired: string[];
    duplicateGuidRepaired: string[];
    orphanMetaFiles: string[];
    moved: AssetRefreshMove[];
    scannedCount: number;
}

interface MetaReadResult {
    meta: AssetMeta | null;
    malformed: boolean;
}

interface AssetScanContext {
    scannedCount: number;
    readonly maxDepth: number;
    readonly maxEntries: number;
}

export class AssetDatabase {
    private static readonly MAX_SCAN_DEPTH = 64;
    private static readonly MAX_SCAN_ENTRIES = 50_000;
    private static readonly MAX_META_BYTES = 1024 * 1024;
    private static instance: AssetDatabase;
    private guidToPath: Map<string, string> = new Map();
    private pathToGuid: Map<string, string> = new Map();
    private pathToMeta: Map<string, AssetMeta> = new Map();
    private pathToFingerprint: Map<string, AssetFileFingerprint> = new Map();
    private dependencyGuidsBySourceGuid: Map<string, Set<string>> = new Map();
    private referencerGuidsByTargetGuid: Map<string, Set<string>> = new Map();
    private repairedMalformedMetaPaths: Set<string> = new Set();
    private repairedDuplicateGuidPaths: Set<string> = new Set();
    private orphanMetaFilePaths: Set<string> = new Set();
    private refreshQueue: Promise<void> = Promise.resolve();
    private fs: DesktopFileSystem;
    private constructor() {
        this.fs = new DesktopFileSystem();
    }

    public static getInstance(): AssetDatabase {
        if (!AssetDatabase.instance) {
            AssetDatabase.instance = new AssetDatabase();
        }
        return AssetDatabase.instance;
    }

    public refresh(rootPath: string): Promise<AssetRefreshResult> {
        const refresh = this.refreshQueue.then(
            () => this.refreshInternal(rootPath),
            () => this.refreshInternal(rootPath)
        );
        this.refreshQueue = refresh.then(() => undefined, () => undefined);
        return refresh;
    }

    private async refreshInternal(rootPath: string): Promise<AssetRefreshResult> {
        const emptyResult: AssetRefreshResult = {
            added: [],
            removed: [],
            changed: [],
            metaChanged: [],
            metaRepaired: [],
            duplicateGuidRepaired: [],
            orphanMetaFiles: [],
            moved: [],
            scannedCount: 0
        };
        if (!this.fs || !await this.fs.exists(rootPath)) return emptyResult;

        const previousGuidToPath = new Map(this.guidToPath);
        const previousPathToFingerprint = new Map(this.pathToFingerprint);
        this.guidToPath.clear();
        this.pathToGuid.clear();
        this.pathToMeta.clear();
        this.pathToFingerprint.clear();
        this.dependencyGuidsBySourceGuid.clear();
        this.referencerGuidsByTargetGuid.clear();
        this.repairedMalformedMetaPaths.clear();
        this.repairedDuplicateGuidPaths.clear();
        this.orphanMetaFilePaths.clear();
        await this.scanPath(rootPath, new Set<string>(), 0, {
            scannedCount: 0,
            maxDepth: AssetDatabase.MAX_SCAN_DEPTH,
            maxEntries: AssetDatabase.MAX_SCAN_ENTRIES
        });
        this.rebuildDependencyGraph();

        const added: string[] = [];
        const removed: string[] = [];
        const changed: string[] = [];
        const metaChanged: string[] = [];

        this.pathToFingerprint.forEach((fingerprint, assetPath) => {
            const previousFingerprint = previousPathToFingerprint.get(assetPath);
            if (!previousFingerprint) {
                added.push(assetPath);
                return;
            }

            const assetContentChanged =
                previousFingerprint.assetMTimeMs !== fingerprint.assetMTimeMs ||
                previousFingerprint.assetSize !== fingerprint.assetSize;
            const metaContentChanged =
                previousFingerprint.metaMTimeMs !== fingerprint.metaMTimeMs ||
                previousFingerprint.metaSize !== fingerprint.metaSize ||
                previousFingerprint.metaSignature !== fingerprint.metaSignature;

            if (assetContentChanged || metaContentChanged) {
                changed.push(assetPath);
            }
            if (metaContentChanged) {
                metaChanged.push(assetPath);
            }
        });

        previousPathToFingerprint.forEach((_fingerprint, assetPath) => {
            if (!this.pathToFingerprint.has(assetPath)) {
                removed.push(assetPath);
            }
        });

        const moved: AssetRefreshMove[] = [];
        previousGuidToPath.forEach((oldPath, guid) => {
            const nextPath = this.guidToPath.get(guid);
            if (nextPath && nextPath !== oldPath) {
                moved.push({ guid, from: oldPath, to: nextPath });
            }
        });

        return {
            added: added.sort((left, right) => left.localeCompare(right)),
            removed: removed.sort((left, right) => left.localeCompare(right)),
            changed: changed.sort((left, right) => left.localeCompare(right)),
            metaChanged: metaChanged.sort((left, right) => left.localeCompare(right)),
            metaRepaired: Array.from(this.repairedMalformedMetaPaths).sort((left, right) => left.localeCompare(right)),
            duplicateGuidRepaired: Array.from(this.repairedDuplicateGuidPaths).sort((left, right) => left.localeCompare(right)),
            orphanMetaFiles: Array.from(this.orphanMetaFilePaths).sort((left, right) => left.localeCompare(right)),
            moved,
            scannedCount: this.pathToFingerprint.size
        };
    }

    public registerAsset(path: string, guid: string = crypto.randomUUID()): string {
        this.guidToPath.set(guid, path);
        this.pathToGuid.set(path, guid);
        return guid;
    }

    public getPath(guid: string): string | undefined {
        return this.guidToPath.get(guid);
    }

    public getGuid(path: string): string | undefined {
        return this.pathToGuid.get(path);
    }

    public getMeta(path: string): AssetMeta | undefined {
        return this.pathToMeta.get(path);
    }

    public getMetaByGuid(guid: string): AssetMeta | undefined {
        const path = this.guidToPath.get(guid);
        return path ? this.pathToMeta.get(path) : undefined;
    }

    public getEntry(path: string): AssetEntry | undefined {
        const guid = this.pathToGuid.get(path);
        const meta = this.pathToMeta.get(path);
        if (!guid || !meta) return undefined;

        return {
            path,
            guid,
            meta
        };
    }

    public async updateMeta(assetPath: string, updater: (meta: AssetMeta) => AssetMeta | void): Promise<AssetMeta | null> {
        if (!this.fs || !await this.fs.exists(assetPath)) return null;

        const currentMeta = this.pathToMeta.get(assetPath)
            ?? (await this.readMeta(`${assetPath}.meta`)).meta
            ?? await this.ensureMetaForPath(assetPath, (await this.fs.stat(assetPath)).isDirectory(), new Set(this.guidToPath.keys()));

        const workingCopy: AssetMeta = JSON.parse(JSON.stringify(currentMeta));
        const result = updater(workingCopy);
        const nextMeta = result ?? workingCopy;

        const normalizedMeta: AssetMeta = {
            formatVersion: 1,
            guid: currentMeta.guid,
            assetType: currentMeta.assetType,
            fileExtension: currentMeta.fileExtension,
            timeCreated: currentMeta.timeCreated,
            labels: Array.isArray(nextMeta.labels)
                ? nextMeta.labels.filter((label): label is string => typeof label === 'string')
                : [],
            userData: this.normalizeUserData(nextMeta.userData),
            importer: this.normalizeImporter(currentMeta.assetType, nextMeta.importer)
        };

        await this.writeMeta(assetPath, normalizedMeta);
        this.pathToMeta.set(assetPath, normalizedMeta);
        this.guidToPath.set(normalizedMeta.guid, assetPath);
        this.pathToGuid.set(assetPath, normalizedMeta.guid);
        return normalizedMeta;
    }

    public getAllEntries(): AssetEntry[] {
        return Array.from(this.pathToGuid.entries()).map(([path, guid]) => ({
            path,
            guid,
            meta: this.pathToMeta.get(path)!
        }));
    }

    public getDependencyPaths(assetPathOrGuid: string): string[] {
        const sourceGuid = this.resolveGuid(assetPathOrGuid);
        if (!sourceGuid) return [];

        const dependencyGuids = this.dependencyGuidsBySourceGuid.get(sourceGuid);
        if (!dependencyGuids) return [];

        return Array.from(dependencyGuids)
            .map((guid) => this.guidToPath.get(guid))
            .filter((entryPath): entryPath is string => typeof entryPath === 'string')
            .sort((left, right) => left.localeCompare(right));
    }

    public getReferencerPaths(assetPathOrGuid: string): string[] {
        const targetGuid = this.resolveGuid(assetPathOrGuid);
        if (!targetGuid) return [];

        const referencerGuids = this.referencerGuidsByTargetGuid.get(targetGuid);
        if (!referencerGuids) return [];

        return Array.from(referencerGuids)
            .map((guid) => this.guidToPath.get(guid))
            .filter((entryPath): entryPath is string => typeof entryPath === 'string')
            .sort((left, right) => left.localeCompare(right));
    }

    public getDependencyClosurePaths(assetPathOrGuid: string, includeSelf: boolean = true): string[] {
        const sourceGuid = this.resolveGuid(assetPathOrGuid);
        if (!sourceGuid) return [];

        const closure = this.collectGuidClosure(sourceGuid, this.dependencyGuidsBySourceGuid);
        if (!includeSelf) {
            closure.delete(sourceGuid);
        }
        return this.guidSetToSortedPaths(closure);
    }

    public getReferencerClosurePaths(assetPathOrGuid: string, includeSelf: boolean = true): string[] {
        const sourceGuid = this.resolveGuid(assetPathOrGuid);
        if (!sourceGuid) return [];

        const closure = this.collectGuidClosure(sourceGuid, this.referencerGuidsByTargetGuid);
        if (!includeSelf) {
            closure.delete(sourceGuid);
        }
        return this.guidSetToSortedPaths(closure);
    }

    public serialize(): any {
        return Array.from(this.guidToPath.entries());
    }

    public deserialize(data: [string, string][]): void {
        this.guidToPath = new Map(data);
        this.pathToGuid = new Map(data.map(([guid, path]) => [path, guid]));
    }

    private async scanPath(assetPath: string, usedGuids: Set<string>, depth: number, context: AssetScanContext) {
        if (!await this.fs.exists(assetPath)) return;
        if (depth > context.maxDepth) {
            throw new Error(`Asset scan depth exceeds ${context.maxDepth} at ${assetPath}`);
        }
        context.scannedCount += 1;
        if (context.scannedCount > context.maxEntries) {
            throw new Error(`Asset scan exceeds ${context.maxEntries} entries at ${assetPath}`);
        }

        const stat = await this.fs.stat(assetPath);
        if (!stat) {
            throw new Error(`Asset path could not be inspected: ${assetPath}`);
        }
        const meta = await this.ensureMetaForPath(assetPath, stat.isDirectory(), usedGuids);

        this.guidToPath.set(meta.guid, assetPath);
        this.pathToGuid.set(assetPath, meta.guid);
        this.pathToMeta.set(assetPath, meta);
        this.pathToFingerprint.set(assetPath, await this.buildFingerprint(assetPath, stat, meta));

        if (!stat.isDirectory()) return;

        const entries = (await this.fs.readdir(assetPath, { withFileTypes: true }))
            .filter((entry: { name: string }) => !entry.name.endsWith('.meta'))
            .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));

        const safeEntries = entries.filter((entry: { isSymbolicLink?: () => boolean }) => entry.isSymbolicLink?.() !== true);
        await this.collectOrphanMetaFiles(assetPath, safeEntries.map((entry: { name: string }) => entry.name));

        for (const entry of safeEntries) {
            await this.scanPath(PathUtils.join(assetPath, entry.name), usedGuids, depth + 1, context);
        }
    }

    private async ensureMetaForPath(assetPath: string, isDirectory: boolean, usedGuids: Set<string>): Promise<AssetMeta> {
        const metaPath = `${assetPath}.meta`;
        const metaReadResult = await this.readMeta(metaPath);
        const existingMeta = metaReadResult.meta;
        const assetType = this.inferAssetType(assetPath, isDirectory);
        const hadDuplicateGuid = typeof existingMeta?.guid === 'string' && existingMeta.guid.trim().length > 0 && usedGuids.has(existingMeta.guid.trim());
        const guid = this.getUniqueGuid(existingMeta?.guid, usedGuids);

        const normalizedMeta: AssetMeta = {
            formatVersion: 1,
            guid,
            assetType,
            fileExtension: isDirectory ? '' : (PathUtils.extname(assetPath).toLowerCase().replace('.', '')),
            timeCreated: typeof existingMeta?.timeCreated === 'number' ? existingMeta.timeCreated : Date.now(),
            labels: Array.isArray(existingMeta?.labels)
                ? existingMeta.labels.filter((label: unknown): label is string => typeof label === 'string')
                : [],
            userData: this.normalizeUserData(existingMeta?.userData),
            importer: this.normalizeImporter(assetType, existingMeta?.importer)
        };

        const nextJson = JSON.stringify(normalizedMeta, null, 2);
        const currentJson = existingMeta ? JSON.stringify(existingMeta, null, 2) : null;
        if (currentJson !== nextJson) {
            await this.writeMeta(assetPath, normalizedMeta);
            if (metaReadResult.malformed) {
                this.repairedMalformedMetaPaths.add(assetPath);
            }
            if (hadDuplicateGuid) {
                this.repairedDuplicateGuidPaths.add(assetPath);
            }
        }

        return normalizedMeta;
    }

    private async collectOrphanMetaFiles(directoryPath: string, assetEntryNames: string[]) {
        const assetNames = new Set(assetEntryNames);
        const metaEntries = (await this.fs.readdir(directoryPath, { withFileTypes: true }))
            .filter((entry: { name: string; isFile?: () => boolean }) => entry.name.endsWith('.meta') && (entry.isFile?.() ?? true));

        metaEntries.forEach((entry: { name: string }) => {
            const assetName = entry.name.slice(0, -5);
            if (!assetNames.has(assetName)) {
                this.orphanMetaFilePaths.add(PathUtils.join(directoryPath, entry.name));
            }
        });
    }

    private async buildFingerprint(assetPath: string, stat: any, meta: AssetMeta): Promise<AssetFileFingerprint> {
        const metaPath = `${assetPath}.meta`;
        const metaStat = await this.fs.exists(metaPath) ? await this.fs.stat(metaPath) : null;

        return {
            guid: meta.guid,
            assetMTimeMs: typeof stat?.mtimeMs === 'number' ? stat.mtimeMs : 0,
            assetSize: stat?.isDirectory?.() ? 0 : (typeof stat?.size === 'number' ? stat.size : 0),
            metaMTimeMs: typeof metaStat?.mtimeMs === 'number' ? metaStat.mtimeMs : 0,
            metaSize: typeof metaStat?.size === 'number' ? metaStat.size : 0,
            metaSignature: JSON.stringify(meta)
        };
    }

    private async writeMeta(assetPath: string, meta: AssetMeta) {
        const metaPath = `${assetPath}.meta`;
        await this.fs.writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
    }

    private async readMeta(metaPath: string): Promise<MetaReadResult> {
        if (!await this.fs.exists(metaPath)) return { meta: null, malformed: false };

        try {
            const stat = await this.fs.stat(metaPath);
            if (!stat || stat.size > AssetDatabase.MAX_META_BYTES) {
                throw new Error(`Asset metadata exceeds ${AssetDatabase.MAX_META_BYTES} bytes: ${metaPath}`);
            }
            return {
                meta: JSON.parse(await this.fs.readFile(metaPath, 'utf8')) as AssetMeta,
                malformed: false
            };
        } catch {
            return {
                meta: null,
                malformed: true
            };
        }
    }

    private getUniqueGuid(candidate: unknown, usedGuids: Set<string>): string {
        const normalizedCandidate = typeof candidate === 'string' && candidate.trim().length > 0
            ? candidate.trim()
            : null;

        if (normalizedCandidate && !usedGuids.has(normalizedCandidate)) {
            usedGuids.add(normalizedCandidate);
            return normalizedCandidate;
        }

        let guid = crypto.randomUUID();
        while (usedGuids.has(guid)) {
            guid = crypto.randomUUID();
        }
        usedGuids.add(guid);
        return guid;
    }

    private normalizeUserData(value: unknown): Record<string, string> {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

        const normalized: Record<string, string> = {};
        Object.entries(value as Record<string, unknown>).forEach(([key, entryValue]) => {
            if (typeof entryValue === 'string') {
                normalized[key] = entryValue;
            }
        });
        return normalized;
    }

    private normalizeImporter(assetType: AssetType, importer: unknown): AssetMetaImporter {
        const defaults = this.getDefaultImporter(assetType);
        if (!importer || typeof importer !== 'object' || Array.isArray(importer)) {
            return defaults;
        }

        const candidate = importer as Partial<AssetMetaImporter> & { settings?: Record<string, unknown> };
        const settings: Record<string, string | number | boolean> = { ...defaults.settings };

        Object.entries(candidate.settings ?? {}).forEach(([key, value]) => {
            if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
                settings[key] = value;
            }
        });

        const normalizedSettings = this.sanitizeImporterSettings(assetType, settings);

        return {
            name: typeof candidate.name === 'string' && candidate.name.trim().length > 0 ? candidate.name : defaults.name,
            version: typeof candidate.version === 'number' ? candidate.version : defaults.version,
            settings: normalizedSettings
        };
    }

    private sanitizeImporterSettings(
        assetType: AssetType,
        settings: Record<string, string | number | boolean>
    ): Record<string, string | number | boolean> {
        const nextSettings = { ...settings };

        const readBoolean = (key: string, fallback: boolean): boolean =>
            typeof nextSettings[key] === 'boolean' ? nextSettings[key] as boolean : fallback;
        const readNumber = (key: string, fallback: number): number =>
            typeof nextSettings[key] === 'number' && Number.isFinite(nextSettings[key]) ? nextSettings[key] as number : fallback;
        const readString = (key: string, fallback: string): string =>
            typeof nextSettings[key] === 'string' && (nextSettings[key] as string).trim().length > 0 ? (nextSettings[key] as string).trim() : fallback;

        switch (assetType) {
            case 'script':
                nextSettings.autoReferenced = readBoolean('autoReferenced', true);
                nextSettings.executionOrder = Math.trunc(readNumber('executionOrder', 0));
                break;
            case 'scene':
                nextSettings.includeInBuild = readBoolean('includeInBuild', true);
                nextSettings.autoLighting = readBoolean('autoLighting', true);
                break;
            case 'prefab':
                nextSettings.autoReconnect = readBoolean('autoReconnect', true);
                nextSettings.preserveOverrides = readBoolean('preserveOverrides', true);
                break;
            case 'material': {
                const shader = readString('shader', 'Standard').toLowerCase();
                nextSettings.shader = shader === 'unlit'
                    ? 'Unlit'
                    : shader === 'transparent'
                        ? 'Transparent'
                        : 'Standard';
                nextSettings.doubleSidedGI = readBoolean('doubleSidedGI', false);
                break;
            }
            case 'texture': {
                const wrapMode = readString('wrapMode', 'repeat').toLowerCase();
                const filterMode = readString('filterMode', 'bilinear').toLowerCase();
                nextSettings.sRGB = readBoolean('sRGB', true);
                nextSettings.alphaIsTransparency = readBoolean('alphaIsTransparency', true);
                nextSettings.wrapMode = ['repeat', 'clamp', 'mirror'].includes(wrapMode) ? wrapMode : 'repeat';
                nextSettings.filterMode = ['point', 'bilinear', 'trilinear'].includes(filterMode) ? filterMode : 'bilinear';
                nextSettings.maxSize = Math.max(1, Math.round(readNumber('maxSize', 2048)));
                break;
            }
            case 'model':
                nextSettings.scaleFactor = Math.max(0.0001, readNumber('scaleFactor', 1));
                nextSettings.importAnimations = readBoolean('importAnimations', true);
                nextSettings.generateColliders = readBoolean('generateColliders', false);
                nextSettings.readWriteEnabled = readBoolean('readWriteEnabled', false);
                break;
            case 'audio': {
                const loadType = readString('loadType', 'decompressOnLoad').toLowerCase();
                nextSettings.loadType = loadType === 'streaming'
                    ? 'streaming'
                    : loadType === 'compressedinmemory'
                        ? 'compressedInMemory'
                        : 'decompressOnLoad';
                nextSettings.preloadAudioData = readBoolean('preloadAudioData', true);
                nextSettings.forceToMono = readBoolean('forceToMono', false);
                break;
            }
            case 'scriptableObject':
                nextSettings.inspectorCollapsed = readBoolean('inspectorCollapsed', false);
                break;
            default:
                break;
        }

        return nextSettings;
    }

    private getDefaultImporter(assetType: AssetType): AssetMetaImporter {
        switch (assetType) {
            case 'folder':
                return { name: 'folder', version: 1, settings: { defaultLabel: 'Folder' } };
            case 'script':
                return { name: 'script', version: 1, settings: { autoReferenced: true, executionOrder: 0 } };
            case 'scene':
                return { name: 'scene', version: 1, settings: { includeInBuild: true, autoLighting: true } };
            case 'prefab':
                return { name: 'prefab', version: 1, settings: { autoReconnect: true, preserveOverrides: true } };
            case 'material':
                return { name: 'material', version: 1, settings: { shader: 'Standard', doubleSidedGI: false } };
            case 'texture':
                return { name: 'texture', version: 1, settings: { sRGB: true, alphaIsTransparency: true, wrapMode: 'repeat', filterMode: 'bilinear', maxSize: 2048 } };
            case 'model':
                return { name: 'model', version: 1, settings: { scaleFactor: 1, importAnimations: true, generateColliders: false, readWriteEnabled: false } };
            case 'audio':
                return { name: 'audio', version: 1, settings: { loadType: 'decompressOnLoad', preloadAudioData: true, forceToMono: false } };
            case 'scriptableObject':
                return { name: 'scriptableObject', version: 1, settings: { inspectorCollapsed: false } };
            default:
                return { name: 'default', version: 1, settings: { imported: true } };
        }
    }

    private inferAssetType(assetPath: string, isDirectory: boolean): AssetType {
        if (isDirectory) return 'folder';

        const ext = PathUtils.extname(assetPath).toLowerCase();

        if (['.cs', '.ts'].includes(ext)) return 'script';
        if (ext === '.scene' || ext === '.json') return 'scene';
        if (ext === '.prefab') return 'prefab';
        if (ext === '.mat') return 'material';
        if (ext === '.asset') return 'scriptableObject';
        if (['.gltf', '.glb', '.fbx', '.obj'].includes(ext)) return 'model';
        if (['.png', '.jpg', '.jpeg', '.tga', '.bmp', '.webp'].includes(ext)) return 'texture';
        if (['.mp3', '.wav', '.ogg', '.flac'].includes(ext)) return 'audio';

        return 'unknown';
    }

    private rebuildDependencyGraph(): void {
        this.dependencyGuidsBySourceGuid.clear();
        this.referencerGuidsByTargetGuid.clear();

        this.pathToGuid.forEach( async(sourceGuid, sourcePath) => {
            const meta = this.pathToMeta.get(sourcePath);
            if (!meta) return;

            const referencedGuids = await this.collectReferencedGuids(sourcePath, meta.assetType);
            referencedGuids.delete(sourceGuid);
            if (referencedGuids.size === 0) return;

            this.dependencyGuidsBySourceGuid.set(sourceGuid, referencedGuids);
            referencedGuids.forEach((targetGuid) => {
                if (!this.referencerGuidsByTargetGuid.has(targetGuid)) {
                    this.referencerGuidsByTargetGuid.set(targetGuid, new Set());
                }
                this.referencerGuidsByTargetGuid.get(targetGuid)!.add(sourceGuid);
            });
        });
    }

    private async collectReferencedGuids(assetPath: string, assetType: AssetType): Promise<Set<string>> {
        const supportedTypes: AssetType[] = ['scene', 'prefab', 'material', 'scriptableObject'];
        if (!supportedTypes.includes(assetType)) return new Set<string>();
        if (!this.fs || !await this.fs.exists(assetPath)) return new Set<string>();

        try {
            const raw = await this.fs.readFile(assetPath, 'utf8');
            const json = JSON.parse(raw);
            const collected = new Set<string>();
            this.collectReferencedGuidsRecursive(json, collected);
            return collected;
        } catch {
            return new Set<string>();
        }
    }

    private collectReferencedGuidsRecursive(value: unknown, collector: Set<string>): void {
        if (!value || typeof value !== 'object') return;

        if (Array.isArray(value)) {
            value.forEach((entry) => this.collectReferencedGuidsRecursive(entry, collector));
            return;
        }

        Object.entries(value as Record<string, unknown>).forEach(([key, entryValue]) => {
            if (typeof entryValue === 'string') {
                if (key.endsWith('Guid')) {
                    const guid = entryValue.trim();
                    if (guid && this.guidToPath.has(guid)) {
                        collector.add(guid);
                    }
                    return;
                }

                if (key.endsWith('Path')) {
                    const normalizedPath = this.normalizeReferencePath(entryValue);
                    const guid = this.pathToGuid.get(normalizedPath);
                    if (guid) {
                        collector.add(guid);
                    }
                    return;
                }
            }

            this.collectReferencedGuidsRecursive(entryValue, collector);
        });
    }

    private normalizeReferencePath(assetPath: string): string {
        if (!assetPath.startsWith('file://')) return assetPath;

        try {
            return decodeURIComponent(assetPath.replace(/^file:\/\//, ''));
        } catch {
            return assetPath.replace(/^file:\/\//, '');
        }
    }

    private resolveGuid(assetPathOrGuid: string): string | null {
        if (this.guidToPath.has(assetPathOrGuid)) return assetPathOrGuid;
        return this.pathToGuid.get(assetPathOrGuid) ?? null;
    }

    private collectGuidClosure(rootGuid: string, graph: Map<string, Set<string>>): Set<string> {
        const visited = new Set<string>();
        const queue: string[] = [rootGuid];

        while (queue.length > 0) {
            const current = queue.shift();
            if (!current || visited.has(current)) continue;
            visited.add(current);

            const neighbors = graph.get(current);
            if (!neighbors) continue;

            neighbors.forEach((neighbor) => {
                if (!visited.has(neighbor)) {
                    queue.push(neighbor);
                }
            });
        }

        return visited;
    }

    private guidSetToSortedPaths(guidSet: Set<string>): string[] {
        return Array.from(guidSet)
            .map((guid) => this.guidToPath.get(guid))
            .filter((entryPath): entryPath is string => typeof entryPath === 'string')
            .sort((left, right) => left.localeCompare(right));
    }
}
