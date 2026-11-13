function componentData(component) {
    return { ...(component || {}), ...(component?.data || {}) };
}

export function collectPlayerModels(scene) {
    const models = [];
    const visit = (object, parentActive = true, parentPath = []) => {
        const active = parentActive && object?.enabled !== false;
        const activePath = object?.id ? [...parentPath, object.id] : parentPath;
        const modelPath = typeof object?.sourceAssetPath === 'string'
            ? object.sourceAssetPath.replaceAll('\\', '/')
            : '';
        if (object?.sourceAssetType === 'model' && /\.(?:glb|gltf)$/i.test(modelPath)) {
            const animator = (object.components || []).find((entry) => entry?.type === 'Animator' && entry.enabled !== false);
            const settings = componentData(animator);
            models.push({
                objectId: object.id,
                path: modelPath,
                active,
                activePath,
                nodes: (object.children || []).map(collectModelNode),
                animation: animator ? {
                    clip: typeof settings.currentAnimation === 'string' ? settings.currentAnimation : null,
                    speed: Number.isFinite(Number(settings.speed)) ? Number(settings.speed) : 1,
                    loop: settings.loop !== false,
                    playOnAwake: settings.playOnAwake !== false
                } : null
            });
        }
        for (const child of object?.children || []) visit(child, active, activePath);
    };
    for (const object of scene?.gameObjects || []) visit(object);
    return models;
}

export function resolvePlayerModelResource(modelPath, resourceUri) {
    if (typeof modelPath !== 'string' || typeof resourceUri !== 'string') {
        throw new Error('Model resource path must be a string');
    }
    const uri = resourceUri.split(/[?#]/, 1)[0].replaceAll('\\', '/');
    if (!uri || uri.startsWith('data:')) return null;
    if (/^[a-z][a-z0-9+.-]*:/i.test(uri) || uri.startsWith('/')) {
        throw new Error(`Model resource must be project-local: ${resourceUri}`);
    }
    let decoded;
    try {
        decoded = decodeURIComponent(uri).replaceAll('\\', '/');
    } catch {
        throw new Error(`Model resource URI is malformed: ${resourceUri}`);
    }
    const parts = modelPath.replaceAll('\\', '/').split('/');
    parts.pop();
    for (const segment of decoded.split('/')) {
        if (!segment || segment === '.') continue;
        if (segment === '..') {
            if (parts.length <= 1) throw new Error(`Model resource escapes Assets: ${resourceUri}`);
            parts.pop();
            continue;
        }
        parts.push(segment);
    }
    const resolved = parts.join('/');
    if (!resolved.startsWith('Assets/') || !/\.(?:bin|png|jpe?g|webp)$/i.test(resolved)) {
        throw new Error(`Model resource is not an allowed local dependency: ${resourceUri}`);
    }
    return resolved;
}

export function collectPlayerModelResources(modelPath, document) {
    const resources = new Map();
    const collect = (entry) => {
        if (typeof entry?.uri !== 'string' || entry.uri.startsWith('data:')) return;
        const resolved = resolvePlayerModelResource(modelPath, entry.uri);
        if (resolved) resources.set(entry.uri, resolved);
    };
    for (const buffer of document?.buffers || []) collect(buffer);
    for (const image of document?.images || []) collect(image);
    return resources;
}

function collectModelNode(object) {
    return {
        objectId: object?.id || null,
        name: String(object?.name || ''),
        transform: object?.transform || null,
        children: (object?.children || []).map(collectModelNode)
    };
}

export function bindPlayerModelHierarchy(authoredNodes, modelRoot, bind) {
    const visit = (nodes, parent) => {
        const available = [...(parent?.children || [])];
        for (const [index, authored] of (nodes || []).entries()) {
            let target = available[index] || null;
            if (authored.name) {
                const named = available.find((candidate) => candidate?.name === authored.name);
                if (named) target = named;
            }
            if (!target) continue;
            if (authored.objectId) bind(authored.objectId, target, authored);
            visit(authored.children, target);
        }
    };
    visit(authoredNodes, modelRoot);
}

export function selectPlayerAnimationClip(clips, requestedName) {
    if (!Array.isArray(clips) || clips.length === 0) return null;
    return clips.find((clip) => clip?.name === requestedName) || clips[0] || null;
}

export function createPlayerAnimationController(THREE, descriptor, gltf) {
    const mixer = new THREE.AnimationMixer(gltf.scene);
    let currentAction = null;
    return {
        descriptor,
        mixer,
        play(requestedName) {
            const clip = selectPlayerAnimationClip(gltf.animations, requestedName || descriptor.animation?.clip);
            if (!clip) return null;
            currentAction?.stop?.();
            currentAction = mixer.clipAction(clip);
            currentAction.setLoop(descriptor.animation?.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
            currentAction.clampWhenFinished = descriptor.animation?.loop !== true;
            currentAction.timeScale = descriptor.animation?.speed ?? 1;
            currentAction.play();
            return clip.name || null;
        },
        stop() {
            currentAction?.stop?.();
            currentAction = null;
        }
    };
}

export function consumePlayerAnimationCommands(commands, lastSequence, controllers, pendingByObject = null) {
    let consumedSequence = Number.isInteger(lastSequence) ? lastSequence : 0;
    for (const command of commands || []) {
        if (!Number.isInteger(command?.sequence) || command.sequence <= consumedSequence) continue;
        if (command.command === 'play' || command.command === 'stop') {
            if (pendingByObject instanceof Map && typeof command.objectId === 'string') {
                pendingByObject.set(command.objectId, {
                    command: command.command,
                    ...(typeof command.clip === 'string' ? { clip: command.clip } : {})
                });
            }
            for (const controller of controllers || []) {
                if (controller?.descriptor?.objectId !== command.objectId) continue;
                if (command.command === 'play') controller.play?.(command.clip);
                else controller.stop?.();
                pendingByObject?.delete?.(command.objectId);
            }
        }
        consumedSequence = Math.max(consumedSequence, command.sequence);
    }
    return consumedSequence;
}

export function updatePlayerAnimationControllers(controllers, deltaTime, isActive) {
    if (!(typeof deltaTime === 'number' && Number.isFinite(deltaTime) && deltaTime > 0)) return;
    for (const controller of controllers || []) {
        if (!controller?.mixer || isActive?.(controller.descriptor) === false) continue;
        controller.mixer.update(deltaTime);
    }
}
