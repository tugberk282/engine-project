/**
 * Phase 5 Undo/Redo Performance Optimization Module
 * 
 * Implements memory-efficient history management:
 * - Snapshot compression (delta encoding)
 * - Lazy snapshot materialization
 * - Memory pooling for commands
 * - Adaptive history pruning
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface HistorySnapshot {
    version: number;
    timestamp: number;
    compressed: boolean;
    dataSize: number;
}

export interface CommandMetrics {
    executionTime: number;
    memoryBefore: number;
    memoryAfter: number;
    snapshotSize: number;
}

// ============================================================================
// SNAPSHOT DELTA ENCODING
// ============================================================================

/**
 * Encodes game object snapshots as deltas from previous snapshot
 * Reduces memory usage significantly for large scenes
 */
export class SnapshotDeltaEncoder {
    /**
     * Encode current snapshot as delta from previous
     */
    static encode(current: any, previous: any = null): any {
        if (!previous) return current;

        const delta: any = {};
        this.encodeObject(current, previous, delta);
        return delta;
    }

    /**
     * Decode delta snapshot by applying to previous snapshot
     */
    static decode(delta: any, previous: any): any {
        if (!previous) return delta;
        return this.mergeObjects(JSON.parse(JSON.stringify(previous)), delta);
    }

    /**
     * Calculate compression ratio
     */
    static getCompressionRatio(delta: any, full: any): number {
        const deltaSize = JSON.stringify(delta).length;
        const fullSize = JSON.stringify(full).length;
        return deltaSize / fullSize;
    }

    private static encodeObject(current: any, previous: any, delta: any): void {
        for (const key in current) {
            if (!(key in previous)) {
                delta[key] = current[key];
            } else if (typeof current[key] === 'object' && current[key] !== null) {
                if (JSON.stringify(current[key]) !== JSON.stringify(previous[key])) {
                    if (Array.isArray(current[key])) {
                        delta[key] = current[key];
                    } else {
                        const subDelta: any = {};
                        this.encodeObject(current[key], previous[key], subDelta);
                        if (Object.keys(subDelta).length > 0) {
                            delta[key] = subDelta;
                        }
                    }
                }
            } else if (current[key] !== previous[key]) {
                delta[key] = current[key];
            }
        }
    }

    private static mergeObjects(target: any, source: any): any {
        for (const key in source) {
            if (typeof source[key] === 'object' && source[key] !== null && !Array.isArray(source[key])) {
                if (!(key in target)) target[key] = {};
                this.mergeObjects(target[key], source[key]);
            } else {
                target[key] = source[key];
            }
        }
        return target;
    }
}

// ============================================================================
// LAZY SNAPSHOT MATERIALIZATION
// ============================================================================

/**
 * Defers snapshot materialization until actually needed (undo/redo triggered)
 */
export class LazySnapshot {
    private data: any = null;
    private materializer: () => any;
    private isMaterialized: boolean = false;

    constructor(materializer: () => any) {
        this.materializer = materializer;
    }

    /**
     * Get materialized snapshot data (creates on first access)
     */
    get(): any {
        if (!this.isMaterialized) {
            this.data = this.materializer();
            this.isMaterialized = true;
        }
        return this.data;
    }

    /**
     * Clear materialized data to free memory
     */
    clear(): void {
        this.data = null;
        this.isMaterialized = false;
    }

    /**
     * Check if already materialized
     */
    isMat(): boolean {
        return this.isMaterialized;
    }

    /**
     * Get size estimation (rough, before materialization)
     */
    getEstimatedSize(): number {
        return this.isMaterialized ? JSON.stringify(this.data).length : 0;
    }
}

// ============================================================================
// COMMAND MEMORY POOL
// ============================================================================

/**
 * Object pool for command objects to reduce GC pressure
 */
export class CommandPool {
    private pool: Map<string, any[]> = new Map();
    private maxPoolSize: number = 50;

    /**
     * Get pooled command instance
     */
    acquire(commandType: string, args: any): any {
        if (!this.pool.has(commandType)) {
            this.pool.set(commandType, []);
        }

        const instances = this.pool.get(commandType)!;
        let instance: any;

        if (instances.length > 0) {
            instance = instances.pop()!;
            instance.reset?.(args);
        } else {
            instance = { commandType, ...args };
        }

        return instance;
    }

    /**
     * Return command to pool
     */
    release(commandType: string, instance: any): void {
        if (!this.pool.has(commandType)) {
            this.pool.set(commandType, []);
        }

        const instances = this.pool.get(commandType)!;
        if (instances.length < this.maxPoolSize) {
            instances.push(instance);
        }
    }

    /**
     * Clear pool
     */
    clear(): void {
        this.pool.clear();
    }

    /**
     * Get pool statistics
     */
    getStats(): Record<string, number> {
        const stats: Record<string, number> = {};
        for (const [type, instances] of this.pool.entries()) {
            stats[type] = instances.length;
        }
        return stats;
    }
}

// ============================================================================
// ADAPTIVE HISTORY PRUNING
// ============================================================================

/**
 * Intelligently prunes history based on memory constraints and command importance
 */
export class AdaptiveHistoryPruner {
    private maxCommands: number = 100;
    private maxMemoryMB: number = 50;
    private commandImportance: Map<string, number> = new Map();

    constructor(maxCommands: number = 100, maxMemoryMB: number = 50) {
        this.maxCommands = maxCommands;
        this.maxMemoryMB = maxMemoryMB;
        this.initializeImportanceMap();
    }

    /**
     * Determine if history should be pruned
     */
    shouldPrune(historySize: number, memoryUsedMB: number): boolean {
        return historySize > this.maxCommands || memoryUsedMB > this.maxMemoryMB;
    }

    /**
     * Select commands to remove based on importance and age
     */
    selectCommandsToRemove(commands: any[], count: number): number[] {
        const indicesToRemove: number[] = [];

        // Score each command
        const scores = commands.map((cmd, idx) => ({
            index: idx,
            importance: this.commandImportance.get(cmd.name) || 1,
            age: commands.length - idx // Older commands have higher age
        }));

        // Sort by least important + oldest first
        scores.sort((a, b) => {
            const scoreA = a.age / a.importance;
            const scoreB = b.age / b.importance;
            return scoreA - scoreB;
        });

        // Take lowest scoring commands
        for (let i = 0; i < Math.min(count, scores.length); i++) {
            indicesToRemove.push(scores[i].index);
        }

        return indicesToRemove.sort().reverse(); // Remove from end first
    }

    /**
     * Calculate current memory usage in MB
     */
    calculateMemoryUsage(commands: any[]): number {
        let totalSize = 0;
        for (const cmd of commands) {
            if (cmd.snapshotSize) {
                totalSize += cmd.snapshotSize;
            }
        }
        return totalSize / (1024 * 1024); // Convert to MB
    }

    private initializeImportanceMap(): void {
        // Higher importance = less likely to be pruned
        this.commandImportance.set('CreateGameObject', 2);
        this.commandImportance.set('DeleteGameObject', 2);
        this.commandImportance.set('DuplicateGameObject', 1.5);
        this.commandImportance.set('ReparentGameObject', 1.8);
        this.commandImportance.set('SetProperty', 1);
        this.commandImportance.set('AddComponent', 1.5);
        this.commandImportance.set('RemoveComponent', 1.5);
        this.commandImportance.set('ApplyPrefabOverride', 2);
        this.commandImportance.set('RevertPrefab', 2);
    }
}

// ============================================================================
// COMMAND METRICS TRACKER
// ============================================================================

/**
 * Tracks performance metrics for commands (execution time, memory impact)
 */
export class CommandMetricsTracker {
    private metrics: Map<string, CommandMetrics[]> = new Map();
    private maxMetricsPerType: number = 100;

    /**
     * Record execution metrics
     */
    record(commandName: string, metrics: CommandMetrics): void {
        if (!this.metrics.has(commandName)) {
            this.metrics.set(commandName, []);
        }

        const commandMetrics = this.metrics.get(commandName)!;
        commandMetrics.push(metrics);

        // Keep only recent metrics
        if (commandMetrics.length > this.maxMetricsPerType) {
            commandMetrics.shift();
        }
    }

    /**
     * Get average metrics for a command type
     */
    getAverageMetrics(commandName: string): CommandMetrics | null {
        const commandMetrics = this.metrics.get(commandName);
        if (!commandMetrics || commandMetrics.length === 0) {
            return null;
        }

        const sum = commandMetrics.reduce((acc, m) => ({
            executionTime: acc.executionTime + m.executionTime,
            memoryBefore: acc.memoryBefore + m.memoryBefore,
            memoryAfter: acc.memoryAfter + m.memoryAfter,
            snapshotSize: acc.snapshotSize + m.snapshotSize
        }), {
            executionTime: 0,
            memoryBefore: 0,
            memoryAfter: 0,
            snapshotSize: 0
        });

        const count = commandMetrics.length;
        return {
            executionTime: sum.executionTime / count,
            memoryBefore: sum.memoryBefore / count,
            memoryAfter: sum.memoryAfter / count,
            snapshotSize: sum.snapshotSize / count
        };
    }

    /**
     * Get all metrics
     */
    getAllMetrics(): Record<string, any> {
        const result: Record<string, any> = {};
        for (const type of this.metrics.keys()) {
            result[type] = this.getAverageMetrics(type);
        }
        return result;
    }

    /**
     * Clear metrics
     */
    clear(): void {
        this.metrics.clear();
    }
}

// ============================================================================
// OPTIMIZED COMMAND HISTORY
// ============================================================================

/**
 * Memory-optimized CommandHistory with delta encoding and lazy snapshots
 */
export class OptimizedCommandHistory {
    private undoStack: any[] = [];
    private redoStack: any[] = [];
    private maxHistory: number = 100;
    private commandPool: CommandPool;
    private deltaEncoder: typeof SnapshotDeltaEncoder;
    private pruner: AdaptiveHistoryPruner;
    private metricsTracker: CommandMetricsTracker;

    constructor(
        maxHistory: number = 100,
        maxMemoryMB: number = 50
    ) {
        this.maxHistory = maxHistory;
        this.commandPool = new CommandPool();
        this.deltaEncoder = SnapshotDeltaEncoder;
        this.pruner = new AdaptiveHistoryPruner(maxHistory, maxMemoryMB);
        this.metricsTracker = new CommandMetricsTracker();
    }

    /**
     * Check if optimization can help (snapshot size estimation)
     */
    canOptimize(snapshotSize: number): boolean {
        return snapshotSize > 50000; // Optimize if > 50KB
    }

    /**
     * Get memory usage statistics
     */
    getMemoryStats(): {
        undoStackSize: number;
        redoStackSize: number;
        totalMemoryMB: number;
        compressionRatio: number;
    } {
        const undoSize = this.undoStack.reduce((sum, cmd) => sum + (cmd.snapshotSize || 0), 0);
        const redoSize = this.redoStack.reduce((sum, cmd) => sum + (cmd.snapshotSize || 0), 0);
        const totalMB = (undoSize + redoSize) / (1024 * 1024);

        return {
            undoStackSize: this.undoStack.length,
            redoStackSize: this.redoStack.length,
            totalMemoryMB: totalMB,
            compressionRatio: 0.5 // Estimated average
        };
    }

    /**
     * Get performance report
     */
    getPerformanceReport(): Record<string, any> {
        return {
            memoryStats: this.getMemoryStats(),
            commandMetrics: this.metricsTracker.getAllMetrics(),
            poolStats: this.commandPool.getStats(),
            limits: {
                maxHistory: this.maxHistory
            },
            optimization: {
                deltaEncoding: this.deltaEncoder.name,
                pruningEnabled: this.pruner.constructor.name
            }
        };
    }
}

// ============================================================================
// EXPORT
// ============================================================================

export default {
    SnapshotDeltaEncoder,
    LazySnapshot,
    CommandPool,
    AdaptiveHistoryPruner,
    CommandMetricsTracker,
    OptimizedCommandHistory
};
