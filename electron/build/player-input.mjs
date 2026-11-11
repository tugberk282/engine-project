export function normalizeInputBinding(value) {
    if (typeof value !== 'string') return '';
    if (value === ' ') return 'Space';
    const raw = value.trim();
    if (!raw) return '';
    const mouse = /^mouse(\d+)$/i.exec(raw);
    if (mouse) return `Mouse${mouse[1]}`;
    const gamepad = /^gamepad(\d+)$/i.exec(raw);
    if (gamepad) return `Gamepad${gamepad[1]}`;
    if (/^[a-z]$/i.test(raw)) return `Key${raw.toUpperCase()}`;
    return raw;
}

function pressed(binding, state) {
    if (!binding) return false;
    if (binding.startsWith('Mouse')) return state.mouseButtons.has(Number(binding.slice(5)));
    if (binding.startsWith('Gamepad')) return state.gamepadButtons.has(Number(binding.slice(7)));
    return state.keys.has(binding);
}

function moveTowards(current, target, amount) {
    if (Math.abs(target - current) <= amount) return target;
    return current + Math.sign(target - current) * amount;
}

export function createPlayerInputMapper(rawInputMap = {}) {
    const rawAxes = rawInputMap?.axes && typeof rawInputMap.axes === 'object' ? rawInputMap.axes : {};
    const axes = Object.fromEntries(Object.entries(rawAxes).map(([name, value]) => {
        const axis = value && typeof value === 'object' ? value : {};
        return [name, {
            positive: normalizeInputBinding(axis.positive ?? axis.positiveButton),
            negative: normalizeInputBinding(axis.negative ?? axis.negativeButton),
            positiveAlt: normalizeInputBinding(axis.positiveAlt ?? axis.altPositiveButton),
            negativeAlt: normalizeInputBinding(axis.negativeAlt ?? axis.altNegativeButton),
            sensitivity: Math.max(0, Number(axis.sensitivity) || 3),
            gravity: Math.max(0, Number(axis.gravity) || 3),
            snap: axis.snap === true,
            value: 0
        }];
    }));
    const rawActions = rawInputMap?.actions && typeof rawInputMap.actions === 'object' ? rawInputMap.actions : {};
    const actions = Object.fromEntries(Object.entries(rawActions).map(([name, bindings]) => [
        name, Array.isArray(bindings) ? bindings.map(normalizeInputBinding).filter(Boolean) : []
    ]));

    const ensureAxis = (name, positive, negative, positiveAlt, negativeAlt) => {
        if (!axes[name]) axes[name] = { positive, negative, positiveAlt, negativeAlt, sensitivity: 3, gravity: 3, snap: true, value: 0 };
    };
    ensureAxis('Horizontal', 'ArrowRight', 'ArrowLeft', 'KeyD', 'KeyA');
    ensureAxis('Vertical', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyS');
    if (!actions.Jump?.length) actions.Jump = ['Space'];
    const previousActions = new Map(Object.keys(actions).map((name) => [name, false]));

    return {
        sample(source = {}, deltaTime = 0) {
            const state = {
                keys: source.keys instanceof Set ? source.keys : new Set(),
                mouseButtons: source.mouseButtons instanceof Set ? source.mouseButtons : new Set(),
                gamepadButtons: source.gamepadButtons instanceof Set ? source.gamepadButtons : new Set()
            };
            const dt = Math.max(0, Math.min(0.1, Number(deltaTime) || 0));
            const frame = {};
            for (const [name, axis] of Object.entries(axes)) {
                let target = (pressed(axis.positive, state) || pressed(axis.positiveAlt, state) ? 1 : 0)
                    - (pressed(axis.negative, state) || pressed(axis.negativeAlt, state) ? 1 : 0);
                if (target === 0 && name === 'Horizontal') target = Number(source.gamepadAxes?.horizontal) || 0;
                if (target === 0 && name === 'Vertical') target = Number(source.gamepadAxes?.vertical) || 0;
                target = Math.max(-1, Math.min(1, target));
                if (axis.snap && target !== 0 && Math.sign(target) !== Math.sign(axis.value)) axis.value = 0;
                axis.value = moveTowards(axis.value, target, (target === 0 ? axis.gravity : axis.sensitivity) * dt);
                frame[name] = axis.value;
            }
            for (const [name, bindings] of Object.entries(actions)) {
                const active = bindings.some((binding) => pressed(binding, state));
                const previous = previousActions.get(name) === true;
                frame[name] = active;
                frame[`__buttonDown:${name}`] = active && !previous;
                frame[`__buttonUp:${name}`] = !active && previous;
                previousActions.set(name, active);
            }
            frame.LookX = Number(source.mouseDelta?.x) || 0;
            frame.LookY = Number(source.mouseDelta?.y) || 0;
            return frame;
        },
        clear() {
            for (const axis of Object.values(axes)) axis.value = 0;
            for (const name of previousActions.keys()) previousActions.set(name, false);
        }
    };
}
