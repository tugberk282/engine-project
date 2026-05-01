import { stableStringify } from './Serialization';

/**
 * ScriptableObject - Unity-style data container asset.
 * Subclass this to create custom data assets that can be saved as .asset files.
 */
export abstract class ScriptableObject {
    /** The type name used for serialization (auto-set to class name). */
    public readonly typeName: string;

    /** Optional display name for the asset. */
    public assetName: string = 'New ScriptableObject';

    constructor() {
        this.typeName = this.constructor.name;
    }

    /**
     * Serialize the ScriptableObject to a plain object.
     * Override to add custom serialization logic.
     */
    public serialize(): any {
        const data: any = { type: this.typeName, assetName: this.assetName };
        // Serialize all public, non-function properties
        for (const key of Object.keys(this)) {
            if (key === 'typeName') continue;
            const val = (this as any)[key];
            if (typeof val !== 'function') {
                data[key] = val;
            }
        }
        return data;
    }

    /**
     * Deserialize data into this ScriptableObject.
     * Override to add custom deserialization logic.
     */
    public deserialize(data: any): void {
        for (const key of Object.keys(data)) {
            if (key === 'type' || key === 'typeName') continue;
            if (key in this) {
                (this as any)[key] = data[key];
            }
        }
    }

    /**
     * Convert to JSON string for .asset file storage.
     */
    public toAssetJSON(): string {
        return stableStringify(this.serialize(), 2);
    }

    /**
     * Create a ScriptableObject from a JSON string.
     */
    public static fromAssetJSON(json: string, registry: Map<string, new () => ScriptableObject>): ScriptableObject | null {
        try {
            const data = JSON.parse(json);
            const Ctor = registry.get(data.type);
            if (!Ctor) {
                console.warn(`ScriptableObject type '${data.type}' not found in registry.`);
                return null;
            }
            const instance = new Ctor();
            instance.deserialize(data);
            return instance;
        } catch (e) {
            console.error('Failed to parse ScriptableObject asset:', e);
            return null;
        }
    }
}

/**
 * Global registry for ScriptableObject types.
 * Register custom types here so they can be deserialized from .asset files.
 */
export class ScriptableObjectRegistry {
    private static registry = new Map<string, new () => ScriptableObject>();

    public static register<T extends ScriptableObject>(ctor: new () => T): void {
        const instance = new ctor();
        this.registry.set(instance.typeName, ctor as any);
    }

    public static get(typeName: string): (new () => ScriptableObject) | undefined {
        return this.registry.get(typeName);
    }

    public static getAll(): Map<string, new () => ScriptableObject> {
        return this.registry;
    }

    public static getTypeNames(): string[] {
        return Array.from(this.registry.keys());
    }
}

// ─── Built-in ScriptableObject examples ───────────────────────────────────────

/** A simple data container for player statistics. */
export class PlayerStats extends ScriptableObject {
    public maxHealth: number = 100;
    public moveSpeed: number = 5;
    public jumpForce: number = 8;
    public attackDamage: number = 10;
}

/** A simple data container for game configuration. */
export class GameConfig extends ScriptableObject {
    public gameName: string = 'My Game';
    public version: string = '1.0.0';
    public targetFrameRate: number = 60;
    public debugMode: boolean = false;
}

// Register built-in types
ScriptableObjectRegistry.register(PlayerStats);
ScriptableObjectRegistry.register(GameConfig);
