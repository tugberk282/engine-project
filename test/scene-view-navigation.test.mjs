import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { SceneCameraNavigation } from '../src/editor/SceneCameraNavigation.ts';

const root = path.resolve(import.meta.dirname, '..');
const editorSource = fs.readFileSync(path.join(root, 'src/editor/Editor.ts'), 'utf8');

const createController = () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 0, 5);
    const controller = new SceneCameraNavigation(camera);
    controller.orbitDistance = 5;
    return { camera, controller };
};

test('scene navigation keeps a stable orbit target across orbit, pan and zoom', () => {
    const { camera, controller } = createController();
    controller.orbit(2, -1, 0.25);
    assert.ok(Math.abs(camera.position.distanceTo(controller.orbitTarget) - 5) < 1e-9);

    const targetBeforePan = controller.orbitTarget.clone();
    const positionBeforePan = camera.position.clone();
    controller.pan(3, -2, 0.5);
    const cameraDelta = camera.position.clone().sub(positionBeforePan);
    const targetDelta = controller.orbitTarget.clone().sub(targetBeforePan);
    assert.ok(cameraDelta.distanceTo(targetDelta) < 1e-9);

    controller.zoom(10);
    assert.ok(controller.orbitDistance < 5);
    assert.ok(Math.abs(
        camera.position.distanceTo(controller.orbitTarget) - controller.orbitDistance
    ) < 1e-9);
});

test('focus frames a target and cancelled pointer navigation restores observable state', () => {
    const { camera, controller } = createController();
    const originalPosition = camera.position.clone();
    const originalRotation = camera.rotation.clone();

    controller.beginInteraction();
    controller.focus(new THREE.Vector3(4, 2, -3), 2);
    controller.orbit(4, 3, 0.2);
    controller.pan(2, 1, 0.4);
    assert.equal(controller.cancelInteraction(), true);

    assert.ok(camera.position.distanceTo(originalPosition) < 1e-9);
    assert.ok(Math.abs(camera.rotation.x - originalRotation.x) < 1e-9);
    assert.deepEqual(controller.orbitTarget.toArray(), [0, 0, 0]);
    assert.equal(controller.orbitDistance, 5);
    assert.equal(controller.cancelInteraction(), false);
});

test('focus distance is deterministic and bounded for tiny selections', () => {
    const { camera, controller } = createController();
    controller.focus(new THREE.Vector3(1, 2, 3), 0);
    assert.equal(controller.orbitDistance, 0.01);
    assert.ok(Math.abs(camera.position.distanceTo(controller.orbitTarget) - 0.01) < 1e-9);
});

test('scene pointer navigation captures the pointer and Escape cancels without changing selection', () => {
    assert.match(editorSource, /canvas\.setPointerCapture\?\.\(event\.pointerId\)/);
    assert.match(editorSource, /canvas\.releasePointerCapture\(activePointerId\)/);
    assert.match(editorSource, /controller\.beginInteraction\(\)/);
    assert.match(editorSource, /controller\.cancelInteraction\(\)/);
    assert.match(editorSource, /event\.stopImmediatePropagation\(\)/);
});

test('transform authoring exposes Unity-style tools, modes, snapping and transactional undo', () => {
    for (const mode of ["'translate'", "'rotate'", "'scale'"]) {
        assert.ok(editorSource.includes(mode), `missing transform mode ${mode}`);
    }
    assert.match(editorSource, /transformPivotMode === 'center'/);
    assert.match(editorSource, /transformSpaceMode === 'local'/);
    assert.match(editorSource, /setTranslationSnap\(EditorSettings\.snapTranslation\)/);
    assert.match(editorSource, /setRotationSnap\(THREE\.MathUtils\.degToRad\(EditorSettings\.snapRotation\)\)/);
    assert.match(editorSource, /setScaleSnap\(EditorSettings\.snapScale\)/);
    assert.match(editorSource, /CommandHistory\.execute\(\{/);
    assert.match(editorSource, /this\.transformControls\.reset\(\)/);
});
