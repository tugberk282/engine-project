'use strict';

const fs = require('node:fs');
const path = require('node:path');

function normalizeScenePath(value) {
    return typeof value === 'string' ? value.replaceAll('\\', '/') : '';
}

function selectBuiltScene(manifest, requestedPath) {
    const selected = normalizeScenePath(requestedPath || manifest?.entryScene);
    const scenes = Array.isArray(manifest?.scenes) ? manifest.scenes : [];
    const scene = scenes.find((entry) => normalizeScenePath(entry?.path) === selected);
    if (!scene) throw new Error('Requested scene is not included in this build');
    return selected;
}

function readBuiltScene(buildRoot, manifest, requestedPath) {
    const scenePath = selectBuiltScene(manifest, requestedPath);
    const fileEntry = Array.isArray(manifest?.files)
        ? manifest.files.find((entry) => normalizeScenePath(entry?.path) === scenePath)
        : null;
    if (!fileEntry || !Number.isFinite(fileEntry.bytes) || fileEntry.bytes > 16 * 1024 * 1024) {
        throw new Error('Requested scene is not a valid build resource');
    }
    const contentRoot = path.resolve(buildRoot, 'content');
    const absolutePath = path.resolve(contentRoot, scenePath);
    if (absolutePath !== contentRoot && !absolutePath.startsWith(`${contentRoot}${path.sep}`)) {
        throw new Error('Requested scene escapes build content');
    }
    return { path: scenePath, value: JSON.parse(fs.readFileSync(absolutePath, 'utf8')) };
}

module.exports = { normalizeScenePath, selectBuiltScene, readBuiltScene };
