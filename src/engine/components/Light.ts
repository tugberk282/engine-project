import { Component } from '../Component';
import * as THREE from 'three';
import { serialize } from '../Decorators';

export enum LightType {
    Directional = 'Directional',
    Point = 'Point',
    Spot = 'Spot',
    Ambient = 'Ambient'
}

/**
 * Light - Unity-style light component
 */
export class Light extends Component {
    @serialize public lightType: LightType = LightType.Directional;
    @serialize public color: THREE.Color = new THREE.Color(1, 1, 1);
    @serialize public intensity: number = 1.0;
    @serialize public cullingMask: number = -1;
    @serialize public range: number = 10;
    @serialize public spotAngle: number = 30;
    @serialize public castShadows: boolean = true;
    @serialize public shadowBias: number = -0.0001;
    @serialize public shadowNormalBias: number = 0.02;
    @serialize public shadowResolution: number = 1024;
    @serialize public shadowRadius: number = 1;

    public light: THREE.Light | null = null;

    public awake(): void {
        this.updateLight();
    }

    private updateLight(): void {
        // Remove old light
        if (this.light) {
            this.gameObject.object3D.remove(this.light);
            this.light = null;
        }

        // Create new light based on type
        switch (this.lightType) {
            case LightType.Directional:
                const dirLight = new THREE.DirectionalLight(this.color, this.intensity);
                if (this.castShadows) {
                    dirLight.castShadow = true;
                    dirLight.shadow.mapSize.width = this.shadowResolution;
                    dirLight.shadow.mapSize.height = this.shadowResolution;
                    dirLight.shadow.bias = this.shadowBias;
                    dirLight.shadow.normalBias = this.shadowNormalBias;
                    dirLight.shadow.radius = this.shadowRadius;
                }
                this.light = dirLight;
                break;

            case LightType.Point:
                const pointLight = new THREE.PointLight(this.color, this.intensity, this.range);
                if (this.castShadows) {
                    pointLight.castShadow = true;
                    pointLight.shadow.mapSize.width = this.shadowResolution;
                    pointLight.shadow.mapSize.height = this.shadowResolution;
                    pointLight.shadow.bias = this.shadowBias;
                    pointLight.shadow.normalBias = this.shadowNormalBias;
                    pointLight.shadow.radius = this.shadowRadius;
                }
                this.light = pointLight;
                break;

            case LightType.Spot:
                const angle = THREE.MathUtils.degToRad(this.spotAngle);
                const spotLight = new THREE.SpotLight(this.color, this.intensity, this.range, angle);
                if (this.castShadows) {
                    spotLight.castShadow = true;
                    spotLight.shadow.mapSize.width = this.shadowResolution;
                    spotLight.shadow.mapSize.height = this.shadowResolution;
                    spotLight.shadow.bias = this.shadowBias;
                    spotLight.shadow.normalBias = this.shadowNormalBias;
                    spotLight.shadow.radius = this.shadowRadius;
                }
                this.light = spotLight;
                break;

            case LightType.Ambient:
                this.light = new THREE.AmbientLight(this.color, this.intensity);
                break;
        }

        if (this.light) {
            this.light.layers.mask = this.cullingMask === -1 ? 0xFFFFFFFF : (this.cullingMask >>> 0);
            this.gameObject.object3D.add(this.light);
        }
    }

    public setLightType(type: LightType): void {
        if (this.lightType !== type) {
            this.lightType = type;
            this.updateLight();
        }
    }

    public setColor(color: THREE.Color): void {
        this.color = color;
        if (this.light) {
            this.light.color = color;
        }
    }

    public setIntensity(intensity: number): void {
        this.intensity = intensity;
        if (this.light) {
            this.light.intensity = intensity;
        }
    }

    public setCullingMask(mask: number): void {
        this.cullingMask = Number.isFinite(mask) ? Math.trunc(mask) : -1;
        if (this.light) {
            this.light.layers.mask = this.cullingMask === -1 ? 0xFFFFFFFF : (this.cullingMask >>> 0);
        }
    }

    public setRange(range: number): void {
        this.range = range;
        if (this.light instanceof THREE.PointLight || this.light instanceof THREE.SpotLight) {
            this.light.distance = range;
        }
    }

    public setSpotAngle(angle: number): void {
        this.spotAngle = angle;
        if (this.light instanceof THREE.SpotLight) {
            this.light.angle = THREE.MathUtils.degToRad(angle);
        }
    }

    public setCastShadows(cast: boolean): void {
        this.castShadows = cast;
        if (this.light && 'castShadow' in this.light) {
            this.light.castShadow = cast;
        }
    }

    public serialize(): any {
        return {
            type: 'Light',
            data: {
                lightType: this.lightType,
                color: this.color.toArray(),
                intensity: this.intensity,
                cullingMask: this.cullingMask,
                range: this.range,
                spotAngle: this.spotAngle,
                castShadows: this.castShadows,
                shadowBias: this.shadowBias,
                shadowNormalBias: this.shadowNormalBias,
                shadowResolution: this.shadowResolution,
                shadowRadius: this.shadowRadius
            }
        };
    }

    public deserialize(data: any): void {
        this.lightType = Object.values(LightType).includes(data.lightType as LightType)
            ? data.lightType as LightType
            : LightType.Directional;
        if (data.color) this.color.fromArray(data.color);
        this.intensity = data.intensity !== undefined ? data.intensity : 1.0;
        this.cullingMask = data.cullingMask !== undefined ? data.cullingMask : -1;
        this.range = data.range ?? 10;
        this.spotAngle = data.spotAngle ?? 30;
        this.castShadows = data.castShadows ?? false;
        this.shadowBias = data.shadowBias !== undefined ? data.shadowBias : -0.0001;
        this.shadowNormalBias = data.shadowNormalBias !== undefined ? data.shadowNormalBias : 0.02;
        this.shadowResolution = data.shadowResolution ?? 1024;
        this.shadowRadius = data.shadowRadius !== undefined ? data.shadowRadius : 1;
        this.updateLight();
    }

    public onDestroy(): void {
        if (this.light) {
            this.gameObject.object3D.remove(this.light);
            this.light = null;
        }
    }

    // --- Gizmo ---
    public createGizmo(): THREE.Object3D {
        const group = new THREE.Group();
        const color = this.color.getHex();

        if (this.lightType === LightType.Point) {
            const geom = new THREE.SphereGeometry(this.range, 16, 16);
            const mat = new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.1 });
            const sphere = new THREE.Mesh(geom, mat);
            group.add(sphere);
        } else if (this.lightType === LightType.Spot) {
            const angle = THREE.MathUtils.degToRad(this.spotAngle);
            const height = this.range;
            const radius = Math.tan(angle) * height;
            const geom = new THREE.ConeGeometry(radius, height, 16, 1, true);
            const mat = new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.1 });
            const cone = new THREE.Mesh(geom, mat);
            cone.rotateX(-Math.PI / 2);
            cone.position.z = -height / 2;
            group.add(cone);
        } else if (this.lightType === LightType.Directional) {
            // Lines for directional light
            const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.5 });
            const points = [];
            for (let i = 0; i < 4; i++) {
                const off = 0.5;
                const x = (i % 2 === 0 ? -1 : 1) * off;
                const y = (i < 2 ? -1 : 1) * off;
                points.push(new THREE.Vector3(x, y, 0), new THREE.Vector3(x, y, -5));
            }
            const geom = new THREE.BufferGeometry().setFromPoints(points);
            const lines = new THREE.LineSegments(geom, mat);
            group.add(lines);
        }

        return group;
    }

    public updateGizmo(helper: THREE.Object3D): void {
        helper.position.copy(this.gameObject.transform.position);
        helper.visible = this.enabled;
    }
}
