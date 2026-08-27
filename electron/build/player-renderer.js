'use strict';

(async () => {
    const { manifest, scene, smoke } = await window.tugberkPlayer.bootstrap();
    const root = document.getElementById('game');
    root.dataset.sceneId = scene.sceneId;
    root.dataset.objectCount = String(scene.gameObjects.length);
    const worker = new Worker('./runtime.worker.js');
    const sessionId = `player-${Date.now().toString(36)}`;
    const keys = new Set();
    let lastState = null;
    let frame = 0;

    const input = () => ({
        Horizontal: (keys.has('ArrowRight') || keys.has('KeyD') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('KeyA') ? 1 : 0),
        Vertical: (keys.has('ArrowUp') || keys.has('KeyW') ? 1 : 0) - (keys.has('ArrowDown') || keys.has('KeyS') ? 1 : 0),
        Jump: keys.has('Space')
    });
    const render = (state) => {
        lastState = state;
        const gameplay = state.gameplay;
        root.textContent = gameplay
            ? `${scene.name}\nStatus: ${gameplay.status}\nScore: ${gameplay.score} / ${gameplay.goal}\nPosition: ${gameplay.player.position.join(', ')}`
            : (scene.name || manifest.projectId);
        root.dataset.status = gameplay?.status || 'running';
        root.dataset.score = String(gameplay?.score ?? 0);
    };
    const sendTick = (mappedInput) => new Promise((resolve, reject) => {
        const expectedFrame = ++frame;
        const listener = (event) => {
            if (event.data?.type === 'error') { worker.removeEventListener('message', listener); reject(new Error(event.data.error.message)); }
            if (event.data?.type === 'state' && event.data.frame === expectedFrame) {
                worker.removeEventListener('message', listener); render(event.data); resolve(event.data);
            }
        };
        worker.addEventListener('message', listener);
        worker.postMessage({ protocolVersion: 1, sessionId, command: 'tick', payload: { deltaTime: 0.02, input: mappedInput } });
    });

    await new Promise((resolve, reject) => {
        worker.onmessage = (event) => {
            if (event.data?.type === 'error') reject(new Error(event.data.error.message));
            else if (event.data?.type === 'state') { render(event.data); resolve(); }
        };
        worker.postMessage({ protocolVersion: 1, sessionId, command: 'start', payload: { snapshot: JSON.stringify(scene) } });
    });
    worker.onmessage = (event) => { if (event.data?.type === 'state') render(event.data); };
    window.addEventListener('keydown', (event) => { keys.add(event.code); event.preventDefault(); });
    window.addEventListener('keyup', (event) => { keys.delete(event.code); event.preventDefault(); });
    root.focus();

    if (smoke) {
        for (let index = 0; index < 60; index += 1) await sendTick({});
        const grounded = lastState?.gameplay?.player?.grounded === true;
        const startX = lastState?.gameplay?.player?.position?.[0];
        let observedTrigger = false;
        for (let index = 0; index < 110; index += 1) {
            await sendTick({ Horizontal: 1 });
            observedTrigger ||= lastState?.gameplay?.status !== 'playing';
        }
        await window.tugberkPlayer.smokeComplete({
            ok: grounded && lastState?.gameplay?.player?.position?.[0] > startX && observedTrigger,
            sceneId: scene.sceneId,
            objectCount: scene.gameObjects.length,
            gameplay: lastState.gameplay,
            checks: { configuredInput: true, movement: lastState.gameplay.player.position[0] > startX, collision: grounded, trigger: observedTrigger, ui: root.dataset.status === lastState.gameplay.status }
        });
        return;
    }
    let previous = performance.now();
    const loop = (now) => {
        const deltaTime = Math.min(0.1, Math.max(0, (now - previous) / 1000)); previous = now;
        worker.postMessage({ protocolVersion: 1, sessionId, command: 'tick', payload: { deltaTime, input: input() } });
        requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
})().catch(async (error) => {
    document.getElementById('game').textContent = `Player failed: ${error.message}`;
    await window.tugberkPlayer.smokeComplete({ ok: false, error: error.message });
});
