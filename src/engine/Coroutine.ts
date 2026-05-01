/**
 * Coroutine - Unity-style coroutine system
 */
export class Coroutine {
    private static coroutines: Map<number, CoroutineInstance> = new Map();
    private static nextId: number = 0;

    public static startCoroutine(generator: Generator, context?: any): number {
        const id = this.nextId++;
        const instance: CoroutineInstance = {
            id,
            generator,
            context,
            isRunning: true,
            waitUntil: 0
        };
        this.coroutines.set(id, instance);
        return id;
    }

    public static stopCoroutine(id: number): void {
        const coroutine = this.coroutines.get(id);
        if (coroutine) {
            coroutine.isRunning = false;
            this.coroutines.delete(id);
        }
    }

    public static stopAllCoroutines(): void {
        this.coroutines.clear();
    }

    public static update(_deltaTime: number): void {
        const now = Date.now();

        this.coroutines.forEach((coroutine, id) => {
            if (!coroutine.isRunning) {
                this.coroutines.delete(id);
                return;
            }

            // Check if we should wait
            if (coroutine.waitUntil > now) {
                return;
            }

            // Continue execution
            const result = coroutine.generator.next();

            if (result.done) {
                this.coroutines.delete(id);
            } else if (result.value) {
                // Handle yield values
                if (result.value instanceof WaitForSeconds) {
                    coroutine.waitUntil = now + (result.value.seconds * 1000);
                } else if (result.value instanceof WaitUntil) {
                    // Check condition next frame
                    if (!result.value.condition()) {
                        coroutine.waitUntil = now + 16; // ~1 frame
                    }
                }
            }
        });
    }
}

interface CoroutineInstance {
    id: number;
    generator: Generator;
    context?: any;
    isRunning: boolean;
    waitUntil: number;
}

// Yield instructions
export class WaitForSeconds {
    constructor(public seconds: number) { }
}

export class WaitUntil {
    constructor(public condition: () => boolean) { }
}

export class WaitForEndOfFrame {
    // Will be handled by the engine
}

// Example usage:
// function* myCoroutine() {
//     console.log('Start');
//     yield new WaitForSeconds(2);
//     console.log('After 2 seconds');
//     yield new WaitUntil(() => someCondition);
//     console.log('Condition met');
// }
// Coroutine.startCoroutine(myCoroutine());
