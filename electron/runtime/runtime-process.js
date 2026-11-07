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
let lastUiEvent = null;
let lastUiEventPayload = null;

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
        tag: typeof source.tag === 'string' ? source.tag : '',
        layer: Number.isInteger(source.layer) && source.layer >= 0 && source.layer < 32 ? source.layer : 0,
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
    if (runtimeObject.components.some((component) => component.type === 'PlayerController')) {
        runtimeObject.controllerState = {
            velocity: [0, 0, 0], grounded: false, jumpWasHeld: false,
            yaw: finiteNumber(runtimeObject.transform.rotation[1], 0),
            spawn: [...runtimeObject.transform.position]
        };
    }
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
    const objects = flattenRuntimeObjects(roots);
    const player = objects.find((object) => componentOf(object, 'PlayerController')) || null;
    const controller = player ? componentOf(player, 'PlayerController') : null;
    const uiObject = objects.find((object) => componentOf(object, 'GameplayUI'));
    const ui = uiObject ? componentOf(uiObject, 'GameplayUI') : null;
    const cameraObject = objects.find((object) => componentOf(object, 'GameplayCamera')) || null;
    const cameraComponent = cameraObject ? componentOf(cameraObject, 'GameplayCamera') : null;
    const triggers = objects.filter((object) => object.active && worldCollider(object)?.data?.isTrigger === true)
        .map((object) => ({ object, active: true, kind: object.tag === 'Finish' ? 'finish' : object.tag === 'Lose' ? 'lose' : object.tag === 'Collect' ? 'collect' : 'trigger' }));
    const authoredMatrix = root.layerCollisionMatrix || root.projectSettings?.collisionMatrix;
    const collisionMatrix = Array.from({ length: 32 }, (_, index) => {
        const value = Array.isArray(authoredMatrix) ? Number(authoredMatrix[index]) : NaN;
        return Number.isFinite(value) ? value >>> 0 : 0xFFFFFFFF;
    });
    return {
        roots, objects, updateCount: 0, fixedUpdateCount: 0, player, triggers, cameraObject, collisionMatrix,
        camera: cameraComponent ? { mode: cameraComponent.data?.mode === 'fixed' ? 'fixed' : 'follow', offset: vector3(cameraComponent.data?.offset, [0, 6, 8]), position: [...cameraObject.transform.position] } : null,
        gameplay: player ? { status: 'playing', collectedCount: 0, respawnCount: 0, requiredCollectibles: Math.max(0, Math.floor(finiteNumber(controller?.data?.requiredCollectibles, 0))), scorePerCollectible: Math.max(0, finiteNumber(ui?.data?.scorePerCollectible, 100)) } : null
    };
}

function layersCollide(world, left, right) {
    const leftMask = world.collisionMatrix[left.layer] ?? 0xFFFFFFFF;
    const rightMask = world.collisionMatrix[right.layer] ?? 0xFFFFFFFF;
    return (leftMask & (1 << right.layer)) !== 0 && (rightMask & (1 << left.layer)) !== 0;
}

function componentDataNumber(component, key, fallback) {
    return finiteNumber(component.data?.[key], fallback);
}

function applyUiEventActions(world, name, value) {
    for (const object of world?.objects || []) {
        for (const component of object.components) {
            if (!component.enabled || component.type !== 'UIEventAction' || component.data?.eventName !== name) continue;
            if (component.data?.action === 'LoadScene') continue;
            const target = component.data?.targetObjectId
                ? world.objects.find((candidate) => candidate.id === component.data.targetObjectId) || object
                : object;
            if (component.data?.action === 'SetPosition') {
                const position = component.data?.position;
                if (Array.isArray(position) && position.length >= 3) target.transform.position = position.slice(0, 3).map((value, index) => finiteNumber(value, target.transform.position[index]));
                continue;
            }
            if (component.data?.action === 'SetRotation') {
                const rotation = component.data?.rotation;
                if (Array.isArray(rotation) && rotation.length >= 3) target.transform.rotation = rotation.slice(0, 3).map((value, index) => finiteNumber(value, target.transform.rotation[index]));
                continue;
            }
            if (component.data?.action === 'SetScale') {
                const scale = component.data?.scale;
                if (Array.isArray(scale) && scale.length >= 3) target.transform.scale = scale.slice(0, 3).map((value, index) => finiteNumber(value, target.transform.scale[index]));
                continue;
            }
            if (component.data?.action === 'SetVelocity') {
                const velocity = component.data?.velocity;
                const body = target.components.find((candidate) => candidate.type === 'RigidBody');
                if (body && Array.isArray(velocity) && velocity.length >= 3) body.data = { ...(body.data || {}), velocity: velocity.slice(0, 3).map((value, index) => finiteNumber(value, body.data?.velocity?.[index] || 0)) };
                continue;
            }
            if (component.data?.action === 'SetText') {
                const authoredText = String(component.data?.text ?? '');
                const displayValue = value && typeof value === 'object' && value.value !== undefined ? value.value : value;
                const text = component.data?.useEventValue === true
                    ? authoredText.split('{value}').join(displayValue == null ? '' : String(displayValue))
                    : authoredText;
                for (const targetComponent of target.components) {
                    if (targetComponent.type === 'UIText' || targetComponent.type === 'UIInputField') targetComponent.data = { ...(targetComponent.data || {}), text };
                }
                continue;
            }
            const action = component.data?.action === 'ToggleActive'
                ? !target.active
                : component.data?.active !== false;
            target.active = action;
        }
    }
}

function componentOf(runtimeObject, type) {
    return runtimeObject.components.find((component) => component.enabled && component.type === type) || null;
}

function worldCollider(object) {
    return componentOf(object, 'BoxCollider') || componentOf(object, 'SphereCollider') || componentOf(object, 'CapsuleCollider');
}

function boundsFor(object, position) {
    const collider = componentOf(object, 'CapsuleCollider');
    const scale = object.transform.scale.map((value) => Math.abs(value));
    const boxCollider = componentOf(object, 'BoxCollider');
    const sphereCollider = componentOf(object, 'SphereCollider');
    if (!collider && !boxCollider && sphereCollider) {
        const radius = Math.max(0.05, finiteNumber(sphereCollider.data?.radius, 0.5) * Math.max(...scale));
        const center = vector3(sphereCollider.data?.center, [0, 0, 0]).map((value, index) => value * scale[index]);
        return {
            min: [position[0] + center[0] - radius, position[1] + center[1] - radius, position[2] + center[2] - radius],
            max: [position[0] + center[0] + radius, position[1] + center[1] + radius, position[2] + center[2] + radius],
            halfHeight: radius
        };
    }
    if (!collider && boxCollider) {
        const size = vector3(boxCollider.data?.size, [1, 1, 1]).map((value, index) => Math.max(0.01, Math.abs(value) * scale[index]));
        const center = vector3(boxCollider.data?.center, [0, 0, 0]).map((value, index) => value * scale[index]);
        const min = position.map((value, index) => value + center[index] - size[index] / 2);
        const max = position.map((value, index) => value + center[index] + size[index] / 2);
        return { min, max, halfHeight: size[1] / 2 };
    }
    const radius = Math.max(0.05, (finiteNumber(collider?.data?.radius, 0.45)) * Math.max(scale[0], scale[2]));
    // Capsule height is authored in world units in the scene contract; the
    // horizontal radius still follows the object's X/Z scale.
    const height = Math.max(radius * 2, finiteNumber(collider?.data?.height, 1.8));
    const center = vector3(collider?.data?.center, [0, 0, 0]);
    return {
        min: [position[0] + center[0] - radius, position[1] + center[1] - height / 2, position[2] + center[2] - radius],
        max: [position[0] + center[0] + radius, position[1] + center[1] + height / 2, position[2] + center[2] + radius],
        radius,
        halfHeight: height / 2
    };
}

function boxBounds(object) {
    const collider = componentOf(object, 'BoxCollider');
    const sphere = componentOf(object, 'SphereCollider');
    const capsule = componentOf(object, 'CapsuleCollider');
    if (!collider && sphere) {
        const radius = Math.max(0.05, finiteNumber(sphere.data?.radius, 0.5) * Math.max(...object.transform.scale.map((value) => Math.abs(value))));
        const center = vector3(sphere.data?.center, [0, 0, 0]);
        return { min: object.transform.position.map((value, index) => value + center[index] - radius), max: object.transform.position.map((value, index) => value + center[index] + radius) };
    }
    if (!collider && !sphere && capsule) {
        const scale = object.transform.scale.map((value) => Math.abs(value));
        const radius = Math.max(0.05, finiteNumber(capsule.data?.radius, 0.5) * Math.max(scale[0], scale[2]));
        const height = Math.max(radius * 2, finiteNumber(capsule.data?.height, 2));
        const center = vector3(capsule.data?.center, [0, 0, 0]);
        return {
            min: [
                object.transform.position[0] + center[0] - radius,
                object.transform.position[1] + center[1] - height / 2,
                object.transform.position[2] + center[2] - radius
            ],
            max: [
                object.transform.position[0] + center[0] + radius,
                object.transform.position[1] + center[1] + height / 2,
                object.transform.position[2] + center[2] + radius
            ]
        };
    }
    if (!collider) return null;
    const size = vector3(collider.data?.size, [1, 1, 1]).map((value) => Math.max(0.01, Math.abs(value)));
    const center = vector3(collider.data?.center, [0, 0, 0]);
    return { min: object.transform.position.map((value, index) => value + center[index] - size[index] / 2), max: object.transform.position.map((value, index) => value + center[index] + size[index] / 2) };
}

function overlapsBounds(a, b) {
    return a.min[0] <= b.max[0] && a.max[0] >= b.min[0] && a.min[1] <= b.max[1] && a.max[1] >= b.min[1] && a.min[2] <= b.max[2] && a.max[2] >= b.min[2];
}

function updateGameplay(world) {
    if (!world.player || !world.gameplay) return;
    const playerBounds = boundsFor(world.player, world.player.transform.position);
    for (const trigger of world.triggers) {
        if (!trigger.active || !trigger.object.active || !layersCollide(world, world.player, trigger.object)) continue;
        const box = boxBounds(trigger.object);
        if (!box || !overlapsBounds(playerBounds, box)) continue;
        if (trigger.kind === 'collect') {
            trigger.active = false;
            world.gameplay.collectedCount += 1;
        } else if (trigger.kind === 'finish' && world.gameplay.collectedCount >= world.gameplay.requiredCollectibles) {
            world.gameplay.status = 'finished';
        } else if (trigger.kind === 'lose') {
            world.gameplay.status = 'lost';
        }
    }
}

function updateCamera(world) {
    if (!world.camera || !world.cameraObject || !world.player) return;
    if (world.camera.mode === 'follow') {
        const yaw = finiteNumber(world.player.transform.rotation?.[1], 0);
        const sin = Math.sin(yaw);
        const cos = Math.cos(yaw);
        const offset = world.camera.offset;
        const rotatedOffset = [
            offset[0] * cos + offset[2] * sin,
            offset[1],
            offset[0] * sin - offset[2] * cos
        ];
        world.cameraObject.transform.position = world.player.transform.position.map((value, index) => value + rotatedOffset[index]);
    }
    world.camera.position = [...world.cameraObject.transform.position];
}

function runPlayerController(object, fixedDeltaTime, input, world) {
    const controller = componentOf(object, 'PlayerController');
    const stateData = object.controllerState;
    const horizontal = Math.max(-1, Math.min(1, finiteNumber(input?.Horizontal, 0)));
    const vertical = Math.max(-1, Math.min(1, finiteNumber(input?.Vertical, 0)));
    const controllerData = controller.data || {};
    const speed = Math.max(0, finiteNumber(controllerData.moveSpeed ?? controllerData.speed, 5));
    const lookX = finiteNumber(input?.LookX, 0);
    const lookSensitivity = Math.max(0, finiteNumber(controllerData.lookSensitivity, 0.002));
    stateData.yaw -= lookX * lookSensitivity;
    object.transform.rotation[1] = stateData.yaw;
    const sin = Math.sin(stateData.yaw);
    const cos = Math.cos(stateData.yaw);
    stateData.velocity[0] = (horizontal * cos + vertical * sin) * speed;
    stateData.velocity[2] = (horizontal * sin - vertical * cos) * speed;
    const jumpHeld = input?.Jump === true;
    if (jumpHeld && !stateData.jumpWasHeld && stateData.grounded) {
        stateData.velocity[1] = Math.max(0, finiteNumber(controllerData.jumpForce ?? controllerData.jumpSpeed, 6));
        stateData.grounded = false;
    }
    stateData.jumpWasHeld = jumpHeld;
    stateData.velocity[1] += finiteNumber(controllerData.gravity, -9.81) * fixedDeltaTime;
    const shape = boundsFor(object, object.transform.position);
    const next = [...object.transform.position];
    for (const axis of [0, 2]) {
        next[axis] += stateData.velocity[axis] * fixedDeltaTime;
        const candidate = boundsFor(object, next);
        for (const other of world.objects) {
            if (other === object || worldCollider(other)?.data?.isTrigger === true || !layersCollide(world, object, other)) continue;
            const box = other.active ? boxBounds(other) : null;
            if (!box || !overlapsBounds(candidate, box)) continue;
            next[axis] = object.transform.position[axis];
            stateData.velocity[axis] = 0;
        }
    }
    const old = boundsFor(object, object.transform.position);
    next[1] += stateData.velocity[1] * fixedDeltaTime;
    const candidate = boundsFor(object, next);
    stateData.grounded = false;
    for (const other of world.objects) {
        if (other === object || worldCollider(other)?.data?.isTrigger === true || !layersCollide(world, object, other)) continue;
        const box = other.active ? boxBounds(other) : null;
        if (!box || candidate.max[0] < box.min[0] || candidate.min[0] > box.max[0] || candidate.max[2] < box.min[2] || candidate.min[2] > box.max[2]) continue;
        if (stateData.velocity[1] <= 0 && old.min[1] >= box.max[1] && candidate.min[1] <= box.max[1]) {
            next[1] = box.max[1] + candidate.halfHeight;
            stateData.velocity[1] = 0;
            stateData.grounded = true;
        } else if (stateData.velocity[1] > 0 && old.max[1] <= box.min[1] && candidate.max[1] >= box.min[1]) {
            next[1] = box.min[1] - candidate.halfHeight;
            stateData.velocity[1] = 0;
        }
    }
    object.transform.position = next;
    if (next[1] < finiteNumber(controllerData.respawnY, -8)) {
        object.transform.position = [...stateData.spawn];
        stateData.velocity = [0, 0, 0];
        stateData.grounded = false;
    }
    updateGameplay(world);
}

function runUpdate(runtimeObject, deltaTime) {
    if (!runtimeObject.active) return;
    for (const component of runtimeObject.components) {
        if (!component.enabled) continue;
        if (component.type === 'AutoRotate') {
            const hasUnityStyleSpeed = Number.isFinite(Number(component.data?.speed));
            const speed = hasUnityStyleSpeed
                ? Number(component.data.speed) * Math.PI / 180
                : componentDataNumber(component, 'rotationSpeed', 2);
            const axis = vector3(component.data?.axis, [0, 1, 0]);
            const length = Math.hypot(axis[0], axis[1], axis[2]) || 1;
            const radians = speed * deltaTime;
            runtimeObject.transform.rotation = runtimeObject.transform.rotation.map((value, index) => value + axis[index] / length * radians);
        }
    }
}

function runFixedUpdate(runtimeObject, fixedDeltaTime, input, world) {
    if (!runtimeObject.active) return;
    if (componentOf(runtimeObject, 'PlayerController')) {
        runPlayerController(runtimeObject, fixedDeltaTime, input, world);
        return;
    }
    for (const component of runtimeObject.components) {
        if (!component.enabled || component.type !== 'RigidBody') continue;
        const mass = componentDataNumber(component, 'mass', 1);
        const isKinematic = component.data?.isKinematic === true;
        if (mass <= 0 || isKinematic) continue;
        const velocity = vector3(component.data?.velocity, [0, 0, 0]);
        if (component.data?.useGravity !== false) velocity[1] -= 9.81 * fixedDeltaTime;
        const start = [...runtimeObject.transform.position];
        const next = [...start];
        for (const axis of [0, 2]) {
            if (component.data?.[`freezePosition${'XYZ'[axis]}`] === true) {
                velocity[axis] = 0;
                continue;
            }
            next[axis] += velocity[axis] * fixedDeltaTime;
            const candidate = boundsFor(runtimeObject, next);
            for (const other of world.objects) {
                if (other === runtimeObject || worldCollider(other)?.data?.isTrigger === true || !layersCollide(world, runtimeObject, other)) continue;
                const box = other.active ? boxBounds(other) : null;
                if (!box || !overlapsBounds(candidate, box)) continue;
                next[axis] = start[axis];
                velocity[axis] = 0;
            }
        }
        const old = boundsFor(runtimeObject, start);
        if (component.data?.freezePositionY === true) {
            velocity[1] = 0;
        } else {
            next[1] += velocity[1] * fixedDeltaTime;
        }
        const candidate = boundsFor(runtimeObject, next);
        for (const other of world.objects) {
            if (other === runtimeObject || worldCollider(other)?.data?.isTrigger === true || !layersCollide(world, runtimeObject, other)) continue;
            const box = other.active ? boxBounds(other) : null;
            if (!box || candidate.max[0] < box.min[0] || candidate.min[0] > box.max[0] || candidate.max[2] < box.min[2] || candidate.min[2] > box.max[2]) continue;
            if (velocity[1] <= 0 && old.min[1] >= box.max[1] && candidate.min[1] <= box.max[1]) {
                next[1] = box.max[1] + candidate.halfHeight;
                velocity[1] = 0;
            } else if (velocity[1] > 0 && old.max[1] <= box.min[1] && candidate.max[1] >= box.min[1]) {
                next[1] = box.min[1] - candidate.halfHeight;
                velocity[1] = 0;
            }
        }
        runtimeObject.transform.position = next;
        const drag = Math.max(0, finiteNumber(component.data?.drag, 0));
        const damping = Math.max(0, 1 - drag * fixedDeltaTime);
        component.data.velocity = velocity.map((value) => value * damping);
    }
}

function runtimeFrame() {
    const result = {
        state,
        frame,
        timeMicros,
        fixedUpdateCount: world?.fixedUpdateCount || 0,
        updateCount: world?.updateCount || 0,
        transforms: world ? world.objects.map((object) => ({
            id: object.id,
            ...(object.active ? {} : { active: false }),
            position: object.transform.position,
            rotation: object.transform.rotation,
            scale: object.transform.scale
        })) : [],
        lastUiEvent,
        lastUiEventPayload
    };
    result.uiText = world ? world.objects.flatMap((object) => object.components
        .filter((component) => component.type === 'UIText' || component.type === 'UIInputField')
        .map((component) => ({ id: `${object.id}:${component.type}`, text: String(component.data?.text ?? '') }))) : [];
    if (world?.gameplay && world.player) {
        result.gameplay = {
            player: { position: [...world.player.transform.position], velocity: [...world.player.controllerState.velocity], grounded: world.player.controllerState.grounded },
            status: world.gameplay.status,
            collectedCount: world.gameplay.collectedCount,
            respawnCount: world.gameplay.respawnCount,
            goal: world.gameplay.requiredCollectibles,
            score: world.gameplay.collectedCount * world.gameplay.scorePerCollectible
        };
        if (world.camera) result.gameplay.camera = { mode: world.camera.mode, position: [...world.camera.position], target: [...world.player.transform.position] };
    }
    return result;
}
function advance(deltaTime, input = {}) {
    const deltaMicros = Math.round(deltaTime * 1_000_000);
    frame += 1;
    timeMicros += deltaMicros;
    fixedAccumulatorMicros += deltaMicros;
    let fixedSteps = 0;
    while (fixedAccumulatorMicros >= FIXED_DELTA_MICROS && fixedSteps < MAX_FIXED_STEPS_PER_FRAME) {
        for (const object of world.objects) runFixedUpdate(object, FIXED_DELTA_MICROS / 1_000_000, input, world);
        world.fixedUpdateCount += 1;
        fixedAccumulatorMicros -= FIXED_DELTA_MICROS;
        fixedSteps += 1;
    }
    if (fixedSteps === MAX_FIXED_STEPS_PER_FRAME) fixedAccumulatorMicros = 0;
    for (const object of world.objects) runUpdate(object, deltaTime);
    updateCamera(world);
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
            lastUiEvent = null;
            lastUiEventPayload = null;
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
    else if (command === 'uiEvent' && typeof payload.name === 'string' && payload.name.length > 0 && payload.name.length <= 128) {
        lastUiEvent = payload.name;
        lastUiEventPayload = payload.value === undefined ? null : payload.value;
        applyUiEventActions(world, payload.name, payload.value);
        if (payload.name.toLowerCase() === 'restart' && snapshot) {
            world = createWorld(snapshot);
            fixedAccumulatorMicros = 0;
        }
    }
    else if ((command === 'tick' && state === 'running') || (command === 'step' && state === 'paused')) {
        const deltaTime = Number(payload.deltaTime);
        if (!Number.isFinite(deltaTime) || deltaTime < 0 || deltaTime > 0.1) {
            return failure(requestId, 'INVALID_DELTA', 'The runtime frame delta is outside the supported range.');
        }
        return reply(requestId, { ok: true, value: advance(deltaTime, payload.input || {}) });
    } else if (command === 'stop') {
        snapshot = null;
        world = null;
        state = 'idle';
        lastUiEvent = null;
        lastUiEventPayload = null;
    } else {
        return failure(requestId, 'INVALID_TRANSITION', 'The runtime lifecycle transition is invalid.');
    }
    reply(requestId, { ok: true, value: runtimeFrame() });
    if (command === 'stop') sessionId = '';
});

process.on('disconnect', () => process.exit(0));
