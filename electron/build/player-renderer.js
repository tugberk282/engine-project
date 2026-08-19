'use strict';

(async () => {
    const { manifest, scene } = await window.tugberkPlayer.bootstrap();
    const root = document.getElementById('game');
    root.dataset.sceneId = scene.sceneId;
    root.dataset.objectCount = String(scene.gameObjects.length);
    root.textContent = scene.name || manifest.projectId;
    window.dispatchEvent(new CustomEvent('tugberk-player-ready', { detail: { manifest, scene } }));
    // Main ignores this in normal play and accepts it only when launched by the smoke harness.
    await window.tugberkPlayer.smokeComplete({ ok: true, sceneId: scene.sceneId, objectCount: scene.gameObjects.length });
})().catch(async (error) => {
    document.getElementById('game').textContent = `Player failed: ${error.message}`;
    await window.tugberkPlayer.smokeComplete({ ok: false, error: error.message });
});
