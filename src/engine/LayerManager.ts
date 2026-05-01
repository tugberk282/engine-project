/**
 * LayerManager - Manages up to 32 named layers and a collision matrix.
 * Mirrors Unity's Layer system with bitmask-based collision filtering.
 */
export class LayerManager {
    private static instance: LayerManager;
    private layers: string[] = new Array(32).fill('');

    /**
     * Collision matrix: collisionMatrix[a] is a bitmask of layers that layer `a` collides with.
     * By default, all layers collide with all other layers.
     */
    private collisionMatrix: number[] = new Array(32).fill(0xFFFFFFFF);

    private constructor() {
        // Built-in Unity layers
        this.layers[0] = 'Default';
        this.layers[1] = 'TransparentFX';
        this.layers[2] = 'Ignore Raycast';
        this.layers[3] = '';
        this.layers[4] = 'Water';
        this.layers[5] = 'UI';
        // Layers 6-31 are user-defined
    }

    public static getInstance(): LayerManager {
        if (!LayerManager.instance) {
            LayerManager.instance = new LayerManager();
        }
        return LayerManager.instance;
    }

    // ─── Layer Name Management ─────────────────────────────────────────────────

    public setLayerName(index: number, name: string): void {
        if (index < 0 || index >= 32) return;
        this.layers[index] = name;
    }

    public getLayerName(index: number): string {
        if (index < 0 || index >= 32) return `Layer ${index}`;
        return this.layers[index] || `Layer ${index}`;
    }

    /** Returns all layers as { index, name } pairs (including empty ones). */
    public getLayers(): { index: number; name: string }[] {
        return this.layers.map((name, index) => ({ index, name }));
    }

    /** Returns only named (non-empty) layers. */
    public getNamedLayers(): { index: number; name: string }[] {
        return this.layers
            .map((name, index) => ({ index, name }))
            .filter(l => l.name.length > 0);
    }

    /** Get layer index by name. Returns -1 if not found. */
    public nameToLayer(name: string): number {
        return this.layers.indexOf(name);
    }

    // ─── Collision Matrix ──────────────────────────────────────────────────────

    /**
     * Set whether two layers collide with each other.
     * This is symmetric: setting (a, b) also sets (b, a).
     */
    public setLayerCollision(layerA: number, layerB: number, collides: boolean): void {
        if (layerA < 0 || layerA >= 32 || layerB < 0 || layerB >= 32) return;

        if (collides) {
            this.collisionMatrix[layerA] |= (1 << layerB);
            this.collisionMatrix[layerB] |= (1 << layerA);
        } else {
            this.collisionMatrix[layerA] &= ~(1 << layerB);
            this.collisionMatrix[layerB] &= ~(1 << layerA);
        }
    }

    /**
     * Check if two layers collide with each other.
     */
    public getLayerCollision(layerA: number, layerB: number): boolean {
        if (layerA < 0 || layerA >= 32 || layerB < 0 || layerB >= 32) return false;
        return (this.collisionMatrix[layerA] & (1 << layerB)) !== 0;
    }

    /**
     * Get the collision bitmask for a given layer.
     * Use this to configure cannon-es body collision filter masks.
     */
    public getCollisionMask(layer: number): number {
        if (layer < 0 || layer >= 32) return 0xFFFFFFFF;
        return this.collisionMatrix[layer];
    }

    /**
     * Get the layer bitmask (1 << layer) for use as a cannon-es collision group.
     */
    public getLayerBitmask(layer: number): number {
        return 1 << layer;
    }

    // ─── Serialization ─────────────────────────────────────────────────────────

    public serialize(): any {
        return {
            layers: [...this.layers],
            collisionMatrix: [...this.collisionMatrix]
        };
    }

    public deserialize(data: any): void {
        if (data.layers) {
            data.layers.forEach((name: string, i: number) => {
                this.layers[i] = name;
            });
        }
        if (data.collisionMatrix) {
            data.collisionMatrix.forEach((mask: number, i: number) => {
                this.collisionMatrix[i] = mask;
            });
        }
    }
}
