export class Input {
    private static keys: Set<string> = new Set();
    private static keysDown: Set<string> = new Set();
    private static keysUp: Set<string> = new Set();

    private static mouseButtons: Set<number> = new Set();
    private static mouseButtonsDown: Set<number> = new Set();
    private static mouseButtonsUp: Set<number> = new Set();

    public static mousePosition: { x: number, y: number } = { x: 0, y: 0 };
    public static mouseDelta: { x: number, y: number } = { x: 0, y: 0 };
    public static mouseWheel: number = 0;

    // Axis configuration
    private static axes: { [name: string]: { positive: string, negative: string, value: number, sensitivity: number, gravity: number } } = {
        "Horizontal": { positive: "KeyD", negative: "KeyA", value: 0, sensitivity: 3, gravity: 3 },
        "Vertical": { positive: "KeyW", negative: "KeyS", value: 0, sensitivity: 3, gravity: 3 },
    };

    private static actions: { [name: string]: string[] } = {
        "Jump": ["Space"],
        "Fire": ["Mouse0"],
        "Submit": ["Enter", "NumpadEnter"],
        "Cancel": ["Escape"]
    };

    public static initialize() {
        window.addEventListener('keydown', (e) => {
            if (!this.keys.has(e.code)) {
                this.keysDown.add(e.code);
            }
            this.keys.add(e.code);
        });

        window.addEventListener('keyup', (e) => {
            this.keysUp.add(e.code);
            this.keys.delete(e.code);
        });

        window.addEventListener('mousedown', (e) => {
            if (!this.mouseButtons.has(e.button)) {
                this.mouseButtonsDown.add(e.button);
            }
            this.mouseButtons.add(e.button);
        });

        window.addEventListener('mouseup', (e) => {
            this.mouseButtonsUp.add(e.button);
            this.mouseButtons.delete(e.button);
        });

        window.addEventListener('mousemove', (e) => {
            this.mouseDelta.x += e.movementX;
            this.mouseDelta.y += e.movementY;
            this.mousePosition.x = e.clientX;
            this.mousePosition.y = e.clientY;
        });

        window.addEventListener('wheel', (e) => {
            this.mouseWheel = e.deltaY;
        }, { passive: false });

        // Prevent context menu
        window.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    public static update(deltaTime: number) {
        // Update Axes
        for (const name in this.axes) {
            const axis = this.axes[name];
            let target = 0;
            if (this.getKey(axis.positive)) target += 1;
            if (this.getKey(axis.negative)) target -= 1;

            // Simple smoothing
            // Move value towards target by sensitivity * deltaTime
            // If returning to 0, use gravity * deltaTime
            const speed = target === 0 ? axis.gravity : axis.sensitivity;
            const diff = target - axis.value;
            const step = speed * deltaTime;

            if (Math.abs(diff) <= step) {
                axis.value = target;
            } else {
                axis.value += Math.sign(diff) * step;
            }
        }
    }

    // Call this at the VERY END of the frame
    public static lateUpdate() {
        this.keysDown.clear();
        this.keysUp.clear();
        this.mouseButtonsDown.clear();
        this.mouseButtonsUp.clear();
        this.mouseDelta.x = 0;
        this.mouseDelta.y = 0;
        this.mouseWheel = 0;
    }

    // --- Unity Style API ---

    public static GetAxis(axisName: string): number {
        return this.axes[axisName] ? this.axes[axisName].value : 0;
    }

    public static getKey(code: string): boolean {
        return this.keys.has(code);
    }

    public static getKeyDown(code: string): boolean {
        return this.keysDown.has(code);
    }

    public static getKeyUp(code: string): boolean {
        return this.keysUp.has(code);
    }

    public static getMouseButton(button: number): boolean {
        return this.mouseButtons.has(button);
    }

    public static getMouseButtonDown(button: number): boolean {
        return this.mouseButtonsDown.has(button);
    }

    public static getMouseButtonUp(button: number): boolean {
        return this.mouseButtonsUp.has(button);
    }

    public static getButton(actionName: string): boolean {
        const keys = this.actions[actionName];
        if (!keys) return false;
        return keys.some(k => k.startsWith('Mouse') ? this.getMouseButton(parseInt(k.replace('Mouse', ''))) : this.getKey(k));
    }

    public static getButtonDown(actionName: string): boolean {
        const keys = this.actions[actionName];
        if (!keys) return false;
        return keys.some(k => k.startsWith('Mouse') ? this.getMouseButtonDown(parseInt(k.replace('Mouse', ''))) : this.getKeyDown(k));
    }

    public static getButtonUp(actionName: string): boolean {
        const keys = this.actions[actionName];
        if (!keys) return false;
        return keys.some(k => k.startsWith('Mouse') ? this.getMouseButtonUp(parseInt(k.replace('Mouse', ''))) : this.getKeyUp(k));
    }

    // Alias for old usage, can be deprecated
    public static resetDelta() {
        this.lateUpdate();
    }
}
