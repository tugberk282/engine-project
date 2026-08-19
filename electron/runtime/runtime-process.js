'use strict';

const { createHash } = require('node:crypto');
const { validateRuntimeSnapshot } = require('./snapshot-validator');

const PROTOCOL_VERSION = 1;
let sessionId = '';
let state = 'idle';
let frame = 0;
let timeMicros = 0;
let snapshot = null;
let world = null;
let fixedAccumulatorMicros = 0;

const FIXED_DELTA_MICROS = 20_000;
const MAX_FIXED_STEPS_PER_FRAME = 5;

function finiteNumber(value, fallback = 0) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function vector3(value, fallback) {
    if (!Array.isArray(value) || value.length < 3) return [...fallback];
    return [finiteNumber(value[0], fallback[0]), finiteNumber(value[1], fallback[1]), finiteNumber(value[2], fallback[2])];
}

function createRuntimeObject(source, parentActive = true) {
    const transform = source.transform && typeof source.transform === 'object' ? source.transform : {};
    const active = parentActive && source.enabled !== false;
    const runtimeObject = {
        id: typeof source.id === 'string' ? source.id : '',
        active,
        transform: {
            position: vector3(transform.position, [0, 0, 0]),
            rotation: vector3(transform.rotation, [0, 0, 0]),
            scale: vector3(transform.scale, [1, 1, 1])
        },
        components: Array.isArray(source.components)
            ? source.components.filter((component) => component && typeof component === 'object').map((component) => ({
                type: component.type,
                enabled: component.data?.enabled !== false,
                data: component.data && typeof component.data === 'object' ? structuredClone(component.data) : {}
            }))
            : [],
        children: []
    };
    runtimeObject.children = Array.isArray(source.children)
        ? source.children.map((child) => createRuntimeObject(child, active))
        : [];
    return runtimeObject;
}

function flattenRuntimeObjects(objects, target = []) {
    for (const object of objects) {
        target.push(object);
        flattenRuntimeObjects(object.children, target);
    }
    return target;
}

function createWorld(root) {
    const roots = (root.gameObjects || []).map((object) => createRuntimeObject(object));
    return { roots, objects: flattenRuntimeObjects(roots), updateCount: 0, fixedUpdateCount: 0 };
}

function componentDataNumber(component, key, fallback) {
    return finiteNumber(component.data?.[key], fallback);
}

function runUpdate(runtimeObject, deltaTime) {
    if (!runtimeObject.active) return;
    for (const component of runtimeObject.components) {
        if (!component.enabled) continue;
        if (component.type === 'AutoRotate') {
            runtimeObject.transform.rotation[1] += componentDataNumber(component, 'rotationSpeed', 2) * deltaTime;
        }
    }
}

function runFixedUpdate(runtimeObject, fixedDeltaTime) {
    if (!runtimeObject.active) return;
    for (const component of runtimeObject.components) {
        if (!component.enabled || component.type !== 'RigidBody') continue;
        const mass = componentDataNumber(component, 'mass', 1);
        const isKinematic = component.data?.isKinematic === true;
        if (mass <= 0 || isKinematic) continue;
        const velocity = vector3(component.data?.velocity, [0, 0, 0]);
        if (component.data?.useGravity !== false) velocity[1] -= 9.81 * fixedDeltaTime;
        runtimeObject.transform.position[0] += velocity[0] * fixedDeltaTime;
        runtimeObject.transform.position[1] += velocity[1] * fixedDeltaTime;
        runtimeObject.transform.position[2] += velocity[2] * fixedDeltaTime;
        component.data.velocity = velocity;
    }
}

function runtimeFrame() {
    return {
        state,
        frame,
        timeMicros,
        fixedUpdateCount: world?.fixedUpdateCount || 0,
        updateCount: world?.updateCount || 0,
        transforms: world ? world.objects.map((object) => ({
            id: object.id,
            position: object.transform.position,
            rotation: object.transform.rotation,
            scale: object.transform.scale
        })) : []
    };
}

function advance(deltaTime) {
    const deltaMicros = Math.round(deltaTime * 1_000_000);
    frame += 1;
    timeMicros += deltaMicros;
    fixedAccumulatorMicros += deltaMicros;
    let fixedSteps = 0;
    while (fixedAccumulatorMicros >= FIXED_DELTA_MICROS && fixedSteps < MAX_FIXED_STEPS_PER_FRAME) {
        for (const object of world.objects) runFixedUpdate(object, FIXED_DELTA_MICROS / 1_000_000);
        world.fixedUpdateCount += 1;
        fixedAccumulatorMicros -= FIXED_DELTA_MICROS;
        fixedSteps += 1;
    }
    if (fixedSteps === MAX_FIXED_STEPS_PER_FRAME) fixedAccumulatorMicros = 0;
    for (const object of world.objects) runUpdate(object, deltaTime);
    world.updateCount += 1;
    return runtimeFrame();
}

function reply(requestId, result) {
    if (process.send) process.send({ protocolVersion: PROTOCOL_VERSION, requestId, sessionId, ...result });
}

function failure(requestId, code, message) {
    reply(requestId, { ok: false, error: { code, message } });
}

process.on('message', (message) => {
    if (!message || message.protocolVersion !== PROTOCOL_VERSION) return;
    const { requestId, command, payload = {}, sessionId: requestedSession } = message;
    if (command === 'ping') {
        reply(requestId, { ok: true, value: { state, frame, timeMicros } });
        return;
    }
    if (command === 'start') {
        sessionId = requestedSession;
        try {
            const { root: parsed } = validateRuntimeSnapshot(payload.snapshot);
            snapshot = parsed;
            world = createWorld(parsed);
            state = 'running';
            frame = 0;
            timeMicros = 0;
            fixedAccumulatorMicros = 0;
            const snapshotHash = createHash('sha256').update(payload.snapshot).digest('hex');
            reply(requestId, { ok: true, value: { ...runtimeFrame(), snapshotHash } });
        } catch (error) {
            failure(requestId, error?.code || 'INVALID_SNAPSHOT', error?.message || 'The persisted scene snapshot could not be loaded.');
        }
        return;
    }
    if (requestedSession !== sessionId || state === 'idle' || state === 'failed') {
        return failure(requestId, 'STALE_RUNTIME_SESSION', 'The runtime session is no longer active.');
    }
    if (command === 'pause' && state === 'running') state = 'paused';
    else if (command === 'resume' && state === 'paused') state = 'running';
    else if ((command === 'tick' && state === 'running') || (command === 'step' && state === 'paused')) {
        const deltaTime = Number(payload.deltaTime);
        if (!Number.isFinite(deltaTime) || deltaTime < 0 || deltaTime > 0.1) {
            return failure(requestId, 'INVALID_DELTA', 'The runtime frame delta is outside the supported range.');
        }
        return reply(requestId, { ok: true, value: advance(deltaTime) });
    } else if (command === 'stop') {
        snapshot = null;
        world = null;
        state = 'idle';
    } else {
        return failure(requestId, 'INVALID_TRANSITION', 'The runtime lifecycle transition is invalid.');
    }
    reply(requestId, { ok: true, value: runtimeFrame() });
    if (command === 'stop') sessionId = '';
});

process.on('disconnect', () => process.exit(0));
