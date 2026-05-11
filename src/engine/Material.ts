import * as THREE from 'three';
import { AssetDatabase } from './AssetDatabase';

/**
 * Material - Unity-style material system
 */
export class Material {
    public name: string = 'New Material';
    public shader: 'Standard' | 'Unlit' | 'Transparent' = 'Standard';
    public doubleSidedGI: boolean = false;
    public depthWrite: boolean = true;
    public depthTest: boolean = true;
    public renderOrder: number = 0;
    public surfaceOpacity: number = 1;
    public color: THREE.Color = new THREE.Color(1, 1, 1);
    public metallic: number = 0;
    public smoothness: number = 0.5;
    public emission: THREE.Color = new THREE.Color(0, 0, 0);
    public emissionIntensity: number = 0;
    public mainTexture: THREE.Texture | null = null;
    public normalMap: THREE.Texture | null = null;
    public metallicMap: THREE.Texture | null = null;
    public roughnessMap: THREE.Texture | null = null;
    public alphaMode: 'Opaque' | 'Cutout' | 'Fade' | 'Transparent' = 'Opaque';
    public alphaCutoff: number = 0.5;
    public assetPath: string | null = null;

    private threeMaterial: THREE.Material | null = null;

    constructor(name: string = 'New Material') {
        this.name = name;
        this.updateThreeMaterial();
    }

    public setColor(color: THREE.Color): void {
        this.color = color;
        this.updateThreeMaterial();
        this.notifyChange();
    }

    public setMetallic(value: number): void {
        this.metallic = Math.max(0, Math.min(1, value));
        this.updateThreeMaterial();
        this.notifyChange();
    }

    public setSmoothness(value: number): void {
        this.smoothness = Math.max(0, Math.min(1, value));
        this.updateThreeMaterial();
        this.notifyChange();
    }

    public setMainTexture(texture: THREE.Texture | null): void {
        this.mainTexture = texture;
        this.updateThreeMaterial();
        this.notifyChange();
    }

    public setNormalMap(texture: THREE.Texture | null): void {
        this.normalMap = texture;
        this.updateThreeMaterial();
        this.notifyChange();
    }

    public setMetallicMap(texture: THREE.Texture | null): void {
        this.metallicMap = texture;
        this.updateThreeMaterial();
        this.notifyChange();
    }

    public setRoughnessMap(texture: THREE.Texture | null): void {
        this.roughnessMap = texture;
        this.updateThreeMaterial();
        this.notifyChange();
    }

    public setShader(shader: 'Standard' | 'Unlit' | 'Transparent'): void {
        this.shader = shader;
        this.updateThreeMaterial();
        this.notifyChange();
    }

    public setDepthWrite(enabled: boolean): void {
        this.depthWrite = enabled;
        this.updateThreeMaterial();
        this.notifyChange();
    }

    public setDepthTest(enabled: boolean): void {
        this.depthTest = enabled;
        this.updateThreeMaterial();
        this.notifyChange();
    }

    public setRenderOrder(order: number): void {
        this.renderOrder = Number.isFinite(order) ? Math.trunc(order) : 0;
        this.notifyChange();
    }

    public setSurfaceOpacity(opacity: number): void {
        this.surfaceOpacity = Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 1;
        this.updateThreeMaterial();
        this.notifyChange();
    }

    public applyAssetData(data: any): void {
        this.name = data.name || this.name;
        this.shader = data.shader || 'Standard';
        this.doubleSidedGI = data.doubleSidedGI === true;
        this.depthWrite = data.depthWrite !== undefined ? data.depthWrite === true : true;
        this.depthTest = data.depthTest !== undefined ? data.depthTest === true : true;
        this.renderOrder = Number.isFinite(data.renderOrder) ? Math.trunc(data.renderOrder) : 0;
        this.surfaceOpacity = Number.isFinite(data.surfaceOpacity) ? Math.max(0, Math.min(1, data.surfaceOpacity)) : 1;
        this.color.setHex(data.color || 0xffffff);
        this.metallic = data.metallic || 0;
        this.smoothness = data.smoothness || 0.5;
        this.emission.setHex(data.emission || 0x000000);
        this.emissionIntensity = data.emissionIntensity || 0;
        this.alphaMode = data.alphaMode || 'Opaque';
        this.alphaCutoff = data.alphaCutoff || 0.5;
        this.updateThreeMaterial();
    }

    public setTextureSilently(slot: 'mainTexture' | 'normalMap' | 'metallicMap' | 'roughnessMap', texture: THREE.Texture | null): void {
        this[slot] = texture;
        this.updateThreeMaterial();
    }

    private notifyChange(): void {
        // @ts-ignore
        if (window.Editor?.instance) {
            // @ts-ignore
            window.Editor.instance.inspectorWindow.refresh();
            // @ts-ignore
            if (this.assetPath && window.Editor.instance.projectWindow) {
                // @ts-ignore
                window.Editor.instance.projectWindow.saveMaterialToFile(this);
            }
        }
        MaterialManager.save();
    }


    private updateThreeMaterial(): void {
        if (!this.threeMaterial || (this.threeMaterial as any).type !== this.getThreeMaterialType()) {
            this.threeMaterial = this.createNewThreeMaterial();
        }

        const mat = this.threeMaterial as any;
        mat.color.copy(this.color);
        mat.depthWrite = this.depthWrite;
        mat.depthTest = this.depthTest;
        mat.alphaTest = 0;

        if (this.shader === 'Standard' || this.shader === 'Transparent') {
            mat.metalness = this.metallic;
            mat.roughness = 1 - this.smoothness;
            mat.map = this.mainTexture;
            mat.normalMap = this.normalMap;
            mat.metalnessMap = this.metallicMap;
            mat.roughnessMap = this.roughnessMap;
            mat.emissive.copy(this.emission);
            mat.emissiveIntensity = this.emissionIntensity;

            if (this.alphaMode !== 'Opaque') {
                mat.transparent = true;
                mat.opacity = this.alphaMode === 'Fade' || this.alphaMode === 'Transparent' ? this.surfaceOpacity : 1;
                if (this.alphaMode === 'Cutout') {
                    mat.alphaTest = this.alphaCutoff;
                }
                if (this.alphaMode === 'Transparent') {
                    mat.depthWrite = false;
                }
            } else {
                mat.transparent = false;
                mat.opacity = 1;
            }
        } else if (this.shader === 'Unlit') {
            mat.map = this.mainTexture;
            mat.transparent = this.alphaMode !== 'Opaque';
            mat.opacity = this.alphaMode === 'Fade' || this.alphaMode === 'Transparent' ? this.surfaceOpacity : 1;
            if (this.alphaMode === 'Cutout') {
                mat.alphaTest = this.alphaCutoff;
            }
            if (this.alphaMode === 'Transparent') {
                mat.depthWrite = false;
            }
        }

        mat.side = this.doubleSidedGI ? THREE.DoubleSide : THREE.FrontSide;

        mat.needsUpdate = true;
    }

    private getThreeMaterialType(): string {
        if (this.shader === 'Standard') return 'MeshStandardMaterial';
        if (this.shader === 'Unlit') return 'MeshBasicMaterial';
        if (this.shader === 'Transparent') return 'MeshPhysicalMaterial';
        return 'MeshStandardMaterial';
    }

    private createNewThreeMaterial(): THREE.Material {
        if (this.shader === 'Standard') return new THREE.MeshStandardMaterial();
        if (this.shader === 'Unlit') return new THREE.MeshBasicMaterial();
        if (this.shader === 'Transparent') return new THREE.MeshPhysicalMaterial();
        return new THREE.MeshStandardMaterial();
    }

    public getThreeMaterial(): THREE.Material {
        if (!this.threeMaterial) {
            this.updateThreeMaterial();
        }
        return this.threeMaterial!;
    }

    public serialize(): any {
        return {
            name: this.name,
            assetPath: this.assetPath,
            shader: this.shader,
            doubleSidedGI: this.doubleSidedGI,
            depthWrite: this.depthWrite,
            depthTest: this.depthTest,
            renderOrder: this.renderOrder,
            surfaceOpacity: this.surfaceOpacity,
            color: this.color.getHex(),
            metallic: this.metallic,
            smoothness: this.smoothness,
            emission: this.emission.getHex(),
            emissionIntensity: this.emissionIntensity,
            alphaMode: this.alphaMode,
            alphaCutoff: this.alphaCutoff,
            mainTexturePath: this.getTextureReference(this.mainTexture),
            mainTextureGuid: this.getTextureGuid(this.mainTexture),
            normalMapPath: this.getTextureReference(this.normalMap),
            normalMapGuid: this.getTextureGuid(this.normalMap),
            metallicMapPath: this.getTextureReference(this.metallicMap),
            metallicMapGuid: this.getTextureGuid(this.metallicMap),
            roughnessMapPath: this.getTextureReference(this.roughnessMap)
            ,
            roughnessMapGuid: this.getTextureGuid(this.roughnessMap)
        };
    }

    public static deserialize(data: any): Material {
        const mat = new Material(data.name);
        mat.assetPath = typeof data.assetPath === 'string' ? data.assetPath : null;
        mat.applyAssetData(data);
        return mat;
    }

    private getTextureReference(texture: THREE.Texture | null): string | null {
        if (!texture) return null;

        const assetPath = (texture.userData?.assetPath as string | undefined) ?? null;
        return assetPath || (texture as any).name || null;
    }

    private getTextureGuid(texture: THREE.Texture | null): string | null {
        if (!texture) return null;

        const explicitGuid = (texture.userData?.assetGuid as string | undefined) ?? null;
        if (explicitGuid) return explicitGuid;

        const assetPath = (texture.userData?.assetPath as string | undefined) ?? null;
        return assetPath ? (AssetDatabase.getInstance().getGuid(assetPath) ?? null) : null;
    }
}

/**
 * MaterialManager - Manages all materials in the project
 */
export class MaterialManager {
    private static materials: Map<string, Material> = new Map();

    public static createMaterial(name: string): Material {
        const mat = new Material(name);
        this.materials.set(this.getPrimaryKey(mat), mat);
        return mat;
    }

    public static registerMaterial(mat: Material): void {
        const key = this.getPrimaryKey(mat);
        this.removeExistingReferences(mat, key);
        this.materials.set(key, mat);
    }

    public static getMaterial(identifier: string | null | undefined): Material | null {
        if (!identifier) return null;

        const normalizedIdentifier = this.normalizeKey(identifier);
        const directMatch = this.materials.get(normalizedIdentifier);
        if (directMatch) return directMatch;

        for (const material of this.materials.values()) {
            if (material.assetPath && this.normalizeKey(material.assetPath) === normalizedIdentifier) {
                return material;
            }
            if (material.name === identifier) {
                return material;
            }
        }

        return null;
    }

    public static getAllMaterials(): Material[] {
        return Array.from(new Set(this.materials.values()));
    }

    public static deleteMaterial(identifier: string): void {
        const normalizedIdentifier = this.normalizeKey(identifier);
        this.materials.delete(normalizedIdentifier);
        Array.from(this.materials.entries()).forEach(([key, material]) => {
            if ((material.assetPath && this.normalizeKey(material.assetPath) === normalizedIdentifier) || material.name === identifier) {
                this.materials.delete(key);
            }
        });
    }

    public static save(): void {
        const data: any = {};
        this.getAllMaterials().forEach((mat) => {
            data[this.getPrimaryKey(mat)] = mat.serialize();
        });
        localStorage.setItem('tugberkengine_materials', JSON.stringify(data));
    }

    public static load(): void {
        const saved = localStorage.getItem('tugberkengine_materials');
        if (saved) {
            const data = JSON.parse(saved);
            Object.keys(data).forEach((key) => {
                const mat = Material.deserialize(data[key]);
                this.materials.set(this.normalizeKey(mat.assetPath || key || mat.name), mat);
            });
        }
    }

    private static getPrimaryKey(mat: Material): string {
        return this.normalizeKey(mat.assetPath || mat.name);
    }

    private static normalizeKey(value: string): string {
        return value.replace(/\\/g, '/');
    }

    private static removeExistingReferences(material: Material, nextKey: string): void {
        Array.from(this.materials.entries()).forEach(([key, value]) => {
            if (value === material && key !== nextKey) {
                this.materials.delete(key);
            }
        });
    }
}
