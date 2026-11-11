export function collectPlayerAudioGraph(scene) {
    const sources = [];
    const listeners = [];
    let listenerObjectId = null;
    const visit = (node, parentActive = true, parentPath = []) => {
        const active = parentActive && node?.enabled !== false;
        const activePath = node?.id ? [...parentPath, node.id] : parentPath;
        for (const component of node?.components || []) {
            const data = component?.data && typeof component.data === 'object' ? component.data : {};
            if (component?.enabled === false || data.enabled === false) continue;
            if (component.type === 'AudioListener') {
                const listener = { objectId: node.id, active, activePath };
                listeners.push(listener);
                if (active && listenerObjectId === null) listenerObjectId = node.id;
            }
            if (component.type === 'AudioSource') {
                sources.push({ objectId: node.id, active, activePath, settings: { ...data, ...component } });
            }
        }
        for (const child of node?.children || []) visit(child, active, activePath);
    };
    for (const node of scene?.gameObjects || []) visit(node);
    return { listenerObjectId, listeners, sources };
}

export function isPlayerAudioActive(activePath, transforms) {
    const activeById = transforms instanceof Map
        ? transforms
        : new Map((transforms || []).map((entry) => [entry.id, entry.active !== false]));
    return !(activePath || []).some((id) => activeById.get(id) === false);
}

export function createWebAudioPlayback(audioContext, buffer, descriptor) {
    const settings = descriptor.settings;
    let source = null;
    let gain = null;
    let panner = null;
    let generation = 0;
    let desiredActive = false;
    const clearNodes = (stopSource) => {
        generation += 1;
        const previous = source;
        source = null;
        if (previous) {
            if (stopSource) {
                try { previous.stop(); } catch {}
            }
            previous.disconnect?.();
        }
        gain?.disconnect?.();
        panner?.disconnect?.();
        gain = null;
        panner = null;
    };
    const start = () => {
        if (source || settings.playOnAwake === false) return;
        const currentGeneration = ++generation;
        source = audioContext.createBufferSource();
        gain = audioContext.createGain();
        source.buffer = buffer;
        source.loop = settings.loop === true;
        const pitch = Number(settings.pitch);
        source.playbackRate.value = Math.max(0.01, Number.isFinite(pitch) ? pitch : 1);
        const volume = Number(settings.volume);
        gain.gain.value = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 1));
        if (settings.spatial !== false) {
            panner = audioContext.createPanner();
            panner.panningModel = 'HRTF';
            panner.distanceModel = 'inverse';
            panner.refDistance = 1;
            source.connect(gain).connect(panner).connect(audioContext.destination);
        } else {
            source.connect(gain).connect(audioContext.destination);
        }
        source.onended = () => {
            if (currentGeneration === generation && settings.loop !== true) clearNodes(false);
        };
        source.start();
        void audioContext.resume?.().catch?.(() => {});
    };
    return {
        descriptor,
        sync(active) {
            if (active === desiredActive) return;
            desiredActive = active;
            if (active) start(); else clearNodes(true);
        },
        stop() { desiredActive = false; clearNodes(true); },
        get panner() { return panner; }
    };
}
