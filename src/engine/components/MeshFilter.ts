import { Component } from '../Component';
import { GameObject } from '../GameObject';
import * as THREE from 'three';

export type PrimitiveType = 'Cube' | 'Sphere' | 'Capsule' | 'Cylinder' | 'Plane' | 'Quad' | 'None';

export class MeshFilter extends Component {
    private _geometry: THREE.BufferGeometry | null = null;
    private _primitiveType: PrimitiveType = 'None';

    constructor(gameObject: GameObject) {
        super(gameObject);
        // Default to None, let MeshRenderer or user set it
    }

    public get geometry(): THREE.BufferGeometry | null {
        return this._geometry;
    }

    public set geometry(value: THREE.BufferGeometry | null) {
        this._geometry = value;
        this._primitiveType = 'None';
        this.notifyRenderer();
    }

    public get primitiveType(): PrimitiveType {
        return this._primitiveType;
    }

    public setPrimitiveType(type: PrimitiveType): void {
        this._primitiveType = type;
        switch (type) {
            case 'Cube':
                this._geometry = new THREE.BoxGeometry(1, 1, 1);
                break;
            case 'Sphere':
                this._geometry = new THREE.SphereGeometry(0.5, 32, 32);
                break;
            case 'Capsule':
                this._geometry = new THREE.CapsuleGeometry(0.5, 1, 8, 16);
                break;
            case 'Cylinder':
                this._geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 32);
                break;
            case 'Plane':
                this._geometry = new THREE.PlaneGeometry(10, 10);
                this._geometry.rotateX(-Math.PI / 2);
                break;
            case 'Quad':
                this._geometry = new THREE.PlaneGeometry(1, 1);
                break;
            case 'None':
                this._geometry = null;
                break;
        }
        this.notifyRenderer();
    }

    private notifyRenderer(): void {
        const renderer = this.gameObject.getComponent('MeshRenderer' as any);
        if (renderer && (renderer as any).updateGeometry) {
            (renderer as any).updateGeometry();
        }
    }

    public serialize(): any {
        return {
            type: 'MeshFilter',
            data: {
                primitiveType: this._primitiveType
            }
        };
    }

    public deserialize(data: any): void {
        if (data.primitiveType) {
            this.setPrimitiveType(data.primitiveType);
        }
    }
}
