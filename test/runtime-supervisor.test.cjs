'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { RuntimeSupervisor } = require('../electron/runtime/runtime-supervisor');

const snapshot = JSON.stringify({
    formatVersion: 1,
    sceneId: 'replay-fixture',
    gameObjects: [{ id: 'player', position: [0, 0, 0] }]
});

const authoredSnapshot = fs.readFileSync(path.join(
    __dirname, '..', 'samples', 'playable-runtime', 'Assets', 'Scenes', 'PlayableSlice.json'
), 'utf8');
const topDownSnapshot = fs.readFileSync(path.join(
    __dirname, '..', 'samples', 'vertical-slice', 'Assets', 'Scenes', 'TopDown.scene.json'
), 'utf8');

function hashReplay(states) {
    return createHash('sha256').update(JSON.stringify(states)).digest('hex');
}

test('100 isolated play runs produce the same replay hash and never mutate editor bytes', async () => {
    const originalBytes = Buffer.from(snapshot);
    const hashes = [];
    for (let run = 0; run < 100; run += 1) {
        const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
        const states = [await supervisor.start(snapshot)];
        for (const deltaTime of [0.016, 0.016, 0.017, 0.016]) {
            states.push(await supervisor.tick(deltaTime));
        }
        hashes.push(hashReplay(states.map(({ state, frame, timeMicros, snapshotHash }) => ({
            state, frame, timeMicros, snapshotHash
        }))));
        await supervisor.shutdown();
    }
    assert.equal(new Set(hashes).size, 1);
    assert.deepEqual(Buffer.from(snapshot), originalBytes);
});

test('malformed and version-mismatched snapshots return stable bounded failures', async () => {
    for (const [input, code] of [
        ['{', 'INVALID_SNAPSHOT'],
        [JSON.stringify({ formatVersion: 2 }), 'RUNTIME_SNAPSHOT_VERSION_MISMATCH']
    ]) {
        const supervisor = new RuntimeSupervisor();
        await assert.rejects(supervisor.start(input), (error) => error.code === code && error.message.length < 256);
        await supervisor.shutdown();
    }
});

test('restart replaces the runtime process and starts from the replacement snapshot', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    const first = await supervisor.start(snapshot);
    const firstChild = supervisor.child;
    const firstSessionId = supervisor.sessionId;
    const replacementSnapshot = JSON.stringify({
        formatVersion: 1,
        sceneId: 'replacement-scene',
        gameObjects: [{ id: 'replacement', position: [4, 5, 6] }]
    });

    const restarted = await supervisor.restart(replacementSnapshot);
    assert.equal(restarted.state, 'running');
    assert.notEqual(supervisor.child, firstChild);
    assert.notEqual(supervisor.sessionId, firstSessionId);
    assert.notEqual(restarted.snapshotHash, first.snapshotHash);
    assert.equal(supervisor.snapshot, replacementSnapshot);
    await supervisor.shutdown();
});

test('runtime crash is isolated, preserves snapshot bytes, and consumes at most two restarts', async () => {
    const diagnostics = [];
    const supervisor = new RuntimeSupervisor({
        heartbeatIntervalMs: 60_000,
        restartBackoffMs: 5,
        onDiagnostic: (event) => diagnostics.push(event)
    });
    const originalBytes = Buffer.from(snapshot);
    await supervisor.start(snapshot);
    supervisor.child.kill();
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(supervisor.state, 'running');
    assert.deepEqual(Buffer.from(snapshot), originalBytes);
    supervisor.child.kill();
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(supervisor.state, 'running');
    supervisor.child.kill();
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(supervisor.state, 'failed');
    assert.equal(diagnostics.length, 3);
    await supervisor.shutdown();
    assert.equal(supervisor.child, null);
    assert.equal(supervisor.pending.size, 0);
    assert.equal(supervisor.heartbeatTimer, null);
});

test('shutdown is idempotent and releases process, timers, and pending requests', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    await supervisor.start(snapshot);
    await Promise.all([supervisor.shutdown(), supervisor.shutdown()]);
    assert.equal(supervisor.state, 'idle');
    assert.equal(supervisor.child, null);
    assert.equal(supervisor.pending.size, 0);
    assert.equal(supervisor.heartbeatTimer, null);
});

test('authored Update and fixed-step components execute in the child runtime and return observable transforms', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    const originalBytes = Buffer.from(authoredSnapshot);
    const started = await supervisor.start(authoredSnapshot);
    assert.deepEqual(started.transforms[0], {
        id: 'moving-cube', position: [0, 2, 0], rotation: [0, 0, 0], scale: [1, 1, 1]
    });

    const advanced = await supervisor.tick(0.04);
    assert.equal(advanced.updateCount, 1);
    assert.equal(advanced.fixedUpdateCount, 2);
    assert.equal(advanced.transforms[0].rotation[1], 0.16);
    assert.ok(advanced.transforms[0].position[1] < 2, 'fixed-step gravity must visibly move the authored object');
    assert.deepEqual(Buffer.from(authoredSnapshot), originalBytes, 'runtime must not mutate editor snapshot bytes');
    await supervisor.shutdown();
});

test('supervised Play Mode executes BehaviourScript lifecycle, input and UI events', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    const program = JSON.stringify({
        version: 1, variables: { speed: 2 },
        start: [{ op: 'setPosition', value: [2, 0, 0] }],
        update: [{ op: 'translate', value: [{ multiply: [{ input: 'Horizontal' }, { variable: 'speed' }, { deltaTime: true }] }, 0, 0] }],
        events: { Message: [{ op: 'setText', value: { eventValue: true } }] }
    });
    const authored = JSON.stringify({ formatVersion: 1, sceneId: 'behaviour-script', gameObjects: [{
        id: 'actor', name: 'Actor', transform: {}, components: [
            { type: 'BehaviourScript', data: { program } }, { type: 'UIText', data: { text: '' } }
        ]
    }] });
    try {
        const started = await supervisor.start(authored);
        assert.equal(started.transforms[0].position[0], 2);
        const moved = await supervisor.tick(0.1, { Horizontal: 1 });
        assert.equal(moved.transforms[0].position[0], 2.2);
        assert.equal(moved.behaviourScripts.instanceCount, 1);
        const event = await supervisor.uiEvent('Message', 'Play Mode');
        assert.equal(event.uiText[0].text, 'Play Mode');
        assert.deepEqual(event.behaviourScripts.diagnostics, []);
    } finally {
        await supervisor.shutdown();
    }
});

test('supervised Play Mode routes bounded BehaviourScript events between authored objects', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    const senderProgram = JSON.stringify({
        version: 1,
        update: [{
            op: 'if', condition: { buttonDown: 'Fire' },
            then: [{ op: 'sendEvent', target: 'Target', name: 'Hit', value: 4 }]
        }]
    });
    const receiverProgram = JSON.stringify({
        version: 1, variables: { health: 10 },
        events: { Hit: [
            { op: 'addVariable', name: 'health', value: { negate: { eventValue: true } } },
            { op: 'setText', value: { concat: ['HP ', { variable: 'health' }] } }
        ] }
    });
    const authored = JSON.stringify({ formatVersion: 1, gameObjects: [
        { id: 'sender', name: 'Sender', transform: {}, components: [{ type: 'BehaviourScript', data: { program: senderProgram } }] },
        { id: 'target', name: 'Target', transform: {}, components: [
            { type: 'UIText', data: { text: '' } },
            { type: 'BehaviourScript', data: { program: receiverProgram } }
        ] }
    ] });
    try {
        await supervisor.start(authored);
        const frame = await supervisor.tick(0.02, { Fire: true, '__buttonDown:Fire': true });
        assert.equal(frame.uiText[0].text, 'HP 6');
        assert.deepEqual(frame.behaviourScripts.diagnostics, []);
    } finally {
        await supervisor.shutdown();
    }
});

test('supervised Play Mode starts an ID-activated pooled BehaviourScript exactly once', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    const activator = JSON.stringify({
        version: 1,
        events: { Spawn: [{ op: 'setActive', target: 'pooled', value: true }] }
    });
    const pooled = JSON.stringify({
        version: 1,
        variables: { starts: 0 },
        start: [
            { op: 'addVariable', name: 'starts', value: 1 },
            { op: 'setText', value: { concat: ['Started ', { variable: 'starts' }] } }
        ],
        update: [{ op: 'translate', value: [1, 0, 0] }]
    });
    const authored = JSON.stringify({ formatVersion: 1, gameObjects: [
        { id: 'activator', transform: {}, components: [{ type: 'BehaviourScript', data: { program: activator } }] },
        { id: 'pooled', name: 'Pooled Enemy', enabled: false, transform: {}, components: [
            { type: 'UIText', data: { text: '' } },
            { type: 'BehaviourScript', data: { program: pooled } }
        ] }
    ] });
    try {
        await supervisor.start(authored);
        const activated = await supervisor.uiEvent('Spawn');
        assert.notEqual(activated.transforms.find(({ id }) => id === 'pooled').active, false);
        assert.equal(activated.uiText.find(({ id }) => id === 'pooled:UIText').text, 'Started 1');
        const first = await supervisor.tick(0.02);
        const second = await supervisor.tick(0.02);
        assert.equal(first.transforms.find(({ id }) => id === 'pooled').position[0], 1);
        assert.equal(second.transforms.find(({ id }) => id === 'pooled').position[0], 2);
        assert.equal(second.uiText.find(({ id }) => id === 'pooled:UIText').text, 'Started 1');
    } finally {
        await supervisor.shutdown();
    }
});

test('supervised Play Mode advances authored AI toward its target at frame-rate-independent speed', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    const program = JSON.stringify({
        version: 1,
        update: [{
            op: 'if', condition: { greaterThan: [{ distanceTo: 'Player' }, 0.1] },
            then: [{ op: 'moveTowards', destination: 'Player', speed: 4 }]
        }]
    });
    const authored = JSON.stringify({ formatVersion: 1, gameObjects: [
        { id: 'enemy', name: 'Enemy', transform: { position: [0, 0, 0] }, components: [{ type: 'BehaviourScript', data: { program } }] },
        { id: 'player', name: 'Player', tag: 'Player', transform: { position: [5, 0, 0] }, components: [] }
    ] });
    try {
        await supervisor.start(authored);
        const frame = await supervisor.tick(0.1);
        assert.equal(frame.transforms.find(({ id }) => id === 'enemy').position[0], 0.4);
        assert.deepEqual(frame.behaviourScripts.diagnostics, []);
    } finally {
        await supervisor.shutdown();
    }
});

test('supervised Play Mode applies authored rigidbody impulse before fixed-step integration', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    const program = JSON.stringify({
        version: 1,
        fixedUpdate: [{ op: 'addForce', value: [4, 0, 0], mode: 'Impulse' }]
    });
    const authored = JSON.stringify({ formatVersion: 1, gameObjects: [{
        id: 'body', transform: { position: [0, 0, 0] }, components: [
            { type: 'RigidBody', data: { mass: 2, useGravity: false, drag: 0, velocity: [0, 0, 0] } },
            { type: 'BehaviourScript', data: { program } }
        ]
    }] });
    try {
        await supervisor.start(authored);
        const frame = await supervisor.tick(0.02);
        assert.equal(frame.transforms[0].position[0], 0.04);
        assert.deepEqual(frame.behaviourScripts.diagnostics, []);
    } finally {
        await supervisor.shutdown();
    }
});

test('supervised Play Mode publishes ordered BehaviourScript audio commands', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    const program = JSON.stringify({
        version: 1,
        events: {
            PlaySfx: [{ op: 'playAudio', target: 'speaker' }],
            StopSfx: [{ op: 'stopAudio', target: 'speaker' }]
        }
    });
    const authored = JSON.stringify({ formatVersion: 1, gameObjects: [
        { id: 'controller', transform: {}, components: [{ type: 'BehaviourScript', data: { program } }] },
        { id: 'speaker', transform: {}, components: [{ type: 'AudioSource', data: { playOnAwake: false } }] }
    ] });
    try {
        await supervisor.start(authored);
        const played = await supervisor.uiEvent('PlaySfx');
        assert.deepEqual(played.audioCommands, [{ sequence: 1, objectId: 'speaker', command: 'play' }]);
        const stopped = await supervisor.uiEvent('StopSfx');
        assert.deepEqual(stopped.audioCommands, [
            { sequence: 1, objectId: 'speaker', command: 'play' },
            { sequence: 2, objectId: 'speaker', command: 'stop' }
        ]);
    } finally {
        await supervisor.shutdown();
    }
});

test('supervised Play Mode publishes ordered BehaviourScript particle commands', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    const program = JSON.stringify({
        version: 1,
        events: {
            PlayFx: [{ op: 'playParticles', target: 'fx' }],
            StopFx: [{ op: 'stopParticles', target: 'fx' }]
        }
    });
    const authored = JSON.stringify({ formatVersion: 1, gameObjects: [
        { id: 'controller', transform: {}, components: [{ type: 'BehaviourScript', data: { program } }] },
        { id: 'fx', transform: {}, components: [{ type: 'ParticleSystem', data: { playOnAwake: false } }] }
    ] });
    try {
        await supervisor.start(authored);
        const played = await supervisor.uiEvent('PlayFx');
        assert.deepEqual(played.particleCommands, [{ sequence: 1, objectId: 'fx', command: 'play' }]);
        const stopped = await supervisor.uiEvent('StopFx');
        assert.deepEqual(stopped.particleCommands, [
            { sequence: 1, objectId: 'fx', command: 'play' },
            { sequence: 2, objectId: 'fx', command: 'stop' }
        ]);
    } finally {
        await supervisor.shutdown();
    }
});

test('supervised Play Mode publishes ordered BehaviourScript animation commands', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    const program = JSON.stringify({
        version: 1,
        events: {
            PlayAnim: [{ op: 'playAnimation', target: 'character', clip: 'Run' }],
            StopAnim: [{ op: 'stopAnimation', target: 'character' }]
        }
    });
    const authored = JSON.stringify({ formatVersion: 1, gameObjects: [
        { id: 'controller', transform: {}, components: [{ type: 'BehaviourScript', data: { program } }] },
        { id: 'character', transform: {}, components: [{ type: 'Animator', data: { currentAnimation: 'Idle' } }] }
    ] });
    try {
        await supervisor.start(authored);
        const played = await supervisor.uiEvent('PlayAnim');
        assert.deepEqual(played.animationCommands, [
            { sequence: 1, objectId: 'character', command: 'play', clip: 'Run' }
        ]);
        const stopped = await supervisor.uiEvent('StopAnim');
        assert.deepEqual(stopped.animationCommands, [
            { sequence: 1, objectId: 'character', command: 'play', clip: 'Run' },
            { sequence: 2, objectId: 'character', command: 'stop' }
        ]);
    } finally {
        await supervisor.shutdown();
    }
});

test('supervised Play Mode activates authored pooled objects at the requested spawn transform', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    const program = JSON.stringify({
        version: 1,
        events: { Fire: [{ op: 'spawnPooled', pool: 'tag:Projectile', position: [4, 1, -2] }] }
    });
    const authored = JSON.stringify({ formatVersion: 1, gameObjects: [
        { id: 'spawner', transform: {}, components: [{ type: 'BehaviourScript', data: { program } }] },
        { id: 'projectile', name: 'Projectile', tag: 'Projectile', enabled: false, transform: { position: [0, 0, 0] }, components: [
            { type: 'RigidBody', data: { useGravity: false, velocity: [5, 0, 0] } }
        ] }
    ] });
    try {
        await supervisor.start(authored);
        const frame = await supervisor.uiEvent('Fire');
        const projectile = frame.transforms.find(({ id }) => id === 'projectile');
        assert.equal(projectile.active, undefined);
        assert.deepEqual(projectile.position, [4, 1, -2]);
        assert.deepEqual(frame.behaviourScripts.diagnostics, []);
    } finally {
        await supervisor.shutdown();
    }
});

test('supervised Play Mode instantiates a resolved prefab with runtime lifecycle and spawn descriptor', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    const cloneProgram = JSON.stringify({ version: 1, start: [{ op: 'setText', value: 'Spawned' }] });
    const prefabData = {
        id: 'prefab-root', name: 'Projectile', tag: 'Projectile', enabled: true,
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        components: [
            { type: 'UIText', data: { text: '' } },
            { type: 'BehaviourScript', data: { program: cloneProgram } },
            { type: 'RigidBody', data: { mass: 1, useGravity: false, velocity: [0, 0, 0] } },
            { type: 'MeshFilter', data: { primitiveType: 'Sphere' } },
            { type: 'MeshRenderer', data: { color: '#ff4400' } }
        ], children: []
    };
    const program = JSON.stringify({ version: 1, events: {
        Fire: [
            { op: 'instantiatePrefab', prefabData, position: [4, 2, -1], store: 'spawned' },
            { op: 'setVelocity', target: { variable: 'spawned' }, value: [2, 0, 0] }
        ],
        RemoveLast: [{ op: 'destroy', target: { variable: 'spawned' } }]
    } });
    const authored = JSON.stringify({ formatVersion: 1, gameObjects: [
        { id: 'spawner', transform: {}, components: [{ type: 'BehaviourScript', data: { program } }] }
    ] });
    try {
        await supervisor.start(authored);
        const frame = await supervisor.uiEvent('Fire');
        const command = frame.spawnCommands[0];
        assert.equal(command.sequence, 1);
        assert.equal(command.node.id, 'runtime-prefab-1-1');
        assert.deepEqual(command.node.transform.position, [4, 2, -1]);
        assert.equal(frame.uiText.find(({ id }) => id === `${command.node.id}:UIText`).text, 'Spawned');
        assert.equal(frame.behaviourScripts.instanceCount, 2);
        assert.deepEqual(frame.behaviourScripts.diagnostics, []);
        const moved = await supervisor.tick(0.02);
        assert.equal(moved.transforms.find(({ id }) => id === command.node.id).position[0], 4.04);
        const removed = await supervisor.uiEvent('RemoveLast');
        assert.equal(removed.transforms.find(({ id }) => id === command.node.id).active, false);
    } finally {
        await supervisor.shutdown();
    }
});

test('supervised BehaviourScript preserves authored action press and release edges', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    const program = JSON.stringify({
        version: 1,
        update: [{
            op: 'if', condition: { buttonDown: 'Interact' },
            then: [{ op: 'setText', value: 'down' }],
            else: [{ op: 'if', condition: { buttonUp: 'Interact' }, then: [{ op: 'setText', value: 'up' }] }]
        }]
    });
    const authored = JSON.stringify({ formatVersion: 1, gameObjects: [{
        id: 'actor', transform: {}, components: [
            { type: 'BehaviourScript', data: { program } }, { type: 'UIText', data: { text: '' } }
        ]
    }] });
    try {
        await supervisor.start(authored);
        const pressed = await supervisor.tick(0.02, { Interact: true, '__buttonDown:Interact': true });
        assert.equal(pressed.uiText[0].text, 'down');
        const released = await supervisor.tick(0.02, { Interact: false, '__buttonUp:Interact': true });
        assert.equal(released.uiText[0].text, 'up');
    } finally {
        await supervisor.shutdown();
    }
});

test('supervised BehaviourScript destroy removes a hierarchy until runtime restart', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    const program = JSON.stringify({
        version: 1,
        events: {
            Remove: [{ op: 'destroy', target: 'victim' }],
            Restore: [{ op: 'setActive', target: 'victim', value: true }]
        }
    });
    const authored = JSON.stringify({ formatVersion: 1, gameObjects: [
        { id: 'actor', transform: {}, components: [{ type: 'BehaviourScript', data: { program } }] },
        { id: 'victim', transform: {}, components: [{ type: 'BoxCollider', data: {} }], children: [
            { id: 'victim-child', transform: {}, components: [] }
        ] }
    ] });
    try {
        await supervisor.start(authored);
        const removed = await supervisor.uiEvent('Remove');
        assert.equal(removed.transforms.find(({ id }) => id === 'victim').active, false);
        assert.equal(removed.transforms.find(({ id }) => id === 'victim-child').active, false);
        const restoreAttempt = await supervisor.uiEvent('Restore');
        assert.equal(restoreAttempt.transforms.find(({ id }) => id === 'victim').active, false);
        const restarted = await supervisor.restart(authored);
        assert.notEqual(restarted.transforms.find(({ id }) => id === 'victim').active, false);
    } finally {
        await supervisor.shutdown();
    }
});

test('supervised BehaviourScript receives trigger enter, stay and exit callbacks', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    const program = JSON.stringify({
        version: 1,
        events: {
            triggerEnter: [{ op: 'setText', value: { eventField: 'otherTag' } }],
            triggerStay: [{ op: 'setText', value: 'stay' }],
            triggerExit: [{ op: 'setText', value: 'exit' }],
            MoveAway: [{ op: 'setPosition', value: [10, 0, 0] }]
        }
    });
    const authored = JSON.stringify({ formatVersion: 1, gameObjects: [
        { id: 'actor', name: 'Actor', transform: {}, components: [
            { type: 'BoxCollider', data: { size: [1, 1, 1] } },
            { type: 'UIText', data: { text: '' } },
            { type: 'BehaviourScript', data: { program } }
        ] },
        { id: 'pickup', name: 'Pickup', tag: 'Pickup', transform: {}, components: [
            { type: 'BoxCollider', data: { size: [1, 1, 1], isTrigger: true } }
        ] }
    ] });
    try {
        await supervisor.start(authored);
        assert.equal((await supervisor.tick(0.02)).uiText[0].text, 'Pickup');
        assert.equal((await supervisor.tick(0.02)).uiText[0].text, 'stay');
        await supervisor.uiEvent('MoveAway');
        assert.equal((await supervisor.tick(0.02)).uiText[0].text, 'exit');
    } finally {
        await supervisor.shutdown();
    }
});

test('generic RigidBody resolves against authored box floors', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    const rigidBodySnapshot = JSON.stringify({
        formatVersion: 1,
        gameObjects: [
            {
                id: 'body',
                transform: { position: [0, 2, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
                components: [
                    { type: 'RigidBody', data: { mass: 1, useGravity: true, velocity: [0, 0, 0] } },
                    { type: 'BoxCollider', data: { size: [1, 1, 1], isTrigger: false } }
                ]
            },
            {
                id: 'floor',
                transform: { position: [0, -0.5, 0], rotation: [0, 0, 0], scale: [4, 1, 4] },
                components: [{ type: 'BoxCollider', data: { size: [1, 1, 1], isTrigger: false } }]
            }
        ]
    });
    await supervisor.start(rigidBodySnapshot);
    for (let index = 0; index < 10; index += 1) await supervisor.tick(0.1);
    const body = (await supervisor.tick(0.02)).transforms.find(({ id }) => id === 'body');
    assert.equal(body.position[1], 0.5);
    await supervisor.shutdown();
});

test('generic RigidBody resolves against authored sphere colliders', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    const snapshot = JSON.stringify({
        formatVersion: 1,
        gameObjects: [
            { id: 'body', transform: { position: [0, 2, 0], scale: [1, 1, 1] }, components: [
                { type: 'RigidBody', data: { mass: 1, useGravity: true, velocity: [0, 0, 0] } },
                { type: 'SphereCollider', data: { radius: 0.5, isTrigger: false } }
            ] },
            { id: 'floor', transform: { position: [0, -0.5, 0], scale: [1, 1, 1] }, components: [
                { type: 'SphereCollider', data: { radius: 1, isTrigger: false } }
            ] }
        ]
    });
    try {
        await supervisor.start(snapshot);
        let state;
        for (let index = 0; index < 120; index += 1) state = await supervisor.tick(0.02);
        assert.ok(state.transforms.find(({ id }) => id === 'body').position[1] > 0.45);
    } finally {
        await supervisor.shutdown();
    }
});

test('generic RigidBody resolves against authored capsule colliders', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    const capsuleSnapshot = JSON.stringify({
        formatVersion: 1,
        gameObjects: [
            { id: 'body', transform: { position: [0, 3, 0], scale: [1, 1, 1] }, components: [
                { type: 'RigidBody', data: { mass: 1, useGravity: true, velocity: [0, 0, 0] } },
                { type: 'BoxCollider', data: { size: [1, 1, 1] } }
            ] },
            { id: 'capsule-platform', transform: { position: [0, -0.5, 0], scale: [2, 1, 2] }, components: [
                { type: 'CapsuleCollider', data: { radius: 0.5, height: 2, center: [0, 0.25, 0] } }
            ] }
        ]
    });
    try {
        await supervisor.start(capsuleSnapshot);
        let state;
        for (let index = 0; index < 140; index += 1) state = await supervisor.tick(0.02);
        assert.equal(state.transforms.find(({ id }) => id === 'body').position[1], 1.25);
    } finally {
        await supervisor.shutdown();
    }
});

test('generic RigidBody honors the authored capsule direction axis', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    const directionalSnapshot = JSON.stringify({
        formatVersion: 1,
        gameObjects: [
            { id: 'body', transform: { position: [2, 3, 0], scale: [1, 1, 1] }, components: [
                { type: 'RigidBody', data: { mass: 1, useGravity: true, velocity: [0, 0, 0] } },
                { type: 'BoxCollider', data: { size: [1, 1, 1] } }
            ] },
            { id: 'x-capsule', transform: { position: [0, 0, 0], scale: [1, 1, 1] }, components: [
                { type: 'CapsuleCollider', data: { radius: 0.5, height: 6, direction: 'X' } }
            ] }
        ]
    });
    try {
        await supervisor.start(directionalSnapshot);
        let state;
        for (let index = 0; index < 140; index += 1) state = await supervisor.tick(0.02);
        assert.equal(state.transforms.find(({ id }) => id === 'body').position[1], 1);
    } finally {
        await supervisor.shutdown();
    }
});

test('supervised RigidBody applies authored drag and frozen position axes', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    const constrainedSnapshot = JSON.stringify({
        formatVersion: 1,
        gameObjects: [{
            id: 'body', transform: { position: [1, 2, 3], scale: [1, 1, 1] }, components: [{
                type: 'RigidBody', data: {
                    mass: 1, useGravity: false, velocity: [4, 3, 2], drag: 1,
                    freezePositionX: true
                }
            }]
        }]
    });
    try {
        await supervisor.start(constrainedSnapshot);
        const first = await supervisor.tick(0.02);
        const second = await supervisor.tick(0.02);
        assert.deepEqual(first.transforms[0].position, [1, 2.06, 3.04]);
        assert.deepEqual(second.transforms[0].position.map(value => Number(value.toFixed(6))), [1, 2.1188, 3.0792]);
    } finally {
        await supervisor.shutdown();
    }
});

test('supervised RigidBody integrates angular velocity, angular drag, and frozen rotation axes', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    const snapshot = JSON.stringify({
        formatVersion: 1,
        gameObjects: [{
            id: 'spinner', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, components: [{
                type: 'RigidBody', data: {
                    mass: 1, useGravity: false, angularVelocity: [1, 2, 3], angularDrag: 1,
                    freezeRotationY: true
                }
            }]
        }]
    });
    try {
        await supervisor.start(snapshot);
        const first = await supervisor.tick(0.02);
        const second = await supervisor.tick(0.02);
        assert.deepEqual(first.transforms[0].rotation, [0.02, 0, 0.06]);
        assert.deepEqual(second.transforms[0].rotation.map(value => Number(value.toFixed(6))), [0.0396, 0, 0.1188]);
    } finally {
        await supervisor.shutdown();
    }
});

test('authored box colliders use world-space size and center for contacts', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    const scaledSnapshot = JSON.stringify({
        formatVersion: 1,
        gameObjects: [
            {
                id: 'body',
                transform: { position: [0.9, 2, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
                components: [
                    { type: 'RigidBody', data: { mass: 1, useGravity: true, velocity: [0, 0, 0] } },
                    { type: 'BoxCollider', data: { size: [1, 1, 1], isTrigger: false } }
                ]
            },
            {
                id: 'scaled-floor',
                transform: { position: [2, -0.5, 0], rotation: [0, 0, 0], scale: [2, 1, 2] },
                components: [{ type: 'BoxCollider', data: { size: [2, 1, 2], center: [-0.1, 0, 0], isTrigger: false } }]
            }
        ]
    });
    await supervisor.start(scaledSnapshot);
    for (let index = 0; index < 10; index += 1) await supervisor.tick(0.1);
    const body = (await supervisor.tick(0.02)).transforms.find(({ id }) => id === 'body');
    assert.equal(body.position[1], 0.5, 'scaled floor geometry must support an overlapping body');
    await supervisor.shutdown();
});

test('runtime collision matrix filters authored body contacts', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    const matrix = new Array(32).fill(0xFFFFFFFF);
    matrix[1] &= ~(1 << 0);
    matrix[0] &= ~(1 << 1);
    const filteredSnapshot = JSON.stringify({
        formatVersion: 1,
        layerCollisionMatrix: matrix,
        gameObjects: [
            { id: 'body', layer: 1, transform: { position: [0, 2, 0], scale: [1, 1, 1] }, components: [
                { type: 'RigidBody', data: { mass: 1, useGravity: true } },
                { type: 'BoxCollider', data: { size: [1, 1, 1] } }
            ] },
            { id: 'floor', layer: 0, transform: { position: [0, -0.5, 0], scale: [4, 1, 4] }, components: [
                { type: 'BoxCollider', data: { size: [1, 1, 1] } }
            ] }
        ]
    });
    await supervisor.start(filteredSnapshot);
    for (let index = 0; index < 10; index += 1) await supervisor.tick(0.1);
    const body = (await supervisor.tick(0.02)).transforms.find(({ id }) => id === 'body');
    assert.ok(body.position[1] < 0.5, 'filtered layers must not create a supporting contact');
    await supervisor.shutdown();
});

test('pause freezes authored state and step advances exactly one frame while remaining paused', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    await supervisor.start(authoredSnapshot);
    const paused = await supervisor.pause();
    assert.equal(paused.state, 'paused');
    await assert.rejects(supervisor.tick(0.02), (error) => error.code === 'INVALID_TRANSITION');
    const stepped = await supervisor.step(0.02);
    assert.equal(stepped.state, 'paused');
    assert.equal(stepped.frame, 1);
    assert.equal(stepped.fixedUpdateCount, 1);
    assert.equal(stepped.transforms[0].rotation[1], 0.08);
    await supervisor.shutdown();
});

test('PlayerController consumes supervised input and resolves against authored floor', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    const playerSnapshot = JSON.stringify({
        formatVersion: 1,
        sceneId: 'input-fixture',
        gameObjects: [
            { id: 'player', transform: { position: [0, 2, 0], scale: [1, 1, 1] }, components: [
                { type: 'PlayerController', data: { moveSpeed: 5, jumpForce: 6, fixedStep: 0.02 } },
                { type: 'CapsuleCollider', data: { radius: 0.5, height: 2 } }
            ] },
            { id: 'floor', transform: { position: [0, -0.5, 0], scale: [10, 1, 10] }, components: [
                { type: 'BoxCollider', data: { size: [10, 1, 10] } }
            ] }
        ]
    });
    try {
        await supervisor.start(playerSnapshot);
        const moved = await supervisor.tick(0.02, { Horizontal: 1 });
        assert.ok(moved.transforms.find(({ id }) => id === 'player').position[0] > 0);
        let grounded;
        for (let index = 0; index < 60; index += 1) grounded = await supervisor.tick(0.02, {});
        assert.equal(grounded.transforms.find(({ id }) => id === 'player').position[1], 1);
    } finally {
        await supervisor.shutdown();
    }
});

test('PlayerController applies mouse-look input to rotation-relative movement', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    const snapshot = JSON.stringify({
        formatVersion: 1, sceneId: 'mouse-look-fixture', gameObjects: [
            { id: 'player', name: 'Player', transform: { position: [0, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, components: [
                { type: 'PlayerController', data: { moveSpeed: 5, lookSensitivity: 0.1, gravity: 0 } },
                { type: 'CapsuleCollider', data: { height: 2, radius: 0.5 } }
            ] }
        ]
    });
    try {
        await supervisor.start(snapshot);
        const frame = await supervisor.tick(0.02, { LookX: 1, Vertical: 1 });
        const player = frame.transforms.find(({ id }) => id === 'player');
        assert.ok(player.rotation[1] < 0);
        assert.ok(player.position[0] < 0, 'forward movement must follow the rotated player heading');
    } finally {
        await supervisor.shutdown();
    }
});

test('supervised gameplay resolves authored collect and finish triggers with score', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    try {
        await supervisor.start(topDownSnapshot);
        let state;
        for (let index = 0; index < 35; index += 1) state = await supervisor.tick(0.02, { Horizontal: 1 });
        assert.equal(state.gameplay.collectedCount, 1);
        assert.equal(state.gameplay.score, 250);
        for (let index = 0; index < 35; index += 1) state = await supervisor.tick(0.02, { Horizontal: 1 });
        assert.equal(state.gameplay.status, 'finished');
    } finally {
        await supervisor.shutdown();
    }
});

test('follow GameplayCamera tracks the supervised player and returns camera state', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    const snapshot = JSON.stringify({
        formatVersion: 1,
        gameObjects: [
            { id: 'player', transform: { position: [0, 1, 0], scale: [1, 1, 1] }, components: [{ type: 'PlayerController', data: { moveSpeed: 5, gravity: 0 } }] },
            { id: 'camera', transform: { position: [0, 6, 8], scale: [1, 1, 1] }, components: [{ type: 'GameplayCamera', data: { mode: 'follow', offset: [0, 6, 8] } }] }
        ]
    });
    try {
        await supervisor.start(snapshot);
        const frame = await supervisor.tick(0.02, { Horizontal: 1 });
        assert.equal(frame.gameplay.camera.mode, 'follow');
        assert.equal(frame.gameplay.camera.position[0], frame.gameplay.player.position[0]);
        assert.equal(frame.transforms.find(({ id }) => id === 'camera').position[0], frame.gameplay.player.position[0]);
    } finally {
        await supervisor.shutdown();
    }
});

test('follow camera consumes clamped vertical look once per rendered frame', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    const snapshot = JSON.stringify({
        formatVersion: 1,
        gameObjects: [
            { id: 'player', transform: { position: [0, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, components: [
                { type: 'PlayerController', data: { moveSpeed: 5, gravity: 0, lookSensitivity: 0.1, maxLookPitch: 45 } }
            ] },
            { id: 'camera', transform: { position: [0, 6, 8], scale: [1, 1, 1] }, components: [
                { type: 'GameplayCamera', data: { mode: 'follow', offset: [0, 6, 8] } }
            ] }
        ]
    });
    try {
        await supervisor.start(snapshot);
        const lookFrame = await supervisor.tick(0.016, { LookX: 1, LookY: 1 });
        assert.equal(Number(lookFrame.transforms.find(({ id }) => id === 'player').rotation[1].toFixed(6)), -0.1,
            'mouse look must not wait for a fixed physics step');
        const frame = await supervisor.tick(0.084, {});
        const player = frame.transforms.find(({ id }) => id === 'player');
        assert.equal(Number(player.rotation[1].toFixed(6)), -0.1, 'mouse delta must not repeat across fixed substeps');
        assert.notEqual(Number(frame.gameplay.camera.position[1].toFixed(6)), 7, 'vertical look must orbit the follow camera');
        const clamped = await supervisor.tick(0.02, { LookY: 100 });
        assert.ok(clamped.gameplay.camera.position.every(Number.isFinite));
    } finally {
        await supervisor.shutdown();
    }
});

test('supervised UI Restart event recreates the authored runtime world', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    try {
        await supervisor.start(topDownSnapshot);
        await supervisor.tick(0.02, { Horizontal: 1 });
        const restarted = await supervisor.uiEvent('Restart');
        assert.equal(restarted.lastUiEvent, 'Restart');
        assert.deepEqual(Array.from(restarted.gameplay.player.position), [0, 0.5, 0]);
        assert.equal(restarted.gameplay.collectedCount, 0);
        assert.equal(restarted.gameplay.status, 'playing');
    } finally {
        await supervisor.shutdown();
    }
});

test('standalone runtime applies cross-object UIEventAction transforms', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    const scene = JSON.stringify({
        formatVersion: 1,
        gameObjects: [
            { id: 'button', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, components: [{ type: 'UIEventAction', data: { eventName: 'Open', action: 'SetRotation', rotation: [0, 1, 0], targetObjectId: 'door' } }] },
            { id: 'door', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, components: [] }
        ]
    });
    try {
        await supervisor.start(scene);
        const result = await supervisor.uiEvent('Open');
        assert.deepEqual(Array.from(result.transforms.find(({ id }) => id === 'door').rotation), [0, 1, 0]);
    } finally {
        await supervisor.shutdown();
    }
});

test('supervised runtime ignores UIEventAction components owned by inactive objects', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    const scene = JSON.stringify({
        formatVersion: 1,
        gameObjects: [
            { id: 'inactive-actions', enabled: false, transform: {}, components: [{
                type: 'UIEventAction', data: { eventName: 'Move', action: 'SetPosition', position: [9, 9, 9], targetObjectId: 'target' }
            }] },
            { id: 'active-actions', transform: {}, components: [{
                type: 'UIEventAction', data: { eventName: 'Move', action: 'SetPosition', position: [2, 3, 4], targetObjectId: 'target' }
            }] },
            { id: 'target', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, components: [] }
        ]
    });
    try {
        await supervisor.start(scene);
        const changed = await supervisor.uiEvent('Move');
        assert.deepEqual(Array.from(changed.transforms.find(({ id }) => id === 'target').position), [2, 3, 4]);
    } finally {
        await supervisor.shutdown();
    }
});

test('supervised SetActive recomputes descendant activity while preserving local disabled state', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    const scene = JSON.stringify({
        formatVersion: 1,
        gameObjects: [
            { id: 'actions', transform: {}, components: [
                { type: 'UIEventAction', data: { eventName: 'Close', action: 'SetActive', active: false, targetObjectId: 'panel' } },
                { type: 'UIEventAction', data: { eventName: 'Open', action: 'SetActive', active: true, targetObjectId: 'panel' } }
            ] },
            { id: 'panel', transform: {}, components: [], children: [
                { id: 'visible-child', transform: {}, components: [] },
                { id: 'authored-hidden', enabled: false, transform: {}, components: [] }
            ] }
        ]
    });
    try {
        await supervisor.start(scene);
        const closed = await supervisor.uiEvent('Close');
        assert.equal(closed.transforms.find(({ id }) => id === 'visible-child').active, false);
        const opened = await supervisor.uiEvent('Open');
        assert.equal(opened.transforms.find(({ id }) => id === 'panel').active, undefined);
        assert.equal(opened.transforms.find(({ id }) => id === 'visible-child').active, undefined);
        assert.equal(opened.transforms.find(({ id }) => id === 'authored-hidden').active, false);
    } finally {
        await supervisor.shutdown();
    }
});

test('supervised SetActive can enable an initially inactive gameplay trigger', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    const scene = JSON.stringify({
        formatVersion: 1,
        gameObjects: [
            { id: 'actions', transform: {}, components: [{
                type: 'UIEventAction', data: { eventName: 'SpawnCollectible', action: 'SetActive', active: true, targetObjectId: 'collectible' }
            }] },
            { id: 'player', transform: { position: [0, 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, components: [
                { type: 'CapsuleCollider', data: { radius: 0.4, height: 1 } },
                { type: 'PlayerController', data: { gravity: 0, requiredCollectibles: 1 } }
            ] },
            { id: 'collectible', enabled: false, tag: 'Collect', transform: { position: [0, 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, components: [
                { type: 'BoxCollider', data: { size: [1, 1, 1], isTrigger: true } }
            ] }
        ]
    });
    try {
        await supervisor.start(scene);
        assert.equal((await supervisor.tick(0.02)).gameplay.collectedCount, 0);
        await supervisor.uiEvent('SpawnCollectible');
        assert.equal((await supervisor.tick(0.02)).gameplay.collectedCount, 1);
    } finally {
        await supervisor.shutdown();
    }
});

test('supervised LoadScene action remains host-owned without toggling objects', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    try {
        await supervisor.start(JSON.stringify({
            formatVersion: 1,
            gameObjects: [{
                id: 'loader', enabled: true, transform: {}, components: [{
                    type: 'UIEventAction', data: {
                        eventName: 'NextLevel', action: 'LoadScene', active: false,
                        scenePath: 'Assets/Scenes/Level2.scene.json'
                    }
                }]
            }]
        }));
        const state = await supervisor.uiEvent('NextLevel');
        assert.equal(state.lastUiEvent, 'NextLevel');
        assert.equal(state.transforms[0].active, undefined);
    } finally {
        await supervisor.shutdown();
    }
});

test('supervised AutoRotate matches the authored speed and axis contract', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    try {
        await supervisor.start(JSON.stringify({
            formatVersion: 1,
            gameObjects: [{ id: 'rotor', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, components: [{ type: 'AutoRotate', data: { speed: 90, axis: [0, 0, 1] } }] }]
        }));
        const state = await supervisor.tick(0.1);
        assert.ok(Math.abs(state.transforms.find(({ id }) => id === 'rotor').rotation[2] - Math.PI / 20) < 1e-6);
    } finally {
        await supervisor.shutdown();
    }
});
