const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createRuntime() {
    const events = [];
    const self = { postMessage: (event) => events.push(event), onmessage: null };
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'engine', 'runtime.worker.js'), 'utf8');
    const context = vm.createContext({ self, JSON, Number, structuredClone });
    context.globalThis = context;
    context.importScripts = (relativePath) => {
        const imported = fs.readFileSync(path.join(__dirname, '..', 'electron', 'runtime', path.basename(relativePath)), 'utf8');
        vm.runInContext(imported, context);
        self.TugberkBehaviourScript = context.TugberkBehaviourScript;
    };
    vm.runInContext(source, context);
    return {
        events,
        send(command, payload = {}, sessionId = 'session-1') {
            self.onmessage({ data: { protocolVersion: 1, sessionId, command, payload } });
            return events.at(-1);
        }
    };
}

test('standalone worker executes authored BehaviourScript lifecycle and UI events', () => {
    const runtime = createRuntime();
    const program = JSON.stringify({
        version: 1, variables: { speed: 5 },
        start: [{ op: 'setPosition', value: [1, 0, 0] }],
        update: [{ op: 'translate', value: [{ multiply: [{ input: 'Horizontal' }, { variable: 'speed' }, { deltaTime: true }] }, 0, 0] }],
        events: { Label: [{ op: 'setText', value: { eventValue: true } }] }
    });
    runtime.send('start', { snapshot: JSON.stringify({ formatVersion: 1, gameObjects: [{
        id: 'actor', name: 'Actor', transform: {}, components: [
            { type: 'BehaviourScript', data: { program } }, { type: 'UIText', data: { text: '' } }
        ]
    }] }) });
    const moved = runtime.send('tick', { deltaTime: 0.1, input: { Horizontal: 1 } });
    assert.equal(moved.transforms[0].position[0], 1.5);
    assert.equal(moved.behaviourScripts.instanceCount, 1);
    const labeled = runtime.send('uiEvent', { name: 'Label', value: 'Ready' });
    assert.equal(labeled.uiText[0].text, 'Ready');
    assert.deepEqual(Array.from(labeled.behaviourScripts.diagnostics), []);
});

test('standalone worker preserves authored action press and release edges', () => {
    const runtime = createRuntime();
    const program = JSON.stringify({
        version: 1,
        update: [{
            op: 'if', condition: { buttonDown: 'Fire' },
            then: [{ op: 'setText', value: 'down' }],
            else: [{ op: 'if', condition: { buttonUp: 'Fire' }, then: [{ op: 'setText', value: 'up' }] }]
        }]
    });
    runtime.send('start', { snapshot: JSON.stringify({ formatVersion: 1, gameObjects: [{
        id: 'actor', transform: {}, components: [
            { type: 'BehaviourScript', data: { program } }, { type: 'UIText', data: { text: '' } }
        ]
    }] }) });
    const pressed = runtime.send('tick', { deltaTime: 0.02, input: { Fire: true, '__buttonDown:Fire': true } });
    assert.equal(pressed.uiText[0].text, 'down');
    const released = runtime.send('tick', { deltaTime: 0.02, input: { Fire: false, '__buttonUp:Fire': true } });
    assert.equal(released.uiText[0].text, 'up');
});

test('standalone worker destroy removes a hierarchy until runtime restart', () => {
    const runtime = createRuntime();
    const program = JSON.stringify({
        version: 1,
        events: {
            Remove: [{ op: 'destroy', target: 'victim' }],
            Restore: [{ op: 'setActive', target: 'victim', value: true }]
        }
    });
    const snapshot = JSON.stringify({ formatVersion: 1, gameObjects: [
        { id: 'actor', transform: {}, components: [{ type: 'BehaviourScript', data: { program } }] },
        { id: 'victim', transform: {}, components: [{ type: 'BoxCollider', data: {} }], children: [
            { id: 'victim-child', transform: {}, components: [] }
        ] }
    ] });
    runtime.send('start', { snapshot });
    const removed = runtime.send('uiEvent', { name: 'Remove' });
    assert.equal(removed.transforms.find(({ id }) => id === 'victim').active, false);
    assert.equal(removed.transforms.find(({ id }) => id === 'victim-child').active, false);
    const restoreAttempt = runtime.send('uiEvent', { name: 'Restore' });
    assert.equal(restoreAttempt.transforms.find(({ id }) => id === 'victim').active, false);
    const restarted = runtime.send('start', { snapshot }, 'session-restarted');
    assert.notEqual(restarted.transforms.find(({ id }) => id === 'victim').active, false);
});

test('standalone BehaviourScript receives trigger enter, stay and exit callbacks', () => {
    const runtime = createRuntime();
    const program = JSON.stringify({
        version: 1,
        events: {
            triggerEnter: [{ op: 'setText', value: { eventField: 'otherTag' } }],
            triggerStay: [{ op: 'setText', value: 'stay' }],
            triggerExit: [{ op: 'setText', value: 'exit' }],
            MoveAway: [{ op: 'setPosition', value: [10, 0, 0] }]
        }
    });
    runtime.send('start', { snapshot: JSON.stringify({ formatVersion: 1, gameObjects: [
        { id: 'actor', name: 'Actor', transform: {}, components: [
            { type: 'BoxCollider', data: { size: [1, 1, 1] } },
            { type: 'UIText', data: { text: '' } },
            { type: 'BehaviourScript', data: { program } }
        ] },
        { id: 'pickup', name: 'Pickup', tag: 'Pickup', transform: {}, components: [
            { type: 'BoxCollider', data: { size: [1, 1, 1], isTrigger: true } }
        ] }
    ] }) });
    assert.equal(runtime.send('tick', { deltaTime: 0.02 }).uiText[0].text, 'Pickup');
    assert.equal(runtime.send('tick', { deltaTime: 0.02 }).uiText[0].text, 'stay');
    runtime.send('uiEvent', { name: 'MoveAway' });
    assert.equal(runtime.send('tick', { deltaTime: 0.02 }).uiText[0].text, 'exit');
});

test('start, pause, resume, tick, and stop have deterministic states', () => {
    const runtime = createRuntime();
    assert.equal(runtime.send('start', { snapshot: JSON.stringify({ formatVersion: 1, gameObjects: [] }) }).state, 'running');
    assert.equal(runtime.send('pause').state, 'paused');
    assert.equal(runtime.send('resume').state, 'running');
    assert.equal(runtime.send('tick', { deltaTime: 0.016 }).frame, 1);
    assert.equal(runtime.send('stop').state, 'idle');
});

test('restart replaces disposable runtime state', () => {
    const runtime = createRuntime();
    runtime.send('start', { snapshot: JSON.stringify({ formatVersion: 1 }) });
    assert.equal(runtime.send('tick', { deltaTime: 0.02 }).frame, 1);
    assert.equal(runtime.send('start', { snapshot: JSON.stringify({ formatVersion: 1 }) }, 'session-2').frame, 0);
});

test('invalid snapshots and frame deltas become bounded error envelopes', () => {
    const badSnapshot = createRuntime().send('start', { snapshot: '{' });
    assert.equal(badSnapshot.error.code, 'INVALID_SNAPSHOT');
    assert.equal(badSnapshot.error.message, 'The persisted scene snapshot could not be loaded.');

    const runtime = createRuntime();
    runtime.send('start', { snapshot: '{}' });
    assert.equal(runtime.send('tick', { deltaTime: 2 }).error.code, 'INVALID_DELTA');
});

test('heartbeat reports liveness without advancing deterministic simulation state', () => {
    const runtime = createRuntime();
    runtime.send('start', { snapshot: '{}' });
    runtime.send('tick', { deltaTime: 0.02 });
    const heartbeat = runtime.send('ping');
    assert.equal(heartbeat.type, 'heartbeat');
    assert.equal(heartbeat.state, 'running');
    assert.equal(heartbeat.frame, 1);
    assert.equal(heartbeat.time, 0.02);
});

test('invalid lifecycle transitions fail with a stable bounded error', () => {
    const runtime = createRuntime();
    runtime.send('start', { snapshot: '{}' });
    const invalidResume = runtime.send('resume');
    assert.equal(invalidResume.type, 'error');
    assert.equal(invalidResume.error.code, 'INVALID_TRANSITION');
    assert.equal(invalidResume.error.message, 'The runtime lifecycle transition is invalid.');
});

test('stale session commands cannot mutate a replacement session', () => {
    const runtime = createRuntime();
    runtime.send('start', { snapshot: '{}' }, 'session-1');
    runtime.send('stop', {}, 'session-1');
    runtime.send('start', { snapshot: '{}' }, 'session-2');
    const before = runtime.events.length;
    runtime.send('tick', { deltaTime: 0.02 }, 'session-1');
    assert.equal(runtime.events.length, before);
    assert.equal(runtime.send('tick', { deltaTime: 0.02 }, 'session-2').frame, 1);
});

test('authored UI events are session-scoped and work without a gameplay controller', () => {
    const runtime = createRuntime();
    const started = runtime.send('start', { snapshot: JSON.stringify({ formatVersion: 1, gameObjects: [] }) });
    assert.equal(started.lastUiEvent, null);
    const clicked = runtime.send('uiEvent', { name: 'StartGame', value: { index: 2, value: 'Hard' } });
    assert.equal(clicked.state, 'running');
    assert.equal(clicked.lastUiEvent, 'StartGame');
    assert.deepEqual(clicked.lastUiEventPayload, { index: 2, value: 'Hard' });
    assert.equal(clicked.gameplay, null);
    const stopped = runtime.send('stop');
    assert.equal(stopped.lastUiEvent, null);
    assert.equal(stopped.lastUiEventPayload, null);
});

test('invalid UI event names fail with a bounded error', () => {
    const runtime = createRuntime();
    runtime.send('start', { snapshot: '{}' });
    assert.equal(runtime.send('uiEvent', { name: '' }).error.code, 'INVALID_UI_EVENT');
});

test('Restart authored UI event resets gameplay state and reactivates triggers', () => {
    const runtime = createRuntime();
    const snapshot = {
        formatVersion: 1,
        gameObjects: [
            { id: 'player', transform: { position: [0, 2, 0], scale: [1, 1, 1] }, components: [
                { type: 'PlayerController', data: { fixedStep: 0.02 } },
                { type: 'CapsuleCollider', data: { radius: 0.5, height: 2 } }
            ] },
            { id: 'floor', transform: { position: [0, -0.5, 0], scale: [10, 1, 10] }, components: [
                { type: 'BoxCollider', data: { size: [10, 1, 10] } }
            ] }
        ]
    };
    runtime.send('start', { snapshot: JSON.stringify(snapshot) });
    runtime.send('tick', { deltaTime: 0.02, input: { Horizontal: 1 } });
    const restarted = runtime.send('uiEvent', { name: 'Restart' });
    assert.deepEqual(Array.from(restarted.gameplay.player.position), [0, 2, 0]);
    assert.equal(restarted.gameplay.collectedCount, 0);
    assert.equal(restarted.gameplay.status, 'playing');
    assert.equal(restarted.lastUiEvent, 'Restart');
});

test('standalone player controller grounds on an authored capsule collider', () => {
    const runtime = createRuntime();
    const snapshot = {
        formatVersion: 1,
        gameObjects: [
            { id: 'player', transform: { position: [0, 3, 0], scale: [1, 1, 1] }, components: [
                { type: 'PlayerController', data: { fixedStep: 0.02 } },
                { type: 'CapsuleCollider', data: { radius: 0.5, height: 2 } }
            ] },
            { id: 'capsule-platform', transform: { position: [0, -0.5, 0], scale: [2, 1, 2] }, components: [
                { type: 'CapsuleCollider', data: { radius: 0.5, height: 2, center: [0, 0.25, 0] } }
            ] }
        ]
    };
    runtime.send('start', { snapshot: JSON.stringify(snapshot) });
    let state;
    for (let index = 0; index < 140; index += 1) state = runtime.send('tick', { deltaTime: 0.02 });
    assert.equal(state.gameplay.player.grounded, true);
    assert.equal(state.gameplay.player.position[1], 1.75);
});

test('standalone follow camera consumes clamped vertical look once per rendered frame', () => {
    const runtime = createRuntime();
    const snapshot = {
        formatVersion: 1,
        gameObjects: [
            { id: 'player', transform: { position: [0, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, components: [
                { type: 'PlayerController', data: { fixedStep: 0.02, gravity: 0, lookSensitivity: 0.1, maxLookPitch: 45 } }
            ] },
            { id: 'camera', transform: { position: [0, 6, 8], scale: [1, 1, 1] }, components: [
                { type: 'GameplayCamera', data: { mode: 'follow', offset: [0, 6, 8] } }
            ] }
        ]
    };
    runtime.send('start', { snapshot: JSON.stringify(snapshot) });
    const lookFrame = runtime.send('tick', { deltaTime: 0.016, input: { LookX: 1, LookY: 1 } });
    assert.equal(Number(lookFrame.transforms.find(({ id }) => id === 'player').rotation[1].toFixed(6)), -0.1,
        'mouse look must not wait for a fixed physics step');
    const frame = runtime.send('tick', { deltaTime: 0.084, input: {} });
    const player = frame.transforms.find(({ id }) => id === 'player');
    assert.equal(Number(player.rotation[1].toFixed(6)), -0.1, 'mouse delta must not repeat across fixed substeps');
    assert.notEqual(Number(frame.gameplay.camera.position[1].toFixed(6)), 7, 'vertical look must orbit the follow camera');
    const clamped = runtime.send('tick', { deltaTime: 0.02, input: { LookY: 100 } });
    assert.ok(clamped.gameplay.camera.position.every(Number.isFinite));
});

test('authored UIEventAction changes object activation in play runtime', () => {
    const runtime = createRuntime();
    const snapshot = {
        formatVersion: 1,
        gameObjects: [{
            id: 'panel', enabled: true,
            transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
            components: [{ type: 'UIEventAction', data: { eventName: 'ClosePanel', action: 'SetActive', active: false } }]
        }]
    };
    runtime.send('start', { snapshot: JSON.stringify(snapshot) });
    const changed = runtime.send('uiEvent', { name: 'ClosePanel' });
    assert.equal(changed.state, 'running');
    assert.equal(changed.lastUiEvent, 'ClosePanel');
    assert.equal(changed.transforms.find((entry) => entry.id === 'panel').active, false);
});

test('standalone SetActive recomputes descendants without losing their authored local state', () => {
    const runtime = createRuntime();
    const snapshot = {
        formatVersion: 1,
        gameObjects: [{
            id: 'actions', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, components: [
                { type: 'UIEventAction', data: { eventName: 'Close', action: 'SetActive', active: false, targetObjectId: 'panel' } },
                { type: 'UIEventAction', data: { eventName: 'Open', action: 'SetActive', active: true, targetObjectId: 'panel' } }
            ]
        }, {
            id: 'panel', enabled: true,
            transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, components: [], children: [
                { id: 'visible-child', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, components: [] },
                { id: 'authored-hidden', enabled: false, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, components: [] }
            ]
        }]
    };
    runtime.send('start', { snapshot: JSON.stringify(snapshot) });
    const closed = runtime.send('uiEvent', { name: 'Close' });
    assert.equal(closed.transforms.find(({ id }) => id === 'visible-child').active, false);
    const opened = runtime.send('uiEvent', { name: 'Open' });
    assert.equal(opened.transforms.find(({ id }) => id === 'panel').active, undefined);
    assert.equal(opened.transforms.find(({ id }) => id === 'visible-child').active, undefined);
    assert.equal(opened.transforms.find(({ id }) => id === 'authored-hidden').active, false);
});

test('standalone SetActive can enable an initially inactive gameplay trigger', () => {
    const runtime = createRuntime();
    const snapshot = {
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
    };
    runtime.send('start', { snapshot: JSON.stringify(snapshot) });
    assert.equal(runtime.send('tick', { deltaTime: 0.02 }).gameplay.collectedCount, 0);
    runtime.send('uiEvent', { name: 'SpawnCollectible' });
    assert.equal(runtime.send('tick', { deltaTime: 0.02 }).gameplay.collectedCount, 1);
});

test('authored UIEventAction can move an object in play runtime', () => {
    const runtime = createRuntime();
    const snapshot = {
        formatVersion: 1,
        gameObjects: [{
            id: 'door',
            transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
            components: [{ type: 'UIEventAction', data: { eventName: 'OpenDoor', action: 'SetPosition', position: [3, 2, 1] } }]
        }]
    };
    runtime.send('start', { snapshot: JSON.stringify(snapshot) });
    const changed = runtime.send('uiEvent', { name: 'OpenDoor' });
    assert.deepEqual(changed.transforms.find((entry) => entry.id === 'door').position, [3, 2, 1]);
});

test('inactive UIEventAction owners cannot handle a matching runtime event', () => {
    const runtime = createRuntime();
    const snapshot = {
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
    };
    runtime.send('start', { snapshot: JSON.stringify(snapshot) });
    const changed = runtime.send('uiEvent', { name: 'Move' });
    assert.deepEqual(changed.transforms.find(({ id }) => id === 'target').position, [2, 3, 4]);
});

test('authored UIEventAction updates authored UI text state', () => {
    const runtime = createRuntime();
    const snapshot = {
        formatVersion: 1,
        gameObjects: [{
            id: 'message',
            transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
            components: [
                { type: 'UIText', data: { text: 'Closed' } },
                { type: 'UIEventAction', data: { eventName: 'OpenDoor', action: 'SetText', text: 'State: {value}', useEventValue: true } }
            ]
        }]
    };
    runtime.send('start', { snapshot: JSON.stringify(snapshot) });
    const changed = runtime.send('uiEvent', { name: 'OpenDoor', value: 'Open' });
    assert.equal(changed.uiText.length, 1);
    assert.equal(changed.uiText[0].id, 'message:UIText');
    assert.equal(changed.uiText[0].text, 'State: Open');
});

test('authored UIEventAction can rotate an object in play runtime', () => {
    const runtime = createRuntime();
    const snapshot = {
        formatVersion: 1,
        gameObjects: [{
            id: 'door',
            transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
            components: [{ type: 'UIEventAction', data: { eventName: 'OpenDoor', action: 'SetRotation', rotation: [0, 1.5, 0] } }]
        }]
    };
    runtime.send('start', { snapshot: JSON.stringify(snapshot) });
    const changed = runtime.send('uiEvent', { name: 'OpenDoor' });
    assert.deepEqual(changed.transforms.find((entry) => entry.id === 'door').rotation, [0, 1.5, 0]);
});

test('authored UIEventAction can scale an object in play runtime', () => {
    const runtime = createRuntime();
    const snapshot = {
        formatVersion: 1,
        gameObjects: [{
            id: 'target',
            transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
            components: [{ type: 'UIEventAction', data: { eventName: 'Grow', action: 'SetScale', scale: [2, 1, 0.5] } }]
        }]
    };
    runtime.send('start', { snapshot: JSON.stringify(snapshot) });
    const changed = runtime.send('uiEvent', { name: 'Grow' });
    assert.deepEqual(changed.transforms.find((entry) => entry.id === 'target').scale, [2, 1, 0.5]);
});

test('authored UIEventAction can target another object', () => {
    const runtime = createRuntime();
    const snapshot = {
        formatVersion: 1,
        gameObjects: [
            { id: 'button', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, components: [{ type: 'UIEventAction', data: { eventName: 'Open', action: 'SetActive', active: false, targetObjectId: 'panel' } }] },
            { id: 'panel', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, components: [] }
        ]
    };
    runtime.send('start', { snapshot: JSON.stringify(snapshot) });
    const changed = runtime.send('uiEvent', { name: 'Open' });
    assert.equal(changed.transforms.find((entry) => entry.id === 'button').active, undefined);
    assert.equal(changed.transforms.find((entry) => entry.id === 'panel').active, false);
});

test('authored UIEventAction can set a rigidbody velocity', () => {
    const runtime = createRuntime();
    const snapshot = {
        formatVersion: 1,
        gameObjects: [{
            id: 'ball',
            transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
            components: [
                { type: 'RigidBody', data: { velocity: [0, 0, 0], useGravity: false } },
                { type: 'UIEventAction', data: { eventName: 'Launch', action: 'SetVelocity', velocity: [4, 0, 0] } }
            ]
        }]
    };
    runtime.send('start', { snapshot: JSON.stringify(snapshot) });
    runtime.send('uiEvent', { name: 'Launch' });
    const moved = runtime.send('tick', { deltaTime: 0.02 });
    assert.ok(moved.transforms.find((entry) => entry.id === 'ball').position[0] > 0);
});

test('LoadScene UIEventAction is host-owned and does not mutate its GameObject', () => {
    const runtime = createRuntime();
    runtime.send('start', { snapshot: JSON.stringify({
        formatVersion: 1,
        gameObjects: [{
            id: 'loader', enabled: true, transform: {}, components: [{
                type: 'UIEventAction', data: {
                    eventName: 'NextLevel', action: 'LoadScene', active: false,
                    scenePath: 'Assets/Scenes/Level2.scene.json'
                }
            }]
        }]
    }) });
    const state = runtime.send('uiEvent', { name: 'NextLevel' });
    assert.equal(state.lastUiEvent, 'NextLevel');
    assert.equal(state.transforms[0].active, undefined);
});

test('standalone runtime publishes authored non-player transform updates', () => {
    const runtime = createRuntime();
    const snapshot = {
        formatVersion: 1,
        gameObjects: [{
            id: 'rotor',
            transform: { position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] },
            components: [{ type: 'AutoRotate', data: { axis: [0, 1, 0], speed: 90 } }]
        }]
    };
    const started = runtime.send('start', { snapshot: JSON.stringify(snapshot) });
    assert.deepEqual(JSON.parse(JSON.stringify(started.transforms[0])), {
        id: 'rotor', position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1]
    });
    const advanced = runtime.send('tick', { deltaTime: 0.05 });
    assert.equal(advanced.transforms[0].rotation[1], Math.PI / 40);
});

test('standalone runtime honors disabled components and disabled parent subtrees', () => {
    const runtime = createRuntime();
    const snapshot = {
        formatVersion: 1,
        gameObjects: [
            {
                id: 'disabled-root',
                enabled: false,
                transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
                components: [{ type: 'AutoRotate', data: { speed: 90 } }],
                children: [{
                    id: 'disabled-child',
                    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
                    components: [{ type: 'AutoRotate', data: { speed: 90 } }]
                }]
            },
            {
                id: 'disabled-component',
                transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
                components: [{ type: 'AutoRotate', data: { enabled: false, speed: 90 } }]
            }
        ]
    };
    runtime.send('start', { snapshot: JSON.stringify(snapshot) });
    const advanced = runtime.send('tick', { deltaTime: 0.05 });
    assert.deepEqual(Array.from(advanced.transforms, (object) => object.rotation[1]), [0, 0, 0]);
});

test('standalone rigidbody preserves velocity between frames', () => {
    const runtime = createRuntime();
    const snapshot = {
        formatVersion: 1,
        gameObjects: [{
            id: 'body',
            transform: { position: [0, 2, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
            components: [{ type: 'RigidBody', data: { velocity: [0, 0, 0], drag: 0 } }]
        }]
    };
    runtime.send('start', { snapshot: JSON.stringify(snapshot) });
    const first = runtime.send('tick', { deltaTime: 0.1 });
    const second = runtime.send('tick', { deltaTime: 0.1 });
    assert.ok(second.transforms[0].position[1] < first.transforms[0].position[1]);
});

test('standalone RigidBody matches authored drag and frozen position axes', () => {
    const runtime = createRuntime();
    const snapshot = {
        formatVersion: 1,
        gameObjects: [{
            id: 'body', transform: { position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] }, components: [{
                type: 'RigidBody', data: {
                    mass: 1, useGravity: false, velocity: [4, 3, 2], drag: 1,
                    freezePositionX: true
                }
            }]
        }]
    };
    runtime.send('start', { snapshot: JSON.stringify(snapshot) });
    const first = runtime.send('tick', { deltaTime: 0.02 });
    const second = runtime.send('tick', { deltaTime: 0.02 });
    assert.deepEqual(Array.from(first.transforms[0].position), [1, 2.06, 3.04]);
    assert.deepEqual(Array.from(second.transforms[0].position, value => Number(value.toFixed(6))), [1, 2.1188, 3.0792]);
});

test('standalone RigidBody integrates angular velocity, angular drag, and frozen rotation axes', () => {
    const runtime = createRuntime();
    const snapshot = {
        formatVersion: 1,
        gameObjects: [{
            id: 'spinner', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, components: [{
                type: 'RigidBody', data: {
                    mass: 1, useGravity: false, angularVelocity: [1, 2, 3], angularDrag: 1,
                    freezeRotationY: true
                }
            }]
        }]
    };
    runtime.send('start', { snapshot: JSON.stringify(snapshot) });
    const first = runtime.send('tick', { deltaTime: 0.02 });
    const second = runtime.send('tick', { deltaTime: 0.02 });
    assert.deepEqual(Array.from(first.transforms[0].rotation), [0.02, 0, 0.06]);
    assert.deepEqual(Array.from(second.transforms[0].rotation, value => Number(value.toFixed(6))), [0.0396, 0, 0.1188]);
});

test('standalone generic RigidBody resolves capsule contacts and collision layers', () => {
    const createSnapshot = (filterLayers) => {
        const matrix = new Array(32).fill(0xFFFFFFFF);
        if (filterLayers) {
            matrix[0] &= ~(1 << 1);
            matrix[1] &= ~(1 << 0);
        }
        return {
            formatVersion: 1,
            layerCollisionMatrix: matrix,
            gameObjects: [
                { id: 'body', layer: 1, transform: { position: [0, 3, 0], scale: [1, 1, 1] }, components: [
                    { type: 'RigidBody', data: { mass: 1, useGravity: true, velocity: [0, 0, 0] } },
                    { type: 'BoxCollider', data: { size: [1, 1, 1] } }
                ] },
                { id: 'platform', layer: 0, transform: { position: [0, -0.5, 0], scale: [2, 1, 2] }, components: [
                    { type: 'CapsuleCollider', data: { radius: 0.5, height: 2, center: [0, 0.25, 0] } }
                ] }
            ]
        };
    };
    const colliding = createRuntime();
    colliding.send('start', { snapshot: JSON.stringify(createSnapshot(false)) });
    let collidingState;
    for (let index = 0; index < 140; index += 1) collidingState = colliding.send('tick', { deltaTime: 0.02 });
    assert.equal(collidingState.transforms.find(({ id }) => id === 'body').position[1], 1.25);

    const filtered = createRuntime();
    filtered.send('start', { snapshot: JSON.stringify(createSnapshot(true)) });
    let filteredState;
    for (let index = 0; index < 140; index += 1) filteredState = filtered.send('tick', { deltaTime: 0.02 });
    assert.ok(filteredState.transforms.find(({ id }) => id === 'body').position[1] < 0);
});

test('standalone generic physics honors the authored capsule direction axis', () => {
    const runtime = createRuntime();
    const snapshot = {
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
    };
    runtime.send('start', { snapshot: JSON.stringify(snapshot) });
    let state;
    for (let index = 0; index < 140; index += 1) state = runtime.send('tick', { deltaTime: 0.02 });
    assert.equal(state.transforms.find(({ id }) => id === 'body').position[1], 1);
});

test('standalone generic physics is invariant to equivalent frame chunking', () => {
    const snapshot = JSON.stringify({
        formatVersion: 1,
        gameObjects: [{
            id: 'body', transform: { position: [0, 2, 0], scale: [1, 1, 1] }, components: [{
                type: 'RigidBody', data: { mass: 1, useGravity: true, velocity: [1, 0, 0], drag: 0.25 }
            }]
        }]
    });
    const coarse = createRuntime();
    coarse.send('start', { snapshot });
    const coarseState = coarse.send('tick', { deltaTime: 0.1 });

    const fine = createRuntime();
    fine.send('start', { snapshot });
    let fineState;
    for (let index = 0; index < 5; index += 1) fineState = fine.send('tick', { deltaTime: 0.02 });

    const rounded = state => Array.from(state.transforms[0].position, value => Number(value.toFixed(8)));
    assert.deepEqual(rounded(coarseState), rounded(fineState));

    const accumulated = createRuntime();
    accumulated.send('start', { snapshot });
    const beforeStep = accumulated.send('tick', { deltaTime: 0.01 });
    const afterStep = accumulated.send('tick', { deltaTime: 0.01 });
    assert.deepEqual(Array.from(beforeStep.transforms[0].position), [0, 2, 0]);
    assert.notDeepEqual(Array.from(afterStep.transforms[0].position), [0, 2, 0]);
});
