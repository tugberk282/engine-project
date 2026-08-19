export type EditorSelectionSource = 'hierarchy' | 'scene' | 'project' | 'inspector' | 'command' | 'restore';

export interface EditorSelectionFocus {
    panel: 'hierarchy' | 'scene' | 'project' | 'inspector';
    controlId: string | null;
}

export interface EmptyEditorSelection {
    kind: 'none';
    revision: number;
    source: EditorSelectionSource;
    focus: EditorSelectionFocus | null;
}

export interface SceneEditorSelection {
    kind: 'scene';
    revision: number;
    source: EditorSelectionSource;
    focus: EditorSelectionFocus | null;
    objectIds: string[];
    activeObjectId: string;
}

export interface AssetEditorSelection {
    kind: 'asset';
    revision: number;
    source: EditorSelectionSource;
    focus: EditorSelectionFocus | null;
    guid: string;
    path: string;
    lastKnownPath: string;
    resolved: boolean;
}

export type EditorSelectionSnapshot = EmptyEditorSelection | SceneEditorSelection | AssetEditorSelection;
export type EditorSelectionListener = (next: EditorSelectionSnapshot, previous: EditorSelectionSnapshot) => void;

/**
 * Stable-identity selection model shared by editor panels. It owns no DOM or
 * engine objects: panels materialize IDs/GUIDs through their typed adapters.
 */
export class EditorSelection {
    private revision = 0;
    private state: EditorSelectionSnapshot = {
        kind: 'none', revision: 0, source: 'restore', focus: null
    };
    private readonly listeners = new Set<EditorSelectionListener>();

    public get snapshot(): EditorSelectionSnapshot {
        return this.clone(this.state);
    }

    public subscribe(listener: EditorSelectionListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    public selectScene(
        objectIds: string[],
        activeObjectId: string | null,
        source: EditorSelectionSource,
        focus: EditorSelectionFocus | null = null
    ): EditorSelectionSnapshot {
        const uniqueIds = Array.from(new Set(objectIds.filter((id) => typeof id === 'string' && id.length > 0)));
        if (uniqueIds.length === 0) return this.clear(source, focus);
        const activeId = activeObjectId && uniqueIds.includes(activeObjectId)
            ? activeObjectId
            : uniqueIds[uniqueIds.length - 1];
        return this.commit({ kind: 'scene', objectIds: uniqueIds, activeObjectId: activeId, source, focus });
    }

    public selectAsset(
        guid: string,
        path: string,
        source: EditorSelectionSource,
        focus: EditorSelectionFocus | null = null
    ): EditorSelectionSnapshot {
        const normalizedGuid = guid.trim();
        const normalizedPath = path.trim();
        if (!normalizedGuid) throw new Error('Asset selection requires a stable GUID');
        if (!normalizedPath) throw new Error('Asset selection requires a path');
        return this.commit({
            kind: 'asset', guid: normalizedGuid, path: normalizedPath,
            lastKnownPath: normalizedPath, resolved: true, source, focus
        });
    }

    public reconcileAsset(resolvePath: (guid: string) => string | null): EditorSelectionSnapshot {
        if (this.state.kind !== 'asset') return this.snapshot;
        const resolvedPath = resolvePath(this.state.guid);
        if (resolvedPath === this.state.path && this.state.resolved) return this.snapshot;
        if (!resolvedPath && !this.state.resolved) return this.snapshot;
        return this.commit({
            kind: 'asset', guid: this.state.guid,
            path: resolvedPath ?? this.state.lastKnownPath,
            lastKnownPath: resolvedPath ?? this.state.lastKnownPath,
            resolved: Boolean(resolvedPath), source: 'restore', focus: this.state.focus
        });
    }

    public reconcileScene(exists: (objectId: string) => boolean): EditorSelectionSnapshot {
        if (this.state.kind !== 'scene') return this.snapshot;
        const remaining = this.state.objectIds.filter(exists);
        const active = exists(this.state.activeObjectId) ? this.state.activeObjectId : null;
        if (remaining.length === this.state.objectIds.length && active) return this.snapshot;
        return this.selectScene(remaining, active, 'restore', this.state.focus);
    }

    public clear(source: EditorSelectionSource, focus: EditorSelectionFocus | null = null): EditorSelectionSnapshot {
        if (this.state.kind === 'none' && this.sameFocus(this.state.focus, focus)) return this.snapshot;
        return this.commit({ kind: 'none', source, focus });
    }

    private commit(next: Omit<EmptyEditorSelection, 'revision'> | Omit<SceneEditorSelection, 'revision'> | Omit<AssetEditorSelection, 'revision'>): EditorSelectionSnapshot {
        const previous = this.snapshot;
        this.state = { ...next, revision: ++this.revision } as EditorSelectionSnapshot;
        const current = this.snapshot;
        this.listeners.forEach((listener) => listener(current, previous));
        return current;
    }

    private clone(snapshot: EditorSelectionSnapshot): EditorSelectionSnapshot {
        if (snapshot.kind === 'scene') return { ...snapshot, objectIds: [...snapshot.objectIds], focus: snapshot.focus ? { ...snapshot.focus } : null };
        return { ...snapshot, focus: snapshot.focus ? { ...snapshot.focus } : null };
    }

    private sameFocus(left: EditorSelectionFocus | null, right: EditorSelectionFocus | null): boolean {
        return left?.panel === right?.panel && left?.controlId === right?.controlId;
    }
}
