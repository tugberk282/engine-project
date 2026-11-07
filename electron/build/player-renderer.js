'use strict';
import * as THREE from './three.module.js';
import { createPlayerScene } from './player-scene.mjs';
import { collectPlayerSceneLoadActions, collectPlayerUiControls, collectPlayerUiText, mountPlayerUiControls } from './player-ui.mjs';

(async () => {
    const { manifest, scenePath, scene, smoke, sceneSwitchSmoke } = await window.tugberkPlayer.bootstrap();
    const root = document.getElementById('game');
    if (sceneSwitchSmoke) {
        const target = manifest.scenes.find((entry) => entry.path !== manifest.entryScene);
        if (!target) {
            await window.tugberkPlayer.smokeComplete({ ok: false, error: 'Scene switch smoke requires two built scenes' });
            return;
        }
        if (scenePath !== manifest.entryScene) {
            await window.tugberkPlayer.smokeComplete({
            ok: manifest.scenes.some((entry) => entry.path === scenePath && entry.sceneId === scene.sceneId),
            scenePath,
            sceneId: scene.sceneId,
            target
            });
            return;
        }
    }
    const gameplayUi = scene.gameObjects
        .flatMap((gameObject) => gameObject.components || [])
        .find((component) => component.type === 'GameplayUI')?.data || {};
    const uiButtons = Array.isArray(gameplayUi.buttons) ? gameplayUi.buttons : [];
    const authoredUiControls = collectPlayerUiControls(scene);
    const authoredUiText = collectPlayerUiText(scene);
    const sceneLoadActions = collectPlayerSceneLoadActions(scene);
    const rawInputMap = scene.inputMap && typeof scene.inputMap === 'object' ? scene.inputMap : {};
    const inputAxes = Object.fromEntries(Object.entries(rawInputMap.axes || {}).map(([name, value]) => {
        const axis = value && typeof value === 'object' ? value : {};
        const normalize = (binding) => {
            if (typeof binding !== 'string') return '';
            const raw = binding.trim();
            if (!raw) return '';
            if (raw === ' ') return 'Space';
            if (/^(Key|Arrow|Numpad|Mouse|Gamepad)/.test(raw)) return raw;
            return /^[a-z]$/i.test(raw) ? `Key${raw.toUpperCase()}` : raw;
        };
        return [name, {
            positive: normalize(axis.positive ?? axis.positiveButton),
            negative: normalize(axis.negative ?? axis.negativeButton),
            positiveAlt: normalize(axis.positiveAlt ?? axis.altPositiveButton),
            negativeAlt: normalize(axis.negativeAlt ?? axis.altNegativeButton)
        }];
    }));
    const inputActions = Object.fromEntries(Object.entries(rawInputMap.actions || {}).map(([name, bindings]) => [
        name,
        Array.isArray(bindings) ? bindings.filter((binding) => typeof binding === 'string').map((binding) => {
            const raw = binding.trim();
            return raw === ' ' ? 'Space' : /^[a-z]$/i.test(raw) ? `Key${raw.toUpperCase()}` : raw;
        }) : []
    ]));
    const hud = document.createElement('section');
    hud.id = 'player-hud';
    hud.setAttribute('aria-live', 'polite');
    hud.setAttribute('aria-label', 'Game status');
    root.replaceChildren(hud);
    const statusLayer = document.createElement('div');
    const controlsLayer = document.createElement('div');
    const textLayer = document.createElement('div');
    textLayer.id = 'player-ui-text';
    controlsLayer.id = 'player-ui-controls';
    hud.append(statusLayer, textLayer, controlsLayer);
    const view = createPlayerScene(THREE, scene);
    const audioSources = [];
    const spatialAudio = [];
    const audioContext = typeof window.AudioContext === 'function' ? new window.AudioContext() : null;
    const audioMime = (audioPath) => {
        const extension = audioPath.split('.').pop()?.toLowerCase();
        return extension === 'wav' ? 'audio/wav'
            : extension === 'ogg' ? 'audio/ogg'
                : extension === 'm4a' ? 'audio/mp4'
                    : extension === 'flac' ? 'audio/flac'
                        : 'audio/mpeg';
    };
    const visitAudio = (node) => {
        for (const component of node.components || []) {
            if (component.type !== 'AudioSource' || component.enabled === false) continue;
            const settings = { ...(component.data || {}), ...component };
            const clipPath = typeof settings.clipPath === 'string' ? settings.clipPath.replaceAll('\\', '/') : '';
            if (!clipPath.startsWith('Assets/') || clipPath.includes('..') || clipPath.includes(':')) continue;
            audioSources.push(window.tugberkPlayer.readAudioAsset(clipPath).then(async (bytes) => {
                if (audioContext) {
                    const raw = bytes instanceof Uint8Array
                        ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
                        : bytes;
                    const buffer = await audioContext.decodeAudioData(raw);
                    const source = audioContext.createBufferSource();
                    const gain = audioContext.createGain();
                    source.buffer = buffer;
                    source.loop = settings.loop === true;
                    const pitch = Number(settings.pitch);
                    source.playbackRate.value = Math.max(0.01, Number.isFinite(pitch) ? pitch : 1);
                    const volume = Number(settings.volume);
                    gain.gain.value = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 1));
                    if (settings.spatial !== false) {
                        const panner = audioContext.createPanner();
                        panner.panningModel = 'HRTF';
                        panner.distanceModel = 'inverse';
                        panner.refDistance = 1;
                        source.connect(gain).connect(panner).connect(audioContext.destination);
                        spatialAudio.push({ panner, objectId: node.id });
                    } else {
                        source.connect(gain).connect(audioContext.destination);
                    }
                    audioSources.push({ stop: () => source.stop(), close: () => source.disconnect() });
                    if (settings.playOnAwake !== false) {
                        void audioContext.resume().catch(() => {});
                        source.start();
                    }
                    return;
                }
                const audio = new Audio(URL.createObjectURL(new Blob([bytes], { type: audioMime(clipPath) })));
                const volume = Number(settings.volume);
                audio.volume = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 1));
                audio.loop = settings.loop === true;
                const pitch = Number(settings.pitch);
                audio.playbackRate = Math.max(0.01, Number.isFinite(pitch) ? pitch : 1);
                if (settings.playOnAwake !== false) void audio.play().catch(() => {});
                audioSources.push(audio);
            }).catch(() => {}));
        }
        for (const child of node.children || []) visitAudio(child);
    };
    for (const gameObject of scene.gameObjects || []) visitAudio(gameObject);
    const materialLoads = [];
    const imageMime = (assetPath) => {
        const extension = assetPath.split('.').pop()?.toLowerCase();
        return extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : extension === 'webp' ? 'image/webp' : 'image/png';
    };
    const loadMaterialTexture = async (object, texturePath, slot = 'map') => {
        if (!texturePath || !object.material || typeof window.tugberkPlayer.readImageAsset !== 'function') return;
        const safePath = String(texturePath).replaceAll('\\', '/');
        if (!safePath.startsWith('Assets/') || safePath.includes('..') || safePath.includes(':')) return;
        const bytes = await window.tugberkPlayer.readImageAsset(safePath);
        const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        const blob = new Blob([raw], { type: imageMime(safePath) });
        const url = URL.createObjectURL(blob);
        try {
            const texture = await new Promise((resolve, reject) => new THREE.TextureLoader().load(url, resolve, undefined, reject));
            texture.colorSpace = slot === 'map' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
            object.material[slot] = texture;
            object.material.needsUpdate = true;
        } finally { URL.revokeObjectURL(url); }
    };
    view.scene.traverse((object) => {
        const materialPath = object.userData?.materialPath;
        if (!materialPath || !object.material) return;
        const safePath = materialPath.replaceAll('\\', '/');
        if (!safePath.startsWith('Assets/') || safePath.includes('..') || safePath.includes(':')) return;
        materialLoads.push(window.tugberkPlayer.readJsonAsset(safePath)
            .then((material) => {
                const properties = material?.properties && typeof material.properties === 'object' ? material.properties : material || {};
                if (!object.material) return;
                if (typeof properties.color === 'string') object.material.color.set(properties.color);
                if (Number.isFinite(Number(properties.metalness))) object.material.metalness = Math.max(0, Math.min(1, Number(properties.metalness)));
                if (Number.isFinite(Number(properties.roughness))) object.material.roughness = Math.max(0, Math.min(1, Number(properties.roughness)));
                if (typeof properties.emission === 'string' && 'emissive' in object.material) object.material.emissive.set(properties.emission);
                if (Number.isFinite(Number(properties.emissionIntensity)) && 'emissiveIntensity' in object.material) object.material.emissiveIntensity = Math.max(0, Number(properties.emissionIntensity));
                const alphaMode = properties.alphaMode;
                if (alphaMode === 'Fade' || alphaMode === 'Transparent' || alphaMode === 'Cutout') {
                    object.material.transparent = alphaMode !== 'Cutout';
                    object.material.depthWrite = alphaMode !== 'Transparent';
                    if (alphaMode === 'Cutout' && Number.isFinite(Number(properties.alphaCutoff))) object.material.alphaTest = Math.max(0, Math.min(1, Number(properties.alphaCutoff)));
                    if (alphaMode !== 'Cutout' && Number.isFinite(Number(properties.surfaceOpacity))) object.material.opacity = Math.max(0, Math.min(1, Number(properties.surfaceOpacity)));
                }
                object.material.needsUpdate = true;
                return Promise.all([
                    loadMaterialTexture(object, properties.mainTexturePath || properties.texturePath || material.mainTexturePath, 'map'),
                    loadMaterialTexture(object, properties.normalMapPath || material.normalMapPath, 'normalMap'),
                    loadMaterialTexture(object, properties.metallicMapPath || material.metallicMapPath, 'metalnessMap'),
                    loadMaterialTexture(object, properties.roughnessMapPath || material.roughnessMapPath, 'roughnessMap')
                ]);
            }).catch(() => {}));
    });
    await Promise.all(materialLoads);
    await Promise.all(audioSources);
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: smoke });
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const toneMapping = scene.environment?.toneMapping || {};
    renderer.toneMapping = ({
        Linear: THREE.LinearToneMapping,
        Reinhard: THREE.ReinhardToneMapping,
        Cineon: THREE.CineonToneMapping,
        ACESFilmic: THREE.ACESFilmicToneMapping
    })[toneMapping.mode] ?? THREE.NoToneMapping;
    renderer.toneMappingExposure = Number.isFinite(Number(toneMapping.exposure))
        ? Math.max(0, Number(toneMapping.exposure))
        : 1;
    renderer.setClearAlpha(Number.isFinite(Number(view.camera.userData.clearAlpha)) ? view.camera.userData.clearAlpha : 1);
    renderer.autoClear = false;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    root.prepend(renderer.domElement);
    let renderWidth = 1;
    let renderHeight = 1;
    const resize = () => {
        const width = Math.max(1, root.clientWidth);
        const height = Math.max(1, root.clientHeight);
        renderWidth = width;
        renderHeight = height;
        renderer.setSize(width, height, false);
        view.resize(width, height);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(root);
    resize();
    root.dataset.sceneId = scene.sceneId;
    root.dataset.objectCount = String(scene.gameObjects.length);
    const worker = new Worker('./runtime.worker.js');
    const sessionId = `player-${Date.now().toString(36)}`;
    const keys = new Set();
    const mouse = { deltaX: 0, deltaY: 0 };
    const gamepadAxis = (value) => {
        const axis = Number.isFinite(value) ? value : 0;
        return Math.abs(axis) < 0.15 ? 0 : Math.max(-1, Math.min(1, axis));
    };
    const gamepadInput = () => {
        const pad = navigator.getGamepads?.().find((candidate) => candidate?.connected);
        if (!pad) return { horizontal: 0, vertical: 0, jump: false };
        return {
            horizontal: gamepadAxis(pad.axes?.[0]),
            vertical: -gamepadAxis(pad.axes?.[1]),
            jump: pad.buttons?.[0]?.pressed === true || pad.buttons?.[1]?.pressed === true
        };
    };
    let lastState = null;
    let frame = 0;
    const mountedControls = new Set();
    let sceneTransitionStarted = false;

    const input = () => {
        const pad = gamepadInput();
        const axisValue = (name, fallbackPositive, fallbackNegative, alternatePositive, alternateNegative) => {
            const axis = inputAxes[name];
            const positives = axis ? [axis.positive, axis.positiveAlt] : [fallbackPositive, alternatePositive];
            const negatives = axis ? [axis.negative, axis.negativeAlt] : [fallbackNegative, alternateNegative];
            return (positives.some((binding) => binding && keys.has(binding)) ? 1 : 0)
                - (negatives.some((binding) => binding && keys.has(binding)) ? 1 : 0);
        };
        const actionValue = (name, fallback) => {
            const bindings = inputActions[name];
            return (bindings?.length ? bindings : fallback).some((binding) => keys.has(binding));
        };
        const keyboardHorizontal = axisValue('Horizontal', 'ArrowRight', 'ArrowLeft', 'KeyD', 'KeyA');
        const keyboardVertical = axisValue('Vertical', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyS');
        return {
            Horizontal: keyboardHorizontal || pad.horizontal,
            Vertical: keyboardVertical || pad.vertical,
            Jump: actionValue('Jump', ['Space']) || pad.jump,
            LookX: mouse.deltaX,
            LookY: mouse.deltaY
        };
    };
    const render = (state) => {
        lastState = state;
        view.update(state);
        const loadAction = state.lastUiEvent
            ? sceneLoadActions.find((entry) => entry.eventName === state.lastUiEvent)
            : null;
        if (loadAction && !sceneTransitionStarted) {
            sceneTransitionStarted = true;
            root.dataset.sceneTransition = loadAction.scenePath;
            void window.tugberkPlayer.activateScene(loadAction.scenePath).catch((error) => {
                sceneTransitionStarted = false;
                root.dataset.sceneTransitionError = error.message;
                statusLayer.textContent = `Scene load failed: ${error.message}`;
            });
        }
        for (const entry of spatialAudio) {
            const object = view.objects.get(entry.objectId);
            if (!object) continue;
            const position = new THREE.Vector3();
            object.getWorldPosition(position);
            entry.panner.positionX.value = position.x;
            entry.panner.positionY.value = position.y;
            entry.panner.positionZ.value = position.z;
        }
        if (audioContext?.listener) {
            const listener = audioContext.listener;
            const cameraPosition = new THREE.Vector3();
            const cameraForward = new THREE.Vector3();
            const cameraUp = new THREE.Vector3(0, 1, 0);
            view.camera.getWorldPosition(cameraPosition);
            view.camera.getWorldDirection(cameraForward);
            const setListenerValue = (modern, value) => {
                if (modern && typeof modern.value === 'number') modern.value = value;
            };
            setListenerValue(listener.positionX, cameraPosition.x);
            setListenerValue(listener.positionY, cameraPosition.y);
            setListenerValue(listener.positionZ, cameraPosition.z);
            if (!listener.positionX && typeof listener.setPosition === 'function') listener.setPosition(cameraPosition.x, cameraPosition.y, cameraPosition.z);
            if (listener.forwardX && typeof listener.forwardX.value === 'number') {
                listener.forwardX.value = cameraForward.x;
                listener.forwardY.value = cameraForward.y;
                listener.forwardZ.value = cameraForward.z;
                listener.upX.value = cameraUp.x;
                listener.upY.value = cameraUp.y;
                listener.upZ.value = cameraUp.z;
            } else if (typeof listener.setOrientation === 'function') {
                listener.setOrientation(cameraForward.x, cameraForward.y, cameraForward.z, cameraUp.x, cameraUp.y, cameraUp.z);
            }
        }
        const previousBackground = view.scene.background;
        for (let passIndex = 0; passIndex < view.renderPasses.length; passIndex += 1) {
            const pass = view.renderPasses[passIndex];
            const viewport = view.viewportPixels(renderWidth, renderHeight, pass);
            renderer.setViewport(viewport.x, viewport.y, viewport.width, viewport.height);
            renderer.setScissor(viewport.x, viewport.y, viewport.width, viewport.height);
            renderer.setScissorTest(true);
            const overlayPreservesColor = pass.renderType === 'Overlay'
                && pass.stackBaseCameraId
                && passIndex > 0
                && pass.clearFlags !== 'Depth Only'
                && pass.clearFlags !== "Don't Clear";
            const clearFlags = overlayPreservesColor ? 'Depth Only' : pass.clearFlags;
            view.scene.background = clearFlags === 'Skybox' ? view.environmentBackground : null;
            if (clearFlags === 'Solid Color' || clearFlags === 'Skybox') {
                renderer.setClearColor(clearFlags === 'Solid Color' ? pass.clearColor : 0x000000, pass.clearAlpha);
                renderer.clear(true, true, true);
            } else if (clearFlags === 'Depth Only') {
                renderer.clearDepth();
            }
            renderer.render(view.scene, pass.camera);
        }
        view.scene.background = previousBackground;
        const gameplay = state.gameplay;
        statusLayer.replaceChildren();
        const title = document.createElement('h1');
        title.textContent = scene.name || manifest.projectId;
        const status = document.createElement('p');
        status.hidden = gameplayUi.showStatus === false;
        status.textContent = gameplay
            ? `Status: ${gameplay.status}`
            : 'Running';
        const score = document.createElement('p');
        score.hidden = gameplayUi.showGoal === false;
        const scorePerCollectible = Number.isFinite(gameplayUi.scorePerCollectible)
            ? gameplayUi.scorePerCollectible
            : 100;
        score.textContent = gameplay
            ? `Score: ${gameplay.score} | Goal: ${gameplay.goal} | Value: ${scorePerCollectible}`
            : '';
        const position = document.createElement('p');
        if (gameplay) position.textContent = `Position: ${gameplay.player.position.join(', ')}`;
        statusLayer.append(title, status, score, position);
        for (const text of state.uiText || []) {
            let element = textLayer.querySelector(`[data-ui-text-id="${CSS.escape(text.id)}"]`);
            if (!element) {
                element = document.createElement('p');
                element.dataset.uiTextId = text.id;
                const authored = authoredUiText.find((entry) => entry.id === text.id);
                if (authored) {
                    element.style.position = 'absolute';
                    element.style.width = `${Math.max(1, authored.layout.width)}px`;
                    element.style.minHeight = `${Math.max(1, authored.layout.height)}px`;
                    element.style.left = `calc(${Math.max(0, Math.min(1, authored.layout.anchorX)) * 100}% + ${authored.layout.x}px)`;
                    element.style.top = `calc(${(1 - Math.max(0, Math.min(1, authored.layout.anchorY))) * 100}% - ${authored.layout.y}px)`;
                    element.style.pointerEvents = 'none';
                    element.style.fontSize = `${Math.max(1, authored.fontSize)}px`;
                    element.style.color = authored.color;
                    element.style.textAlign = authored.alignment;
                    element.style.whiteSpace = 'nowrap';
                }
                textLayer.append(element);
            }
            element.textContent = text.text;
        }
        for (const button of uiButtons) {
            if (!button || typeof button.label !== 'string' || typeof button.event !== 'string') continue;
            let control = controlsLayer.querySelector(`[data-ui-event="${CSS.escape(button.event)}"]`);
            if (!control) {
                control = document.createElement('button');
                control.type = 'button';
                control.dataset.uiEvent = button.event;
                control.textContent = button.label;
                control.addEventListener('click', () => worker.postMessage({ protocolVersion: 1, sessionId, command: 'uiEvent', payload: { name: button.event } }));
                controlsLayer.append(control);
            }
        }
        if (!mountedControls.size && authoredUiControls.length) {
            mountPlayerUiControls(document, controlsLayer, authoredUiControls, worker, sessionId);
            for (const control of authoredUiControls) mountedControls.add(control.id);
        }
        root.dataset.status = gameplay?.status || 'running';
        root.dataset.score = String(gameplay?.score ?? 0);
        root.dataset.lastUiEvent = state.lastUiEvent || '';
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
    window.addEventListener('mousemove', (event) => {
        if (document.pointerLockElement === root || event.buttons !== 0) {
            mouse.deltaX += Number.isFinite(event.movementX) ? event.movementX : 0;
            mouse.deltaY += Number.isFinite(event.movementY) ? event.movementY : 0;
        }
    });
    root.addEventListener('click', (event) => {
        if (event.target === root || event.target === renderer.domElement) {
            const result = root.requestPointerLock?.();
            result?.catch?.(() => {});
        }
    });
    window.addEventListener('blur', () => keys.clear());
    document.addEventListener('visibilitychange', () => { if (document.hidden) keys.clear(); });
    window.addEventListener('pagehide', () => {
        worker.terminate(); observer.disconnect(); view.dispose(); renderer.dispose();
        for (const audio of audioSources) {
            if (audio?.stop) {
                try { audio.stop(); } catch {}
                audio.close?.();
                continue;
            }
            if (audio instanceof HTMLAudioElement) {
                audio.pause(); audio.removeAttribute('src'); audio.load();
            }
        }
        audioContext?.close();
    }, { once: true });
    root.focus();

    if (sceneSwitchSmoke) {
        const action = sceneLoadActions[0];
        if (!action) {
            await window.tugberkPlayer.smokeComplete({ ok: false, error: 'Entry scene has no authored LoadScene action' });
            return;
        }
        worker.postMessage({
            protocolVersion: 1,
            sessionId,
            command: 'uiEvent',
            payload: { name: action.eventName }
        });
        return;
    }

    if (smoke) {
        const playerMaterial = view.objects.get('object-player')?.children.find((child) => child.isMesh)?.material;
        const authoredMaterial = playerMaterial?.color?.getHexString() === '3b82f6'
            && playerMaterial.metalness === 0.1 && playerMaterial.roughness === 0.65;
        const gl = renderer.getContext();
        const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
        gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let distinctPixels = false;
        for (let offset = 4; offset < pixels.length; offset += 4) {
            if (pixels[offset] !== pixels[0] || pixels[offset + 1] !== pixels[1] || pixels[offset + 2] !== pixels[2]) {
                distinctPixels = true; break;
            }
        }
        const renderedScene = view.meshCount > 0 && renderer.info.render.triangles > 0 && distinctPixels;
        const shadowPipeline = renderer.shadowMap.enabled === true && renderer.shadowMap.type === THREE.PCFSoftShadowMap;
        const authoredButton = hud.querySelector('[data-ui-event="Restart"]');
        let authoredUiEvent = false;
        if (authoredButton) {
            await new Promise((resolve) => {
                const listener = (event) => {
                    if (event.data?.lastUiEvent !== 'Restart') return;
                    worker.removeEventListener('message', listener);
                    authoredUiEvent = true;
                    resolve();
                };
                worker.addEventListener('message', listener);
                authoredButton.click();
            });
        }
        for (let index = 0; index < 60; index += 1) await sendTick({});
        const grounded = lastState?.gameplay?.player?.grounded === true;
        const startX = lastState?.gameplay?.player?.position?.[0];
        const jumpStartY = lastState?.gameplay?.player?.position?.[1];
        window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
        const configuredJump = input().Jump === true;
        await sendTick(input());
        window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true }));
        const jumpEndY = lastState?.gameplay?.player?.position?.[1];
        const jumped = configuredJump && jumpEndY > jumpStartY;
        const playerTransform = () => lastState?.transforms?.find((entry) => entry.id === 'object-player');
        const lookStartY = playerTransform()?.rotation?.[1];
        const lookEvent = new MouseEvent('mousemove', { bubbles: true, buttons: 1 });
        Object.defineProperty(lookEvent, 'movementX', { value: 12 });
        Object.defineProperty(lookEvent, 'movementY', { value: -4 });
        window.dispatchEvent(lookEvent);
        const mappedLook = input();
        await sendTick(mappedLook);
        mouse.deltaX = 0;
        mouse.deltaY = 0;
        const lookEndY = playerTransform()?.rotation?.[1];
        const looked = mappedLook.LookX === 12 && mappedLook.LookY === -4 && lookEndY < lookStartY;
        // Exercise the same browser event and mapping path used by the live player loop.
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true }));
        const configuredInput = input().Horizontal === 1;
        let observedTrigger = false;
        for (let index = 0; index < 110; index += 1) {
            await sendTick(input());
            observedTrigger ||= lastState?.gameplay?.status !== 'playing';
        }
        window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true }));
        await window.tugberkPlayer.smokeComplete({
            ok: renderedScene && shadowPipeline && authoredMaterial && authoredUiEvent && configuredInput && configuredJump && jumped && looked && grounded && lastState?.gameplay?.player?.position?.[0] > startX && observedTrigger,
            sceneId: scene.sceneId,
            objectCount: scene.gameObjects.length,
            gameplay: lastState.gameplay,
            checks: { renderedScene, shadowPipeline, authoredMaterial, authoredUiEvent, configuredInput, configuredJump, movement: lastState.gameplay.player.position[0] > startX, jump: jumped, look: looked, collision: grounded, trigger: observedTrigger, ui: root.dataset.status === lastState.gameplay.status }
        });
        return;
    }
    let previous = performance.now();
    const loop = (now) => {
        const deltaTime = Math.min(0.1, Math.max(0, (now - previous) / 1000)); previous = now;
        const mappedInput = input();
        mouse.deltaX = 0;
        mouse.deltaY = 0;
        worker.postMessage({ protocolVersion: 1, sessionId, command: 'tick', payload: { deltaTime, input: mappedInput } });
        requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
})().catch(async (error) => {
    document.getElementById('game').textContent = `Player failed: ${error.message}`;
    await window.tugberkPlayer.smokeComplete({ ok: false, error: error.message });
});
