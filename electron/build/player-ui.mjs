const CONTROL_TYPES = new Set(['UIButton', 'UIInputField', 'UIDropdown', 'UIToggle', 'UISlider', 'UIScrollbar']);

function readRectLayout(object, defaultSize) {
    const rect = (object?.components || []).find((component) => component?.type === 'RectTransform')?.data || null;
    const vector = (value, fallback) => Array.isArray(value)
        ? [Number(value[0] ?? fallback[0]), Number(value[1] ?? fallback[1])]
        : [Number(value?.x ?? fallback[0]), Number(value?.y ?? fallback[1])];
    const size = vector(rect?.sizeDelta, defaultSize);
    const anchored = vector(rect?.anchoredPosition, [0, 0]);
    const anchor = vector(rect?.anchorMin, [0.5, 0.5]);
    const pivot = vector(rect?.pivot, [0.5, 0.5]);
    return {
        width: size[0], height: size[1], x: anchored[0], y: anchored[1],
        anchorX: anchor[0], anchorY: anchor[1], pivotX: pivot[0], pivotY: pivot[1]
    };
}

function resolveCanvasInteraction(object, parent) {
    const component = (object?.components || []).find((entry) => entry?.type === 'CanvasGroup' && entry.enabled !== false);
    if (!component) return parent;
    const data = component.data && typeof component.data === 'object' ? component.data : {};
    const inherited = data.ignoreParentGroups === true
        ? { alpha: 1, interactable: true, blocksRaycasts: true }
        : parent;
    const alpha = Number(data.alpha);
    return {
        alpha: Math.max(0, inherited.alpha * (Number.isFinite(alpha) ? alpha : 1)),
        interactable: inherited.interactable && data.interactable !== false,
        blocksRaycasts: inherited.blocksRaycasts && data.blocksRaycasts !== false
    };
}

const DEFAULT_INTERACTION = Object.freeze({ alpha: 1, interactable: true, blocksRaycasts: true });
const ROOT_FRAME = Object.freeze({
    leftPercent: 0, leftPixels: 0, topPercent: 0, topPixels: 0,
    widthPercent: 1, widthPixels: 0, heightPercent: 1, heightPixels: 0
});

function readGameObjectReference(value) {
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object') return null;
    const id = value.__ref ?? value.id;
    return typeof id === 'string' && id.length > 0 ? id : null;
}

function resolveRectFrame(object, parentFrame) {
    if ((object?.components || []).some((entry) => entry?.type === 'Canvas' && entry.enabled !== false)) {
        return ROOT_FRAME;
    }
    const hasRect = (object?.components || []).some((entry) => entry?.type === 'RectTransform' && entry.enabled !== false);
    if (!hasRect) return parentFrame;
    const layout = readRectLayout(object, [100, 100]);
    const minX = Math.max(0, Math.min(1, layout.anchorX));
    const maxX = (() => {
        const rect = (object.components || []).find((entry) => entry?.type === 'RectTransform')?.data || {};
        const value = Array.isArray(rect.anchorMax) ? rect.anchorMax[0] : rect.anchorMax?.x;
        return Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : minX));
    })();
    const minY = Math.max(0, Math.min(1, layout.anchorY));
    const maxY = (() => {
        const rect = (object.components || []).find((entry) => entry?.type === 'RectTransform')?.data || {};
        const value = Array.isArray(rect.anchorMax) ? rect.anchorMax[1] : rect.anchorMax?.y;
        return Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : minY));
    })();
    const stretchedX = minX !== maxX;
    const stretchedY = minY !== maxY;
    const widthPercent = stretchedX ? (maxX - minX) * parentFrame.widthPercent : 0;
    const widthPixels = stretchedX ? (maxX - minX) * parentFrame.widthPixels + layout.width : layout.width;
    const heightPercent = stretchedY ? (maxY - minY) * parentFrame.heightPercent : 0;
    const heightPixels = stretchedY ? (maxY - minY) * parentFrame.heightPixels + layout.height : layout.height;
    return {
        leftPercent: parentFrame.leftPercent + minX * parentFrame.widthPercent - (stretchedX ? 0 : layout.pivotX * widthPercent),
        leftPixels: parentFrame.leftPixels + minX * parentFrame.widthPixels + layout.x - (stretchedX ? 0 : layout.pivotX * widthPixels),
        topPercent: parentFrame.topPercent + (1 - (stretchedY ? maxY : minY)) * parentFrame.heightPercent - (stretchedY ? 0 : (1 - layout.pivotY) * heightPercent),
        topPixels: parentFrame.topPixels + (1 - (stretchedY ? maxY : minY)) * parentFrame.heightPixels - layout.y - (stretchedY ? 0 : (1 - layout.pivotY) * heightPixels),
        widthPercent, widthPixels, heightPercent, heightPixels
    };
}

const frameLength = (percent = 0, pixels = 0) => ({ percent, pixels });
const addLength = (...values) => values.reduce((result, value) => ({
    percent: result.percent + value.percent,
    pixels: result.pixels + value.pixels
}), frameLength());
const scaleLength = (value, scale) => ({ percent: value.percent * scale, pixels: value.pixels * scale });

function frameLengths(frame) {
    return {
        left: frameLength(frame.leftPercent, frame.leftPixels),
        top: frameLength(frame.topPercent, frame.topPixels),
        width: frameLength(frame.widthPercent, frame.widthPixels),
        height: frameLength(frame.heightPercent, frame.heightPixels)
    };
}

function composeFrame(left, top, width, height) {
    return {
        leftPercent: left.percent, leftPixels: left.pixels,
        topPercent: top.percent, topPixels: top.pixels,
        widthPercent: width.percent, widthPixels: width.pixels,
        heightPercent: height.percent, heightPixels: height.pixels
    };
}

function componentSettings(object, type) {
    const component = (object?.components || []).find((entry) => entry?.type === type && entry.enabled !== false);
    return component ? (component.data && typeof component.data === 'object' ? component.data : {}) : null;
}

function horizontalAlignment(value) {
    return String(value || '').includes('Center') ? 0.5 : String(value || '').includes('Right') ? 1 : 0;
}

function verticalAlignment(value) {
    return String(value || '').startsWith('Middle') ? 0.5 : String(value || '').startsWith('Lower') ? 1 : 0;
}

function preferredContentSize(object) {
    const children = (object?.children || []).filter((child) =>
        (child?.components || []).some((entry) => entry?.type === 'RectTransform' && entry.enabled !== false)
    );
    const vertical = componentSettings(object, 'VerticalLayoutGroup');
    const horizontal = componentSettings(object, 'HorizontalLayoutGroup');
    const sizes = children.map((child) => readRectLayout(child, [100, 100]));
    if (vertical) {
        return {
            width: Math.max(0, ...sizes.map((entry) => entry.width))
                + Number(vertical.paddingLeft || 0) + Number(vertical.paddingRight || 0),
            height: sizes.reduce((sum, entry) => sum + entry.height, 0)
                + Math.max(0, sizes.length - 1) * Number(vertical.spacing || 0)
                + Number(vertical.paddingTop || 0) + Number(vertical.paddingBottom || 0)
        };
    }
    if (horizontal) {
        return {
            width: sizes.reduce((sum, entry) => sum + entry.width, 0)
                + Math.max(0, sizes.length - 1) * Number(horizontal.spacing || 0)
                + Number(horizontal.paddingLeft || 0) + Number(horizontal.paddingRight || 0),
            height: Math.max(0, ...sizes.map((entry) => entry.height))
                + Number(horizontal.paddingTop || 0) + Number(horizontal.paddingBottom || 0)
        };
    }
    return {
        width: Math.max(0, ...sizes.map((entry) => entry.x + entry.width * (1 - entry.pivotX))),
        height: Math.max(0, ...sizes.map((entry) => -entry.y + entry.height * (1 - entry.pivotY)))
    };
}

function applyContentSizeFit(object, frame) {
    const fitter = componentSettings(object, 'ContentSizeFitter');
    if (!fitter || !(object?.children || []).length) return frame;
    const lengths = frameLengths(frame);
    const preferred = preferredContentSize(object);
    const width = fitter.horizontalFit === 'PreferredSize'
        ? frameLength(0, preferred.width + Number(fitter.paddingLeft || 0) + Number(fitter.paddingRight || 0))
        : lengths.width;
    const height = fitter.verticalFit === 'PreferredSize'
        ? frameLength(0, preferred.height + Number(fitter.paddingTop || 0) + Number(fitter.paddingBottom || 0))
        : lengths.height;
    return composeFrame(lengths.left, lengths.top, width, height);
}

function resolveLayoutChildFrames(object, frame) {
    const children = (object?.children || []).filter((child) =>
        (child?.components || []).some((entry) => entry?.type === 'RectTransform' && entry.enabled !== false)
    );
    const vertical = componentSettings(object, 'VerticalLayoutGroup');
    const horizontal = componentSettings(object, 'HorizontalLayoutGroup');
    const settings = vertical || horizontal;
    if (!settings || children.length === 0) return new Map();
    const parent = frameLengths(frame);
    const leftPad = Number(settings.paddingLeft || 0);
    const rightPad = Number(settings.paddingRight || 0);
    const topPad = Number(settings.paddingTop || 0);
    const bottomPad = Number(settings.paddingBottom || 0);
    const spacing = Number(settings.spacing || 0);
    const sizes = children.map((child) => readRectLayout(child, [100, 100]));
    const result = new Map();

    if (vertical) {
        const baseHeight = sizes.reduce((sum, entry) => sum + entry.height, 0);
        const remaining = addLength(parent.height, frameLength(0, -topPad - bottomPad - spacing * Math.max(0, children.length - 1) - baseHeight));
        const expand = vertical.childForceExpandHeight === true ? scaleLength(remaining, 1 / children.length) : frameLength();
        let cursor = addLength(parent.top, frameLength(0, topPad), vertical.childForceExpandHeight === true
            ? frameLength() : scaleLength(remaining, verticalAlignment(vertical.childAlignment)));
        children.forEach((child, index) => {
            const size = sizes[index];
            const width = vertical.childForceExpandWidth === true || vertical.childControlWidth !== false
                ? addLength(parent.width, frameLength(0, -leftPad - rightPad))
                : frameLength(0, size.width);
            const height = addLength(frameLength(0, size.height), expand);
            const left = addLength(parent.left, frameLength(0, leftPad), scaleLength(
                addLength(parent.width, frameLength(0, -leftPad - rightPad), scaleLength(width, -1)),
                horizontalAlignment(vertical.childAlignment)
            ));
            result.set(child, composeFrame(left, cursor, width, height));
            cursor = addLength(cursor, height, frameLength(0, spacing));
        });
    } else {
        const baseWidth = sizes.reduce((sum, entry) => sum + entry.width, 0);
        const remaining = addLength(parent.width, frameLength(0, -leftPad - rightPad - spacing * Math.max(0, children.length - 1) - baseWidth));
        const expand = horizontal.childForceExpandWidth === true ? scaleLength(remaining, 1 / children.length) : frameLength();
        let cursor = addLength(parent.left, frameLength(0, leftPad), horizontal.childForceExpandWidth === true
            ? frameLength() : scaleLength(remaining, horizontalAlignment(horizontal.childAlignment)));
        children.forEach((child, index) => {
            const size = sizes[index];
            const width = addLength(frameLength(0, size.width), expand);
            const height = horizontal.childForceExpandHeight === true || horizontal.childControlHeight !== false
                ? addLength(parent.height, frameLength(0, -topPad - bottomPad))
                : frameLength(0, size.height);
            const top = addLength(parent.top, frameLength(0, topPad), scaleLength(
                addLength(parent.height, frameLength(0, -topPad - bottomPad), scaleLength(height, -1)),
                verticalAlignment(horizontal.childAlignment)
            ));
            result.set(child, composeFrame(cursor, top, width, height));
            cursor = addLength(cursor, width, frameLength(0, spacing));
        });
    }
    return result;
}

export function resolvePlayerUiFrames(scene) {
    const frames = new Map();
    const visit = (object, parentFrame = ROOT_FRAME, forcedFrame = null) => {
        const frame = applyContentSizeFit(object, forcedFrame || resolveRectFrame(object, parentFrame));
        if (object?.id) frames.set(object.id, frame);
        const layoutFrames = resolveLayoutChildFrames(object, frame);
        for (const child of object?.children || []) visit(child, frame, layoutFrames.get(child) || null);
    };
    for (const object of scene?.gameObjects || []) visit(object);
    return frames;
}

const cssLength = (percent, pixels) => `calc(${percent * 100}% + ${pixels}px)`;

export function applyPlayerUiLayout(element, layout, frame = null) {
    if (frame) {
        element.style.position = 'absolute';
        element.style.left = cssLength(frame.leftPercent, frame.leftPixels);
        element.style.top = cssLength(frame.topPercent, frame.topPixels);
        element.style.width = cssLength(frame.widthPercent, frame.widthPixels);
        element.style.height = cssLength(frame.heightPercent, frame.heightPixels);
        element.style.transform = 'none';
        return;
    }
    const clamp = (value) => Math.max(0, Math.min(1, Number(value)));
    element.style.position = 'absolute';
    element.style.width = `${Math.max(1, layout.width)}px`;
    element.style.minHeight = `${Math.max(1, layout.height)}px`;
    element.style.left = `calc(${clamp(layout.anchorX) * 100}% + ${layout.x}px)`;
    element.style.top = `calc(${(1 - clamp(layout.anchorY)) * 100}% - ${layout.y}px)`;
    element.style.transform = `translate(${-clamp(layout.pivotX) * 100}%, ${-(1 - clamp(layout.pivotY)) * 100}%)`;
}

export function applyPlayerUiImageStyle(element, image) {
    element.style.backgroundColor = image.color;
    element.style.backgroundPosition = 'center';
    element.style.backgroundRepeat = 'no-repeat';
    element.style.backgroundSize = image.preserveAspect ? 'contain' : '100% 100%';
    element.style.pointerEvents = image.raycastTarget && image.interaction.blocksRaycasts ? 'auto' : 'none';
    element.style.opacity = String(image.interaction.alpha);
    element.style.clipPath = 'none';
    element.style.maskImage = 'none';
    element.style.webkitMaskImage = 'none';
    if (image.imageType !== 'Filled') return;
    const amount = Math.max(0, Math.min(1, Number(image.fillAmount) || 0));
    if (image.fillMethod === 'Horizontal') {
        const empty = (1 - amount) * 100;
        element.style.clipPath = image.fillOrigin === 1
            ? `inset(0 0 0 ${empty}%)`
            : `inset(0 ${empty}% 0 0)`;
        return;
    }
    if (image.fillMethod === 'Vertical') {
        const empty = (1 - amount) * 100;
        element.style.clipPath = image.fillOrigin === 1
            ? `inset(0 0 ${empty}% 0)`
            : `inset(${empty}% 0 0 0)`;
        return;
    }
    const origin = [180, 270, 0, 90][Math.max(0, Math.min(3, Math.trunc(image.fillOrigin)))] ?? 180;
    const sweep = amount * 360;
    const start = image.fillClockwise ? origin : origin - sweep;
    const mask = `conic-gradient(from ${start}deg, #000 0deg ${sweep}deg, transparent ${sweep}deg 360deg)`;
    element.style.maskImage = mask;
    element.style.webkitMaskImage = mask;
}

export function isPlayerUiActive(activePath, transforms) {
    const activeById = transforms instanceof Map
        ? transforms
        : new Map((transforms || []).map((entry) => [entry.id, entry.active !== false]));
    return !(activePath || []).some((id) => activeById.get(id) === false);
}

export function collectPlayerUiControls(scene) {
    const controls = [];
    const frames = resolvePlayerUiFrames(scene);
    const visit = (object, parentActive = true, parentInteraction = DEFAULT_INTERACTION, parentFrame = ROOT_FRAME, parentPath = []) => {
        const active = parentActive && object?.enabled !== false;
        const activePath = object?.id ? [...parentPath, object.id] : parentPath;
        const interaction = resolveCanvasInteraction(object, parentInteraction);
        const layout = readRectLayout(object, [100, 30]);
        const frame = frames.get(object?.id) || resolveRectFrame(object, parentFrame);
        for (const component of object?.components || []) {
            if (!CONTROL_TYPES.has(component?.type) || component.enabled === false) continue;
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
                direction: String(data.direction ?? 'LeftToRight'),
                scrollbarSize: Number.isFinite(Number(data.size)) ? Math.max(0.01, Math.min(1, Number(data.size))) : 0.2,
                numberOfSteps: Number.isFinite(Number(data.numberOfSteps)) ? Math.max(0, Math.trunc(Number(data.numberOfSteps))) : 0,
                backgroundColor: String(data.backgroundColor ?? '#3f3f3f'),
                handleColor: String(data.handleColor ?? '#d9d9d9'),
                interactable: data.interactable !== false,
                navigationMode: String(data.navigationMode ?? 'Automatic'),
                navigationUp: readGameObjectReference(data.navigationUp),
                navigationDown: readGameObjectReference(data.navigationDown),
                navigationLeft: readGameObjectReference(data.navigationLeft),
                navigationRight: readGameObjectReference(data.navigationRight),
                readOnly: data.readOnly === true,
                contentType: String(data.contentType ?? 'Standard'),
                characterValidation: String(data.characterValidation ?? 'None'),
                textAlignment: String(data.textAlignment ?? 'Left'),
                selectAllOnFocus: data.selectAllOnFocus === true,
                restoreTextOnEscape: data.restoreTextOnEscape !== false,
                disabledOptionIndices: Array.isArray(data.disabledOptionIndices)
                    ? data.disabledOptionIndices.map(Number).filter(Number.isInteger)
                    : [],
                characterLimit: Number.isFinite(Number(data.characterLimit)) ? Math.max(0, Number(data.characterLimit)) : 0
                ,layout, frame, interaction, active, activePath
            });
        }
        for (const child of object?.children || []) visit(child, active, interaction, frame, activePath);
    };
    for (const object of scene?.gameObjects || []) visit(object);
    return controls;
}

export function collectPlayerUiText(scene) {
    const entries = [];
    const frames = resolvePlayerUiFrames(scene);
    const visit = (object, parentActive = true, parentInteraction = DEFAULT_INTERACTION, parentFrame = ROOT_FRAME, parentPath = []) => {
        const active = parentActive && object?.enabled !== false;
        const activePath = object?.id ? [...parentPath, object.id] : parentPath;
        const interaction = resolveCanvasInteraction(object, parentInteraction);
        const frame = frames.get(object?.id) || resolveRectFrame(object, parentFrame);
        const component = (object?.components || []).find((entry) => entry?.type === 'UIText' && entry.enabled !== false);
        if (component) {
            const data = component.data && typeof component.data === 'object' ? component.data : {};
            entries.push({
                id: `${object.id || object.name || 'ui'}:UIText`,
                text: String(data.text ?? ''),
                fontSize: Number.isFinite(Number(data.fontSize)) ? Number(data.fontSize) : 14,
                color: String(data.color ?? '#ffffff'),
                alignment: String(data.alignment ?? 'left'),
                layout: readRectLayout(object, [100, 20]), frame, active, activePath,
                interaction
            });
        }
        for (const child of object?.children || []) visit(child, active, interaction, frame, activePath);
    };
    for (const object of scene?.gameObjects || []) visit(object);
    return entries;
}

export function collectPlayerUiImages(scene) {
    const images = [];
    const frames = resolvePlayerUiFrames(scene);
    const visit = (object, parentActive = true, parentInteraction = DEFAULT_INTERACTION, parentFrame = ROOT_FRAME, parentPath = []) => {
        const active = parentActive && object?.enabled !== false;
        const activePath = object?.id ? [...parentPath, object.id] : parentPath;
        const interaction = resolveCanvasInteraction(object, parentInteraction);
        const frame = frames.get(object?.id) || resolveRectFrame(object, parentFrame);
        const component = (object?.components || []).find((entry) => entry?.type === 'UIImage');
        if (component && component.enabled !== false) {
            const data = component.data && typeof component.data === 'object' ? component.data : {};
            const spritePath = typeof data.spritePath === 'string' ? data.spritePath.replaceAll('\\', '/') : null;
            images.push({
                id: `${object.id || object.name || 'ui'}:UIImage`,
                color: String(data.color ?? '#ffffff'),
                spritePath,
                raycastTarget: data.raycastTarget !== false,
                imageType: data.imageType === 'Filled' ? 'Filled' : 'Simple',
                preserveAspect: data.preserveAspect === true,
                fillMethod: ['Horizontal', 'Vertical', 'Radial360'].includes(data.fillMethod) ? data.fillMethod : 'Horizontal',
                fillOrigin: Math.max(0, Math.trunc(Number(data.fillOrigin) || 0)),
                fillClockwise: data.fillClockwise !== false,
                fillAmount: Math.max(0, Math.min(1, Number.isFinite(Number(data.fillAmount)) ? Number(data.fillAmount) : 1)),
                layout: readRectLayout(object, [100, 100]), frame, active, activePath,
                interaction
            });
        }
        for (const child of object?.children || []) visit(child, active, interaction, frame, activePath);
    };
    for (const object of scene?.gameObjects || []) visit(object);
    return images;
}

export function collectPlayerScrollRects(scene) {
    const descriptors = [];
    const frames = resolvePlayerUiFrames(scene);
    const byId = new Map();
    const index = (object) => {
        if (object?.id) byId.set(object.id, object);
        for (const child of object?.children || []) index(child);
    };
    for (const object of scene?.gameObjects || []) index(object);
    const descendantIds = (object) => {
        const ids = [];
        const visit = (entry) => {
            if (entry?.id) ids.push(entry.id);
            for (const child of entry?.children || []) visit(child);
        };
        for (const child of object?.children || []) visit(child);
        return ids;
    };
    const visit = (object, parentActive = true, parentPath = []) => {
        const active = parentActive && object?.enabled !== false;
        const activePath = object?.id ? [...parentPath, object.id] : parentPath;
        const component = (object?.components || []).find((entry) => entry?.type === 'UIScrollRect' && entry.enabled !== false);
        if (component) {
            const data = component.data && typeof component.data === 'object' ? component.data : {};
            const contentId = readGameObjectReference(data.content);
            const viewportId = readGameObjectReference(data.viewport) || object?.id || null;
            const content = contentId ? byId.get(contentId) : null;
            descriptors.push({
                id: `${object?.id || 'scroll'}:UIScrollRect`, objectId: object?.id || null,
                active, activePath, contentId, viewportId,
                contentFrame: contentId ? frames.get(contentId) || null : null,
                viewportFrame: viewportId ? frames.get(viewportId) || frames.get(object?.id) || ROOT_FRAME : ROOT_FRAME,
                descendantIds: content ? [contentId, ...descendantIds(content)] : [],
                horizontal: data.horizontal !== false,
                vertical: data.vertical !== false,
                movementType: String(data.movementType || 'Clamped'),
                scrollSensitivity: Number.isFinite(Number(data.scrollSensitivity)) ? Math.max(0, Number(data.scrollSensitivity)) : 20,
                keyboardScrollStep: Number.isFinite(Number(data.keyboardScrollStep)) ? Math.max(0, Number(data.keyboardScrollStep)) : 0,
                keyboardPageStep: Number.isFinite(Number(data.keyboardPageStep)) ? Math.max(0, Number(data.keyboardPageStep)) : 0,
                horizontalNormalizedPosition: Math.max(0, Math.min(1, Number(data.horizontalNormalizedPosition) || 0)),
                verticalNormalizedPosition: Math.max(0, Math.min(1, Number.isFinite(Number(data.verticalNormalizedPosition)) ? Number(data.verticalNormalizedPosition) : 1)),
                horizontalScrollbarId: readGameObjectReference(data.horizontalScrollbar),
                verticalScrollbarId: readGameObjectReference(data.verticalScrollbar)
            });
        }
        for (const child of object?.children || []) visit(child, active, activePath);
    };
    for (const object of scene?.gameObjects || []) visit(object);
    return descriptors;
}

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

export function mountPlayerScrollRects(document, container, descriptors, elementsByObjectId = new Map()) {
    const mounted = [];
    for (const descriptor of descriptors || []) {
        if (!descriptor.contentFrame) continue;
        const viewport = document.createElement('div');
        viewport.dataset.uiScrollRect = descriptor.id;
        viewport.dataset.uiActivePath = JSON.stringify(descriptor.activePath || []);
        viewport.hidden = !descriptor.active;
        viewport.tabIndex = 0;
        viewport.style.background = 'transparent';
        viewport.style.overflow = 'hidden';
        viewport.style.pointerEvents = 'auto';
        viewport.style.touchAction = 'none';
        applyPlayerUiLayout(viewport, {}, descriptor.viewportFrame);
        container.append(viewport);

        const state = {
            horizontal: clamp01(descriptor.horizontalNormalizedPosition),
            vertical: clamp01(descriptor.verticalNormalizedPosition),
            dragging: false, pointerX: 0, pointerY: 0, startHorizontal: 0, startVertical: 1
        };
        const descendants = descriptor.descendantIds
            .map((id) => elementsByObjectId.get(id))
            .filter(Boolean);
        const scrollbarInput = (id) => elementsByObjectId.get(id)?.children?.[0] || null;
        const horizontalScrollbar = scrollbarInput(descriptor.horizontalScrollbarId);
        const verticalScrollbar = scrollbarInput(descriptor.verticalScrollbarId);
        viewport.dataset.horizontalScrollbarBound = String(Boolean(horizontalScrollbar));
        viewport.dataset.verticalScrollbarBound = String(Boolean(verticalScrollbar));

        const metrics = () => {
            const containerRect = container.getBoundingClientRect?.() || { width: 0, height: 0 };
            const viewportRect = viewport.getBoundingClientRect?.() || { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
            const contentWidth = descriptor.contentFrame.widthPercent * containerRect.width + descriptor.contentFrame.widthPixels;
            const contentHeight = descriptor.contentFrame.heightPercent * containerRect.height + descriptor.contentFrame.heightPixels;
            return {
                viewportRect,
                hiddenWidth: Math.max(0, contentWidth - viewportRect.width),
                hiddenHeight: Math.max(0, contentHeight - viewportRect.height)
            };
        };
        const apply = () => {
            const { viewportRect, hiddenWidth, hiddenHeight } = metrics();
            const offsetX = descriptor.horizontal ? -state.horizontal * hiddenWidth : 0;
            const offsetY = descriptor.vertical ? -(1 - state.vertical) * hiddenHeight : 0;
            for (const element of descendants) {
                element.style.translate = `${offsetX}px ${offsetY}px`;
                const rect = element.getBoundingClientRect?.();
                if (!rect) continue;
                const top = Math.max(0, viewportRect.top - rect.top);
                const right = Math.max(0, rect.right - viewportRect.right);
                const bottom = Math.max(0, rect.bottom - viewportRect.bottom);
                const left = Math.max(0, viewportRect.left - rect.left);
                element.style.clipPath = `inset(${top}px ${right}px ${bottom}px ${left}px)`;
            }
            if (horizontalScrollbar) horizontalScrollbar.value = String(state.horizontal);
            if (verticalScrollbar) verticalScrollbar.value = String(state.vertical);
            viewport.dataset.horizontalNormalizedPosition = String(state.horizontal);
            viewport.dataset.verticalNormalizedPosition = String(state.vertical);
        };
        const scrollByPixels = (deltaX, deltaY) => {
            const { hiddenWidth, hiddenHeight } = metrics();
            if (descriptor.horizontal && hiddenWidth > 0) state.horizontal = clamp01(state.horizontal + deltaX / hiddenWidth);
            if (descriptor.vertical && hiddenHeight > 0) state.vertical = clamp01(state.vertical - deltaY / hiddenHeight);
            apply();
        };
        viewport.addEventListener('wheel', (event) => {
            const scale = descriptor.scrollSensitivity / 20;
            scrollByPixels(Number(event.deltaX) * scale, Number(event.deltaY) * scale);
            event.preventDefault?.();
        }, { passive: false });
        viewport.addEventListener('pointerdown', (event) => {
            state.dragging = true; state.pointerX = event.clientX; state.pointerY = event.clientY;
            state.startHorizontal = state.horizontal; state.startVertical = state.vertical;
            viewport.setPointerCapture?.(event.pointerId);
        });
        viewport.addEventListener('pointermove', (event) => {
            if (!state.dragging) return;
            const { hiddenWidth, hiddenHeight } = metrics();
            if (descriptor.horizontal && hiddenWidth > 0) state.horizontal = clamp01(state.startHorizontal - (event.clientX - state.pointerX) / hiddenWidth);
            if (descriptor.vertical && hiddenHeight > 0) state.vertical = clamp01(state.startVertical + (event.clientY - state.pointerY) / hiddenHeight);
            apply();
        });
        const endDrag = (event) => {
            state.dragging = false;
            viewport.releasePointerCapture?.(event.pointerId);
        };
        viewport.addEventListener('pointerup', endDrag);
        viewport.addEventListener('pointercancel', endDrag);
        viewport.addEventListener('keydown', (event) => {
            const { viewportRect } = metrics();
            const step = descriptor.keyboardScrollStep || 40;
            const page = descriptor.keyboardPageStep || Math.max(step, viewportRect.height * 0.9);
            if (event.key === 'ArrowDown') scrollByPixels(0, step);
            else if (event.key === 'ArrowUp') scrollByPixels(0, -step);
            else if (event.key === 'ArrowRight') scrollByPixels(step, 0);
            else if (event.key === 'ArrowLeft') scrollByPixels(-step, 0);
            else if (event.key === 'PageDown') scrollByPixels(0, page);
            else if (event.key === 'PageUp') scrollByPixels(0, -page);
            else return;
            event.preventDefault?.();
        });
        horizontalScrollbar?.addEventListener('input', () => { state.horizontal = clamp01(horizontalScrollbar.value); apply(); });
        verticalScrollbar?.addEventListener('input', () => { state.vertical = clamp01(verticalScrollbar.value); apply(); });
        document.defaultView?.addEventListener('resize', apply);
        apply();
        mounted.push({ descriptor, viewport, state, apply });
    }
    return mounted;
}

export function collectPlayerSceneLoadActions(scene) {
    const actions = [];
    const visit = (object, parentActive = true, parentPath = []) => {
        const active = parentActive && object?.enabled !== false;
        const activePath = object?.id ? [...parentPath, object.id] : parentPath;
        for (const component of object?.components || []) {
            if (component?.type !== 'UIEventAction' || component.enabled === false || component.data?.enabled === false) continue;
            const data = component.data && typeof component.data === 'object' ? component.data : {};
            if (data.action !== 'LoadScene' || typeof data.eventName !== 'string' || typeof data.scenePath !== 'string') continue;
            actions.push({ eventName: data.eventName, scenePath: data.scenePath.replaceAll('\\', '/'), active, activePath });
        }
        for (const child of object?.children || []) visit(child, active, activePath);
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

export function normalizePlayerInputText(value, control) {
    let next = typeof value === 'string' ? value : '';
    if (control.lineType === 'SingleLine') next = next.replace(/[\r\n]+/g, ' ');

    if (control.contentType === 'IntegerNumber' || control.contentType === 'DecimalNumber') {
        const negative = next.trimStart().startsWith('-');
        next = next.replace(/[^0-9.]/g, '');
        if (control.contentType === 'IntegerNumber') {
            next = next.replaceAll('.', '');
        } else {
            const decimalIndex = next.indexOf('.');
            if (decimalIndex >= 0) {
                next = `${next.slice(0, decimalIndex + 1)}${next.slice(decimalIndex + 1).replaceAll('.', '')}`;
            }
        }
        if (negative) next = `-${next}`;
    }

    switch (control.characterValidation) {
        case 'Alphanumeric':
            next = next.replace(/[^a-zA-Z0-9]/g, '');
            break;
        case 'Name':
            next = next.replace(/[^a-zA-Z0-9 '\-]/g, '').replace(/\s{2,}/g, ' ');
            break;
        case 'EmailAddress':
            next = next.replace(/[^a-zA-Z0-9@._\-+]/g, '');
            break;
        default:
            break;
    }

    return control.characterLimit > 0 ? next.slice(0, control.characterLimit) : next;
}

export function mountPlayerUiControls(document, container, controls, worker, sessionId) {
    const mountedByObjectId = new Map();
    const mountedControls = [];

    const findAutomaticTarget = (source, key) => {
        const direction = ({
            ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 },
            ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }
        })[key];
        if (!direction || typeof source.input.getBoundingClientRect !== 'function') return null;
        const sourceRect = source.input.getBoundingClientRect();
        if (sourceRect.width <= 0 || sourceRect.height <= 0) return null;
        const sourceX = sourceRect.left + sourceRect.width * 0.5;
        const sourceY = sourceRect.top + sourceRect.height * 0.5;
        let best = null;
        let bestScore = Number.NEGATIVE_INFINITY;
        for (const candidate of mountedControls) {
            if (candidate === source || candidate.control.navigationMode === 'None'
                || candidate.input.disabled || candidate.wrapper.hidden
                || typeof candidate.input.getBoundingClientRect !== 'function') continue;
            const rect = candidate.input.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) continue;
            const deltaX = rect.left + rect.width * 0.5 - sourceX;
            const deltaY = rect.top + rect.height * 0.5 - sourceY;
            const magnitude = Math.hypot(deltaX, deltaY);
            if (magnitude <= 0.0001) continue;
            const normalizedX = deltaX / magnitude;
            const normalizedY = deltaY / magnitude;
            const dot = normalizedX * direction.x + normalizedY * direction.y;
            if (dot <= 0.25) continue;
            const perpendicular = Math.abs(normalizedX * direction.y - normalizedY * direction.x) * magnitude;
            const score = dot * 10000 - magnitude - perpendicular * 2;
            if (score > bestScore) {
                best = candidate;
                bestScore = score;
            }
        }
        return best;
    };

    for (const control of controls) {
        const wrapper = document.createElement('label');
        wrapper.dataset.uiControl = control.type;
        wrapper.dataset.uiControlId = control.id;
        wrapper.dataset.uiObjectId = control.activePath.at(-1) || '';
        wrapper.dataset.uiActivePath = JSON.stringify(control.activePath);
        wrapper.hidden = !control.active;
        wrapper.textContent = control.type === 'UIButton' ? '' : control.label;
        applyPlayerUiLayout(wrapper, control.layout, control.frame);
        wrapper.style.opacity = String(control.interaction.alpha);
        wrapper.style.pointerEvents = control.interaction.blocksRaycasts ? 'auto' : 'none';
        let input;
        if (control.type === 'UIButton') {
            input = document.createElement('button');
            input.type = 'button';
            input.textContent = control.label;
            input.addEventListener('click', () => postControlEvent(worker, sessionId, control, true));
        } else if (control.type === 'UIInputField') {
            input = document.createElement(control.lineType === 'SingleLine' ? 'input' : 'textarea');
            if (input.tagName === 'TEXTAREA') input.rows = 3;
            input.value = control.text;
            input.placeholder = control.placeholder;
            input.readOnly = control.readOnly;
            input.style.textAlign = control.textAlignment.toLowerCase();
            if (input.tagName === 'INPUT') {
                if (control.contentType === 'Password') input.type = 'password';
                else if (control.contentType === 'IntegerNumber') input.inputMode = 'numeric';
                else if (control.contentType === 'DecimalNumber') input.inputMode = 'decimal';
            }
            if (control.characterLimit > 0) input.maxLength = control.characterLimit;
            let focusText = input.value;
            input.addEventListener('focus', () => {
                focusText = input.value;
                if (control.selectAllOnFocus) input.select?.();
            });
            input.addEventListener('keydown', (event) => {
                if (event.key === 'Escape' && control.restoreTextOnEscape) {
                    input.value = focusText;
                    input.blur();
                    event.preventDefault();
                }
            });
            input.addEventListener('input', () => {
                input.value = normalizePlayerInputText(input.value, control);
                postControlEvent(worker, sessionId, control, input.value);
            });
            input.addEventListener('change', () => postControlEvent(worker, sessionId, control, input.value));
        } else if (control.type === 'UIDropdown') {
            input = document.createElement('select');
            for (const [index, option] of control.options.entries()) {
                const item = document.createElement('option');
                item.value = String(index);
                item.textContent = option;
                item.disabled = control.disabledOptionIndices.includes(index);
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
            const isScrollbar = control.type === 'UIScrollbar';
            input.min = isScrollbar ? '0' : String(Math.min(control.minValue, control.maxValue));
            input.max = isScrollbar ? '1' : String(Math.max(control.minValue, control.maxValue));
            input.step = isScrollbar
                ? (control.numberOfSteps > 1 ? String(1 / (control.numberOfSteps - 1)) : 'any')
                : (control.wholeNumbers ? '1' : 'any');
            input.value = String(Math.max(Number(input.min), Math.min(Number(input.max), control.value)));
            if (isScrollbar) {
                input.dataset.scrollbarSize = String(control.scrollbarSize);
                input.style.accentColor = control.handleColor;
                wrapper.style.backgroundColor = control.backgroundColor;
            }
            if (control.direction === 'RightToLeft') input.style.direction = 'rtl';
            if (control.direction === 'BottomToTop' || control.direction === 'TopToBottom') {
                input.style.writingMode = 'vertical-lr';
                if (control.direction === 'BottomToTop') input.style.direction = 'rtl';
            }
            input.addEventListener('input', () => postControlEvent(worker, sessionId, control, Number(input.value)));
        }
        input.disabled = !control.interaction.interactable || !control.interactable;
        input.tabIndex = control.navigationMode === 'None' ? -1 : 0;
        input.dataset.uiEvent = control.eventName;
        wrapper.append(input);
        container.append(wrapper);
        const objectId = control.activePath.at(-1);
        const mounted = { control, input, wrapper };
        mountedControls.push(mounted);
        if (objectId && !mountedByObjectId.has(objectId)) {
            mountedByObjectId.set(objectId, mounted);
        }

        const usesDirectionalSelection = control.navigationMode === 'Explicit'
            || (control.navigationMode === 'Automatic' && (control.type === 'UIButton' || control.type === 'UIToggle'));
        if (usesDirectionalSelection) {
            input.addEventListener('keydown', (event) => {
                const explicitTargetId = control.navigationMode === 'Explicit' ? ({
                    ArrowUp: control.navigationUp,
                    ArrowDown: control.navigationDown,
                    ArrowLeft: control.navigationLeft,
                    ArrowRight: control.navigationRight
                })[event.key] : null;
                const explicitTarget = explicitTargetId ? mountedByObjectId.get(explicitTargetId) : null;
                const target = explicitTarget && !explicitTarget.input.disabled && !explicitTarget.wrapper.hidden
                    ? explicitTarget
                    : findAutomaticTarget(mounted, event.key);
                if (!target) return;
                target.input.focus();
                event.preventDefault();
            });
        }
    }
    return new Map(Array.from(mountedByObjectId, ([objectId, mounted]) => [objectId, mounted.wrapper]));
}
