export class TagManager {
    private static instance: TagManager;
    private tags: Set<string> = new Set(["Untagged", "MainCamera", "Player", "EditorOnly"]);

    private constructor() { }

    public static getInstance(): TagManager {
        if (!TagManager.instance) {
            TagManager.instance = new TagManager();
        }
        return TagManager.instance;
    }

    public addTag(tag: string) {
        this.tags.add(tag);
    }

    public removeTag(tag: string) {
        if (tag === "Untagged") return;
        this.tags.delete(tag);
    }

    public getTags(): string[] {
        return Array.from(this.tags);
    }

    public isValidTag(tag: string): boolean {
        return this.tags.has(tag);
    }
}
