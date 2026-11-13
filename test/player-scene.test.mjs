import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { consumePlayerSpawnCommands, createPlayerScene } from '../electron/build/player-scene.mjs';

test('player scene consumes each sequenced runtime prefab spawn once', () => {
    const materialized = [];
    let sequence = consumePlayerSpawnCommands([
        { sequence: 1, node: { id: 'clone-a' } }
    ], 0, (node) => materialized.push(node.id));
    sequence = consumePlayerSpawnCommands([
        { sequence: 1, node: { id: 'clone-a' } },
        { sequence: 2, node: { id: 'clone-b' } }
    ], sequence, (node) => materialized.push(node.id));
    assert.equal(sequence, 2);
    assert.deepEqual(materialized, ['clone-a', 'clone-b']);
});

test('player scene materializes a runtime prefab primitive and accepts transform frames', () => {
    const view = createPlayerScene(THREE, { gameObjects: [] });
    const object = view.materialize({
        id: 'runtime-prefab-1-1', name: 'Runtime Cube', enabled: true,
        transform: { position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] },
        components: [
            { type: 'MeshFilter', data: { primitiveType: 'Cube' } },
            { type: 'MeshRenderer', data: { color: '#ff4400' } }
        ], children: []
    });
    assert.ok(object);
    assert.equal(object.children.some((child) => child.isMesh), true);
    view.update({ transforms: [{
        id: 'runtime-prefab-1-1', position: [5, 4, 3], rotation: [0, 1, 0], scale: [2, 2, 2]
    }] });
    assert.deepEqual(object.position.toArray(), [5, 4, 3]);
    assert.deepEqual(object.scale.toArray(), [2, 2, 2]);
    view.dispose();
});

test('player scene rebuilds camera passes for a runtime prefab and preserves its active hierarchy', () => {
    const view = createPlayerScene(THREE, { gameObjects: [] });
    const fallbackCamera = view.camera;
    view.materialize({
        id: 'runtime-camera-root', name: 'Disabled Camera Prefab', enabled: false,
        transform: {}, components: [], children: [{
            id: 'runtime-camera', name: 'Runtime Camera', enabled: true, tag: 'MainCamera',
            transform: {}, components: [{
                type: 'Camera', data: { isMain: true, depth: 7, viewportRect: { x: 0, y: 0, width: 0.5, height: 1 } }
            }], children: []
        }]
    });
    try {
        assert.notEqual(view.camera, fallbackCamera);
        assert.equal(view.renderPasses.length, 1);
        assert.equal(view.renderPasses[0].objectId, 'runtime-camera');
        assert.deepEqual(view.renderPasses[0].activePath, ['runtime-camera-root', 'runtime-camera']);
        assert.deepEqual(view.camera.userData.viewportRect, { x: 0, y: 0, width: 0.5, height: 1 });
    } finally {
        view.dispose();
    }
});

test('player scene materializes runtime prefab lights with authored settings and active transforms', () => {
    const view = createPlayerScene(THREE, { gameObjects: [] });
    const root = view.materialize({
        id: 'runtime-light-root', name: 'Runtime Light Prefab', enabled: true,
        transform: {}, components: [], children: [{
            id: 'runtime-light', name: 'Runtime Point Light', enabled: true, layer: 4,
            transform: { position: [1, 2, 3] }, components: [{
                type: 'Light', data: {
                    lightType: 'Point', color: '#336699', intensity: 2.5, range: 18,
                    castShadows: true, cullingMask: 1 << 4, shadowResolution: 512
                }
            }], children: []
        }]
    });
    try {
        const lightObject = view.objects.get('runtime-light');
        const light = lightObject.children.find((child) => child.isLight);
        assert.ok(root);
        assert.ok(light?.isPointLight);
        assert.equal(light.color.getHexString(), '336699');
        assert.equal(light.intensity, 2.5);
        assert.equal(light.distance, 18);
        assert.equal(light.castShadow, true);
        assert.equal(light.layers.mask, 1 << 4);
        assert.deepEqual(light.shadow.mapSize.toArray(), [512, 512]);
        view.update({ transforms: [{
            id: 'runtime-light-root', active: false,
            position: [4, 5, 6], rotation: [0, 0, 0], scale: [1, 1, 1]
        }] });
        assert.equal(root.visible, false);
        assert.deepEqual(root.position.toArray(), [4, 5, 6]);
    } finally {
        view.dispose();
    }
});

test('player scene materializes authored primitives and updates runtime transforms', () => {
  const authored = {
    environment: { backgroundColor: '#112233' },
    gameObjects: [
      { id: 'player', name: 'Player', transform: { position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] }, components: [
        { type: 'MeshFilter', data: { primitiveType: 'Capsule' } },
        { type: 'MeshRenderer', data: { color: '#336699', metalness: 0.4, roughness: 0.25 } },
        { type: 'PlayerController' }
      ] },
      { id: 'camera', name: 'Main Camera', transform: { position: [0, 5, 10], rotation: [0, 0, 0], scale: [1, 1, 1] }, components: [
        { type: 'Camera', data: { isMain: true, fieldOfView: 55 } }
      ] },
      { id: 'floor', name: 'Floor', transform: { position: [0, -1, 0], rotation: [0, 0, 0], scale: [10, 1, 10] }, components: [
        { type: 'MeshFilter', data: { geometryType: 'Cube' } },
        { type: 'MeshRenderer', data: { color: '#555555' } }
      ] }
    ]
  };
  const view = createPlayerScene(THREE, authored);
  try {
    assert.equal(view.meshCount, 2);
    assert.equal(view.camera.isPerspectiveCamera, true);
    assert.equal(view.objects.get('player').name, 'Player');
    const mesh = view.objects.get('player').children[0];
    assert.equal(mesh.material.color.getHexString(), '336699');
    assert.equal(mesh.material.metalness, 0.4);
    assert.equal(mesh.material.roughness, 0.25);
    view.update({ transforms: [{ id: 'floor', position: [0, 2, 0], rotation: [0, 0, 0], scale: [2, 2, 2] }] });
    assert.deepEqual(view.objects.get('floor').position.toArray(), [0, 2, 0]);
    assert.deepEqual(view.objects.get('floor').scale.toArray(), [2, 2, 2]);
  } finally {
    view.dispose();
  }
});

test('standalone Cylinder uses the Unity-style two-unit authored height', () => {
  const view = createPlayerScene(THREE, {
    gameObjects: [{ id: 'cylinder', name: 'Cylinder', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, components: [
      { type: 'MeshFilter', data: { primitiveType: 'Cylinder' } },
      { type: 'MeshRenderer', data: { color: '#ffffff' } }
    ] }]
  });
  try {
    const mesh = view.objects.get('cylinder').children[0];
    mesh.geometry.computeBoundingBox();
    assert.equal(mesh.geometry.boundingBox.max.y - mesh.geometry.boundingBox.min.y, 2);
  } finally {
    view.dispose();
  }
});

test('standalone Spot light preserves authored range and angle', () => {
  const view = createPlayerScene(THREE, {
    gameObjects: [{ id: 'spot', name: 'Spot', transform: { position: [0, 2, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, components: [
      { type: 'Light', data: { lightType: 'Spot', intensity: 3, range: 14, spotAngle: 42 } }
    ] }]
  });
  try {
    const light = view.objects.get('spot').children[0];
    assert.equal(light.isSpotLight, true);
    assert.equal(light.intensity, 3);
    assert.equal(light.distance, 14);
    assert.equal(light.angle, 42 * Math.PI / 180);
  } finally {
    view.dispose();
  }
});

test('standalone Ambient light preserves authored light type and intensity', () => {
  const view = createPlayerScene(THREE, {
    gameObjects: [{ id: 'ambient', name: 'Ambient', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, components: [
      { type: 'Light', data: { lightType: 'Ambient', intensity: 0.35, color: '#224466' } }
    ] }]
  });
  try {
    const light = view.objects.get('ambient').children[0];
    assert.equal(light.isAmbientLight, true);
    assert.equal(light.intensity, 0.35);
    assert.equal(light.color.getHexString(), '224466');
  } finally {
    view.dispose();
  }
});

test('standalone lights normalize serialized RGB arrays', () => {
  const view = createPlayerScene(THREE, {
    gameObjects: [{ id: 'light', name: 'Light', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, components: [
      { type: 'Light', data: { lightType: 'Point', color: [0.1, 0.4, 0.8] } }
    ] }]
  });
  try {
    const color = view.objects.get('light').children[0].color;
    assert.ok(Math.abs(color.r - 0.1) < 1e-6);
    assert.ok(Math.abs(color.g - 0.4) < 1e-6);
    assert.ok(Math.abs(color.b - 0.8) < 1e-6);
  } finally {
    view.dispose();
  }
});

test('standalone camera preserves authored clear color, alpha, culling mask, and layer assignment', () => {
  const view = createPlayerScene(THREE, {
    environment: { backgroundColor: '#010203' },
    gameObjects: [
      { id: 'camera', tag: 'MainCamera', layer: 0, transform: { position: [0, 0, 5] }, components: [
        { type: 'Camera', data: {
          clearFlags: 'Solid Color', clearColor: [0.2, 0.4, 0.6], clearAlpha: 0.5,
          cullingMask: 1 << 7, viewportRect: { x: 0.5, y: 0.25, width: 0.5, height: 0.5 }
        } }
      ] },
      { id: 'layered', layer: 7, transform: {}, components: [
        { type: 'MeshFilter', data: { primitiveType: 'Cube' } }, { type: 'MeshRenderer', data: {} }
      ] }
    ]
  });
  try {
    assert.equal(view.scene.background.getHexString(), '7caacb');
    assert.equal(view.camera.userData.clearAlpha, 0.5);
    assert.equal(view.camera.layers.mask, 1 << 7);
    assert.deepEqual(view.camera.userData.viewportRect, { x: 0.5, y: 0.25, width: 0.5, height: 0.5 });
    assert.deepEqual(view.viewportPixels(1200, 800), { x: 600, y: 200, width: 600, height: 400 });
    assert.equal(view.objects.get('layered').layers.mask, 1 << 7);
    assert.equal(view.objects.get('layered').children[0].layers.mask, 1 << 7);
  } finally {
    view.dispose();
  }
});

test('standalone lights preserve authored shadow and culling settings', () => {
  const view = createPlayerScene(THREE, {
    gameObjects: [{ id: 'light', layer: 3, transform: {}, components: [
      { type: 'Light', data: {
        lightType: 'Directional', castShadows: true, cullingMask: 1 << 3,
        shadowResolution: 2048, shadowBias: -0.002, shadowNormalBias: 0.04, shadowRadius: 2
      } }
    ] }]
  });
  try {
    const light = view.objects.get('light').children[0];
    assert.equal(light.castShadow, true);
    assert.equal(light.layers.mask, 1 << 3);
    assert.deepEqual(light.shadow.mapSize.toArray(), [2048, 2048]);
    assert.equal(light.shadow.bias, -0.002);
    assert.equal(light.shadow.normalBias, 0.04);
    assert.equal(light.shadow.radius, 2);
  } finally {
    view.dispose();
  }
});

test('standalone scene preserves authored linear and exponential fog', () => {
  const linear = createPlayerScene(THREE, {
    environment: { fog: { enabled: true, mode: 'Linear', color: '#234567', near: 3, far: 80 } },
    gameObjects: []
  });
  const exponential = createPlayerScene(THREE, {
    environment: { fog: { enabled: true, mode: 'Exp2', color: '#765432', density: 0.075 } },
    gameObjects: []
  });
  try {
    assert.equal(linear.scene.fog.isFog, true);
    assert.equal(linear.scene.fog.near, 3);
    assert.equal(linear.scene.fog.far, 80);
    assert.equal(exponential.scene.fog.isFogExp2, true);
    assert.equal(exponential.scene.fog.density, 0.075);
  } finally {
    linear.dispose();
    exponential.dispose();
  }
});

test('standalone camera stack follows base-overlay links and depth order', () => {
  const cameraNode = (id, depth, data = {}) => ({
    id, name: id, tag: id === 'main' ? 'MainCamera' : 'Untagged', transform: {}, components: [
      { type: 'Camera', data: { depth, ...data } }
    ]
  });
  const view = createPlayerScene(THREE, {
    gameObjects: [
      cameraNode('late-base', 20),
      cameraNode('overlay', 5, {
        renderType: 'Overlay', stackBaseCamera: { __ref: 'main' },
        viewportRect: { x: 0.5, y: 0, width: 0.5, height: 1 }
      }),
      cameraNode('main', 0, { viewportRect: { x: 0, y: 0, width: 0.5, height: 1 } })
    ]
  });
  try {
    assert.deepEqual(view.renderPasses.map(pass => pass.objectId), ['main', 'overlay', 'late-base']);
    assert.equal(view.camera, view.renderPasses[0].camera);
    view.resize(1200, 800);
    assert.equal(view.renderPasses[0].camera.aspect, 0.75);
    assert.equal(view.renderPasses[1].camera.aspect, 0.75);
    assert.deepEqual(view.viewportPixels(1200, 800, view.renderPasses[1]), {
      x: 600, y: 0, width: 600, height: 800
    });
  } finally {
    view.dispose();
  }
});

test('standalone player retains an overlay whose base camera is invalid', () => {
  const view = createPlayerScene(THREE, {
    gameObjects: [{
      id: 'orphan-overlay', transform: {}, components: [{
        type: 'Camera', data: {
          renderType: 'Overlay', stackBaseCamera: { __ref: 'missing-camera' }, depth: 4
        }
      }]
    }]
  });
  try {
    assert.equal(view.renderPasses.length, 1);
    assert.equal(view.renderPasses[0].objectId, 'orphan-overlay');
  } finally {
    view.dispose();
  }
});
