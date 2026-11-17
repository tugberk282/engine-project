const FALLBACK_MESSAGE = 'The game stopped because its runtime encountered an error. Re-export the game and try again.';

export function createPlayerResponseWatchdog(now = () => performance.now(), timeoutMs = 10_000) {
    let pendingSince = null;
    return {
        request() { if (pendingSince === null) pendingSince = now(); },
        acknowledge() { pendingSince = null; },
        check(visible = true) {
            if (!visible) { pendingSince = null; return false; }
            return pendingSince !== null && now() - pendingSince >= timeoutMs;
        }
    };
}

export function startPlayerWorker(worker, envelope, render, timeoutMs = 10_000) {
    return new Promise((resolve, reject) => {
        const finish = (error, state) => {
            clearTimeout(timer);
            worker.removeEventListener('message', onMessage);
            worker.removeEventListener('error', onError);
            worker.removeEventListener('messageerror', onMessageError);
            if (error) reject(error); else resolve(state);
        };
        const failure = (code, message) => Object.assign(new Error(message), { code });
        const onError = () => finish(failure('PLAYER_RUNTIME_WORKER_CRASHED', 'The runtime worker could not start.'));
        const onMessageError = () => finish(failure('PLAYER_RUNTIME_MESSAGE_FAILED', 'The runtime response could not be read.'));
        const onMessage = (event) => {
            const data = event.data;
            if (data?.sessionId !== envelope.sessionId) return;
            if (data.type === 'error') finish(failure(data.error?.code || 'PLAYER_RUNTIME_START_FAILED', data.error?.message || 'The runtime could not start.'));
            else if (data.type === 'state') {
                try { render(data); finish(null, data); } catch (error) { finish(error); }
            }
        };
        const timer = setTimeout(() => finish(failure('PLAYER_RUNTIME_START_TIMEOUT', 'The runtime did not start within the allowed time.')), timeoutMs);
        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', onError);
        worker.addEventListener('messageerror', onMessageError);
        try { worker.postMessage(envelope); } catch (error) { finish(error); }
    });
}

export async function attachPlayerTexture(load, isDisposed, attach) {
    if (isDisposed()) return false;
    const texture = await load();
    if (isDisposed()) {
        texture.dispose();
        return false;
    }
    try {
        attach(texture);
        return true;
    } catch (error) {
        texture.dispose();
        throw error;
    }
}

export function disposePlayerModel(root) {
    const resources = new Set();
    if (root.background?.isTexture) resources.add(root.background);
    if (root.environment?.isTexture) resources.add(root.environment);
    root.traverse((entry) => {
        if (entry.shadow?.map) resources.add(entry.shadow.map);
        if (entry.shadow?.mapPass) resources.add(entry.shadow.mapPass);
        if (entry.geometry) resources.add(entry.geometry);
        for (const material of Array.isArray(entry.material) ? entry.material : [entry.material]) {
            if (!material) continue;
            resources.add(material);
            for (const value of Object.values(material)) if (value?.isTexture) resources.add(value);
        }
    });
    const errors = [];
    for (const resource of resources) {
        try { resource.dispose(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'Player model cleanup failed');
}

export function normalizePlayerRuntimeFailure(value, fallbackCode = 'PLAYER_RUNTIME_FAILED') {
    const source = value?.error && typeof value.error === 'object' ? value.error : value;
    const candidateCode = String(source?.code || '').trim();
    const safeFallback = /^[A-Z][A-Z0-9_]{2,63}$/.test(fallbackCode)
        ? fallbackCode
        : 'PLAYER_RUNTIME_FAILED';
    const code = /^[A-Z][A-Z0-9_]{2,63}$/.test(candidateCode) ? candidateCode : safeFallback;
    const diagnostic = String(source?.message || 'The runtime stopped without diagnostic details.').slice(0, 500);
    return Object.freeze({ code, message: FALLBACK_MESSAGE, diagnostic });
}

export function mountPlayerRuntimeFailure(document, root, failure) {
    document.title = 'Tugberk Player - Runtime Error';
    root.dataset.runtimeError = failure.code;
    root.replaceChildren();
    const container = document.createElement('section');
    container.className = 'player-runtime-error';
    container.setAttribute('role', 'alert');
    const card = document.createElement('div');
    card.className = 'player-runtime-error__card';
    const heading = document.createElement('h1');
    heading.textContent = 'The game has stopped';
    const message = document.createElement('p');
    message.textContent = failure.message;
    const code = document.createElement('code');
    code.textContent = failure.code;
    card.append(heading, message, code);
    container.append(card);
    root.append(container);
    return container;
}
