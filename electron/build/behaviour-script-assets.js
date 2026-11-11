'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { BuildError } = require('./build-contract');
const { compileBehaviourProgram } = require('../runtime/behaviour-script');

const MAX_PROGRAM_BYTES = 64 * 1024;

function normalizeAssetPath(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    const normalized = value.trim().replaceAll('\\', '/');
    if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) return null;
    const segments = normalized.split('/');
    if (segments[0] !== 'Assets' || segments.some(segment => !segment || segment === '.' || segment === '..')) return null;
    return normalized.toLowerCase().endsWith('.behaviour.json') ? normalized : null;
}

function isInside(root, target) {
    const relative = path.relative(root, target);
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function resolveBehaviourScriptAssetsForBuild(scenes, projectRoot) {
    const realRoot = await fs.promises.realpath(projectRoot);
    const sources = new Map();
    const load = async (assetPath) => {
        if (sources.has(assetPath)) return sources.get(assetPath);
        const candidate = path.resolve(projectRoot, ...assetPath.split('/'));
        if (!isInside(projectRoot, candidate)) {
            throw new BuildError('BEHAVIOUR_SCRIPT_ASSET_PATH_INVALID', `BehaviourScript asset escapes project root: ${assetPath}`);
        }
        let realPath;
        let stat;
        try {
            realPath = await fs.promises.realpath(candidate);
            stat = await fs.promises.stat(realPath);
        } catch (error) {
            throw new BuildError('BEHAVIOUR_SCRIPT_ASSET_MISSING', `BehaviourScript asset could not be read: ${assetPath}`, { cause: error.code });
        }
        if (!isInside(realRoot, realPath) || !stat.isFile()) {
            throw new BuildError('BEHAVIOUR_SCRIPT_ASSET_PATH_INVALID', `BehaviourScript asset is outside the project or is not a file: ${assetPath}`);
        }
        if (stat.size > MAX_PROGRAM_BYTES) {
            throw new BuildError('BEHAVIOUR_SCRIPT_ASSET_TOO_LARGE', `BehaviourScript asset exceeds ${MAX_PROGRAM_BYTES} bytes: ${assetPath}`);
        }
        const source = await fs.promises.readFile(realPath, 'utf8');
        const compiled = compileBehaviourProgram(source);
        if (!compiled.ok) {
            throw new BuildError('BEHAVIOUR_SCRIPT_ASSET_INVALID', `BehaviourScript asset is invalid (${assetPath}): ${compiled.error}`);
        }
        sources.set(assetPath, source);
        return source;
    };
    const visit = async (node) => {
        for (const component of Array.isArray(node?.components) ? node.components : []) {
            if (component?.type !== 'BehaviourScript') continue;
            const rawPath = component?.data?.assetPath;
            if (typeof rawPath !== 'string' || !rawPath.trim()) continue;
            const assetPath = normalizeAssetPath(rawPath);
            if (!assetPath) throw new BuildError('BEHAVIOUR_SCRIPT_ASSET_PATH_INVALID', `BehaviourScript asset path is invalid: ${String(rawPath)}`);
            component.data.program = await load(assetPath);
            component.data.assetPath = assetPath;
        }
        for (const child of Array.isArray(node?.children) ? node.children : []) await visit(child);
    };
    for (const scene of scenes) {
        for (const root of scene.value?.gameObjects || []) await visit(root);
    }
    return { resolvedAssetCount: sources.size };
}

module.exports = { MAX_PROGRAM_BYTES, normalizeAssetPath, resolveBehaviourScriptAssetsForBuild };
