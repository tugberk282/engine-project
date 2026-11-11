import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlayerUiImageStyle, collectPlayerSceneLoadActions, collectPlayerScrollRects, collectPlayerUiControls, collectPlayerUiImages, collectPlayerUiText, isPlayerUiActive, mountPlayerScrollRects, mountPlayerUiControls, normalizePlayerInputText, resolvePlayerUiFrames } from '../electron/build/player-ui.mjs';

test('player UI collector preserves authored control values and RectTransform layout', () => {
    const scene = {
        gameObjects: [{
            id: 'menu',
            components: [{ type: 'RectTransform', data: { sizeDelta: [320, 80], anchoredPosition: [12, -8], anchorMin: [0, 1] } },
                { type: 'UIButton', data: {
                    label: 'Play', eventName: 'Start', interactable: false, navigationMode: 'Explicit',
                    navigationDown: { __ref: 'difficulty', __type: 'GameObject' }
                } }],
            children: [{
                id: 'difficulty',
                components: [{ type: 'UIDropdown', data: { options: ['Easy', 'Hard'], disabledOptionIndices: [0], selectedIndex: 1, eventName: 'Difficulty' } }]
            }]
        }]
    };
    const controls = collectPlayerUiControls(scene);
    assert.equal(controls.length, 2);
    assert.equal(controls[0].eventName, 'Start');
    assert.equal(controls[0].layout.width, 320);
    assert.equal(controls[0].layout.anchorY, 1);
    assert.equal(controls[0].layout.pivotX, 0.5);
    assert.equal(controls[0].interactable, false);
    assert.equal(controls[0].navigationMode, 'Explicit');
    assert.equal(controls[0].navigationDown, 'difficulty');
    assert.deepEqual(Array.from(controls[1].options), ['Easy', 'Hard']);
    assert.equal(controls[1].selectedIndex, 1);
    assert.deepEqual(controls[1].disabledOptionIndices, [0]);
});

test('player input normalization enforces authored content and character validation', () => {
    const common = { lineType: 'SingleLine', characterLimit: 0, characterValidation: 'None' };
    assert.equal(normalizePlayerInputText(' -12-3.4 ', { ...common, contentType: 'IntegerNumber' }), '-1234');
    assert.equal(normalizePlayerInputText('-12.3.45', { ...common, contentType: 'DecimalNumber' }), '-12.345');
    assert.equal(normalizePlayerInputText('a b-2!', { ...common, contentType: 'Standard', characterValidation: 'Alphanumeric' }), 'ab2');
    assert.equal(normalizePlayerInputText('Ada  Lovelace!', { ...common, contentType: 'Standard', characterValidation: 'Name' }), 'Ada Lovelace');
    assert.equal(normalizePlayerInputText('a+b@example.com!', { ...common, contentType: 'Standard', characterValidation: 'EmailAddress', characterLimit: 15 }), 'a+b@example.com');
});

test('player UI image collector preserves sprite, color, activity and pivot layout', () => {
    const scene = { gameObjects: [{
        id: 'panel',
        components: [
            { type: 'RectTransform', data: { sizeDelta: { x: 256, y: 128 }, pivot: [0, 1] } },
            { type: 'UIImage', data: { color: '#123456', spritePath: 'Assets\\UI\\panel.png', imageType: 'Filled', preserveAspect: true, fillMethod: 'Horizontal', fillOrigin: 1, fillAmount: 0.6 } }
        ],
        children: [{ id: 'hidden', enabled: false, components: [{ type: 'UIImage', data: {} }] }]
    }] };
    const images = collectPlayerUiImages(scene);
    assert.equal(images.length, 2);
    assert.equal(images[0].spritePath, 'Assets/UI/panel.png');
    assert.equal(images[0].color, '#123456');
    assert.equal(images[0].layout.width, 256);
    assert.equal(images[0].layout.height, 128);
    assert.equal(images[0].layout.pivotX, 0);
    assert.equal(images[0].layout.pivotY, 1);
    assert.equal(images[0].imageType, 'Filled');
    assert.equal(images[0].preserveAspect, true);
    assert.equal(images[0].fillAmount, 0.6);
    assert.equal(images[1].active, false);
});

test('player UIImage applies authored simple and filled rendering modes', () => {
    const element = { style: {} };
    const common = {
        color: '#123456', preserveAspect: true, raycastTarget: true,
        interaction: { alpha: 0.5, blocksRaycasts: true }, fillClockwise: true
    };
    applyPlayerUiImageStyle(element, {
        ...common, imageType: 'Filled', fillMethod: 'Horizontal', fillOrigin: 1, fillAmount: 0.25
    });
    assert.equal(element.style.backgroundSize, 'contain');
    assert.equal(element.style.pointerEvents, 'auto');
    assert.equal(element.style.clipPath, 'inset(0 0 0 75%)');

    applyPlayerUiImageStyle(element, {
        ...common, imageType: 'Filled', fillMethod: 'Radial360', fillOrigin: 2, fillAmount: 0.5, fillClockwise: false
    });
    assert.match(element.style.maskImage, /conic-gradient\(from -180deg/);
    assert.match(element.style.maskImage, /180deg/);

    applyPlayerUiImageStyle(element, { ...common, imageType: 'Simple' });
    assert.equal(element.style.clipPath, 'none');
    assert.equal(element.style.maskImage, 'none');
});

test('player UI collectors apply CanvasGroup hierarchy and retain inactive content for runtime activation', () => {
    const scene = { gameObjects: [{
        id: 'canvas',
        components: [{ type: 'CanvasGroup', data: { alpha: 0.5, interactable: false, blocksRaycasts: false } }],
        children: [
            { id: 'button', components: [{ type: 'UIButton', data: { label: 'Disabled' } }] },
            {
                id: 'independent',
                components: [
                    { type: 'CanvasGroup', data: { alpha: 0.8, interactable: true, blocksRaycasts: true, ignoreParentGroups: true } },
                    { type: 'UIText', data: { text: 'Independent' } },
                    { type: 'UIImage', data: {} }
                ]
            },
            { id: 'hidden', enabled: false, components: [{ type: 'UIText', data: { text: 'Hidden' } }, { type: 'UIButton', data: {} }] }
        ]
    }] };

    const controls = collectPlayerUiControls(scene);
    const text = collectPlayerUiText(scene);
    const images = collectPlayerUiImages(scene);
    assert.equal(controls.length, 2);
    assert.deepEqual(controls[0].interaction, { alpha: 0.5, interactable: false, blocksRaycasts: false });
    assert.equal(controls[1].active, false);
    assert.deepEqual(controls[1].activePath, ['canvas', 'hidden']);
    assert.equal(text.length, 2);
    assert.deepEqual(text[0].interaction, { alpha: 0.8, interactable: true, blocksRaycasts: true });
    assert.equal(text[1].active, false);
    assert.deepEqual(images[0].interaction, text[0].interaction);
});

test('player UI resolves nested and stretched RectTransforms into viewport-relative frames', () => {
    const scene = { gameObjects: [{
        id: 'canvas', components: [{ type: 'Canvas' }], children: [{
            id: 'panel',
            components: [{ type: 'RectTransform', data: {
                anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0.5, 0.5],
                sizeDelta: [400, 200], anchoredPosition: [20, 10]
            } }],
            children: [{
                id: 'button',
                components: [
                    { type: 'RectTransform', data: {
                        anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5],
                        sizeDelta: [-40, -20], anchoredPosition: [5, -3]
                    } },
                    { type: 'UIButton', data: { label: 'Nested' } }
                ]
            }]
        }]
    }] };

    const control = collectPlayerUiControls(scene)[0];
    assert.deepEqual(control.frame, {
        leftPercent: 0.5, leftPixels: -175,
        topPercent: 0.5, topPixels: -107,
        widthPercent: 0, widthPixels: 360,
        heightPercent: 0, heightPixels: 180
    });
});

test('vertical layout and content fitter derive deterministic child frames', () => {
    const scene = { gameObjects: [{
        id: 'panel', components: [
            { type: 'RectTransform', data: { sizeDelta: [300, 200] } },
            { type: 'VerticalLayoutGroup', data: {
                paddingLeft: 10, paddingRight: 10, paddingTop: 10, paddingBottom: 10,
                spacing: 5, childAlignment: 'UpperCenter', childControlWidth: true,
                childForceExpandWidth: true, childForceExpandHeight: false
            } },
            { type: 'ContentSizeFitter', data: { horizontalFit: 'Unconstrained', verticalFit: 'PreferredSize' } }
        ], children: [
            { id: 'first', components: [{ type: 'RectTransform', data: { sizeDelta: [80, 30] } }, { type: 'UIButton', data: {} }] },
            { id: 'second', components: [{ type: 'RectTransform', data: { sizeDelta: [90, 40] } }, { type: 'UIButton', data: {} }] }
        ]
    }] };
    const frames = resolvePlayerUiFrames(scene);
    assert.equal(frames.get('panel').heightPixels, 95);
    assert.deepEqual(frames.get('first'), {
        leftPercent: 0.5, leftPixels: -140, topPercent: 0.5, topPixels: -90,
        widthPercent: 0, widthPixels: 280, heightPercent: 0, heightPixels: 30
    });
    assert.equal(frames.get('second').topPixels, -55);
    assert.equal(collectPlayerUiControls(scene)[1].frame.heightPixels, 40);
});

test('horizontal layout distributes expandable width across immediate children', () => {
    const scene = { gameObjects: [{
        id: 'row', components: [
            { type: 'RectTransform', data: { sizeDelta: [300, 100] } },
            { type: 'HorizontalLayoutGroup', data: {
                paddingLeft: 10, paddingRight: 10, paddingTop: 10, paddingBottom: 10,
                spacing: 10, childAlignment: 'MiddleLeft', childForceExpandWidth: true,
                childControlHeight: true, childForceExpandHeight: true
            } }
        ], children: [
            { id: 'left', components: [{ type: 'RectTransform', data: { sizeDelta: [50, 20] } }] },
            { id: 'right', components: [{ type: 'RectTransform', data: { sizeDelta: [50, 20] } }] }
        ]
    }] };
    const frames = resolvePlayerUiFrames(scene);
    assert.equal(frames.get('left').widthPixels, 135);
    assert.equal(frames.get('right').widthPixels, 135);
    assert.equal(frames.get('right').leftPixels - frames.get('left').leftPixels, 145);
    assert.equal(frames.get('left').heightPixels, 80);
});

test('player UI runtime visibility follows every authored ancestor transform state', () => {
    const path = ['canvas', 'menu', 'button'];
    assert.equal(isPlayerUiActive(path, [
        { id: 'canvas' }, { id: 'menu' }, { id: 'button' }
    ]), true);
    assert.equal(isPlayerUiActive(path, [
        { id: 'canvas' }, { id: 'menu', active: false }, { id: 'button' }
    ]), false);
    assert.equal(isPlayerUiActive(path, [
        { id: 'canvas' }, { id: 'menu', active: true }, { id: 'button' }
    ]), true);
});

test('player UI mount honors authored native control state', () => {
    class FakeElement {
        constructor(tag) {
            this.tagName = tag.toUpperCase(); this.type = ''; this.style = {}; this.dataset = {};
            this.children = []; this.listeners = {}; this.hidden = false; this.disabled = false; this.tabIndex = 0;
        }
        append(...children) { this.children.push(...children); }
        addEventListener(name, listener) { this.listeners[name] = listener; }
        select() { this.selected = true; }
        blur() { this.blurred = true; }
        focus() { this.focused = true; }
    }
    const document = { createElement: (tag) => new FakeElement(tag) };
    const container = new FakeElement('div');
    const common = {
        label: 'Control', eventName: 'Change', active: true, activePath: ['control'],
        layout: { width: 100, height: 30, x: 0, y: 0, anchorX: 0, anchorY: 1, pivotX: 0, pivotY: 1 },
        frame: null, interaction: { alpha: 1, interactable: true, blocksRaycasts: true },
        text: '', placeholder: '', lineType: 'SingleLine', options: [], selectedIndex: 0,
        isOn: false, value: 0, minValue: 0, maxValue: 1, wholeNumbers: false,
        direction: 'LeftToRight', readOnly: false, contentType: 'Standard', textAlignment: 'Left',
        selectAllOnFocus: false, restoreTextOnEscape: true, characterLimit: 0
    };
    mountPlayerUiControls(document, container, [
        { ...common, id: 'input', type: 'UIInputField', interactable: false, navigationMode: 'None', disabledOptionIndices: [] },
        { ...common, id: 'dropdown', type: 'UIDropdown', interactable: true, navigationMode: 'Automatic', options: ['A', 'B'], disabledOptionIndices: [1] }
    ], { postMessage() {} }, 'session');

    const input = container.children[0].children.at(-1);
    const dropdown = container.children[1].children.at(-1);
    assert.equal(input.tagName, 'INPUT');
    assert.equal(input.disabled, true);
    assert.equal(input.tabIndex, -1);
    assert.equal(dropdown.children[1].disabled, true);
});

test('player UIScrollbar preserves authored range, direction, size, and colors', () => {
    class FakeElement {
        constructor(tag) {
            this.tagName = tag.toUpperCase(); this.type = ''; this.style = {}; this.dataset = {};
            this.children = []; this.listeners = {}; this.hidden = false; this.disabled = false; this.tabIndex = 0;
        }
        append(...children) { this.children.push(...children); }
        addEventListener(name, listener) { this.listeners[name] = listener; }
    }
    const scene = { gameObjects: [{
        id: 'scrollbar', components: [
            { type: 'RectTransform', data: { sizeDelta: [20, 180] } },
            { type: 'UIScrollbar', data: {
                value: 0.75, size: 0.4, numberOfSteps: 5, direction: 'TopToBottom',
                backgroundColor: '#112233', handleColor: '#abcdef'
            } }
        ]
    }] };
    const control = collectPlayerUiControls(scene)[0];
    assert.equal(control.type, 'UIScrollbar');
    assert.equal(control.scrollbarSize, 0.4);
    assert.equal(control.numberOfSteps, 5);

    const document = { createElement: (tag) => new FakeElement(tag) };
    const container = new FakeElement('div');
    mountPlayerUiControls(document, container, [control], { postMessage() {} }, 'session');
    const wrapper = container.children[0];
    const input = wrapper.children[0];
    assert.equal(input.type, 'range');
    assert.equal(input.value, '0.75');
    assert.equal(input.step, '0.25');
    assert.equal(input.dataset.scrollbarSize, '0.4');
    assert.equal(input.style.writingMode, 'vertical-lr');
    assert.equal(input.style.accentColor, '#abcdef');
    assert.equal(wrapper.style.backgroundColor, '#112233');
});

test('player UIScrollRect resolves content and synchronizes wheel movement with its scrollbar', () => {
    class FakeElement {
        constructor(tag, rect = { left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100 }) {
            this.tagName = tag.toUpperCase(); this.style = {}; this.dataset = {}; this.children = [];
            this.listeners = {}; this.hidden = false; this.rect = rect; this.value = '0'; this.tabIndex = 0;
        }
        append(...children) { this.children.push(...children); }
        addEventListener(name, listener) { this.listeners[name] = listener; }
        getBoundingClientRect() { return this.rect; }
    }
    const scene = { gameObjects: [{
        id: 'viewport', components: [
            { type: 'RectTransform', data: { sizeDelta: [200, 100] } },
            { type: 'UIScrollRect', data: {
                content: { __ref: 'content' }, viewport: { __ref: 'viewport' },
                vertical: true, horizontal: false, verticalNormalizedPosition: 1,
                scrollSensitivity: 20, verticalScrollbar: { __ref: 'scrollbar' }
            } }
        ], children: [{
            id: 'content', components: [{ type: 'RectTransform', data: { sizeDelta: [200, 300] } }],
            children: [{ id: 'item', components: [{ type: 'RectTransform', data: { sizeDelta: [180, 30] } }, { type: 'UIText', data: { text: 'Item' } }] }]
        }]
    }, {
        id: 'scrollbar', components: [{ type: 'RectTransform', data: { sizeDelta: [20, 100] } }, { type: 'UIScrollbar', data: { direction: 'BottomToTop' } }]
    }] };
    const descriptor = collectPlayerScrollRects(scene)[0];
    assert.equal(descriptor.contentId, 'content');
    assert.deepEqual(descriptor.descendantIds, ['content', 'item']);

    const document = { createElement: (tag) => new FakeElement(tag) };
    const container = new FakeElement('div', { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 });
    const item = new FakeElement('p', { left: 300, top: 250, width: 180, height: 30, right: 480, bottom: 280 });
    const scrollbarInput = new FakeElement('input');
    const scrollbarWrapper = new FakeElement('label');
    scrollbarWrapper.children = [scrollbarInput];
    const mounted = mountPlayerScrollRects(document, container, [descriptor], new Map([
        ['item', item], ['scrollbar', scrollbarWrapper]
    ]))[0];
    let prevented = false;
    mounted.viewport.listeners.wheel({ deltaX: 0, deltaY: 50, preventDefault() { prevented = true; } });
    assert.equal(mounted.state.vertical, 0.75);
    assert.equal(item.style.translate, '0px -50px');
    assert.equal(scrollbarInput.value, '0.75');
    assert.equal(prevented, true);
});

test('player UI explicit navigation focuses the authored active target', () => {
    class FakeElement {
        constructor(tag) {
            this.tagName = tag.toUpperCase(); this.type = ''; this.style = {}; this.dataset = {};
            this.children = []; this.listeners = {}; this.hidden = false; this.disabled = false; this.tabIndex = 0;
        }
        append(...children) { this.children.push(...children); }
        addEventListener(name, listener) { this.listeners[name] = listener; }
        focus() { this.focused = true; }
    }
    const document = { createElement: (tag) => new FakeElement(tag) };
    const container = new FakeElement('div');
    const common = {
        label: 'Control', eventName: '', active: true,
        layout: { width: 100, height: 30, x: 0, y: 0, anchorX: 0, anchorY: 1, pivotX: 0, pivotY: 1 },
        frame: null, interaction: { alpha: 1, interactable: true, blocksRaycasts: true },
        text: '', placeholder: '', lineType: 'SingleLine', options: [], selectedIndex: 0,
        isOn: false, value: 0, minValue: 0, maxValue: 1, wholeNumbers: false,
        direction: 'LeftToRight', readOnly: false, contentType: 'Standard', textAlignment: 'Left',
        selectAllOnFocus: false, restoreTextOnEscape: true, characterLimit: 0,
        interactable: true, disabledOptionIndices: [], navigationMode: 'Automatic'
    };
    mountPlayerUiControls(document, container, [
        { ...common, id: 'first:UIButton', type: 'UIButton', activePath: ['first'], navigationMode: 'Explicit', navigationDown: 'second' },
        { ...common, id: 'second:UIButton', type: 'UIButton', activePath: ['second'] }
    ], { postMessage() {} }, 'session');

    const source = container.children[0].children[0];
    const target = container.children[1].children[0];
    let prevented = false;
    source.listeners.keydown({ key: 'ArrowDown', preventDefault() { prevented = true; } });
    assert.equal(target.focused, true);
    assert.equal(prevented, true);

    target.focused = false;
    target.disabled = true;
    prevented = false;
    source.listeners.keydown({ key: 'ArrowDown', preventDefault() { prevented = true; } });
    assert.equal(target.focused, false);
    assert.equal(prevented, false);
});

test('player UI automatic navigation uses the EventSystem directional score', () => {
    class FakeElement {
        constructor(tag) {
            this.tagName = tag.toUpperCase(); this.type = ''; this.style = {}; this.dataset = {};
            this.children = []; this.listeners = {}; this.hidden = false; this.disabled = false; this.tabIndex = 0;
            this.rect = { left: 0, top: 0, width: 20, height: 20 };
        }
        append(...children) { this.children.push(...children); }
        addEventListener(name, listener) { this.listeners[name] = listener; }
        focus() { this.focused = true; }
        getBoundingClientRect() { return this.rect; }
    }
    const document = { createElement: (tag) => new FakeElement(tag) };
    const container = new FakeElement('div');
    const common = {
        type: 'UIButton', label: 'Control', eventName: '', active: true,
        layout: { width: 100, height: 30, x: 0, y: 0, anchorX: 0, anchorY: 1, pivotX: 0, pivotY: 1 },
        frame: null, interaction: { alpha: 1, interactable: true, blocksRaycasts: true },
        interactable: true, navigationMode: 'Automatic'
    };
    mountPlayerUiControls(document, container, [
        { ...common, id: 'source:UIButton', activePath: ['source'] },
        { ...common, id: 'near:UIButton', activePath: ['near'] },
        { ...common, id: 'diagonal:UIButton', activePath: ['diagonal'] }
    ], { postMessage() {} }, 'session');
    const source = container.children[0].children[0];
    const near = container.children[1].children[0];
    const diagonal = container.children[2].children[0];
    near.rect = { left: 0, top: 60, width: 20, height: 20 };
    diagonal.rect = { left: 80, top: 60, width: 20, height: 20 };

    let prevented = false;
    source.listeners.keydown({ key: 'ArrowDown', preventDefault() { prevented = true; } });
    assert.equal(near.focused, true);
    assert.equal(diagonal.focused, undefined);
    assert.equal(prevented, true);
});

test('player UI text collector preserves authored style and layout', () => {
    const scene = {
        gameObjects: [{
            id: 'status',
            components: [
                { type: 'RectTransform', data: { sizeDelta: [200, 30], anchoredPosition: [4, 5], anchorMin: [0.5, 0.5] } },
                { type: 'UIText', data: { text: 'Ready', fontSize: 22, color: '#ffcc00', alignment: 'center' } }
            ]
        }]
    };
    const text = collectPlayerUiText(scene);
    assert.equal(text.length, 1);
    assert.equal(text[0].text, 'Ready');
    assert.equal(text[0].fontSize, 22);
    assert.equal(text[0].color, '#ffcc00');
    assert.equal(text[0].alignment, 'center');
    assert.equal(text[0].layout.width, 200);
});

test('player scene action collector finds enabled nested LoadScene actions', () => {
    const actions = collectPlayerSceneLoadActions({ gameObjects: [{
        id: 'menu', components: [{ type: 'UIEventAction', data: { action: 'SetActive', eventName: 'Ignore' } }], children: [
            { id: 'play', components: [{ type: 'UIEventAction', data: { action: 'LoadScene', eventName: 'Play', scenePath: 'Assets\\Scenes\\Level.scene.json' } }] },
            { id: 'disabled', components: [{ type: 'UIEventAction', enabled: false, data: { action: 'LoadScene', eventName: 'Bad', scenePath: '../bad' } }] }
        ]
    }] });
    assert.deepEqual(actions, [{
        eventName: 'Play', scenePath: 'Assets/Scenes/Level.scene.json', active: true, activePath: ['menu', 'play']
    }]);
});
