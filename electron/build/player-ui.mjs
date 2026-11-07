const CONTROL_TYPES = new Set(['UIButton', 'UIInputField', 'UIDropdown', 'UIToggle', 'UISlider']);

export function collectPlayerUiControls(scene) {
    const controls = [];
    const visit = (object) => {
        const rect = (object?.components || []).find((component) => component?.type === 'RectTransform')?.data || null;
        const vector = (value, fallback) => Array.isArray(value) ? value : [Number(value?.x ?? fallback[0]), Number(value?.y ?? fallback[1])];
        const size = vector(rect?.sizeDelta, [100, 30]);
        const anchored = vector(rect?.anchoredPosition, [0, 0]);
        const anchor = vector(rect?.anchorMin, [0.5, 0.5]);
        for (const component of object?.components || []) {
            if (!CONTROL_TYPES.has(component?.type)) continue;
            const data = component.data && typeof component.data === 'object' ? component.data : {};
            controls.push({
                id: `${object.id || object.name || 'ui'}:${component.type}`,
                type: component.type,
                label: String(data.label ?? object.name ?? component.type),
                eventName: String(data.eventName ?? ''),
                text: String(data.text ?? ''),
                placeholder: String(data.placeholder ?? ''),
                lineType: String(data.lineType ?? 'SingleLine'),
                options: Array.isArray(data.options) ? data.options.map((value) => String(value)) : [],
                selectedIndex: Number.isFinite(Number(data.selectedIndex)) ? Number(data.selectedIndex) : 0,
                isOn: data.isOn === true,
                value: Number.isFinite(Number(data.value)) ? Number(data.value) : 0,
                minValue: Number.isFinite(Number(data.minValue)) ? Number(data.minValue) : 0,
                maxValue: Number.isFinite(Number(data.maxValue)) ? Number(data.maxValue) : 1,
                wholeNumbers: data.wholeNumbers === true,
                readOnly: data.readOnly === true,
                characterLimit: Number.isFinite(Number(data.characterLimit)) ? Math.max(0, Number(data.characterLimit)) : 0
                ,layout: { width: size[0], height: size[1], x: anchored[0], y: anchored[1], anchorX: anchor[0], anchorY: anchor[1] }
            });
        }
        for (const child of object?.children || []) visit(child);
    };
    for (const object of scene?.gameObjects || []) visit(object);
    return controls;
}

export function collectPlayerUiText(scene) {
    const entries = [];
    const visit = (object) => {
        const component = (object?.components || []).find((entry) => entry?.type === 'UIText');
        if (component) {
            const data = component.data && typeof component.data === 'object' ? component.data : {};
            const rect = (object.components || []).find((entry) => entry?.type === 'RectTransform')?.data || {};
            const pair = (value, fallback) => Array.isArray(value) ? value : [Number(value?.x ?? fallback[0]), Number(value?.y ?? fallback[1])];
            const size = pair(rect.sizeDelta, [100, 20]);
            const anchored = pair(rect.anchoredPosition, [0, 0]);
            const anchor = pair(rect.anchorMin, [0.5, 0.5]);
            entries.push({
                id: `${object.id || object.name || 'ui'}:UIText`,
                text: String(data.text ?? ''),
                fontSize: Number.isFinite(Number(data.fontSize)) ? Number(data.fontSize) : 14,
                color: String(data.color ?? '#ffffff'),
                alignment: String(data.alignment ?? 'left'),
                layout: { width: size[0], height: size[1], x: anchored[0], y: anchored[1], anchorX: anchor[0], anchorY: anchor[1] }
            });
        }
        for (const child of object?.children || []) visit(child);
    };
    for (const object of scene?.gameObjects || []) visit(object);
    return entries;
}

export function collectPlayerSceneLoadActions(scene) {
    const actions = [];
    const visit = (object) => {
        for (const component of object?.components || []) {
            if (component?.type !== 'UIEventAction' || component.enabled === false || component.data?.enabled === false) continue;
            const data = component.data && typeof component.data === 'object' ? component.data : {};
            if (data.action !== 'LoadScene' || typeof data.eventName !== 'string' || typeof data.scenePath !== 'string') continue;
            actions.push({ eventName: data.eventName, scenePath: data.scenePath.replaceAll('\\', '/') });
        }
        for (const child of object?.children || []) visit(child);
    };
    for (const object of scene?.gameObjects || []) visit(object);
    return actions;
}

function postControlEvent(worker, sessionId, control, value) {
    if (!control.eventName) return;
    worker.postMessage({
        protocolVersion: 1,
        sessionId,
        command: 'uiEvent',
        payload: { name: control.eventName, value, controlId: control.id, controlType: control.type }
    });
}

export function mountPlayerUiControls(document, container, controls, worker, sessionId) {
    for (const control of controls) {
        const wrapper = document.createElement('label');
        wrapper.dataset.uiControl = control.type;
        wrapper.dataset.uiControlId = control.id;
        wrapper.textContent = control.label;
        wrapper.style.position = 'absolute';
        wrapper.style.width = `${Math.max(1, control.layout.width)}px`;
        wrapper.style.minHeight = `${Math.max(1, control.layout.height)}px`;
        wrapper.style.left = `calc(${Math.max(0, Math.min(1, control.layout.anchorX)) * 100}% + ${control.layout.x}px)`;
        wrapper.style.top = `calc(${(1 - Math.max(0, Math.min(1, control.layout.anchorY))) * 100}% - ${control.layout.y}px)`;
        wrapper.style.pointerEvents = 'auto';
        let input;
        if (control.type === 'UIButton') {
            input = document.createElement('button');
            input.type = 'button';
            input.textContent = control.label;
            input.addEventListener('click', () => postControlEvent(worker, sessionId, control, true));
        } else if (control.type === 'UIInputField') {
            input = document.createElement('textarea');
            input.rows = control.lineType === 'SingleLine' ? 1 : 3;
            input.value = control.text;
            input.placeholder = control.placeholder;
            input.readOnly = control.readOnly;
            if (control.characterLimit > 0) input.maxLength = control.characterLimit;
            input.addEventListener('input', () => postControlEvent(worker, sessionId, control, input.value));
            input.addEventListener('change', () => postControlEvent(worker, sessionId, control, input.value));
        } else if (control.type === 'UIDropdown') {
            input = document.createElement('select');
            for (const [index, option] of control.options.entries()) {
                const item = document.createElement('option');
                item.value = String(index);
                item.textContent = option;
                input.append(item);
            }
            input.value = String(Math.max(0, Math.min(control.options.length - 1, control.selectedIndex)));
            input.addEventListener('change', () => postControlEvent(worker, sessionId, control, {
                index: Number(input.value), value: control.options[Number(input.value)] ?? null
            }));
        } else if (control.type === 'UIToggle') {
            input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = control.isOn;
            input.addEventListener('change', () => postControlEvent(worker, sessionId, control, input.checked));
        } else {
            input = document.createElement('input');
            input.type = 'range';
            input.min = String(Math.min(control.minValue, control.maxValue));
            input.max = String(Math.max(control.minValue, control.maxValue));
            input.step = control.wholeNumbers ? '1' : 'any';
            input.value = String(Math.max(Number(input.min), Math.min(Number(input.max), control.value)));
            input.addEventListener('input', () => postControlEvent(worker, sessionId, control, Number(input.value)));
        }
        input.dataset.uiEvent = control.eventName;
        wrapper.append(input);
        container.append(wrapper);
    }
}
