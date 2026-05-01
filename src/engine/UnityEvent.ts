/**
 * UnityEvent - Unity-style event system
 */
export class UnityEvent<T = void> {
    private listeners: Array<(arg: T) => void> = [];

    public addListener(callback: (arg: T) => void): void {
        if (!this.listeners.includes(callback)) {
            this.listeners.push(callback);
        }
    }

    public removeListener(callback: (arg: T) => void): void {
        const index = this.listeners.indexOf(callback);
        if (index !== -1) {
            this.listeners.splice(index, 1);
        }
    }

    public removeAllListeners(): void {
        this.listeners = [];
    }

    public invoke(arg: T): void {
        this.listeners.forEach(listener => listener(arg));
    }

    public getListenerCount(): number {
        return this.listeners.length;
    }
}

// Example usage:
// class MyComponent extends Component {
//     public onDamage: UnityEvent<number> = new UnityEvent();
//
//     public takeDamage(amount: number) {
//         this.onDamage.invoke(amount);
//     }
// }
//
// myComponent.onDamage.addListener((damage) => {
//     console.log(`Took ${damage} damage!`);
// });
