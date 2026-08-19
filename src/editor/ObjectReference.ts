export type ObjectReferenceIdentity =
    | { kind: 'scene-object'; objectId: string }
    | { kind: 'component'; objectId: string; componentType: string }
    | { kind: 'asset'; guid: string; lastKnownPath: string }
    | { kind: 'missing'; identity: string; label: string };

export interface ObjectReferenceDropPayload {
    type: 'gameobject' | 'material';
    id: string | null;
    guid: string | null;
    fullPath: string | null;
    name: string | null;
}

export function parseObjectReferenceDropPayload(serialized: string): ObjectReferenceDropPayload | null {
    if (!serialized) return null;
    let value: unknown;
    try {
        value = JSON.parse(serialized);
    } catch {
        return null;
    }
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    if (record.type !== 'gameobject' && record.type !== 'material') return null;
    const id = typeof record.id === 'string' && record.id.length > 0 ? record.id : null;
    const guid = typeof record.guid === 'string' && record.guid.length > 0 ? record.guid : null;
    const fullPath = typeof record.fullPath === 'string' && record.fullPath.length > 0 ? record.fullPath : null;
    if (record.type === 'gameobject' && !id) return null;
    if (record.type === 'material' && !guid && !fullPath) return null;
    return {
        type: record.type,
        id,
        guid,
        fullPath,
        name: typeof record.name === 'string' && record.name.length > 0 ? record.name : null
    };
}

export function describeObjectReference(value: unknown): ObjectReferenceIdentity | null {
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, any>;
    if (record.__missingReference === true) {
        const identity = typeof record.identity === 'string' ? record.identity : 'unknown';
        return { kind: 'missing', identity, label: typeof record.label === 'string' ? record.label : identity };
    }
    if (typeof record.id === 'string' && record.gameObject && typeof record.gameObject.id === 'string') {
        return { kind: 'component', objectId: record.gameObject.id, componentType: record.constructor?.name ?? 'Component' };
    }
    if (typeof record.id === 'string' && record.object3D) {
        return { kind: 'scene-object', objectId: record.id };
    }
    const assetPath = typeof record.assetPath === 'string' ? record.assetPath : null;
    const assetGuid = typeof record.assetGuid === 'string'
        ? record.assetGuid
        : (typeof record.userData?.assetGuid === 'string' ? record.userData.assetGuid : null);
    if (assetGuid && assetPath) return { kind: 'asset', guid: assetGuid, lastKnownPath: assetPath };
    return null;
}

export function sameObjectReference(left: unknown, right: unknown): boolean {
    if (left === right) return true;
    const leftIdentity = describeObjectReference(left);
    const rightIdentity = describeObjectReference(right);
    return leftIdentity !== null && rightIdentity !== null
        && JSON.stringify(leftIdentity) === JSON.stringify(rightIdentity);
}
