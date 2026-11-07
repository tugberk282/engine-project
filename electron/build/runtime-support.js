'use strict';

// This is the deliberately bounded contract shared by build diagnostics and the
// standalone player. Unknown component types remain serializable, but are
// reported instead of being silently treated as runtime behavior.
const SUPPORTED_RUNTIME_COMPONENTS = new Set([
    'Transform', 'RectTransform', 'MeshFilter', 'MeshRenderer', 'Camera', 'Light',
    'BoxCollider', 'SphereCollider', 'CapsuleCollider', 'RigidBody', 'AudioSource', 'AutoRotate',
    'PlayerController', 'GameplayCamera', 'GameplayUI', 'UIEventAction', 'UIText',
    'UIButton', 'UIInputField', 'UIDropdown', 'UIToggle', 'UISlider'
]);

function collectRuntimeDiagnostics(scenes) {
    const unsupported = new Map();
    const sceneDiagnostics = [];
    const visit = (node, scenePath, inheritedActive, cameras, sceneLoads) => {
        const active = inheritedActive && node?.enabled !== false;
        for (const component of Array.isArray(node?.components) ? node.components : []) {
            const type = typeof component?.type === 'string' ? component.type : '';
            if (type === 'Camera') {
                const data = { ...(component?.data || {}), ...component };
                cameras.push({
                    objectId: node?.id,
                    active: active && component?.enabled !== false,
                    renderType: data.renderType === 'Overlay' ? 'Overlay' : 'Base',
                    stackBaseCameraId: data.stackBaseCamera?.__ref || data.stackBaseCamera?.id || null
                });
            }
            if (type === 'UIEventAction' && active && component?.enabled !== false && component?.data?.enabled !== false) {
                const data = { ...(component?.data || {}), ...component };
                if (data.action === 'LoadScene' && typeof data.scenePath === 'string' && data.scenePath.trim()) {
                    sceneLoads.push(data.scenePath.replaceAll('\\', '/'));
                }
            }
            if (type && !SUPPORTED_RUNTIME_COMPONENTS.has(type)) {
                const entry = unsupported.get(type) || { type, count: 0, scenes: new Set() };
                entry.count++;
                entry.scenes.add(scenePath);
                unsupported.set(type, entry);
            }
        }
        for (const child of Array.isArray(node?.children) ? node.children : []) visit(child, scenePath, active, cameras, sceneLoads);
    };
    const selectedScenePaths = new Set(scenes.map(scene => scene.path.replaceAll('\\', '/')));
    for (const scene of scenes) {
        const cameras = [];
        const sceneLoads = [];
        for (const object of scene.value?.gameObjects || []) visit(object, scene.path, true, cameras, sceneLoads);
        const enabledCameras = cameras.filter(camera => camera.active);
        if (enabledCameras.length === 0) {
            sceneDiagnostics.push({
                type: 'MissingCamera', count: 1, scenes: [scene.path],
                message: `Scene ${scene.path} has no enabled Camera; the player will use a fallback view.`
            });
        }
        const baseCameraIds = new Set(enabledCameras
            .filter(camera => camera.renderType === 'Base')
            .map(camera => camera.objectId));
        const invalidOverlays = enabledCameras.filter(camera => camera.renderType === 'Overlay'
            && camera.stackBaseCameraId && !baseCameraIds.has(camera.stackBaseCameraId));
        if (invalidOverlays.length > 0) {
            sceneDiagnostics.push({
                type: 'InvalidCameraStack', count: invalidOverlays.length, scenes: [scene.path],
                message: `Scene ${scene.path} has ${invalidOverlays.length} Overlay camera${invalidOverlays.length === 1 ? '' : 's'} without an enabled Base camera; each will render as an independent pass.`
            });
        }
        const invalidSceneLoads = sceneLoads.filter(target => !selectedScenePaths.has(target));
        if (invalidSceneLoads.length > 0) {
            sceneDiagnostics.push({
                type: 'InvalidSceneReference', count: invalidSceneLoads.length, scenes: [scene.path],
                message: `Scene ${scene.path} has ${invalidSceneLoads.length} LoadScene target${invalidSceneLoads.length === 1 ? '' : 's'} that are not selected in Build Settings.`
            });
        }
    }
    const unsupportedDiagnostics = [...unsupported.values()]
        .sort((left, right) => left.type.localeCompare(right.type))
        .map(entry => ({ type: entry.type, count: entry.count, scenes: [...entry.scenes].sort() }));
    return [...unsupportedDiagnostics, ...sceneDiagnostics]
        .sort((left, right) => left.type.localeCompare(right.type) || left.scenes[0].localeCompare(right.scenes[0]));
}

module.exports = { SUPPORTED_RUNTIME_COMPONENTS, collectRuntimeDiagnostics };
