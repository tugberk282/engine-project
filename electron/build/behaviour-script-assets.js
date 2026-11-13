'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { BuildError } = require('./build-contract');
const { compileBehaviourProgram } = require('../runtime/behaviour-script');

const MAX_PROGRAM_BYTES = 64 * 1024;
const MAX_PREFAB_BYTES = 1024 * 1024;

function normalizeAssetPath(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    const normalized = value.trim().replaceAll('\\', '/');
    if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) return null;
    const segments = normalized.split('/');
    if (segments[0] !== 'Assets' || segments.some(segment => !segment || segment === '.' || segment === '..')) return null;
    return normalized.toLowerCase().endsWith('.behaviour.json') ? normalized : null;
}

function normalizePrefabPath(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    const normalized = value.trim().replaceAll('\\', '/');
    if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) return null;
    const segments = normalized.split('/');
    if (segments[0] !== 'Assets' || segments.some(segment => !segment || segment === '.' || segment === '..')) return null;
    return normalized.toLowerCase().endsWith('.prefab') ? normalized : null;
}

function isInside(root, target) {
    const relative = path.relative(root, target);
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function resolveBehaviourScriptAssetsForBuild(scenes, projectRoot) {
    const realRoot = await fs.promises.realpath(projectRoot);
    const sources = new Map();
    const prefabs = new Map();
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
    const loadPrefab = async (assetPath) => {
        if (prefabs.has(assetPath)) return prefabs.get(assetPath);
        const candidate = path.resolve(projectRoot, ...assetPath.split('/'));
        if (!isInside(projectRoot, candidate)) {
            throw new BuildError('RUNTIME_PREFAB_PATH_INVALID', `Runtime prefab escapes project root: ${assetPath}`);
        }
        let realPath;
        let stat;
        try {
            realPath = await fs.promises.realpath(candidate);
            stat = await fs.promises.stat(realPath);
        } catch (error) {
            throw new BuildError('RUNTIME_PREFAB_MISSING', `Runtime prefab could not be read: ${assetPath}`, { cause: error.code });
        }
        if (!isInside(realRoot, realPath) || !stat.isFile()) {
            throw new BuildError('RUNTIME_PREFAB_PATH_INVALID', `Runtime prefab is outside the project or is not a file: ${assetPath}`);
        }
        if (stat.size > MAX_PREFAB_BYTES) {
            throw new BuildError('RUNTIME_PREFAB_TOO_LARGE', `Runtime prefab exceeds ${MAX_PREFAB_BYTES} bytes: ${assetPath}`);
        }
        let parsed;
        try {
            parsed = JSON.parse(await fs.promises.readFile(realPath, 'utf8'));
        } catch (error) {
            throw new BuildError('RUNTIME_PREFAB_INVALID', `Runtime prefab is invalid (${assetPath}): ${error.message}`);
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
            || !parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
            throw new BuildError('RUNTIME_PREFAB_INVALID', `Runtime prefab does not contain serialized data: ${assetPath}`);
        }
        prefabs.set(assetPath, parsed.data);
        return parsed.data;
    };
    const resolvePrefabActions = async (programSource) => {
        const program = JSON.parse(programSource || '{}');
        let changed = false;
        const visitActions = async (actions) => {
            if (!Array.isArray(actions)) return;
            for (const action of actions) {
                if (!action || typeof action !== 'object' || Array.isArray(action)) continue;
                if (action.op === 'instantiatePrefab') {
                    const assetPath = normalizePrefabPath(action.prefabPath);
                    if (!assetPath) throw new BuildError('RUNTIME_PREFAB_PATH_INVALID', `Runtime prefab path is invalid: ${String(action.prefabPath)}`);
                    action.prefabPath = assetPath;
                    action.prefabData = structuredClone(await loadPrefab(assetPath));
                    changed = true;
                }
                await visitActions(action.then);
                await visitActions(action.else);
            }
        };
        await visitActions(program.start);
        await visitActions(program.update);
        await visitActions(program.fixedUpdate);
        for (const actions of Object.values(program.events || {})) await visitActions(actions);
        if (!changed) return programSource;
        const resolved = JSON.stringify(program);
        if (Buffer.byteLength(resolved, 'utf8') > MAX_PROGRAM_BYTES) {
            throw new BuildError('RUNTIME_PREFAB_PROGRAM_TOO_LARGE', `Resolved BehaviourScript exceeds ${MAX_PROGRAM_BYTES} bytes.`);
        }
        return resolved;
    };
    const visit = async (node) => {
        for (const component of Array.isArray(node?.components) ? node.components : []) {
            if (component?.type !== 'BehaviourScript') continue;
            const rawPath = component?.data?.assetPath;
            if (typeof rawPath === 'string' && rawPath.trim()) {
                const assetPath = normalizeAssetPath(rawPath);
                if (!assetPath) throw new BuildError('BEHAVIOUR_SCRIPT_ASSET_PATH_INVALID', `BehaviourScript asset path is invalid: ${String(rawPath)}`);
                component.data.program = await resolvePrefabActions(await load(assetPath));
                component.data.assetPath = assetPath;
            } else {
                component.data.program = await resolvePrefabActions(String(component.data?.program || '{}'));
            }
        }
        for (const child of Array.isArray(node?.children) ? node.children : []) await visit(child);
    };
    for (const scene of scenes) {
        for (const root of scene.value?.gameObjects || []) await visit(root);
    }
    return { resolvedAssetCount: sources.size, resolvedPrefabCount: prefabs.size };
}

module.exports = {
    MAX_PROGRAM_BYTES, MAX_PREFAB_BYTES, normalizeAssetPath, normalizePrefabPath,
    resolveBehaviourScriptAssetsForBuild
};
