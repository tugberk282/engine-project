import { Component } from '../Component';
import { GameObject } from '../GameObject';
import * as THREE from 'three';
import { Material, MaterialManager } from '../Material';


export class MeshRenderer extends Component {
    public mesh: THREE.Mesh;
    private _material: Material | null = null;

    public textureName: string | null = null;
    public materialName: string | null = null;
    public materialPath: string | null = null;
    public sortingPriority: number = 0;

    private _castShadow: boolean = true;
    private _receiveShadow: boolean = true;

    constructor(gameObject: GameObject) {
        super(gameObject);

        // Default geometry (placeholder until MeshFilter starts)
        const geometry = new THREE.BufferGeometry();
        this._material = new Material("DefaultMaterial");
        this.mesh = new THREE.Mesh(geometry, this._material.getThreeMaterial());

        // Add mesh to the GameObject's underlying Three.js object
        this.gameObject.object3D.add(this.mesh);

        // Shadow support
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;
    }

    public awake(): void {
        this.updateGeometry();
        this.syncMaterialRenderSettings();
    }

    public update(): void {
        this.syncMaterialRenderSettings();
    }

    /** Called by MeshFilter when geometry changes */
    public updateGeometry(): void {
        const filter = this.gameObject.getComponent('MeshFilter' as any);
        if (filter && (filter as any).geometry) {
            this.mesh.geometry = (filter as any).geometry;
        } else {
            // Placeholder or empty geometry
            this.mesh.geometry = new THREE.BufferGeometry();
        }
    }

    public get castShadow(): boolean { return this._castShadow; }
    public set castShadow(value: boolean) {
        this._castShadow = value;
        if (this.mesh) this.mesh.castShadow = value;
    }

    public get receiveShadow(): boolean { return this._receiveShadow; }
    public set receiveShadow(value: boolean) {
        this._receiveShadow = value;
        if (this.mesh) this.mesh.receiveShadow = value;
    }

    public get material(): Material | null {
        return this._material;
    }

    public set material(value: Material | null) {
        this._material = value;
        if (this._material) {
            this.mesh.material = this._material.getThreeMaterial();
            this.materialName = this._material.name;
            this.materialPath = this._material.assetPath;
            this.syncMaterialRenderSettings();
        } else {
            this.mesh.material = new THREE.MeshStandardMaterial({ color: 0xcccccc });
            this.materialName = null;
            this.materialPath = null;
            this.mesh.renderOrder = 0;
        }
    }

    public setColor(hex: number) {
        if (this.mesh.material instanceof THREE.MeshStandardMaterial) {
            this.mesh.material.color.setHex(hex);
        }
    }

    public get color(): string {
        if (this.mesh.material instanceof THREE.MeshStandardMaterial) {
            return '#' + this.mesh.material.color.getHexString();
        }
        return '#ffffff';
    }

    public set color(hexString: string) {
        if (this.mesh.material instanceof THREE.MeshStandardMaterial) {
            this.mesh.material.color.set(hexString);
        }
    }

    public setTexture(texture: THREE.Texture | null) {
        if (this.mesh.material instanceof THREE.MeshStandardMaterial) {
            this.mesh.material.map = texture;
            this.mesh.material.needsUpdate = true;
        }
    }

    public serialize(): any {
        return {
            type: this.constructor.name,
            data: {
                color: this.color,
                materialName: this.materialName,
                materialPath: this.materialPath,
                sortingPriority: this.sortingPriority,
                castShadow: this.castShadow,
                receiveShadow: this.receiveShadow
            }
        };
    }

    public deserialize(data: any): void {
        if (data.color) {
            this.color = data.color;
        }
        if (data.materialPath || data.materialName) {
            const mat = MaterialManager.getMaterial(data.materialPath || data.materialName);
            if (mat) this.material = mat;
        }
        this.sortingPriority = Number.isFinite(data.sortingPriority) ? Math.trunc(data.sortingPriority) : 0;
        this.castShadow = data.castShadow !== undefined ? data.castShadow : true;
        this.receiveShadow = data.receiveShadow !== undefined ? data.receiveShadow : true;
        this.syncMaterialRenderSettings();

        // Geometry will be handled by deserialized MeshFilter
    }

    private syncMaterialRenderSettings(): void {
        if (!this.mesh) return;
        this.mesh.renderOrder = (this._material?.renderOrder ?? 0) + (this.sortingPriority ?? 0);
    }
}
