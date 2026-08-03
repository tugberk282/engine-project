export type BuildTarget = 'win-x64' | 'linux-x64' | 'darwin-x64' | 'darwin-arm64';

export type BuildRequest = Readonly<{
    version: 1;
    projectRoot: string;
    projectRevision: string;
    outputPath: string;
    target: BuildTarget;
}>;

export type BuildProgress = Readonly<{
    buildId: string;
    stage: 'validate' | 'resolve' | 'import' | 'bundle' | 'package';
    stageIndex: number;
    stageCount: number;
}>;

export type BuildResult = Readonly<{
    buildId: string;
    outputPath: string;
    manifest: Readonly<{ manifestVersion: 1; manifestHash: string }>;
}>;

type BuildProtocol = {
    request(command: string, payload: Record<string, unknown>): Promise<unknown>;
};

/** Renderer adapter. Execution, paths, workers and publication remain in main. */
export class BuildSettings {
    // Legacy editor preferences remain compatible while project-scoped settings
    // migrate away from localStorage. They do not execute privileged build work.
    public static scenes: string[] = [];
    public static platform: 'WebGL' | 'Windows' | 'Mac' | 'Linux' = 'Windows';
    public static productName = 'TugberkEngine Game';
    public static companyName = 'Tugberk Studio';
    public static version = '1.0.0';

    private readonly protocol: BuildProtocol;

    constructor(protocol: BuildProtocol = (window as any).tugberk?.v1) {
        if (!protocol) throw new Error('Versioned desktop build protocol is unavailable');
        this.protocol = protocol;
    }

    public async build(request: BuildRequest): Promise<BuildResult> {
        return await this.protocol.request('build.start', request) as BuildResult;
    }

    public async cancel(buildId: string): Promise<void> {
        await this.protocol.request('build.cancel', { buildId });
    }

    public static save(): void {
        localStorage.setItem('tugberkengine_build_settings', JSON.stringify({
            scenes: this.scenes,
            platform: this.platform,
            productName: this.productName,
            companyName: this.companyName,
            version: this.version
        }));
    }

    public static load(): void {
        const text = localStorage.getItem('tugberkengine_build_settings');
        if (!text) return;
        const value = JSON.parse(text);
        if (Array.isArray(value.scenes)) this.scenes = value.scenes.filter((entry: unknown) => typeof entry === 'string');
        if (['WebGL', 'Windows', 'Mac', 'Linux'].includes(value.platform)) this.platform = value.platform;
        if (typeof value.productName === 'string') this.productName = value.productName;
        if (typeof value.companyName === 'string') this.companyName = value.companyName;
        if (typeof value.version === 'string') this.version = value.version;
    }

    public static build(): never {
        throw new Error('Build execution requires the versioned desktop BuildSettings adapter');
    }
}
