export class DirtyState {
    private revision = 0;
    private persistedRevision = 0;
    private commandRevision = 0;
    private persistedCommandRevision = 0;
    private listeners = new Set<(dirty: boolean) => void>();

    public get isDirty(): boolean {
        return this.revision !== this.persistedRevision
            || this.commandRevision !== this.persistedCommandRevision;
    }

    public markChanged(): void {
        this.revision++;
        this.emit();
    }

    public setCommandRevision(revision: number): void {
        this.commandRevision = revision;
        this.emit();
    }

    public markPersisted(): void {
        this.persistedRevision = this.revision;
        this.persistedCommandRevision = this.commandRevision;
        this.emit();
    }

    public reset(): void {
        this.revision = 0;
        this.persistedRevision = 0;
        this.commandRevision = 0;
        this.persistedCommandRevision = 0;
        this.emit();
    }

    public subscribe(listener: (dirty: boolean) => void): () => void {
        this.listeners.add(listener);
        listener(this.isDirty);
        return () => this.listeners.delete(listener);
    }

    private emit(): void {
        this.listeners.forEach((listener) => listener(this.isDirty));
    }
}
