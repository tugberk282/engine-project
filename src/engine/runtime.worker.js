const PROTOCOL_VERSION = 1;
importScripts('./behaviour-script.js');
let sessionId = '';
let state = 'idle';
let frame = 0;
let time = 0;
let snapshot = null;
let gameplay = null;
let lastUiEvent = null;
let lastUiEventPayload = null;
let runtimeObjects = [];
let runtimeCollisionMatrix = new Array(32).fill(0xFFFFFFFF);
let runtimeFixedAccumulator = 0;
let behaviourScripts = null;
let runtimeContactPairs = new Map();

const DEFAULT_FIXED_STEP = 1 / 50;

function componentData(component) {
    return component && typeof component.data === 'object'
        ? { ...component, ...component.data }
        : (component || {});
}

function allGameObjects(roots) {
    const result = [];
    const visit = (object, parentEnabled = true) => {
        if (!object || typeof object !== 'object') return;
        if (typeof object._runtimeSelfEnabled !== 'boolean') {
            object._runtimeSelfEnabled = object.enabled !== false;
        }
        if (typeof object._runtimeDestroyed !== 'boolean') object._runtimeDestroyed = false;
        object.enabled = parentEnabled && object._runtimeSelfEnabled && !object._runtimeDestroyed;
        result.push(object);
        if (Array.isArray(object.children)) object.children.forEach((child) => visit(child, object.enabled));
    };
    if (Array.isArray(roots)) roots.forEach((root) => visit(root, true));
    return result;
}

function refreshRuntimeActiveState(roots, parentEnabled = true) {
    for (const object of roots || []) {
        object.enabled = parentEnabled && object._runtimeSelfEnabled && object._runtimeDestroyed !== true;
        refreshRuntimeActiveState(object.children, object.enabled);
    }
}

function findComponent(object, type) {
    return Array.isArray(object.components)
        ? object.components.find((component) => component && component.type === type && component.data?.enabled !== false)
        : null;
}

function runtimeComponent(object, type) {
    return findComponent(object, type);
}

function applyUiEventActions(name, value) {
    for (const object of runtimeObjects) {
        if (object.enabled === false) continue;
        for (const component of object.components || []) {
            if (component?.data?.enabled === false || component?.type !== 'UIEventAction' || component.data?.eventName !== name) continue;
            if (component.data?.action === 'LoadScene') continue;
            const target = component.data?.targetObjectId
                ? runtimeObjects.find((candidate) => candidate.id === component.data.targetObjectId) || object
                : object;
            if (component.data?.action === 'SetPosition') {
                const position = component.data?.position;
                if (Array.isArray(position) && position.length >= 3) target.transform.position = vector3(position, target.transform?.position || [0, 0, 0]);
                continue;
            }
            if (component.data?.action === 'SetRotation') {
                const rotation = component.data?.rotation;
                if (Array.isArray(rotation) && rotation.length >= 3) target.transform.rotation = vector3(rotation, target.transform?.rotation || [0, 0, 0]);
                continue;
            }
            if (component.data?.action === 'SetScale') {
                const scale = component.data?.scale;
                if (Array.isArray(scale) && scale.length >= 3) target.transform.scale = vector3(scale, target.transform?.scale || [1, 1, 1]);
                continue;
            }
            if (component.data?.action === 'SetVelocity') {
                const velocity = component.data?.velocity;
                const body = (target.components || []).find((candidate) => candidate?.type === 'RigidBody');
                if (body && Array.isArray(velocity) && velocity.length >= 3) body.data = { ...(body.data || {}), velocity: vector3(velocity, body.data?.velocity || [0, 0, 0]) };
                continue;
            }
            if (component.data?.action === 'SetText') {
                const authoredText = String(component.data?.text ?? '');
                const displayValue = value && typeof value === 'object' && value.value !== undefined ? value.value : value;
                const text = component.data?.useEventValue === true
                    ? authoredText.split('{value}').join(displayValue == null ? '' : String(displayValue))
                    : authoredText;
                for (const targetComponent of target.components || []) {
                    if (targetComponent?.type === 'UIText' || targetComponent?.type === 'UIInputField') targetComponent.data = { ...(targetComponent.data || {}), text };
                }
                continue;
            }
            target._runtimeSelfEnabled = component.data?.action === 'ToggleActive'
                ? !target._runtimeSelfEnabled
                : component.data?.active !== false;
        }
    }
    refreshRuntimeActiveState(snapshot?.gameObjects);
}

function vector3(value, fallback) {
    if (!Array.isArray(value) || value.length < 3) return [...fallback];
    return value.slice(0, 3).map((entry, index) => Number.isFinite(Number(entry)) ? Number(entry) : fallback[index]);
}

function capsuleAxis(data) {
    const direction = data?.direction;
    if (direction === 'X' || direction === 0) return 0;
    if (direction === 'Z' || direction === 2) return 2;
    return 1;
}

function capsuleSize(data, scale) {
    const axis = capsuleAxis(data);
    const perpendicular = [0, 1, 2].filter((index) => index !== axis);
    const radius = Math.max(0.05, Math.abs(Number(data?.radius) || 0.5)
        * Math.max(scale[perpendicular[0]], scale[perpendicular[1]]));
    const height = Math.max(radius * 2, Math.abs(Number(data?.height) || 2) * scale[axis]);
    const size = [radius * 2, radius * 2, radius * 2];
    size[axis] = height;
    return { radius, height, size };
}

function runtimeCollider(object) {
    return findComponent(object, 'BoxCollider')
        || findComponent(object, 'SphereCollider')
        || findComponent(object, 'CapsuleCollider');
}

function runtimeBounds(object, position, scaleBox = false) {
    const source = runtimeCollider(object);
    if (!source) return null;
    const collider = componentData(source);
    const scale = vector3(object.transform?.scale, [1, 1, 1]).map((entry) => Math.abs(entry));
    const center = vector3(collider.center, [0, 0, 0]).map((entry, index) =>
        scaleBox && source.type === 'BoxCollider' ? entry * scale[index] : entry
    );
    let size;
    if (source.type === 'SphereCollider') {
        const diameter = Math.max(0.1, Math.abs(Number(collider.radius) || 0.5) * Math.max(...scale) * 2);
        size = [diameter, diameter, diameter];
    } else if (source.type === 'CapsuleCollider') {
        size = capsuleSize(collider, scale).size;
    } else {
        size = vector3(collider.size, [1, 1, 1]).map((entry, index) =>
            Math.max(0.01, Math.abs(entry) * (scaleBox ? scale[index] : 1))
        );
    }
    return {
        min: position.map((entry, index) => entry + center[index] - size[index] / 2),
        max: position.map((entry, index) => entry + center[index] + size[index] / 2),
        halfHeight: size[1] / 2
    };
}

function runtimeBoundsOverlap(left, right) {
    return left.min[0] <= right.max[0] && left.max[0] >= right.min[0]
        && left.min[1] <= right.max[1] && left.max[1] >= right.min[1]
        && left.min[2] <= right.max[2] && left.max[2] >= right.min[2];
}

function processBehaviourContacts(input) {
    const current = new Map();
    const dispatch = (pair, suffix) => {
        const prefix = pair.isTrigger ? 'trigger' : 'collision';
        behaviourScripts?.eventForObject(pair.left.id, `${prefix}${suffix}`, {
            otherId: pair.right.id,
            otherName: pair.right.name || '',
            otherTag: pair.right.tag || '',
            isTrigger: pair.isTrigger
        }, input);
        behaviourScripts?.eventForObject(pair.right.id, `${prefix}${suffix}`, {
            otherId: pair.left.id,
            otherName: pair.left.name || '',
            otherTag: pair.left.tag || '',
            isTrigger: pair.isTrigger
        }, input);
    };
    for (let leftIndex = 0; leftIndex < runtimeObjects.length; leftIndex += 1) {
        const left = runtimeObjects[leftIndex];
        const leftCollider = left.enabled !== false ? runtimeCollider(left) : null;
        if (!leftCollider) continue;
        for (let rightIndex = leftIndex + 1; rightIndex < runtimeObjects.length; rightIndex += 1) {
            const right = runtimeObjects[rightIndex];
            const rightCollider = right.enabled !== false ? runtimeCollider(right) : null;
            if (!rightCollider || !runtimeLayersCollide(left, right)) continue;
            const leftBounds = runtimeBounds(left, vector3(left.transform?.position, [0, 0, 0]), true);
            const rightBounds = runtimeBounds(right, vector3(right.transform?.position, [0, 0, 0]), true);
            if (!leftBounds || !rightBounds || !runtimeBoundsOverlap(leftBounds, rightBounds)) continue;
            const key = `${left.id}\u0000${right.id}`;
            const pair = {
                left, right,
                isTrigger: componentData(leftCollider).isTrigger === true || componentData(rightCollider).isTrigger === true
            };
            current.set(key, pair);
            dispatch(pair, runtimeContactPairs.has(key) ? 'Stay' : 'Enter');
        }
    }
    for (const [key, pair] of runtimeContactPairs) {
        if (!current.has(key)) dispatch(pair, 'Exit');
    }
    runtimeContactPairs = current;
}

function runtimeLayersCollide(left, right) {
    const leftLayer = Number.isInteger(left.layer) ? left.layer : 0;
    const rightLayer = Number.isInteger(right.layer) ? right.layer : 0;
    const leftMask = runtimeCollisionMatrix[leftLayer] ?? 0xFFFFFFFF;
    const rightMask = runtimeCollisionMatrix[rightLayer] ?? 0xFFFFFFFF;
    return (leftMask & (1 << rightLayer)) !== 0 && (rightMask & (1 << leftLayer)) !== 0;
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
    const initialRotation = vector3(playerObject.transform?.rotation, [0, 0, 0]);
    playerObject.transform = playerObject.transform && typeof playerObject.transform === 'object'
        ? playerObject.transform
        : {};
    playerObject.transform.rotation = [...initialRotation];
    const playerScale = vector3(playerObject.transform?.scale, [1, 1, 1]).map((value) => Math.abs(value));
    const radius = Math.max(0.05, (Number(capsule.radius) || 0.45) * Math.max(playerScale[0], playerScale[2]));
    // Capsule height is authored in world units in the scene contract; the
    // horizontal radius still follows the object's X/Z scale.
    const height = Math.max(radius * 2, Number(capsule.height) || 1.8);
    const boxes = [];
    const triggers = [];
    const authoredMatrix = scene.layerCollisionMatrix || scene.projectSettings?.collisionMatrix;
    const collisionMatrix = Array.from({ length: 32 }, (_, index) => {
        const value = Array.isArray(authoredMatrix) ? Number(authoredMatrix[index]) : NaN;
        return Number.isFinite(value) ? value >>> 0 : 0xFFFFFFFF;
    });

    for (const object of objects) {
        if (object === playerObject) continue;
        const colliderSource = findComponent(object, 'BoxCollider')
            || findComponent(object, 'SphereCollider')
            || findComponent(object, 'CapsuleCollider');
        if (!colliderSource) continue;
        const collider = componentData(colliderSource);
        const position = vector3(object.transform?.position || object.position, [0, 0, 0]);
        const center = vector3(collider.center, [0, 0, 0]);
        const objectScale = vector3(object.transform?.scale, [1, 1, 1]).map((entry) => Math.abs(entry));
        const size = colliderSource.type === 'SphereCollider'
            ? [1, 1, 1].map(() => Math.max(0.01, Math.abs(Number(collider.radius) || 0.5) * 2))
            : colliderSource.type === 'CapsuleCollider'
                ? capsuleSize(collider, objectScale).size
                : vector3(collider.size, [1, 1, 1]).map((entry) => Math.max(0.01, Math.abs(entry)));
        const box = {
            id: object.id || object.name || `trigger-${triggers.length}`,
            object,
            min: position.map((entry, index) => entry + center[index] - size[index] / 2),
            max: position.map((entry, index) => entry + center[index] + size[index] / 2),
            kind: object.tag === 'Finish' ? 'finish'
                : (object.tag === 'Respawn' ? 'respawn'
                    : (object.tag === 'Collect' ? 'collect'
                        : (object.tag === 'Lose' ? 'lose' : 'trigger'))),
            active: true,
            layer: Number.isInteger(object.layer) && object.layer >= 0 && object.layer < 32 ? object.layer : 0
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
        lookSensitivity: Math.max(0, Number(controller.lookSensitivity) || 0.002),
        maxLookPitch: Math.max(0, Math.min(Math.PI / 2, (Number(controller.maxLookPitch) || 85) * Math.PI / 180)),
        initialYaw: initialRotation[1],
        requiredCollectibles: Math.max(0, Math.floor(Number(controller.requiredCollectibles) || 0)),
        respawnY: Number.isFinite(Number(controller.respawnY)) ? Number(controller.respawnY) : -8,
        spawn,
        radius,
        halfHeight: height / 2,
        boxes,
        triggers,
        collisionMatrix,
        playerLayer: Number.isInteger(playerObject.layer) && playerObject.layer >= 0 && playerObject.layer < 32 ? playerObject.layer : 0,
        playerObject,
        rotation: [...initialRotation],
        pitch: 0,
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

function layersCollide(simulation, leftLayer, rightLayer) {
    const leftMask = simulation.collisionMatrix[leftLayer] ?? 0xFFFFFFFF;
    const rightMask = simulation.collisionMatrix[rightLayer] ?? 0xFFFFFFFF;
    return (leftMask & (1 << rightLayer)) !== 0 && (rightMask & (1 << leftLayer)) !== 0;
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

function restartGameplay(simulation) {
    simulation.position = [...simulation.spawn];
    simulation.rotation[1] = Number(simulation.initialYaw) || 0;
    simulation.velocity = [0, 0, 0];
    simulation.grounded = false;
    simulation.jumpWasHeld = false;
    simulation.pendingJump = false;
    simulation.accumulator = 0;
    simulation.status = 'playing';
    simulation.collectedCount = 0;
    simulation.respawnCount = 0;
    for (const trigger of simulation.triggers) trigger.active = true;
}

function moveHorizontal(simulation, axis, amount) {
    if (amount === 0) return;
    const oldPosition = [...simulation.position];
    const nextPosition = [...simulation.position];
    nextPosition[axis] += amount;
    const oldBounds = playerBounds(simulation, oldPosition);
    const nextBounds = playerBounds(simulation, nextPosition);

    for (const box of simulation.boxes) {
        if (box.object?.enabled === false) continue;
        if (!layersCollide(simulation, simulation.playerLayer, box.layer)) continue;
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
    const sin = Math.sin(simulation.rotation[1]);
    const cos = Math.cos(simulation.rotation[1]);
    const length = Math.hypot(horizontal, vertical) || 1;
    simulation.velocity[0] = (horizontal * cos + vertical * sin) / length * simulation.moveSpeed;
    simulation.velocity[2] = (horizontal * sin - vertical * cos) / length * simulation.moveSpeed;

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
        if (box.object?.enabled === false) continue;
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
        if (!trigger.active || trigger.object?.enabled === false) continue;
        if (!layersCollide(simulation, simulation.playerLayer, trigger.layer)) continue;
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
    const sensitivity = Math.max(0, Number(simulation.lookSensitivity) || 0.002);
    simulation.rotation[1] -= (Number(input.LookX) || 0) * sensitivity;
    simulation.pitch = Math.max(-simulation.maxLookPitch, Math.min(simulation.maxLookPitch,
        simulation.pitch - (Number(input.LookY) || 0) * sensitivity));
    simulation.playerObject.transform.rotation[1] = simulation.rotation[1];
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

function runRuntimeComponents(deltaTime, runUpdates = true, runPhysics = true) {
    for (const object of runtimeObjects) {
        if (object.enabled === false || !object.transform) continue;

        const autoRotate = runUpdates ? runtimeComponent(object, 'AutoRotate') : null;
        if (autoRotate) {
            const settings = componentData(autoRotate);
            const speed = Number(settings.speed ?? settings.rotationSpeed ?? 90);
            if (Number.isFinite(speed)) {
                const axis = vector3(settings.axis, [0, 1, 0]);
                const length = Math.hypot(axis[0], axis[1], axis[2]) || 1;
                const degrees = speed * deltaTime;
                const rotation = vector3(object.transform.rotation, [0, 0, 0]);
                object.transform.rotation = rotation.map((value, index) =>
                    value + axis[index] / length * degrees * Math.PI / 180
                );
            }
        }

        if (!runPhysics) continue;
        const rigidBody = runtimeComponent(object, 'RigidBody');
        if (!rigidBody) continue;
        const settings = rigidBody.data && typeof rigidBody.data === 'object' ? rigidBody.data : rigidBody;
        if (settings.isKinematic || Number(settings.mass) === 0 || runtimeComponent(object, 'PlayerController')) continue;

        const start = vector3(object.transform.position, [0, 0, 0]);
        const position = [...start];
        const velocity = vector3(settings.velocity, [0, 0, 0]);
        if (settings.useGravity !== false) velocity[1] += -9.81 * deltaTime;
        for (const axis of [0, 2]) {
            if (settings[`freezePosition${'XYZ'[axis]}`]) {
                velocity[axis] = 0;
                continue;
            }
            position[axis] += velocity[axis] * deltaTime;
            const candidate = runtimeBounds(object, position, true);
            for (const other of runtimeObjects) {
                const otherCollider = runtimeCollider(other);
                if (other === object || other.enabled === false || !otherCollider
                    || componentData(otherCollider).isTrigger === true || !runtimeLayersCollide(object, other)) continue;
                const obstacle = runtimeBounds(other, vector3(other.transform?.position, [0, 0, 0]));
                if (!candidate || !obstacle || !runtimeBoundsOverlap(candidate, obstacle)) continue;
                position[axis] = start[axis];
                velocity[axis] = 0;
                break;
            }
        }
        const oldBounds = runtimeBounds(object, start, true);
        if (settings.freezePositionY) velocity[1] = 0;
        else position[1] += velocity[1] * deltaTime;
        const candidate = runtimeBounds(object, position, true);
        for (const other of runtimeObjects) {
            const otherCollider = runtimeCollider(other);
            if (other === object || other.enabled === false || !otherCollider
                || componentData(otherCollider).isTrigger === true || !runtimeLayersCollide(object, other)) continue;
            const obstacle = runtimeBounds(other, vector3(other.transform?.position, [0, 0, 0]));
            if (!candidate || !oldBounds || !obstacle
                || candidate.max[0] < obstacle.min[0] || candidate.min[0] > obstacle.max[0]
                || candidate.max[2] < obstacle.min[2] || candidate.min[2] > obstacle.max[2]) continue;
            if (velocity[1] <= 0 && oldBounds.min[1] >= obstacle.max[1] && candidate.min[1] <= obstacle.max[1]) {
                position[1] = obstacle.max[1] + candidate.halfHeight;
                velocity[1] = 0;
            } else if (velocity[1] > 0 && oldBounds.max[1] <= obstacle.min[1] && candidate.max[1] >= obstacle.min[1]) {
                position[1] = obstacle.min[1] - candidate.halfHeight;
                velocity[1] = 0;
            }
        }
        const drag = Math.max(0, Number(settings.drag) || 0);
        const damping = Math.max(0, 1 - drag * deltaTime);
        settings.velocity = velocity.map((value) => value * damping);
        object.transform.position = position;
        const angularVelocity = vector3(settings.angularVelocity, [0, 0, 0]);
        const rotation = vector3(object.transform.rotation, [0, 0, 0]);
        for (let axis = 0; axis < 3; axis += 1) {
            if (settings[`freezeRotation${'XYZ'[axis]}`]) angularVelocity[axis] = 0;
            else rotation[axis] += angularVelocity[axis] * deltaTime;
        }
        object.transform.rotation = rotation;
        const angularDrag = Math.max(0, Number(settings.angularDrag) || 0);
        const angularDamping = Math.max(0, 1 - angularDrag * deltaTime);
        settings.angularVelocity = angularVelocity.map((value) => value * angularDamping);
    }
}

function runtimeTransformState() {
    return runtimeObjects.map((object) => ({
        id: String(object.id || object.name || ''),
        ...(object.enabled === false ? { active: false } : {}),
        position: vector3(object.transform?.position, [0, 0, 0]),
        rotation: vector3(object.transform?.rotation, [0, 0, 0]),
        scale: vector3(object.transform?.scale, [1, 1, 1])
    })).filter((object) => object.id.length > 0);
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
                ? (() => {
                    const yaw = Number(gameplay.rotation[1]) || 0;
                    const pitch = Number(gameplay.pitch) || 0;
                    const sin = Math.sin(yaw);
                    const cos = Math.cos(yaw);
                    const offset = gameplay.camera.offset;
                    const yawOffset = [offset[0] * cos + offset[2] * sin, offset[1], offset[0] * sin - offset[2] * cos];
                    const pitchSin = Math.sin(pitch);
                    const pitchCos = Math.cos(pitch);
                    const rotatedOffset = [yawOffset[0], yawOffset[1] * pitchCos - yawOffset[2] * pitchSin, yawOffset[1] * pitchSin + yawOffset[2] * pitchCos];
                    return gameplay.position.map((value, index) => value + rotatedOffset[index]);
                })()
                : gameplay.camera.position).map((value) => Number(value.toFixed(6))),
            target: gameplay.position.map((value) => Number(value.toFixed(6)))
        }
    };
}

function emitState() {
    const uiText = runtimeObjects.flatMap((object) => (object.components || [])
        .filter((component) => component?.type === 'UIText' || component?.type === 'UIInputField')
        .map((component) => ({ id: `${object.id}:${component.type}`, text: String(component.data?.text ?? '') })));
    self.postMessage({
        type: 'state', sessionId, state, frame, time, transforms: runtimeTransformState(), gameplay: gameplayState(), uiText,
        lastUiEvent, lastUiEventPayload,
        behaviourScripts: behaviourScripts
            ? { instanceCount: behaviourScripts.instanceCount, diagnostics: behaviourScripts.diagnostics() }
            : { instanceCount: 0, diagnostics: [] }
    });
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
            runtimeObjects = allGameObjects(snapshot.gameObjects);
            runtimeFixedAccumulator = 0;
            runtimeContactPairs = new Map();
            const authoredMatrix = snapshot.layerCollisionMatrix || snapshot.projectSettings?.collisionMatrix;
            runtimeCollisionMatrix = Array.from({ length: 32 }, (_, index) => {
                const value = Array.isArray(authoredMatrix) ? Number(authoredMatrix[index]) : NaN;
                return Number.isFinite(value) ? value >>> 0 : 0xFFFFFFFF;
            });
            gameplay = createGameplay(snapshot);
            behaviourScripts = self.TugberkBehaviourScript.createBehaviourRuntime(runtimeObjects, {
                refreshActiveState: () => refreshRuntimeActiveState(snapshot?.gameObjects)
            });
            behaviourScripts.start();
            lastUiEvent = null;
            lastUiEventPayload = null;
            state = 'running';
            emitState();
        } catch {
            fail('INVALID_SNAPSHOT', 'The persisted scene snapshot could not be loaded.');
        }
        return;
    }

    if (envelope.sessionId !== sessionId || state === 'idle' || state === 'failed') return;

    switch (envelope.command) {
        case 'uiEvent': {
            const name = envelope.payload?.name;
            if (typeof name !== 'string' || name.length === 0 || name.length > 128) {
                fail('INVALID_UI_EVENT', 'The UI event name is invalid.');
                break;
            }
            lastUiEvent = name;
            lastUiEventPayload = envelope.payload?.value === undefined ? null : envelope.payload.value;
            applyUiEventActions(name, envelope.payload?.value);
            behaviourScripts?.event(name, envelope.payload?.value);
            if (gameplay && name.toLowerCase() === 'restart') restartGameplay(gameplay);
            emitState();
            break;
        }
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
            behaviourScripts?.update(deltaTime, envelope.payload?.input || {});
            runRuntimeComponents(deltaTime, true, false);
            runtimeFixedAccumulator += deltaTime;
            let runtimeFixedSteps = 0;
            while (runtimeFixedAccumulator + 1e-9 >= DEFAULT_FIXED_STEP && runtimeFixedSteps < 5) {
                behaviourScripts?.fixedUpdate(DEFAULT_FIXED_STEP, envelope.payload?.input || {});
                runRuntimeComponents(DEFAULT_FIXED_STEP, false, true);
                processBehaviourContacts(envelope.payload?.input || {});
                runtimeFixedAccumulator -= DEFAULT_FIXED_STEP;
                runtimeFixedSteps += 1;
            }
            if (runtimeFixedSteps === 5 && runtimeFixedAccumulator >= DEFAULT_FIXED_STEP) {
                runtimeFixedAccumulator %= DEFAULT_FIXED_STEP;
            }
            if (gameplay) tickGameplay(gameplay, deltaTime, envelope.payload?.input || {});
            emitState();
            break;
        }
        case 'stop':
            snapshot = null;
            runtimeObjects = [];
            behaviourScripts = null;
            runtimeContactPairs = new Map();
            runtimeCollisionMatrix = new Array(32).fill(0xFFFFFFFF);
            runtimeFixedAccumulator = 0;
            gameplay = null;
            lastUiEvent = null;
            lastUiEventPayload = null;
            state = 'idle';
            emitState();
            sessionId = '';
            break;
        default:
            fail('UNKNOWN_COMMAND', 'The runtime command is not supported.');
    }
};
