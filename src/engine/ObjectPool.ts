/**
 * ObjectPool - Unity-style object pooling system
 */
export class ObjectPool<T> {
    private pool: T[] = [];
    private active: Set<T> = new Set();
    private factory: () => T;
    private reset?: (obj: T) => void;
    private maxSize: number;

    constructor(factory: () => T, initialSize: number = 10, maxSize: number = 100, reset?: (obj: T) => void) {
        this.factory = factory;
        this.maxSize = maxSize;
        this.reset = reset;

        // Pre-populate pool
        for (let i = 0; i < initialSize; i++) {
            this.pool.push(factory());
        }
    }

    public get(): T {
        let obj: T;

        if (this.pool.length > 0) {
            obj = this.pool.pop()!;
        } else {
            obj = this.factory();
        }

        this.active.add(obj);
        return obj;
    }

    public release(obj: T): void {
        if (!this.active.has(obj)) {
            console.warn('Trying to release object that is not from this pool');
            return;
        }

        this.active.delete(obj);

        // Reset object if reset function provided
        if (this.reset) {
            this.reset(obj);
        }

        // Only add back to pool if under max size
        if (this.pool.length < this.maxSize) {
            this.pool.push(obj);
        }
    }

    public releaseAll(): void {
        this.active.forEach(obj => {
            if (this.reset) {
                this.reset(obj);
            }
            if (this.pool.length < this.maxSize) {
                this.pool.push(obj);
            }
        });
        this.active.clear();
    }

    public getActiveCount(): number {
        return this.active.size;
    }

    public getPooledCount(): number {
        return this.pool.length;
    }

    public clear(): void {
        this.pool = [];
        this.active.clear();
    }
}

/**
 * PoolManager - Global pool manager
 */
export class PoolManager {
    private static pools: Map<string, ObjectPool<any>> = new Map();

    public static createPool<T>(
        name: string,
        factory: () => T,
        initialSize: number = 10,
        maxSize: number = 100,
        reset?: (obj: T) => void
    ): ObjectPool<T> {
        const pool = new ObjectPool(factory, initialSize, maxSize, reset);
        this.pools.set(name, pool);
        return pool;
    }

    public static getPool<T>(name: string): ObjectPool<T> | null {
        return this.pools.get(name) || null;
    }

    public static releaseAllPools(): void {
        this.pools.forEach(pool => pool.releaseAll());
    }

    public static clearAllPools(): void {
        this.pools.forEach(pool => pool.clear());
        this.pools.clear();
    }
}

// Example usage:
// const bulletPool = PoolManager.createPool(
//     'bullets',
//     () => new Bullet(),
//     20,
//     100,
//     (bullet) => bullet.reset()
// );
//
// const bullet = bulletPool.get();
// // Use bullet
// bulletPool.release(bullet);
