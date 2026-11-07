'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { selectBuiltScene, readBuiltScene } = require('../electron/build/player-content');

test('player scene loading is confined to manifest-selected build content', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tugberk-player-scenes-'));
    try {
        const relative = 'Assets/Scenes/Level2.scene.json';
        const absolute = path.join(root, 'content', ...relative.split('/'));
        fs.mkdirSync(path.dirname(absolute), { recursive: true });
        const scene = { formatVersion: 1, sceneId: 'level-2', gameObjects: [] };
        const bytes = Buffer.from(JSON.stringify(scene));
        fs.writeFileSync(absolute, bytes);
        const manifest = {
            entryScene: 'Assets/Scenes/Main.scene.json',
            scenes: [
                { sceneId: 'main', path: 'Assets/Scenes/Main.scene.json' },
                { sceneId: 'level-2', path: relative }
            ],
            files: [{ path: relative, bytes: bytes.length }]
        };
        assert.equal(selectBuiltScene(manifest, 'Assets\\Scenes\\Level2.scene.json'), relative);
        assert.deepEqual(readBuiltScene(root, manifest, relative), { path: relative, value: scene });
        assert.throws(() => selectBuiltScene(manifest, 'Assets/Scenes/NotBuilt.scene.json'), /not included/);
        assert.throws(() => selectBuiltScene(manifest, '../Level2.scene.json'), /not included/);
        assert.throws(() => readBuiltScene(root, { ...manifest, files: [] }, relative), /not a valid build resource/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
