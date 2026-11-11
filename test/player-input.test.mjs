import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlayerInputMapper, normalizeInputBinding } from '../electron/build/player-input.mjs';

test('player input canonicalizes project keyboard, mouse, and gamepad bindings', () => {
    assert.equal(normalizeInputBinding('d'), 'KeyD');
    assert.equal(normalizeInputBinding('mouse0'), 'Mouse0');
    assert.equal(normalizeInputBinding('GAMEPAD2'), 'Gamepad2');
    assert.equal(normalizeInputBinding(' '), 'Space');
});

test('player axes apply authored sensitivity, gravity, snap, and gamepad fallback', () => {
    const mapper = createPlayerInputMapper({ axes: { Horizontal: {
        positiveButton: 'd', negativeButton: 'a', sensitivity: 2, gravity: 4, snap: true
    } } });
    const keys = new Set(['KeyD']);
    assert.equal(mapper.sample({ keys }, 0.1).Horizontal, 0.2);
    assert.equal(mapper.sample({ keys }, 0.1).Horizontal, 0.4);
    keys.clear();
    assert.equal(mapper.sample({ keys }, 0.1).Horizontal, 0);
    keys.add('KeyA');
    assert.equal(mapper.sample({ keys }, 0.1).Horizontal, -0.2);
    keys.clear();
    mapper.clear();
    assert.equal(mapper.sample({ keys, gamepadAxes: { horizontal: 0.75 } }, 0.1).Horizontal, 0.2);
});

test('player actions consume authored mouse and gamepad buttons and clear held axes', () => {
    const mapper = createPlayerInputMapper({
        axes: { Horizontal: { positiveButton: 'd', negativeButton: 'a', sensitivity: 10, gravity: 10 } },
        actions: { Fire: ['mouse0'], Jump: ['gamepad0'] }
    });
    const source = {
        keys: new Set(['KeyD']), mouseButtons: new Set([0]), gamepadButtons: new Set([0])
    };
    const active = mapper.sample(source, 0.1);
    assert.equal(active.Horizontal, 1);
    assert.equal(active.Fire, true);
    assert.equal(active.Jump, true);
    assert.equal(active['__buttonDown:Fire'], true);
    assert.equal(active['__buttonUp:Fire'], false);
    const held = mapper.sample(source, 0.1);
    assert.equal(held['__buttonDown:Fire'], false);
    source.mouseButtons.clear();
    const released = mapper.sample(source, 0.1);
    assert.equal(released.Fire, false);
    assert.equal(released['__buttonUp:Fire'], true);
    mapper.clear();
    const cleared = mapper.sample({}, 0);
    assert.equal(cleared.Horizontal, 0);
    assert.equal(cleared.Fire, false);
    assert.equal(cleared.Jump, false);
    assert.equal(cleared['__buttonUp:Jump'], false);
});
