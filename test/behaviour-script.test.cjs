'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { compileBehaviourProgram, createBehaviourRuntime } = require('../electron/runtime/behaviour-script');

function fixture(program) {
    return [{
        id: 'actor', name: 'Actor', tag: 'Player', active: true, selfActive: true,
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        components: [
            { type: 'RigidBody', enabled: true, data: { velocity: [0, 0, 0] } },
            { type: 'UIText', enabled: true, data: { text: '' } },
            { type: 'BehaviourScript', enabled: true, data: { program: JSON.stringify(program) } }
        ]
    }];
}

test('BehaviourScript compiles only bounded versioned JSON programs', () => {
    assert.equal(compileBehaviourProgram('{').ok, false);
    assert.equal(compileBehaviourProgram(JSON.stringify({ version: 2 })).ok, false);
    assert.equal(compileBehaviourProgram(JSON.stringify({ update: {} })).ok, false);
    assert.equal(compileBehaviourProgram(JSON.stringify({ version: 1, update: [] })).ok, true);
});

test('BehaviourScript executes lifecycle, input expressions and UI events deterministically', () => {
    const objects = fixture({
        version: 1, variables: { speed: 4 },
        start: [{ op: 'setPosition', value: [1, 2, 3] }],
        update: [{ op: 'translate', value: [
            { multiply: [{ input: 'Horizontal' }, { variable: 'speed' }, { deltaTime: true }] }, 0, 0
        ] }],
        fixedUpdate: [{ op: 'addVelocity', value: [0, 1, 0] }],
        events: { Win: [{ op: 'setText', value: { eventValue: true } }] }
    });
    const runtime = createBehaviourRuntime(objects);
    runtime.start();
    runtime.update(0.5, { Horizontal: 1 });
    runtime.fixedUpdate(0.02);
    runtime.event('Win', 'Finished');
    assert.deepEqual(objects[0].transform.position, [3, 2, 3]);
    assert.deepEqual(objects[0].components[0].data.velocity, [0, 1, 0]);
    assert.equal(objects[0].components[1].data.text, 'Finished');
    assert.deepEqual(runtime.diagnostics(), []);
});

test('BehaviourScript reports unsupported actions without throwing', () => {
    const runtime = createBehaviourRuntime(fixture({ version: 1, start: [{ op: 'unknown' }] }));
    assert.doesNotThrow(() => runtime.start());
    assert.match(runtime.diagnostics()[0].message, /Unsupported action/);
});

test('BehaviourScript routes object-scoped callbacks and exposes event fields', () => {
    const objects = fixture({
        version: 1,
        events: { triggerEnter: [{ op: 'setText', value: { eventField: 'otherTag' } }] }
    });
    const runtime = createBehaviourRuntime(objects);
    runtime.start();
    runtime.eventForObject('missing', 'triggerEnter', { otherTag: 'Ignored' });
    runtime.eventForObject('actor', 'triggerEnter', { otherTag: 'Pickup' });
    assert.equal(objects[0].components[1].data.text, 'Pickup');
});

test('BehaviourScript distinguishes held, pressed, and released authored actions', () => {
    const objects = fixture({
        version: 1,
        update: [{
            op: 'if', condition: { buttonDown: 'Fire' },
            then: [{ op: 'setText', value: 'Pressed' }],
            else: [{
                op: 'if', condition: { buttonUp: 'Fire' },
                then: [{ op: 'setText', value: 'Released' }],
                else: [{ op: 'if', condition: { button: 'Fire' }, then: [{ op: 'setText', value: 'Held' }] }]
            }]
        }]
    });
    const runtime = createBehaviourRuntime(objects);
    runtime.start();
    runtime.update(0.02, { Fire: true, '__buttonDown:Fire': true });
    assert.equal(objects[0].components[1].data.text, 'Pressed');
    runtime.update(0.02, { Fire: true });
    assert.equal(objects[0].components[1].data.text, 'Held');
    runtime.update(0.02, { Fire: false, '__buttonUp:Fire': true });
    assert.equal(objects[0].components[1].data.text, 'Released');
    assert.deepEqual(runtime.diagnostics(), []);
});

test('BehaviourScript destroy permanently removes a hierarchy from the running world', () => {
    const objects = fixture({
        version: 1,
        events: {
            Remove: [{ op: 'destroy' }],
            Restore: [{ op: 'setActive', value: true }]
        }
    });
    objects[0].children = [{
        id: 'child', active: true, selfActive: true,
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        components: []
    }];
    let refreshCount = 0;
    const runtime = createBehaviourRuntime(objects, { refreshActiveState: () => { refreshCount += 1; } });
    runtime.start();
    runtime.event('Remove');
    assert.equal(objects[0].destroyed, true);
    assert.equal(objects[0].active, false);
    assert.equal(objects[0].children[0].destroyed, true);
    assert.equal(objects[0].children[0].active, false);
    runtime.event('Restore');
    assert.equal(objects[0].active, false);
    assert.equal(refreshCount, 1);
    assert.deepEqual(runtime.diagnostics(), []);
});
