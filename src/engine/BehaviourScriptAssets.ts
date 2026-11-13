const MAX_PROGRAM_LENGTH = 64 * 1024;
const MAX_PREFAB_LENGTH = 1024 * 1024;

export class BehaviourScriptAssetError extends Error {
    public readonly code: string;

    public constructor(code: string, message: string) {
        super(message);
        this.name = 'BehaviourScriptAssetError';
        this.code = code;
    }
}

export function normalizeBehaviourScriptAssetPath(value: unknown): string | null {
    if (typeof value !== 'string' || value.trim().length === 0) return null;
    const normalized = value.trim().replace(/[\\/]+/g, '/');
    if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) return null;
    const segments = normalized.split('/');
    if (segments[0] !== 'Assets' || segments.some((segment) => !segment || segment === '.' || segment === '..')) return null;
    if (!normalized.toLowerCase().endsWith('.behaviour.json')) return null;
    return normalized;
}

export function validateBehaviourScriptAssetSource(source: string, assetPath: string): void {
    if (source.length > MAX_PROGRAM_LENGTH) {
        throw new BehaviourScriptAssetError('BEHAVIOUR_SCRIPT_ASSET_TOO_LARGE', `${assetPath} exceeds ${MAX_PROGRAM_LENGTH} characters.`);
    }
    let value: any;
    try {
        value = JSON.parse(source);
    } catch (cause) {
        throw new BehaviourScriptAssetError('BEHAVIOUR_SCRIPT_ASSET_INVALID', `${assetPath} contains invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new BehaviourScriptAssetError('BEHAVIOUR_SCRIPT_ASSET_INVALID', `${assetPath} must contain a JSON object.`);
    }
    if (value.version !== undefined && value.version !== 1) {
        throw new BehaviourScriptAssetError('BEHAVIOUR_SCRIPT_ASSET_VERSION_UNSUPPORTED', `${assetPath} uses unsupported BehaviourScript version ${String(value.version)}.`);
    }
    for (const field of ['start', 'update', 'fixedUpdate']) {
        if (value[field] !== undefined && !Array.isArray(value[field])) {
            throw new BehaviourScriptAssetError('BEHAVIOUR_SCRIPT_ASSET_INVALID', `${assetPath} field '${field}' must be an action array.`);
        }
    }
}

export function normalizeRuntimePrefabAssetPath(value: unknown): string | null {
    if (typeof value !== 'string' || value.trim().length === 0) return null;
    const normalized = value.trim().replace(/[\\/]+/g, '/');
    if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) return null;
    const segments = normalized.split('/');
    if (segments[0] !== 'Assets' || segments.some((segment) => !segment || segment === '.' || segment === '..')) return null;
    return normalized.toLowerCase().endsWith('.prefab') ? normalized : null;
}

function parseRuntimePrefab(source: string, assetPath: string): Record<string, unknown> {
    if (source.length > MAX_PREFAB_LENGTH) {
        throw new BehaviourScriptAssetError('RUNTIME_PREFAB_TOO_LARGE', `${assetPath} exceeds ${MAX_PREFAB_LENGTH} characters.`);
    }
    let value: any;
    try {
        value = JSON.parse(source);
    } catch (cause) {
        throw new BehaviourScriptAssetError('RUNTIME_PREFAB_INVALID', `${assetPath} contains invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    if (!value || typeof value !== 'object' || Array.isArray(value) || !value.data || typeof value.data !== 'object' || Array.isArray(value.data)) {
        throw new BehaviourScriptAssetError('RUNTIME_PREFAB_INVALID', `${assetPath} does not contain serialized prefab data.`);
    }
    return value.data as Record<string, unknown>;
}

export async function resolveBehaviourScriptAssets(
    snapshot: string,
    projectRoot: string,
    readText: (absolutePath: string) => Promise<string | null>
): Promise<string> {
    const document = JSON.parse(snapshot) as { gameObjects?: any[] };
    const sources = new Map<string, string>();
    const prefabs = new Map<string, Record<string, unknown>>();
    const resolvePrefabActions = async (programSource: string): Promise<string> => {
        let program: any;
        let changed = false;
        try {
            program = JSON.parse(programSource || '{}');
        } catch {
            return programSource;
        }
        const visitActions = async (actions: unknown): Promise<void> => {
            if (!Array.isArray(actions)) return;
            for (const action of actions) {
                if (!action || typeof action !== 'object' || Array.isArray(action)) continue;
                const record = action as Record<string, any>;
                if (record.op === 'instantiatePrefab') {
                    const assetPath = normalizeRuntimePrefabAssetPath(record.prefabPath);
                    if (!assetPath) {
                        throw new BehaviourScriptAssetError('RUNTIME_PREFAB_PATH_INVALID', `Runtime prefab path is invalid: ${String(record.prefabPath)}`);
                    }
                    let data = prefabs.get(assetPath);
                    if (!data) {
                        const absolutePath = `${projectRoot.replace(/[\\/]+$/g, '')}/${assetPath}`;
                        const source = await readText(absolutePath);
                        if (source === null) {
                            throw new BehaviourScriptAssetError('RUNTIME_PREFAB_MISSING', `Runtime prefab could not be read: ${assetPath}`);
                        }
                        data = parseRuntimePrefab(source, assetPath);
                        prefabs.set(assetPath, data);
                    }
                    record.prefabPath = assetPath;
                    record.prefabData = structuredClone(data);
                    changed = true;
                }
                await visitActions(record.then);
                await visitActions(record.else);
            }
        };
        await visitActions(program.start);
        await visitActions(program.update);
        await visitActions(program.fixedUpdate);
        for (const actions of Object.values(program.events || {})) await visitActions(actions);
        if (!changed) return programSource;
        const resolved = JSON.stringify(program);
        if (resolved.length > MAX_PROGRAM_LENGTH) {
            throw new BehaviourScriptAssetError('RUNTIME_PREFAB_PROGRAM_TOO_LARGE', `Resolved BehaviourScript exceeds ${MAX_PROGRAM_LENGTH} characters.`);
        }
        return resolved;
    };
    const visit = async (node: any): Promise<void> => {
        for (const component of Array.isArray(node?.components) ? node.components : []) {
            if (component?.type !== 'BehaviourScript') continue;
            const rawPath = component?.data?.assetPath;
            if (typeof rawPath !== 'string' || rawPath.trim().length === 0) {
                component.data.program = await resolvePrefabActions(String(component?.data?.program || '{}'));
                continue;
            }
            const assetPath = normalizeBehaviourScriptAssetPath(rawPath);
            if (!assetPath) {
                throw new BehaviourScriptAssetError('BEHAVIOUR_SCRIPT_ASSET_PATH_INVALID', `BehaviourScript asset path is invalid: ${String(rawPath)}`);
            }
            let source = sources.get(assetPath);
            if (source === undefined) {
                const absolutePath = `${projectRoot.replace(/[\\/]+$/g, '')}/${assetPath}`;
                source = await readText(absolutePath) ?? undefined;
                if (source === undefined) {
                    throw new BehaviourScriptAssetError('BEHAVIOUR_SCRIPT_ASSET_MISSING', `BehaviourScript asset could not be read: ${assetPath}`);
                }
                validateBehaviourScriptAssetSource(source, assetPath);
                sources.set(assetPath, source);
            }
            component.data.program = await resolvePrefabActions(source);
            component.data.assetPath = assetPath;
        }
        for (const child of Array.isArray(node?.children) ? node.children : []) await visit(child);
    };
    for (const root of document.gameObjects || []) await visit(root);
    return JSON.stringify(document);
}
