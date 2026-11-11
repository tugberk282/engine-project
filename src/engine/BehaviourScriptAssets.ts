const MAX_PROGRAM_LENGTH = 64 * 1024;

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

export async function resolveBehaviourScriptAssets(
    snapshot: string,
    projectRoot: string,
    readText: (absolutePath: string) => Promise<string | null>
): Promise<string> {
    const document = JSON.parse(snapshot) as { gameObjects?: any[] };
    const sources = new Map<string, string>();
    const visit = async (node: any): Promise<void> => {
        for (const component of Array.isArray(node?.components) ? node.components : []) {
            if (component?.type !== 'BehaviourScript') continue;
            const rawPath = component?.data?.assetPath;
            if (typeof rawPath !== 'string' || rawPath.trim().length === 0) continue;
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
            component.data.program = source;
            component.data.assetPath = assetPath;
        }
        for (const child of Array.isArray(node?.children) ? node.children : []) await visit(child);
    };
    for (const root of document.gameObjects || []) await visit(root);
    return JSON.stringify(document);
}
