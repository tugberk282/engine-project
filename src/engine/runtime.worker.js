const PROTOCOL_VERSION = 1;
let sessionId = '';
let state = 'idle';
let frame = 0;
let time = 0;
let snapshot = null;
let gameplay = null;

const DEFAULT_FIXED_STEP = 1 / 50;

function componentData(component) {
    return component && typeof component.data === 'object'
        ? { ...component, ...component.data }
        : (component || {});
}

function allGameObjects(roots) {
    const result = [];
    const visit = (object) => {
        if (!object || typeof object !== 'object') return;
        result.push(object);
        if (Array.isArray(object.children)) object.children.forEach(visit);
    };
    if (Array.isArray(roots)) roots.forEach(visit);
    return result;
}

function findComponent(object, type) {
    return Array.isArray(object.components)
        ? object.components.find((component) => component && component.type === type)
        : null;
}

function vector3(value, fallback) {
    if (!Array.isArray(value) || value.length < 3) return [...fallback];
    return value.slice(0, 3).map((entry, index) => Number.isFinite(Number(entry)) ? Number(entry) : fallback[index]);
}

function createGameplay(scene) {
    const objects = allGameObjects(scene.gameObjects);
    const playerObject = objects.find((object) => findComponent(object, 'PlayerController'));
    if (!playerObject) return null;

    const controller = componentData(findComponent(playerObject, 'PlayerController'));
    const cameraObject = objects.find((object) => findComponent(object, 'GameplayCamera'));
    const camera = componentData(cameraObject ? findComponent(cameraObject, 'GameplayCamera') : null);
    const uiObject = objects.find((object) => findComponent(object, 'GameplayUI'));
    const ui = componentData(uiObject ? findComponent(uiObject, 'GameplayUI') : null);
    const capsule = componentData(findComponent(playerObject, 'CapsuleCollider'));
    const spawn = vector3(playerObject.transform?.position || playerObject.position, [0, 2, 0]);
    const radius = Math.max(0.05, Number(capsule.radius) || 0.45);
    const height = Math.max(radius * 2, Number(capsule.height) || 1.8);
    const boxes = [];
    const triggers = [];

    for (const object of objects) {
        if (object === playerObject) continue;
        const colliderSource = findComponent(object, 'BoxCollider');
        if (!colliderSource) continue;
        const collider = componentData(colliderSource);
        const position = vector3(object.transform?.position || object.position, [0, 0, 0]);
        const center = vector3(collider.center, [0, 0, 0]);
        const size = vector3(collider.size, [1, 1, 1]).map((entry) => Math.max(0.01, Math.abs(entry)));
        const box = {
            id: object.id || object.name || `trigger-${triggers.length}`,
            min: position.map((entry, index) => entry + center[index] - size[index] / 2),
            max: position.map((entry, index) => entry + center[index] + size[index] / 2),
            kind: object.tag === 'Finish' ? 'finish'
                : (object.tag === 'Respawn' ? 'respawn'
                    : (object.tag === 'Collect' ? 'collect'
                        : (object.tag === 'Lose' ? 'lose' : 'trigger'))),
            active: true
        };
        if (collider.isTrigger) triggers.push(box);
        else boxes.push(box);
    }

    return {
        accumulator: 0,
        fixedStep: Math.max(1 / 240, Math.min(0.05, Number(controller.fixedStep) || DEFAULT_FIXED_STEP)),
        gravity: Number.isFinite(Number(controller.gravity)) ? Number(controller.gravity) : -9.81,
        moveSpeed: Math.max(0, Number(controller.moveSpeed ?? controller.speed) || 5),
        jumpSpeed: Math.max(0, Number(controller.jumpForce ?? controller.jumpSpeed) || 6),
        requiredCollectibles: Math.max(0, Math.floor(Number(controller.requiredCollectibles) || 0)),
        respawnY: Number.isFinite(Number(controller.respawnY)) ? Number(controller.respawnY) : -8,
        spawn,
        radius,
        halfHeight: height / 2,
        boxes,
        triggers,
        position: [...spawn],
        velocity: [0, 0, 0],
        grounded: false,
        jumpWasHeld: false,
        pendingJump: false,
        status: 'playing',
        collectedCount: 0,
        respawnCount: 0,
        scorePerCollectible: Math.max(0, Number(ui.scorePerCollectible) || 100),
        camera: {
            mode: camera.mode === 'fixed' ? 'fixed' : 'follow',
            position: vector3(cameraObject?.transform?.position, [0, 6, 8]),
            offset: vector3(camera.offset, [0, 6, 8])
        }
    };
}

function overlaps(minA, maxA, minB, maxB) {
    return minA[0] <= maxB[0] && maxA[0] >= minB[0]
        && minA[1] <= maxB[1] && maxA[1] >= minB[1]
        && minA[2] <= maxB[2] && maxA[2] >= minB[2];
}

function playerBounds(simulation, position) {
    return {
        min: [position[0] - simulation.radius, position[1] - simulation.halfHeight, position[2] - simulation.radius],
        max: [position[0] + simulation.radius, position[1] + simulation.halfHeight, position[2] + simulation.radius]
    };
}

function respawn(simulation) {
    simulation.position = [...simulation.spawn];
    simulation.velocity = [0, 0, 0];
    simulation.grounded = false;
    simulation.status = 'playing';
    simulation.respawnCount += 1;
}

function moveHorizontal(simulation, axis, amount) {
    if (amount === 0) return;
    const oldPosition = [...simulation.position];
    const nextPosition = [...simulation.position];
    nextPosition[axis] += amount;
    const oldBounds = playerBounds(simulation, oldPosition);
    const nextBounds = playerBounds(simulation, nextPosition);

    for (const box of simulation.boxes) {
        if (!overlaps(nextBounds.min, nextBounds.max, box.min, box.max)) continue;
        // Merely touching a platform's top is support, not a horizontal wall.
        if (nextBounds.min[1] >= box.max[1] - 1e-7 || nextBounds.max[1] <= box.min[1] + 1e-7) continue;
        let blocked = false;
        if (amount > 0 && oldBounds.max[axis] <= box.min[axis]) {
            nextPosition[axis] = box.min[axis] - (axis === 0 || axis === 2 ? simulation.radius : simulation.halfHeight);
            blocked = true;
        } else if (amount < 0 && oldBounds.min[axis] >= box.max[axis]) {
            nextPosition[axis] = box.max[axis] + (axis === 0 || axis === 2 ? simulation.radius : simulation.halfHeight);
            blocked = true;
        }
        if (blocked) simulation.velocity[axis] = 0;
    }
    simulation.position[axis] = nextPosition[axis];
}

function simulateFixedStep(simulation, input) {
    const horizontal = Math.max(-1, Math.min(1, Number(input.Horizontal) || 0));
    const vertical = Math.max(-1, Math.min(1, Number(input.Vertical) || 0));
    const length = Math.hypot(horizontal, vertical) || 1;
    simulation.velocity[0] = horizontal / length * simulation.moveSpeed;
    simulation.velocity[2] = -vertical / length * simulation.moveSpeed;

    if (simulation.pendingJump && simulation.grounded) {
        simulation.velocity[1] = simulation.jumpSpeed;
        simulation.grounded = false;
    }
    simulation.pendingJump = false;
    simulation.velocity[1] += simulation.gravity * simulation.fixedStep;

    moveHorizontal(simulation, 0, simulation.velocity[0] * simulation.fixedStep);
    moveHorizontal(simulation, 2, simulation.velocity[2] * simulation.fixedStep);

    const oldPosition = [...simulation.position];
    const nextY = oldPosition[1] + simulation.velocity[1] * simulation.fixedStep;
    const oldBounds = playerBounds(simulation, oldPosition);
    const nextBounds = playerBounds(simulation, [oldPosition[0], nextY, oldPosition[2]]);
    simulation.grounded = false;
    let resolvedY = nextY;
    for (const box of simulation.boxes) {
        const horizontalOverlap = nextBounds.min[0] <= box.max[0] && nextBounds.max[0] >= box.min[0]
            && nextBounds.min[2] <= box.max[2] && nextBounds.max[2] >= box.min[2];
        if (!horizontalOverlap) continue;
        if (simulation.velocity[1] <= 0 && oldBounds.min[1] >= box.max[1] - 1e-7 && nextBounds.min[1] <= box.max[1]) {
            resolvedY = Math.max(resolvedY, box.max[1] + simulation.halfHeight);
            simulation.velocity[1] = 0;
            simulation.grounded = true;
        } else if (simulation.velocity[1] > 0 && oldBounds.max[1] <= box.min[1] && nextBounds.max[1] >= box.min[1]) {
            resolvedY = Math.min(resolvedY, box.min[1] - simulation.halfHeight);
            simulation.velocity[1] = 0;
        }
    }
    simulation.position[1] = resolvedY;

    const bounds = playerBounds(simulation, simulation.position);
    for (const trigger of simulation.triggers) {
        if (!trigger.active) continue;
        if (!overlaps(bounds.min, bounds.max, trigger.min, trigger.max)) continue;
        if (trigger.kind === 'collect') {
            trigger.active = false;
            simulation.collectedCount += 1;
        }
        if (trigger.kind === 'finish' && simulation.collectedCount >= simulation.requiredCollectibles) {
            simulation.status = 'finished';
        }
        if (trigger.kind === 'lose') simulation.status = 'lost';
        if (trigger.kind === 'respawn') {
            respawn(simulation);
            return;
        }
    }
    if (simulation.position[1] < simulation.respawnY) respawn(simulation);
}

function tickGameplay(simulation, deltaTime, input) {
    const jumpHeld = Boolean(input.Jump);
    if (jumpHeld && !simulation.jumpWasHeld) simulation.pendingJump = true;
    simulation.jumpWasHeld = jumpHeld;
    simulation.accumulator += deltaTime;
    let steps = 0;
    while (simulation.accumulator + 1e-10 >= simulation.fixedStep && steps < 8) {
        simulateFixedStep(simulation, input);
        simulation.accumulator -= simulation.fixedStep;
        steps += 1;
    }
}

function gameplayState() {
    if (!gameplay) return null;
    return {
        player: {
            position: gameplay.position.map((value) => Number(value.toFixed(6))),
            velocity: gameplay.velocity.map((value) => Number(value.toFixed(6))),
            grounded: gameplay.grounded
        },
        status: gameplay.status,
        collectedCount: gameplay.collectedCount,
        respawnCount: gameplay.respawnCount,
        fixedStep: gameplay.fixedStep,
        score: gameplay.collectedCount * gameplay.scorePerCollectible,
        goal: gameplay.requiredCollectibles,
        camera: {
            mode: gameplay.camera.mode,
            position: (gameplay.camera.mode === 'follow'
                ? gameplay.position.map((value, index) => value + gameplay.camera.offset[index])
                : gameplay.camera.position).map((value) => Number(value.toFixed(6))),
            target: gameplay.position.map((value) => Number(value.toFixed(6)))
        }
    };
}

function emitState() {
    self.postMessage({ type: 'state', sessionId, state, frame, time, gameplay: gameplayState() });
}

function fail(code, message) {
    state = 'failed';
    self.postMessage({ type: 'error', sessionId, error: { code, message } });
}

self.onmessage = (event) => {
    const envelope = event.data;
    if (!envelope || envelope.protocolVersion !== PROTOCOL_VERSION || typeof envelope.command !== 'string'
        || typeof envelope.sessionId !== 'string' || envelope.sessionId.length === 0) {
        fail('INVALID_ENVELOPE', 'The runtime command envelope is invalid.');
        return;
    }

    if (envelope.command === 'start') {
        sessionId = envelope.sessionId;
        frame = 0;
        time = 0;
        try {
            snapshot = JSON.parse(envelope.payload?.snapshot);
            if (!snapshot || typeof snapshot !== 'object') throw new Error('invalid snapshot');
            gameplay = createGameplay(snapshot);
            state = 'running';
            emitState();
        } catch {
            fail('INVALID_SNAPSHOT', 'The persisted scene snapshot could not be loaded.');
        }
        return;
    }

    if (envelope.sessionId !== sessionId || state === 'idle' || state === 'failed') return;

    switch (envelope.command) {
        case 'ping':
            self.postMessage({ type: 'heartbeat', sessionId, state, frame, time });
            break;
        case 'pause':
            if (state !== 'running') {
                fail('INVALID_TRANSITION', 'The runtime lifecycle transition is invalid.');
                break;
            }
            state = 'paused';
            emitState();
            break;
        case 'resume':
            if (state !== 'paused') {
                fail('INVALID_TRANSITION', 'The runtime lifecycle transition is invalid.');
                break;
            }
            state = 'running';
            emitState();
            break;
        case 'tick': {
            if (state !== 'running') break;
            const deltaTime = Number(envelope.payload?.deltaTime);
            if (!Number.isFinite(deltaTime) || deltaTime < 0 || deltaTime > 0.1) {
                fail('INVALID_DELTA', 'The runtime frame delta is outside the supported range.');
                break;
            }
            frame += 1;
            time += deltaTime;
            if (gameplay) tickGameplay(gameplay, deltaTime, envelope.payload?.input || {});
            emitState();
            break;
        }
        case 'stop':
            snapshot = null;
            gameplay = null;
            state = 'idle';
            emitState();
            sessionId = '';
            break;
        default:
            fail('UNKNOWN_COMMAND', 'The runtime command is not supported.');
    }
};
