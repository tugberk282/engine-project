import assert from 'node:assert/strict';
import test from 'node:test';

class FakeWindow {
    listeners = new Map();

    addEventListener(type, listener) {
        const listeners = this.listeners.get(type) ?? [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
    }

    dispatch(type, event = {}) {
        for (const listener of this.listeners.get(type) ?? []) listener(event);
    }
}

test('focus loss clears held keyboard, pointer, deltas, wheel, and axes', async () => {
    const fakeWindow = new FakeWindow();
    globalThis.window = fakeWindow;
    const { Input } = await import('../src/engine/Input.ts');

    Input.initialize();
    fakeWindow.dispatch('keydown', { code: 'KeyD' });
    fakeWindow.dispatch('mousedown', { button: 0 });
    fakeWindow.dispatch('mousemove', { movementX: 7, movementY: -4, clientX: 20, clientY: 30 });
    fakeWindow.dispatch('wheel', { deltaY: 120 });
    Input.update(1);

    assert.equal(Input.getKey('KeyD'), true);
    assert.equal(Input.getMouseButton(0), true);
    assert.equal(Input.GetAxis('Horizontal'), 1);

    fakeWindow.dispatch('blur');

    assert.equal(Input.getKey('KeyD'), false);
    assert.equal(Input.getKeyDown('KeyD'), false);
    assert.equal(Input.getMouseButton(0), false);
    assert.equal(Input.GetAxis('Horizontal'), 0);
    assert.deepEqual(Input.mouseDelta, { x: 0, y: 0 });
    assert.equal(Input.mouseWheel, 0);
});

test('editor shortcuts yield keyboard ownership only to text editing and a running Game view', async () => {
    const { editorOwnsKeyboardInput } = await import('../src/editor/EditorInputOwnership.ts');

    assert.equal(editorOwnsKeyboardInput({ isTextEditing: false, isPlaying: false, isGameView: false }), true);
    assert.equal(editorOwnsKeyboardInput({ isTextEditing: false, isPlaying: true, isGameView: false }), true);
    assert.equal(editorOwnsKeyboardInput({ isTextEditing: false, isPlaying: true, isGameView: true }), false);
    assert.equal(editorOwnsKeyboardInput({ isTextEditing: true, isPlaying: false, isGameView: false }), false);
});
