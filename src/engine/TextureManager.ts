import * as THREE from 'three';

export class TextureManager {
    private static textures: Map<string, THREE.Texture> = new Map();

    public static loadTexture(name: string, url: string): Promise<THREE.Texture> {
        return new Promise((resolve, reject) => {
            const loader = new THREE.TextureLoader();
            loader.load(
                url,
                (texture) => {
                    this.textures.set(name, texture);
                    resolve(texture);
                },
                undefined,
                (err) => reject(err)
            );
        });
    }

    public static addTexture(name: string, texture: THREE.Texture) {
        this.textures.set(name, texture);
    }

    public static getTexture(name: string): THREE.Texture | undefined {
        return this.textures.get(name);
    }

    public static getAllTextureNames(): string[] {
        return Array.from(this.textures.keys());
    }
}
