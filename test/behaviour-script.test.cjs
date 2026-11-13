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
    assert.match(compileBehaviourProgram(JSON.stringify({ version: 1, update: [{ op: 'if', then: {} }] })).error, /action array/);
    const nested = { op: 'if', then: [] };
    let branch = nested.then;
    for (let index = 0; index < 17; index += 1) {
        const child = { op: 'if', then: [] };
        branch.push(child);
        branch = child.then;
    }
    assert.match(compileBehaviourProgram(JSON.stringify({ version: 1, update: [nested] })).error, /depth limit/);
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

test('BehaviourScript supports gameplay math, world reads and bounded object-to-object events', () => {
    const sender = fixture({
        version: 1,
        variables: { elapsed: 0 },
        update: [
            { op: 'addVariable', name: 'elapsed', value: { deltaTime: true } },
            {
                op: 'if',
                condition: { greaterOrEqual: [{ variable: 'elapsed' }, 1] },
                then: [{
                    op: 'sendEvent', target: 'Receiver', name: 'Damage',
                    value: { subtract: [10, { objectProperty: { target: 'self', property: 'position.x' } }] }
                }]
            }
        ]
    })[0];
    sender.transform.position[0] = 3;
    const receiver = {
        id: 'receiver', name: 'Receiver', active: true, selfActive: true,
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        components: [
            { type: 'UIText', enabled: true, data: { text: '' } },
            {
                type: 'BehaviourScript', enabled: true, data: { program: JSON.stringify({
                    version: 1,
                    variables: { health: 12 },
                    events: { Damage: [
                        { op: 'addVariable', name: 'health', value: { negate: { eventValue: true } } },
                        { op: 'setText', value: { concat: ['HP ', { max: [0, { variable: 'health' }] }] } }
                    ] }
                }) }
            }
        ]
    };
    const runtime = createBehaviourRuntime([sender, receiver]);
    runtime.start();
    runtime.update(0.5);
    assert.equal(receiver.components[0].data.text, '');
    runtime.update(0.5);
    assert.equal(receiver.components[0].data.text, 'HP 5');
    assert.deepEqual(runtime.diagnostics(), []);
});

test('BehaviourScript rejects zero division and recursive event chains at the shared operation budget', () => {
    const divide = createBehaviourRuntime(fixture({
        version: 1,
        start: [{ op: 'setVariable', name: 'bad', value: { divide: [1, 0] } }]
    }));
    divide.start();
    assert.match(divide.diagnostics()[0].message, /Division by zero/);

    const recursive = createBehaviourRuntime(fixture({
        version: 1,
        start: [{ op: 'sendEvent', name: 'Loop' }],
        events: { Loop: [{ op: 'sendEvent', name: 'Loop' }] }
    }), { maxOperations: 16 });
    recursive.start();
    assert.match(recursive.diagnostics().at(-1).message, /Operation budget of 16 exceeded/);
});

test('BehaviourScript activates ID-referenced pooled objects and starts them exactly once', () => {
    const activator = fixture({
        version: 1,
        events: { Spawn: [{ op: 'setActive', target: 'pooled', value: true }] }
    })[0];
    const pooled = {
        id: 'pooled', name: 'Pooled Enemy', active: false, selfActive: false, enabled: false,
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        components: [
            { type: 'UIText', enabled: true, data: { text: '' } },
            { type: 'BehaviourScript', enabled: true, data: { program: JSON.stringify({
                version: 1,
                variables: { starts: 0 },
                start: [
                    { op: 'addVariable', name: 'starts', value: 1 },
                    { op: 'setText', value: { concat: ['Started ', { variable: 'starts' }] } }
                ],
                update: [{ op: 'translate', value: [1, 0, 0] }]
            }) } }
        ]
    };
    const runtime = createBehaviourRuntime([activator, pooled]);
    runtime.start();
    assert.equal(pooled.components[0].data.text, '');
    runtime.event('Spawn');
    runtime.update(0.02);
    assert.equal(pooled.components[0].data.text, 'Started 1');
    assert.equal(pooled.transform.position[0], 1);
    runtime.update(0.02);
    assert.equal(pooled.components[0].data.text, 'Started 1');
    assert.equal(pooled.transform.position[0], 2);
    assert.deepEqual(runtime.diagnostics(), []);
});

test('BehaviourScript moves authored AI toward an active target using frame time', () => {
    const chaser = fixture({
        version: 1,
        update: [{
            op: 'if', condition: { greaterThan: [{ distanceTo: 'Player' }, 1] },
            then: [{ op: 'moveTowards', destination: 'Player', speed: 4 }]
        }]
    })[0];
    chaser.id = 'chaser';
    chaser.name = 'Chaser';
    chaser.tag = 'Enemy';
    const player = {
        id: 'player', name: 'Player', tag: 'Player', active: true, selfActive: true,
        transform: { position: [3, 4, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, components: []
    };
    const runtime = createBehaviourRuntime([chaser, player]);
    runtime.start();
    runtime.update(0.5);
    assert.deepEqual(chaser.transform.position.map((value) => Number(value.toFixed(6))), [1.2, 1.6, 0]);
    runtime.update(1);
    assert.deepEqual(chaser.transform.position, [3, 4, 0]);
    assert.deepEqual(runtime.diagnostics(), []);
});

test('BehaviourScript applies Unity-style force modes to dynamic rigidbodies', () => {
    const objects = fixture({
        version: 1,
        fixedUpdate: [
            { op: 'addForce', value: [4, 0, 0], mode: 'Force' },
            { op: 'addForce', value: [0, 2, 0], mode: 'Acceleration' },
            { op: 'addForce', value: [0, 0, 6], mode: 'Impulse' },
            { op: 'addForce', value: [1, 1, 1], mode: 'VelocityChange' }
        ]
    });
    objects[0].components[0].data.mass = 2;
    const runtime = createBehaviourRuntime(objects);
    runtime.start();
    runtime.fixedUpdate(0.5);
    assert.deepEqual(objects[0].components[0].data.velocity, [2, 2, 4]);

    objects[0].components[0].data.isKinematic = true;
    runtime.fixedUpdate(0.5);
    assert.deepEqual(objects[0].components[0].data.velocity, [2, 2, 4]);
    assert.deepEqual(runtime.diagnostics(), []);
});

test('BehaviourScript emits bounded audio playback commands for authored sources', () => {
    const objects = fixture({
        version: 1,
        events: {
            Play: [{ op: 'playAudio', target: 'speaker' }],
            Stop: [{ op: 'stopAudio', target: 'speaker' }]
        }
    });
    objects.push({
        id: 'speaker', name: 'Speaker', active: true, selfActive: true,
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        components: [{ type: 'AudioSource', enabled: true, data: { playOnAwake: false } }]
    });
    const commands = [];
    const runtime = createBehaviourRuntime(objects, { audioCommand: (command) => commands.push(command) });
    runtime.start();
    runtime.event('Play');
    runtime.event('Stop');
    assert.deepEqual(commands, [
        { objectId: 'speaker', command: 'play' },
        { objectId: 'speaker', command: 'stop' }
    ]);
    assert.deepEqual(runtime.diagnostics(), []);
});

test('BehaviourScript emits bounded particle playback commands for authored systems', () => {
    const objects = fixture({
        version: 1,
        events: {
            Play: [{ op: 'playParticles', target: 'fx' }],
            Stop: [{ op: 'stopParticles', target: 'fx' }]
        }
    });
    objects.push({
        id: 'fx', name: 'FX', active: true, selfActive: true,
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        components: [{ type: 'ParticleSystem', enabled: true, data: { playOnAwake: false } }]
    });
    const commands = [];
    const runtime = createBehaviourRuntime(objects, { particleCommand: (command) => commands.push(command) });
    runtime.start();
    runtime.event('Play');
    runtime.event('Stop');
    assert.deepEqual(commands, [
        { objectId: 'fx', command: 'play' },
        { objectId: 'fx', command: 'stop' }
    ]);
    assert.deepEqual(runtime.diagnostics(), []);
});

test('BehaviourScript emits authored animation playback commands with an optional clip', () => {
    const objects = fixture({
        version: 1,
        events: {
            Play: [{ op: 'playAnimation', target: 'character', clip: { concat: ['R', 'un'] } }],
            Stop: [{ op: 'stopAnimation', target: 'character' }]
        }
    });
    objects.push({
        id: 'character', name: 'Character', active: true, selfActive: true,
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        components: [{ type: 'Animator', enabled: true, data: { currentAnimation: 'Idle' } }]
    });
    const commands = [];
    const runtime = createBehaviourRuntime(objects, { animationCommand: (command) => commands.push(command) });
    runtime.start();
    runtime.event('Play');
    runtime.event('Stop');
    assert.deepEqual(commands, [
        { objectId: 'character', command: 'play', clip: 'Run' },
        { objectId: 'character', command: 'stop' }
    ]);
    assert.deepEqual(runtime.diagnostics(), []);
});

test('BehaviourScript spawns inactive authored pool entries in deterministic order', () => {
    const spawner = fixture({
        version: 1,
        variables: { lastSpawn: '' },
        events: { Fire: [{
            op: 'spawnPooled', pool: 'tag:Projectile', position: [3, 2, 1], rotation: [0, 1, 0], store: 'lastSpawn'
        }, { op: 'setText', value: { variable: 'lastSpawn' } }] }
    })[0];
    const projectile = (id) => ({
        id, name: id, tag: 'Projectile', active: false, selfActive: false, enabled: false,
        transform: { position: [9, 9, 9], rotation: [2, 2, 2], scale: [1, 1, 1] },
        components: [{ type: 'RigidBody', enabled: true, data: { velocity: [5, 5, 5], angularVelocity: [1, 1, 1] } }]
    });
    const first = projectile('projectile-a');
    const second = projectile('projectile-b');
    const runtime = createBehaviourRuntime([spawner, first, second]);
    runtime.start();
    runtime.event('Fire');
    assert.equal(first.active, true);
    assert.deepEqual(first.transform.position, [3, 2, 1]);
    assert.deepEqual(first.transform.rotation, [0, 1, 0]);
    assert.deepEqual(first.components[0].data.velocity, [0, 0, 0]);
    assert.equal(spawner.components[1].data.text, 'projectile-a');
    runtime.event('Fire');
    assert.equal(second.active, true);
    assert.equal(spawner.components[1].data.text, 'projectile-b');
    runtime.event('Fire');
    assert.match(runtime.diagnostics().at(-1).message, /No inactive pooled object found/);
});
