'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { BUILD_MANIFEST_VERSION, BuildError, STAGES, assertBuildRequest, serializeError } = require('./build-contract');
const { stableStringify, contentHash, migrateProject, migrateScene, normalizeDocument, validateDocument } =
    require('../architecture/persistence');

let cancelled = false;
process.on('message', (message) => {
    if (message?.type === 'cancel') cancelled = true;
    if (message?.type === 'build') run(message.request).catch((error) => finish({ ok: false, error: serializeError(error) }));
});

function emit(type, value) {
    if (process.connected) process.send({ type, ...value });
}

function checkCancelled() {
    if (cancelled) throw new BuildError('BUILD_CANCELLED', 'Build was cancelled');
}

async function stage(name, work) {
    checkCancelled();
    emit('progress', { stage: name, stageIndex: STAGES.indexOf(name), stageCount: STAGES.length });
    emit('log', { level: 'info', message: `Starting ${name}` });
    return work();
}

function isInside(root, target) {
    const relative = path.relative(root, target);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function listFiles(root, relative = '') {
    const directory = path.join(root, relative);
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
        checkCancelled();
        if (entry.isSymbolicLink()) continue;
        const child = path.posix.join(relative.replaceAll('\\', '/'), entry.name);
        if (entry.isDirectory()) files.push(...await listFiles(root, child));
        else if (entry.isFile() && !child.endsWith('.meta')) files.push(child);
    }
    return files;
}

async function copyTree(source, destination) {
    const entries = await fs.promises.readdir(source, { withFileTypes: true });
    await fs.promises.mkdir(destination, { recursive: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
        checkCancelled();
        const from = path.join(source, entry.name);
        const to = path.join(destination, entry.name);
        if (entry.isDirectory()) await copyTree(from, to);
        else if (entry.isFile()) await fs.promises.copyFile(from, to);
    }
}

async function run(rawRequest) {
    const request = assertBuildRequest(rawRequest);
    const projectFile = path.join(request.projectRoot, 'project.json');
    let projectText;
    let project;

    await stage('validate', async () => {
        projectText = await fs.promises.readFile(projectFile, 'utf8').catch((error) => {
            throw new BuildError('PROJECT_MISSING', 'project.json could not be read', { cause: error.code });
        });
        if (contentHash(projectText) !== request.projectRevision) {
            throw new BuildError('REVISION_STALE', 'Project changed after the build request was created');
        }
        try {
            project = normalizeDocument('project', migrateProject(JSON.parse(projectText)));
            validateDocument('project', project);
        } catch (error) {
            throw new BuildError(error.code || 'PROJECT_INVALID', error.message);
        }
    });

    let scenes;
    await stage('resolve', async () => {
        scenes = [];
        for (const entry of project.scenes) {
            checkCancelled();
            const scenePath = path.resolve(request.projectRoot, entry.path);
            if (!isInside(request.projectRoot, scenePath)) {
                throw new BuildError('SCENE_PATH_INVALID', `Scene escapes project root: ${entry.path}`);
            }
            let parsed;
            try {
                parsed = JSON.parse(await fs.promises.readFile(scenePath, 'utf8'));
                parsed = normalizeDocument('scene', migrateScene(parsed));
                validateDocument('scene', parsed);
            } catch (error) {
                throw new BuildError(error.code === 'ENOENT' ? 'SCENE_MISSING' : (error.code || 'SCENE_INVALID'),
                    `Could not resolve scene ${entry.path}`);
            }
            if (parsed.sceneId !== entry.sceneId) {
                throw new BuildError('SCENE_GUID_MISMATCH', `Scene identifier does not match ${entry.path}`);
            }
            scenes.push({ path: entry.path.replaceAll('\\', '/'), value: parsed });
        }
        if (scenes.length === 0) throw new BuildError('SCENE_MISSING', 'At least one scene is required');
    });

    const assets = await stage('import', async () => {
        const assetRoot = path.join(request.projectRoot, 'Assets');
        return fs.existsSync(assetRoot) ? listFiles(assetRoot) : [];
    });

    const workspace = request.workspacePath;
    await stage('bundle', async () => {
        await fs.promises.mkdir(path.join(workspace, 'content'), { recursive: true });
        for (const scene of scenes) {
            const destination = path.join(workspace, 'content', scene.path);
            await fs.promises.mkdir(path.dirname(destination), { recursive: true });
            await fs.promises.writeFile(destination, stableStringify(scene.value), 'utf8');
        }
        for (const asset of assets) {
            const projectRelative = path.posix.join('Assets', asset);
            if (scenes.some((scene) => scene.path === projectRelative)) continue;
            const source = path.join(request.projectRoot, 'Assets', asset);
            const destination = path.join(workspace, 'content', projectRelative);
            await fs.promises.mkdir(path.dirname(destination), { recursive: true });
            await fs.promises.copyFile(source, destination);
        }
    });

    const manifest = await stage('package', async () => {
        if (request.target === 'win-x64') {
            const electronRoot = path.resolve(__dirname, '..', '..', 'node_modules', 'electron', 'dist');
            if (!fs.existsSync(path.join(electronRoot, 'electron.exe'))) {
                throw new BuildError('PLAYER_RUNTIME_MISSING', 'The Windows player runtime is not installed');
            }
            await copyTree(electronRoot, workspace);
            await fs.promises.rename(path.join(workspace, 'electron.exe'), path.join(workspace, 'Tugberk Player.exe'));
            const appRoot = path.join(workspace, 'resources', 'app');
            await fs.promises.mkdir(appRoot, { recursive: true });
            for (const file of ['player-main.js', 'player-preload.js', 'player.html', 'player-renderer.js']) {
                await fs.promises.copyFile(path.join(__dirname, file), path.join(appRoot, file));
            }
            await fs.promises.writeFile(path.join(appRoot, 'package.json'), stableStringify({
                name: 'tugberk-standalone-player', version: '1.0.0', private: true, main: 'player-main.js'
            }), 'utf8');
        }
        const contentFiles = await listFiles(path.join(workspace, 'content'));
        const files = [];
        for (const relative of contentFiles) {
            const bytes = await fs.promises.readFile(path.join(workspace, 'content', relative));
            files.push({
                path: relative.replaceAll('\\', '/'),
                bytes: bytes.length,
                sha256: crypto.createHash('sha256').update(bytes).digest('hex')
            });
        }
        const core = {
            manifestVersion: BUILD_MANIFEST_VERSION,
            requestVersion: request.version,
            projectId: project.projectId,
            projectRevision: request.projectRevision,
            target: request.target,
            entryScene: project.scenes[0].path.replaceAll('\\', '/'),
            scenes: project.scenes.map((scene) => ({ sceneId: scene.sceneId, path: scene.path.replaceAll('\\', '/') })),
            files
        };
        const result = { ...core, manifestHash: contentHash(core) };
        await fs.promises.writeFile(path.join(workspace, 'manifest.json'), stableStringify(result), 'utf8');
        return result;
    });
    finish({ ok: true, manifest });
}

function finish(result) {
    emit('result', result);
    setImmediate(() => process.disconnect?.());
}
