import { GameObject } from './GameObject';
import * as THREE from 'three';



export class Component {
    public gameObject: GameObject;
    public id: string;
    public enabled: boolean = true;
    public overrides: Set<string> = new Set(); // Track property overrides from prefabs
    public static _serializableFields: string[] = [];

    constructor(gameObject: GameObject) {
        this.gameObject = gameObject;
        this.id = crypto.randomUUID();
    }

    public awake(): void { }
    public start(): void { }
    public onEnable(): void { }
    public onDisable(): void { }
    public update(_deltaTime: number): void { }
    public lateUpdate(): void { }
    public onDestroy(): void { }
    public reset(): void { }

    public serialize(): any {
        const data: any = {
            type: this.constructor.name,
            data: {}
        };

        const fields = (this.constructor as any)._serializableFields || [];
        for (const field of fields) {
            const val = (this as any)[field];
            data.data[field] = Component.serializeValue(val, new Set<unknown>());
        }

        return data;
    }

    public deserialize(data: any): void {
        if (!data) return;
        for (const key in data) {
            const decoded = Component.cloneValue(data[key]);
            if (Component.tryAssignIntoExistingValue((this as any)[key], decoded)) {
                continue;
            }
            (this as any)[key] = decoded;
        }
    }

    private static serializeValue(value: unknown, seen: Set<unknown>): unknown {
        if (value === null) return null;

        const valueType = typeof value;
        if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
            return value;
        }

        if (value instanceof GameObject) {
            return { __ref: value.id, __type: 'GameObject' };
        }

        if (value instanceof Component) {
            return {
                __ref: value.gameObject.id,
                __comp: value.constructor.name,
                __type: 'Component'
            };
        }

        if (valueType === 'object' && seen.has(value)) {
            return null;
        }

        if (value instanceof THREE.Vector2) {
            return { __valueType: 'THREE.Vector2', x: value.x, y: value.y };
        }

        if (value instanceof THREE.Vector3) {
            return { __valueType: 'THREE.Vector3', x: value.x, y: value.y, z: value.z };
        }

        if (value instanceof THREE.Vector4) {
            return { __valueType: 'THREE.Vector4', x: value.x, y: value.y, z: value.z, w: value.w };
        }

        if (value instanceof THREE.Quaternion) {
            return { __valueType: 'THREE.Quaternion', x: value.x, y: value.y, z: value.z, w: value.w };
        }

        if (value instanceof THREE.Euler) {
            return {
                __valueType: 'THREE.Euler',
                x: value.x,
                y: value.y,
                z: value.z,
                order: value.order
            };
        }

        if (value instanceof THREE.Color) {
            return { __valueType: 'THREE.Color', r: value.r, g: value.g, b: value.b };
        }

        if (Array.isArray(value)) {
            return value.map((entry) => Component.serializeValue(entry, seen));
        }

        if (value instanceof Date) {
            return { __valueType: 'Date', iso: value.toISOString() };
        }

        if (value instanceof Set) {
            seen.add(value);
            const values = Array.from(value.values()).map((entry) => Component.serializeValue(entry, seen));
            seen.delete(value);
            return { __valueType: 'Set', values };
        }

        if (value instanceof Map) {
            seen.add(value);
            const entries = Array.from(value.entries()).map(([mapKey, mapValue]) => [
                Component.serializeValue(mapKey, seen),
                Component.serializeValue(mapValue, seen)
            ]);
            seen.delete(value);
            return { __valueType: 'Map', entries };
        }

        if (valueType === 'object') {
            seen.add(value);
            const objectValue = value as Record<string, unknown>;
            const serializedObject: Record<string, unknown> = {};
            for (const [key, entry] of Object.entries(objectValue)) {
                if (typeof entry === 'function' || typeof entry === 'undefined') continue;
                serializedObject[key] = Component.serializeValue(entry, seen);
            }
            seen.delete(value);
            return serializedObject;
        }

        return null;
    }

    private static cloneValue(value: unknown): unknown {
        if (value === null || typeof value !== 'object') {
            return value;
        }

        if (Array.isArray(value)) {
            return value.map((entry) => Component.cloneValue(entry));
        }

        const objectValue = value as Record<string, unknown>;
        const typedValue = Component.deserializeTypedValue(objectValue);
        if (typedValue !== undefined) {
            return typedValue;
        }

        const cloned: Record<string, unknown> = {};
        for (const [key, entry] of Object.entries(objectValue)) {
            cloned[key] = Component.cloneValue(entry);
        }
        return cloned;
    }

    private static deserializeTypedValue(value: Record<string, unknown>): unknown {
        const valueType = typeof value.__valueType === 'string' ? value.__valueType : null;
        if (!valueType) return undefined;

        switch (valueType) {
            case 'THREE.Vector2':
                return new THREE.Vector2(
                    typeof value.x === 'number' ? value.x : 0,
                    typeof value.y === 'number' ? value.y : 0
                );
            case 'THREE.Vector3':
                return new THREE.Vector3(
                    typeof value.x === 'number' ? value.x : 0,
                    typeof value.y === 'number' ? value.y : 0,
                    typeof value.z === 'number' ? value.z : 0
                );
            case 'THREE.Vector4':
                return new THREE.Vector4(
                    typeof value.x === 'number' ? value.x : 0,
                    typeof value.y === 'number' ? value.y : 0,
                    typeof value.z === 'number' ? value.z : 0,
                    typeof value.w === 'number' ? value.w : 0
                );
            case 'THREE.Quaternion':
                return new THREE.Quaternion(
                    typeof value.x === 'number' ? value.x : 0,
                    typeof value.y === 'number' ? value.y : 0,
                    typeof value.z === 'number' ? value.z : 0,
                    typeof value.w === 'number' ? value.w : 1
                );
            case 'THREE.Euler':
                return new THREE.Euler(
                    typeof value.x === 'number' ? value.x : 0,
                    typeof value.y === 'number' ? value.y : 0,
                    typeof value.z === 'number' ? value.z : 0,
                    Component.toEulerOrder(value.order, 'XYZ')
                );
            case 'THREE.Color':
                return new THREE.Color(
                    typeof value.r === 'number' ? value.r : 1,
                    typeof value.g === 'number' ? value.g : 1,
                    typeof value.b === 'number' ? value.b : 1
                );
            case 'Date':
                if (typeof value.iso === 'string') return new Date(value.iso);
                return new Date(0);
            case 'Set':
                if (!Array.isArray(value.values)) return new Set();
                return new Set(value.values.map((entry) => Component.cloneValue(entry)));
            case 'Map':
                if (!Array.isArray(value.entries)) return new Map();
                return new Map(
                    value.entries
                        .filter((entry) => Array.isArray(entry) && entry.length === 2)
                        .map((entry) => [Component.cloneValue(entry[0]), Component.cloneValue(entry[1])])
                );
            default:
                return undefined;
        }
    }

    private static tryAssignIntoExistingValue(existing: unknown, incoming: unknown): boolean {
        if (existing instanceof THREE.Vector2) {
            const parsed = Component.toVectorTuple(incoming, 2);
            if (!parsed) return false;
            existing.set(parsed[0], parsed[1]);
            return true;
        }

        if (existing instanceof THREE.Vector3) {
            const parsed = Component.toVectorTuple(incoming, 3);
            if (!parsed) return false;
            existing.set(parsed[0], parsed[1], parsed[2]);
            return true;
        }

        if (existing instanceof THREE.Vector4) {
            const parsed = Component.toVectorTuple(incoming, 4);
            if (!parsed) return false;
            existing.set(parsed[0], parsed[1], parsed[2], parsed[3]);
            return true;
        }

        if (existing instanceof THREE.Quaternion) {
            const parsed = Component.toVectorTuple(incoming, 4);
            if (!parsed) return false;
            existing.set(parsed[0], parsed[1], parsed[2], parsed[3]);
            return true;
        }

        if (existing instanceof THREE.Euler) {
            if (!incoming || typeof incoming !== 'object') return false;
            const data = incoming as Record<string, unknown>;
            const x = typeof data.x === 'number' ? data.x : existing.x;
            const y = typeof data.y === 'number' ? data.y : existing.y;
            const z = typeof data.z === 'number' ? data.z : existing.z;
            const order = Component.toEulerOrder(data.order, existing.order);
            existing.set(x, y, z, order);
            return true;
        }

        if (existing instanceof THREE.Color) {
            if (incoming instanceof THREE.Color) {
                existing.copy(incoming);
                return true;
            }
            if (typeof incoming === 'string' || typeof incoming === 'number') {
                existing.set(incoming as any);
                return true;
            }
            if (Array.isArray(incoming) && incoming.length >= 3) {
                const [r, g, b] = incoming;
                if (typeof r === 'number' && typeof g === 'number' && typeof b === 'number') {
                    existing.setRGB(r, g, b);
                    return true;
                }
            }
            if (incoming && typeof incoming === 'object') {
                const data = incoming as Record<string, unknown>;
                const r = typeof data.r === 'number' ? data.r : existing.r;
                const g = typeof data.g === 'number' ? data.g : existing.g;
                const b = typeof data.b === 'number' ? data.b : existing.b;
                existing.setRGB(r, g, b);
                return true;
            }
        }

        if (existing instanceof Date) {
            if (incoming instanceof Date) {
                existing.setTime(incoming.getTime());
                return true;
            }
            if (typeof incoming === 'string' || typeof incoming === 'number') {
                const date = new Date(incoming);
                if (!Number.isNaN(date.getTime())) {
                    existing.setTime(date.getTime());
                    return true;
                }
            }
        }

        return false;
    }

    private static toVectorTuple(value: unknown, length: 2 | 3 | 4): number[] | null {
        if (Array.isArray(value) && value.length >= length) {
            const tuple = value.slice(0, length);
            if (tuple.every((entry) => typeof entry === 'number')) {
                return tuple as number[];
            }
        }

        if (value && typeof value === 'object') {
            const objectValue = value as Record<string, unknown>;
            const keys = ['x', 'y', 'z', 'w'].slice(0, length);
            const tuple = keys.map((key) => objectValue[key]);
            if (tuple.every((entry) => typeof entry === 'number')) {
                return tuple as number[];
            }
        }

        return null;
    }

    private static toEulerOrder(value: unknown, fallback: THREE.EulerOrder): THREE.EulerOrder {
        const validOrders: THREE.EulerOrder[] = ['XYZ', 'YZX', 'ZXY', 'XZY', 'YXZ', 'ZYX'];
        if (typeof value === 'string' && validOrders.includes(value as THREE.EulerOrder)) {
            return value as THREE.EulerOrder;
        }
        return fallback;
    }
}
