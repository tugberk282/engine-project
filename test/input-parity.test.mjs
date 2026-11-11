import assert from 'node:assert/strict';
import test from 'node:test';

test('editor input derives button actions from project axes and canonicalizes mouse and space', async () => {
    const listeners = new Map();
    globalThis.window = {
        addEventListener(type, listener) { listeners.set(type, listener); }
    };
    const { Input } = await import('../src/engine/Input.ts');
    Input.initialize();
    Input.configureProjectAxes([
        ['Horizontal', { positiveButton: 'd', negativeButton: 'a', sensitivity: 3, gravity: 3 }],
        ['Jump', { positiveButton: ' ', negativeButton: '', sensitivity: 1000, gravity: 1000 }],
        ['Fire1', { positiveButton: 'mouse0', negativeButton: '', sensitivity: 1000, gravity: 1000 }]
    ]);

    listeners.get('keydown')({ code: 'Space' });
    listeners.get('mousedown')({ button: 0 });
    Input.update(0.02);
    const active = Input.snapshot();
    assert.equal(active.Jump, true);
    assert.equal(active.Fire1, true);
    assert.equal(active['__buttonDown:Jump'], true);
    assert.equal(active['__buttonDown:Fire1'], true);
    assert.equal(active['__buttonUp:Jump'], false);
    Input.lateUpdate();
    const held = Input.snapshot();
    assert.equal(held.Jump, true);
    assert.equal(held['__buttonDown:Jump'], false);

    listeners.get('keyup')({ code: 'Space' });
    listeners.get('mouseup')({ button: 0 });
    Input.update(0.02);
    const released = Input.snapshot();
    assert.equal(released.Jump, false);
    assert.equal(released.Fire1, false);
    assert.equal(released['__buttonUp:Jump'], true);
    assert.equal(released['__buttonUp:Fire1'], true);
    Input.clearHeldState();
    delete globalThis.window;
});
