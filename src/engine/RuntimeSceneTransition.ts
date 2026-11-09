export function normalizeRuntimeScenePath(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().replace(/\\/g, '/');
    if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) return null;
    const segments = normalized.split('/');
    if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return null;
    if (segments[0]?.toLowerCase() !== 'assets') return null;
    return segments.join('/');
}

export function resolveRuntimeScenePath(
    requestedPath: unknown,
    selectedBuildScenes: unknown,
    projectScenes: unknown
): string | null {
    const requested = normalizeRuntimeScenePath(requestedPath);
    if (!requested) return null;

    const normalizeList = (value: unknown): string[] => Array.isArray(value)
        ? value.map(normalizeRuntimeScenePath).filter((entry): entry is string => !!entry)
        : [];
    const selected = normalizeList(selectedBuildScenes);
    const allowed = selected.length > 0 ? selected : normalizeList(projectScenes);
    const requestedKey = requested.toLowerCase();
    return allowed.find((entry) => entry.toLowerCase() === requestedKey) ?? null;
}
