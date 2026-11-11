'use strict';
import * as THREE from './three.module.js';
import { GLTFLoader } from './gltf-loader.js';
import { createPlayerScene } from './player-scene.mjs';
import { applyPlayerUiImageStyle, applyPlayerUiLayout, collectPlayerSceneLoadActions, collectPlayerScrollRects, collectPlayerUiControls, collectPlayerUiImages, collectPlayerUiText, isPlayerUiActive, mountPlayerScrollRects, mountPlayerUiControls } from './player-ui.mjs';
import { createPlayerInputMapper } from './player-input.mjs';
import { collectPlayerAudioGraph, createWebAudioPlayback, isPlayerAudioActive } from './player-audio.mjs';
import {
    bindPlayerModelHierarchy,
    collectPlayerModelResources,
    collectPlayerModels,
    selectPlayerAnimationClip
} from './player-model.mjs';
import { collectPlayerParticleSystems, createPlayerParticleEmitter } from './player-particles.mjs';

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
    const authoredUiImages = collectPlayerUiImages(scene);
    const authoredUiText = collectPlayerUiText(scene);
    const authoredScrollRects = collectPlayerScrollRects(scene);
    const sceneLoadActions = collectPlayerSceneLoadActions(scene);
    const inputMapper = createPlayerInputMapper(scene.inputMap);
    const authoredAudio = collectPlayerAudioGraph(scene);
    const authoredModels = collectPlayerModels(scene);
    const authoredParticles = collectPlayerParticleSystems(scene);
    const hud = document.createElement('section');
    hud.id = 'player-hud';
    hud.setAttribute('aria-live', 'polite');
    hud.setAttribute('aria-label', 'Game status');
    root.replaceChildren(hud);
    const statusLayer = document.createElement('div');
    const controlsLayer = document.createElement('div');
    const imageLayer = document.createElement('div');
    const textLayer = document.createElement('div');
    textLayer.id = 'player-ui-text';
    imageLayer.id = 'player-ui-images';
    controlsLayer.id = 'player-ui-controls';
    hud.append(statusLayer, imageLayer, textLayer, controlsLayer);
    const uiElementsByObjectId = new Map();
    const view = createPlayerScene(THREE, scene);
    const particleEmitters = authoredParticles
        .map((descriptor) => {
            const object = view.objects.get(descriptor.objectId);
            return object ? createPlayerParticleEmitter(THREE, descriptor, object) : null;
        })
        .filter(Boolean);
    const modelMixers = [];
    const modelBindings = [];
    const modelErrors = [];
    let loadedModelCount = 0;
    let loadedModelMeshCount = 0;
    const parseWithLoader = (loader, raw, resourcePath = '') => new Promise((resolve, reject) => {
        loader.parse(raw, resourcePath, resolve, reject);
    });
    const parseModel = async (descriptor, bytes) => {
        const raw = bytes instanceof Uint8Array
            ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
            : bytes;
        if (descriptor.path.toLowerCase().endsWith('.glb')) {
            return await parseWithLoader(new GLTFLoader(), raw);
        }

        const source = new TextDecoder('utf-8', { fatal: true }).decode(raw);
        const document = JSON.parse(source);
        const resources = collectPlayerModelResources(descriptor.path, document);
        const manager = new THREE.LoadingManager();
        const objectUrls = new Map();
        try {
            for (const [uri, assetPath] of resources) {
                const resourceBytes = await window.tugberkPlayer.readModelAsset(assetPath);
                const extension = assetPath.split('.').pop()?.toLowerCase();
                const mime = extension === 'png' ? 'image/png'
                    : extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg'
                        : extension === 'webp' ? 'image/webp'
                            : 'application/octet-stream';
                objectUrls.set(uri, URL.createObjectURL(new Blob([resourceBytes], { type: mime })));
            }
            manager.setURLModifier((url) => objectUrls.get(url) || url);
            return await parseWithLoader(new GLTFLoader(manager), source);
        } finally {
            for (const url of objectUrls.values()) URL.revokeObjectURL(url);
        }
    };
    await Promise.all(authoredModels.map(async (descriptor) => {
        try {
            const bytes = await window.tugberkPlayer.readModelAsset(descriptor.path);
            const gltf = await parseModel(descriptor, bytes);
            const target = view.objects.get(descriptor.objectId);
            if (!target) throw new Error(`Model target is missing: ${descriptor.objectId}`);
            gltf.scene.traverse((entry) => {
                if (!entry.isMesh) return;
                loadedModelMeshCount += 1;
                entry.castShadow = true;
                entry.receiveShadow = true;
            });
            target.add(gltf.scene);
            bindPlayerModelHierarchy(descriptor.nodes, gltf.scene, (objectId, object, authoredNode) => {
                view.bindExternalObject(objectId, object);
                modelBindings.push({ object, authoredNode });
            });
            loadedModelCount += 1;
            if (descriptor.animation?.playOnAwake && gltf.animations?.length) {
                const clip = selectPlayerAnimationClip(gltf.animations, descriptor.animation.clip);
                if (clip) {
                    const mixer = new THREE.AnimationMixer(gltf.scene);
                    const action = mixer.clipAction(clip);
                    action.setLoop(descriptor.animation.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
                    action.clampWhenFinished = !descriptor.animation.loop;
                    action.timeScale = descriptor.animation.speed;
                    action.play();
                    modelMixers.push(mixer);
                }
            }
        } catch (error) {
            const message = `${descriptor.path}: ${error?.message || String(error)}`;
            modelErrors.push(message);
            console.warn(`Could not load authored model ${message}`);
        }
    }));
    root.dataset.modelErrors = String(modelErrors.length);
    const audioSources = [];
    const audioLoads = [];
    const audioContext = typeof window.AudioContext === 'function' ? new window.AudioContext() : null;
    const audioMime = (audioPath) => {
        const extension = audioPath.split('.').pop()?.toLowerCase();
        return extension === 'wav' ? 'audio/wav'
            : extension === 'ogg' ? 'audio/ogg'
                : extension === 'm4a' ? 'audio/mp4'
                    : extension === 'flac' ? 'audio/flac'
                        : 'audio/mpeg';
    };
    const loadAudioSource = (descriptor) => {
            const { settings } = descriptor;
            const clipPath = typeof settings.clipPath === 'string' ? settings.clipPath.replaceAll('\\', '/') : '';
            if (!clipPath.startsWith('Assets/') || clipPath.includes('..') || clipPath.includes(':')) return;
            audioLoads.push(window.tugberkPlayer.readAudioAsset(clipPath).then(async (bytes) => {
                if (audioContext) {
                    const raw = bytes instanceof Uint8Array
                        ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
                        : bytes;
                    const buffer = await audioContext.decodeAudioData(raw);
                    const playback = createWebAudioPlayback(audioContext, buffer, descriptor);
                    audioSources.push(playback);
                    playback.sync(descriptor.active);
                    return;
                }
                const url = URL.createObjectURL(new Blob([bytes], { type: audioMime(clipPath) }));
                const audio = new Audio(url);
                const volume = Number(settings.volume);
                audio.volume = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 1));
                audio.loop = settings.loop === true;
                const pitch = Number(settings.pitch);
                audio.playbackRate = Math.max(0.01, Number.isFinite(pitch) ? pitch : 1);
                const playback = {
                    descriptor,
                    active: false,
                    sync(active) {
                        if (active === this.active) return;
                        this.active = active;
                        if (active && settings.playOnAwake !== false) void audio.play().catch(() => {});
                        else { audio.pause(); audio.currentTime = 0; }
                    },
                    stop() { audio.pause(); audio.removeAttribute('src'); audio.load(); URL.revokeObjectURL(url); },
                    get panner() { return null; }
                };
                audioSources.push(playback);
                playback.sync(descriptor.active);
            }).catch(() => {}));
    };
    for (const source of authoredAudio.sources) loadAudioSource(source);
    const materialLoads = [];
    const imageMime = (assetPath) => {
        const extension = assetPath.split('.').pop()?.toLowerCase();
        return extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : extension === 'webp' ? 'image/webp' : 'image/png';
    };
    await Promise.all(particleEmitters.map(async (emitter) => {
        const safePath = emitter.descriptor.texturePath || '';
        if (!safePath.startsWith('Assets/') || safePath.includes('..') || safePath.includes(':')) return;
        try {
            const bytes = await window.tugberkPlayer.readImageAsset(safePath);
            const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
            const url = URL.createObjectURL(new Blob([raw], { type: imageMime(safePath) }));
            try {
                emitter.material.map = await new Promise((resolve, reject) => new THREE.TextureLoader().load(url, resolve, undefined, reject));
                emitter.material.needsUpdate = true;
            } finally { URL.revokeObjectURL(url); }
        } catch (error) {
            console.warn(`Could not load particle texture ${safePath}: ${error?.message || String(error)}`);
        }
    }));
    const uiImageUrls = [];
    for (const image of authoredUiImages) {
        const element = document.createElement('div');
        element.dataset.uiImageId = image.id;
        element.dataset.uiObjectId = image.activePath.at(-1) || '';
        element.dataset.uiActivePath = JSON.stringify(image.activePath);
        element.hidden = !image.active;
        applyPlayerUiLayout(element, image.layout, image.frame);
        applyPlayerUiImageStyle(element, image);
        imageLayer.append(element);
        if (element.dataset.uiObjectId && !uiElementsByObjectId.has(element.dataset.uiObjectId)) {
            uiElementsByObjectId.set(element.dataset.uiObjectId, element);
        }
        const safePath = image.spritePath || '';
        if (!safePath.startsWith('Assets/') || safePath.includes('..') || safePath.includes(':')) continue;
        try {
            const bytes = await window.tugberkPlayer.readImageAsset(safePath);
            const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
            const url = URL.createObjectURL(new Blob([raw], { type: imageMime(safePath) }));
            uiImageUrls.push(url);
            element.style.backgroundImage = `url(${JSON.stringify(url)})`;
        } catch {}
    }
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
    await Promise.all(audioLoads);
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
    const mouseButtons = new Set();
    const mouse = { deltaX: 0, deltaY: 0 };
    const gamepadAxis = (value) => {
        const axis = Number.isFinite(value) ? value : 0;
        return Math.abs(axis) < 0.15 ? 0 : Math.max(-1, Math.min(1, axis));
    };
    const gamepadInput = () => {
        const pad = navigator.getGamepads?.().find((candidate) => candidate?.connected);
        if (!pad) return { horizontal: 0, vertical: 0, buttons: new Set() };
        return {
            horizontal: gamepadAxis(pad.axes?.[0]),
            vertical: -gamepadAxis(pad.axes?.[1]),
            buttons: new Set(Array.from(pad.buttons || [], (button, index) => button?.pressed ? index : -1).filter((index) => index >= 0))
        };
    };
    let lastState = null;
    let frame = 0;
    let pendingAnimationDelta = 0;
    const mountedControls = new Set();
    let mountedScrollRects = [];
    let sceneTransitionStarted = false;

    const input = (deltaTime = 0.02) => {
        const pad = gamepadInput();
        return inputMapper.sample({
            keys, mouseButtons, gamepadButtons: pad.buttons,
            gamepadAxes: pad, mouseDelta: { x: mouse.deltaX, y: mouse.deltaY }
        }, deltaTime);
    };
    const render = (state) => {
        lastState = state;
        view.update(state);
        const simulationDelta = pendingAnimationDelta;
        if (simulationDelta > 0) {
            for (const mixer of modelMixers) mixer.update(simulationDelta);
            for (const emitter of particleEmitters) {
                emitter.update(simulationDelta, isPlayerUiActive(emitter.descriptor.activePath, state.transforms));
            }
            pendingAnimationDelta = 0;
        }
        const loadAction = state.lastUiEvent
            ? sceneLoadActions.find((entry) => entry.eventName === state.lastUiEvent
                && isPlayerUiActive(entry.activePath, state.transforms))
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
        for (const entry of audioSources) {
            entry.sync(isPlayerAudioActive(entry.descriptor.activePath, state.transforms));
            const object = view.objects.get(entry.descriptor.objectId);
            const panner = entry.panner;
            if (!object || !panner) continue;
            const position = new THREE.Vector3();
            object.getWorldPosition(position);
            panner.positionX.value = position.x;
            panner.positionY.value = position.y;
            panner.positionZ.value = position.z;
        }
        if (audioContext?.listener) {
            const listener = audioContext.listener;
            const activeListener = authoredAudio.listeners.find((entry) => isPlayerAudioActive(entry.activePath, state.transforms));
            const listenerObject = activeListener
                ? view.objects.get(activeListener.objectId)
                : null;
            const listenerTransform = listenerObject || view.camera;
            const cameraPosition = new THREE.Vector3();
            const cameraForward = new THREE.Vector3(0, 0, -1);
            const cameraUp = new THREE.Vector3(0, 1, 0);
            const listenerRotation = new THREE.Quaternion();
            listenerTransform.getWorldPosition(cameraPosition);
            listenerTransform.getWorldQuaternion(listenerRotation);
            cameraForward.applyQuaternion(listenerRotation).normalize();
            cameraUp.applyQuaternion(listenerRotation).normalize();
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
                    element.dataset.uiObjectId = authored.activePath.at(-1) || '';
                    element.dataset.uiActivePath = JSON.stringify(authored.activePath);
                    element.hidden = !authored.active;
                    applyPlayerUiLayout(element, authored.layout, authored.frame);
                    element.style.pointerEvents = 'none';
                    element.style.fontSize = `${Math.max(1, authored.fontSize)}px`;
                    element.style.color = authored.color;
                    element.style.textAlign = authored.alignment;
                    element.style.whiteSpace = 'nowrap';
                    element.style.opacity = String(authored.interaction.alpha);
                }
                textLayer.append(element);
                if (element.dataset.uiObjectId && !uiElementsByObjectId.has(element.dataset.uiObjectId)) {
                    uiElementsByObjectId.set(element.dataset.uiObjectId, element);
                }
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
            const mountedByObjectId = mountPlayerUiControls(document, controlsLayer, authoredUiControls, worker, sessionId);
            for (const [objectId, element] of mountedByObjectId) {
                if (!uiElementsByObjectId.has(objectId)) uiElementsByObjectId.set(objectId, element);
            }
            for (const control of authoredUiControls) mountedControls.add(control.id);
        }
        if (!mountedScrollRects.length && authoredScrollRects.length) {
            mountedScrollRects = mountPlayerScrollRects(document, controlsLayer, authoredScrollRects, uiElementsByObjectId);
        }
        for (const element of root.querySelectorAll('[data-ui-active-path]')) {
            let path = [];
            try { path = JSON.parse(element.dataset.uiActivePath || '[]'); } catch {}
            element.hidden = !isPlayerUiActive(path, state.transforms);
        }
        root.dataset.status = gameplay?.status || 'running';
        root.dataset.score = String(gameplay?.score ?? 0);
        root.dataset.lastUiEvent = state.lastUiEvent || '';
    };
    const sendTick = (mappedInput) => new Promise((resolve, reject) => {
        pendingAnimationDelta += 0.02;
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
    window.addEventListener('mousedown', (event) => mouseButtons.add(event.button));
    window.addEventListener('mouseup', (event) => mouseButtons.delete(event.button));
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
    const clearInput = () => { keys.clear(); mouseButtons.clear(); inputMapper.clear(); };
    window.addEventListener('blur', clearInput);
    document.addEventListener('visibilitychange', () => { if (document.hidden) clearInput(); });
    window.addEventListener('pagehide', () => {
        worker.terminate(); observer.disconnect(); view.dispose(); renderer.dispose();
        for (const url of uiImageUrls) URL.revokeObjectURL(url);
        for (const audio of audioSources) {
            try { audio.stop(); } catch {}
        }
        audioContext?.close();
        for (const mixer of modelMixers) mixer.stopAllAction();
        for (const emitter of particleEmitters) emitter.dispose();
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
        const layoutFirst = hud.querySelector('[data-ui-object-id="object-layout-restart"]');
        const layoutSecond = hud.querySelector('[data-ui-object-id="object-layout-secondary"]');
        const firstRect = layoutFirst?.getBoundingClientRect();
        const secondRect = layoutSecond?.getBoundingClientRect();
        const authoredLayout = Boolean(firstRect && secondRect
            && Math.abs(firstRect.width - 280) < 0.5
            && Math.abs(firstRect.height - 30) < 0.5
            && Math.abs(secondRect.top - firstRect.top - 35) < 0.5);
        const scrollViewport = hud.querySelector('[data-ui-scroll-rect="object-scroll-viewport:UIScrollRect"]');
        scrollViewport?.dispatchEvent(new WheelEvent('wheel', { deltaY: 50, bubbles: true, cancelable: true }));
        const scrollItem = hud.querySelector('[data-ui-object-id="object-scroll-item"]');
        const scrollInput = hud.querySelector('[data-ui-object-id="object-scrollbar"] input');
        const authoredScrollRect = Boolean(scrollViewport && scrollItem && scrollInput
            && Number(scrollViewport.dataset.verticalNormalizedPosition) < 1
            && scrollItem.style.translate === '0px -50px'
            && Math.abs(Number(scrollInput.value) - 0.75) < 0.0001);
        const filledImage = hud.querySelector('[data-ui-object-id="object-filled-image"]');
        const authoredFilledImage = Boolean(filledImage
            && filledImage.style.clipPath.startsWith('inset(')
            && filledImage.style.clipPath.includes('60%')
            && filledImage.style.backgroundSize === 'contain'
            && filledImage.style.pointerEvents === 'none');
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
        const configuredInput = input().Horizontal > 0;
        let observedTrigger = false;
        for (let index = 0; index < 110; index += 1) {
            await sendTick(input());
            observedTrigger ||= lastState?.gameplay?.status !== 'playing';
        }
        window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true }));
        const authoredModel = authoredModels.length === 0 || (
            modelErrors.length === 0
            && loadedModelCount === authoredModels.length
            && loadedModelMeshCount > 0
            && (!authoredModels.some((entry) => entry.animation?.playOnAwake)
                || modelMixers.some((mixer) => mixer.time > 0))
        );
        const authoredModelHierarchy = modelBindings.every(({ object, authoredNode }) => {
            const scale = authoredNode.transform?.scale;
            return !Array.isArray(scale) || scale.length < 3
                || (Math.abs(object.scale.x - scale[0]) < 0.0001
                    && Math.abs(object.scale.y - scale[1]) < 0.0001
                    && Math.abs(object.scale.z - scale[2]) < 0.0001);
        });
        const liveParticleCount = particleEmitters.reduce((total, emitter) => total + emitter.simulation.particles.length, 0);
        const authoredParticleSystem = authoredParticles.length === 0
            || (particleEmitters.length === authoredParticles.length && liveParticleCount > 0);
        await window.tugberkPlayer.smokeComplete({
            ok: renderedScene && shadowPipeline && authoredMaterial && authoredUiEvent && authoredLayout && authoredScrollRect && authoredFilledImage && authoredModel && authoredModelHierarchy && authoredParticleSystem && configuredInput && configuredJump && jumped && looked && grounded && lastState?.gameplay?.player?.position?.[0] > startX && observedTrigger,
            sceneId: scene.sceneId,
            objectCount: scene.gameObjects.length,
            modelCount: loadedModelCount,
            modelMeshCount: loadedModelMeshCount,
            modelErrors,
            animatedModelCount: modelMixers.filter((mixer) => mixer.time > 0).length,
            modelBindingCount: modelBindings.length,
            scrollRectState: {
                normalized: scrollViewport?.dataset.verticalNormalizedPosition || null,
                translate: scrollItem?.style.translate || null,
                scrollbarValue: scrollInput?.value || null,
                scrollbarBound: scrollViewport?.dataset.verticalScrollbarBound || null
            },
            filledImageState: filledImage ? {
                clipPath: filledImage.style.clipPath,
                backgroundSize: filledImage.style.backgroundSize,
                pointerEvents: filledImage.style.pointerEvents
            } : null,
            particleSystemCount: particleEmitters.length,
            liveParticleCount,
            gameplay: lastState.gameplay,
            checks: { renderedScene, shadowPipeline, authoredMaterial, authoredUiEvent, authoredLayout, authoredScrollRect, authoredFilledImage, authoredModel, authoredModelHierarchy, authoredParticleSystem, configuredInput, configuredJump, movement: lastState.gameplay.player.position[0] > startX, jump: jumped, look: looked, collision: grounded, trigger: observedTrigger, ui: root.dataset.status === lastState.gameplay.status }
        });
        return;
    }
    let previous = performance.now();
    const loop = (now) => {
        const deltaTime = Math.min(0.1, Math.max(0, (now - previous) / 1000)); previous = now;
        pendingAnimationDelta += deltaTime;
        const mappedInput = input(deltaTime);
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
