export function createPlayerScene(THREE, document) {
    const scene = new THREE.Scene();
    const environmentBackground = new THREE.Color(document.environment?.backgroundColor || '#20323a');
    scene.background = environmentBackground;
    const authoredFog = document.environment?.fog;
    if (authoredFog?.enabled) {
        scene.fog = authoredFog.mode === 'Exp2'
            ? new THREE.FogExp2(authoredFog.color || '#cccccc', Math.max(0, Number(authoredFog.density) || 0.02))
            : new THREE.Fog(
                authoredFog.color || '#cccccc',
                Math.max(0, Number(authoredFog.near) || 1),
                Math.max(Number(authoredFog.near) || 1, Number(authoredFog.far) || 50)
            );
    }
    const objects = new Map();
    const externalObjects = new Map();
    const cameras = [];
    let player = null;
    let meshCount = 0;
    let cameraIndex = 0;
    const components = (node, type) => (node.components || []).filter(c => c.type === type && c.enabled !== false);
    const data = c => ({ ...c, ...c?.data });
    const colorValue = value => {
        if (Array.isArray(value) && value.length >= 3) {
            const color = new THREE.Color();
            color.fromArray(value);
            return color;
        }
        return value || '#ffffff';
    };
    const geometry = type => {
        switch (type) {
            case 'Cube': return new THREE.BoxGeometry(1, 1, 1);
            case 'Sphere': return new THREE.SphereGeometry(0.5, 24, 16);
            case 'Capsule': return new THREE.CapsuleGeometry(0.5, 1, 8, 16);
            case 'Cylinder': return new THREE.CylinderGeometry(0.5, 0.5, 2, 24);
            case 'Plane': return new THREE.PlaneGeometry(10, 10).rotateX(-Math.PI / 2);
            case 'Quad': return new THREE.PlaneGeometry(1, 1);
            default: return null;
        }
    };
    const visit = (node, parent) => {
        const object = new THREE.Group();
        object.name = node.name || '';
        object.visible = node.enabled !== false;
        object.layers.set(Number.isInteger(node.layer) ? Math.max(0, Math.min(31, node.layer)) : 0);
        objects.set(node.id, object);
        const transform = node.transform || {};
        object.position.fromArray(transform.position || [0, 0, 0]);
        object.rotation.fromArray(transform.rotation || [0, 0, 0]);
        object.scale.fromArray(transform.scale || [1, 1, 1]);
        parent.add(object);
        const filter = data(components(node, 'MeshFilter')[0]);
        const renderer = components(node, 'MeshRenderer')[0];
        const shape = renderer && geometry(filter.primitiveType || filter.geometryType);
        if (shape) {
            const settings = data(renderer);
            const material = new THREE.MeshStandardMaterial({
                color: colorValue(settings.color || '#cccccc'),
                metalness: Number.isFinite(Number(settings.metalness)) ? Math.max(0, Math.min(1, Number(settings.metalness))) : 0,
                roughness: Number.isFinite(Number(settings.roughness)) ? Math.max(0, Math.min(1, Number(settings.roughness))) : 1
            });
            const mesh = new THREE.Mesh(shape, material);
            mesh.layers.mask = object.layers.mask;
            if (typeof settings.materialPath === 'string' && settings.materialPath.length > 0) {
                mesh.userData.materialPath = settings.materialPath;
            }
            mesh.castShadow = settings.castShadow !== false;
            mesh.receiveShadow = settings.receiveShadow !== false;
            object.add(mesh);
            meshCount++;
        }
        for (const entry of components(node, 'Camera')) {
            const settings = data(entry);
            const camera = settings.orthographic
                ? new THREE.OrthographicCamera(-5, 5, 5, -5, settings.nearClipPlane ?? 0.1, settings.farClipPlane ?? 1000)
                : new THREE.PerspectiveCamera(settings.fieldOfView ?? 60, 1, settings.nearClipPlane ?? 0.1, settings.farClipPlane ?? 1000);
            camera.userData.orthographicSize = settings.orthographicSize ?? 5;
            camera.layers.mask = settings.cullingMask === undefined || settings.cullingMask === -1
                ? 0xFFFFFFFF
                : (Number(settings.cullingMask) >>> 0);
            object.add(camera);
            cameras.push({
                camera,
                objectId: node.id,
                index: cameraIndex++,
                main: settings.isMain === true || node.tag === 'MainCamera',
                clearFlags: settings.clearFlags || 'Solid Color',
                clearColor: colorValue(settings.clearColor || '#334c66'),
                clearAlpha: Number.isFinite(Number(settings.clearAlpha)) ? Math.max(0, Math.min(1, Number(settings.clearAlpha))) : 1,
                viewportRect: settings.viewportRect,
                renderType: settings.renderType === 'Overlay' ? 'Overlay' : 'Base',
                stackBaseCameraId: settings.stackBaseCamera?.__ref || settings.stackBaseCamera?.id || null,
                depth: Number(settings.depth) || 0
            });
        }
        for (const entry of components(node, 'Light')) {
            const settings = data(entry);
            const light = settings.lightType === 'Point'
                ? new THREE.PointLight(colorValue(settings.color), settings.intensity ?? 1, settings.range ?? 10)
                : settings.lightType === 'Spot'
                    ? new THREE.SpotLight(
                        colorValue(settings.color), settings.intensity ?? 1,
                        settings.range ?? 10, (settings.spotAngle ?? 30) * Math.PI / 180,
                        settings.penumbra ?? 0, settings.decay ?? 2
                    )
                    : settings.lightType === 'Ambient'
                        ? new THREE.AmbientLight(colorValue(settings.color), settings.intensity ?? 1)
                    : new THREE.DirectionalLight(colorValue(settings.color), settings.intensity ?? 1);
            light.layers.mask = settings.cullingMask === undefined || settings.cullingMask === -1
                ? 0xFFFFFFFF
                : (Number(settings.cullingMask) >>> 0);
            if ('castShadow' in light) {
                light.castShadow = settings.castShadows !== false;
                if (light.shadow) {
                    const resolution = Math.max(16, Math.min(8192, Math.trunc(Number(settings.shadowResolution) || 1024)));
                    light.shadow.mapSize.set(resolution, resolution);
                    light.shadow.bias = Number.isFinite(Number(settings.shadowBias)) ? Number(settings.shadowBias) : -0.0001;
                    light.shadow.normalBias = Number.isFinite(Number(settings.shadowNormalBias)) ? Number(settings.shadowNormalBias) : 0.02;
                    light.shadow.radius = Math.max(0, Number(settings.shadowRadius) || 0);
                }
            }
            object.add(light);
            if (light.target) { light.target.position.set(0, 0, -1); object.add(light.target); }
        }
        if (components(node, 'PlayerController').length) player ??= object;
        for (const child of node.children || []) visit(child, object);
    };
    for (const node of document.gameObjects || []) visit(node, scene);
    scene.add(new THREE.AmbientLight(document.environment?.ambientColor || '#ffffff', document.environment?.ambientIntensity ?? 0.8));
    const depthOrderedCameras = [...cameras].sort((left, right) => left.depth - right.depth || left.index - right.index);
    const knownBaseCameraIds = new Set(depthOrderedCameras
        .filter(entry => entry.renderType !== 'Overlay')
        .map(entry => entry.objectId));
    const baseCameras = depthOrderedCameras.filter(entry =>
        entry.renderType !== 'Overlay' || !entry.stackBaseCameraId || !knownBaseCameraIds.has(entry.stackBaseCameraId)
    );
    const renderPasses = [];
    for (const base of baseCameras) {
        renderPasses.push(base);
        depthOrderedCameras
            .filter(entry => entry.renderType === 'Overlay' && entry.stackBaseCameraId === base.objectId)
            .forEach(entry => renderPasses.push(entry));
    }
    const selectedCamera = cameras.find(entry => entry.main)
        || [...cameras].sort((left, right) => right.depth - left.depth || left.index - right.index)[0];
    const camera = selectedCamera?.camera || new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    if (selectedCamera?.clearFlags === 'Solid Color') scene.background = new THREE.Color(selectedCamera.clearColor);
    camera.userData.clearAlpha = selectedCamera?.clearAlpha ?? 1;
    const normalizeViewport = authored => {
        const source = authored || { x: 0, y: 0, width: 1, height: 1 };
        const normalized = {
            width: Math.max(0.001, Math.min(1, Number(source.width) || 1)),
            height: Math.max(0.001, Math.min(1, Number(source.height) || 1))
        };
        normalized.x = Math.max(0, Math.min(1 - normalized.width, Number(source.x) || 0));
        normalized.y = Math.max(0, Math.min(1 - normalized.height, Number(source.y) || 0));
        return normalized;
    };
    for (const entry of renderPasses) {
        entry.viewportRect = normalizeViewport(entry.viewportRect);
        entry.camera.userData.viewportRect = entry.viewportRect;
        entry.camera.userData.clearAlpha = entry.clearAlpha;
    }
    const fallbackPass = {
        camera,
        clearFlags: 'Solid Color',
        clearColor: environmentBackground,
        clearAlpha: 1,
        viewportRect: normalizeViewport(),
        renderType: 'Base',
        stackBaseCameraId: null,
        depth: 0
    };
    if (renderPasses.length === 0) renderPasses.push(fallbackPass);
    if (!camera.parent) { camera.position.set(5, 7, 12); camera.lookAt(0, 0, 0); scene.add(camera); }
    const resize = (width, height) => {
        for (const entry of renderPasses) {
            const aspect = Math.max(1, width * entry.viewportRect.width) / Math.max(1, height * entry.viewportRect.height);
            if (entry.camera.isOrthographicCamera) {
                const size = entry.camera.userData.orthographicSize;
                entry.camera.left = -size * aspect; entry.camera.right = size * aspect;
                entry.camera.top = size; entry.camera.bottom = -size;
            } else entry.camera.aspect = aspect;
            entry.camera.updateProjectionMatrix();
        }
    };
    const viewportPixels = (width, height, entry = selectedCamera || fallbackPass) => {
        const viewport = entry.viewportRect || normalizeViewport();
        return {
            x: Math.round(Math.max(1, width) * viewport.x),
            y: Math.round(Math.max(1, height) * viewport.y),
            width: Math.max(1, Math.round(Math.max(1, width) * viewport.width)),
            height: Math.max(1, Math.round(Math.max(1, height) * viewport.height))
        };
    };
    const update = state => {
        for (const transform of state.transforms || []) {
            const object = objects.get(transform.id);
            if (!object) continue;
            if (typeof transform.active === 'boolean') object.visible = transform.active;
            object.position.fromArray(transform.position);
            object.rotation.fromArray(transform.rotation);
            object.scale.fromArray(transform.scale);
            const external = externalObjects.get(transform.id);
            if (external) {
                if (typeof transform.active === 'boolean') external.visible = transform.active;
                external.position.fromArray(transform.position);
                external.rotation.fromArray(transform.rotation);
                external.scale.fromArray(transform.scale);
            }
        }
        if (player && state.gameplay?.player) player.position.fromArray(state.gameplay.player.position);
        const view = state.gameplay?.camera;
        if (view) {
            scene.updateMatrixWorld(true);
            const position = new THREE.Vector3().fromArray(view.position);
            camera.position.copy(camera.parent ? camera.parent.worldToLocal(position) : position);
            camera.lookAt(new THREE.Vector3().fromArray(view.target));
        }
        scene.updateMatrixWorld(true);
    };
    const dispose = () => scene.traverse(object => {
        object.geometry?.dispose();
        if (object.material) object.material.dispose();
    });
    const bindExternalObject = (objectId, object) => {
        if (typeof objectId === 'string' && object) externalObjects.set(objectId, object);
    };
    return { scene, camera, renderPasses, environmentBackground, objects, meshCount, resize, viewportPixels, update, bindExternalObject, dispose };
}
