'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { contentHash, stableStringify, validateDocument } = require('../architecture/persistence');
const { BuildError } = require('./build-contract');

async function runPackagedPlayer(buildRoot, { frames = 1 } = {}) {
    if (!Number.isInteger(frames) || frames < 0 || frames > 1_000_000) {
        throw new BuildError('FRAME_COUNT_INVALID', 'frames must be an integer from 0 to 1000000');
    }
    const manifest = JSON.parse(await fs.promises.readFile(path.join(buildRoot, 'manifest.json'), 'utf8'));
    const { manifestHash, ...core } = manifest;
    if (contentHash(core) !== manifestHash) throw new BuildError('MANIFEST_CORRUPT', 'Manifest integrity check failed');
    for (const file of manifest.files) {
        const bytes = await fs.promises.readFile(path.join(buildRoot, 'content', file.path));
        const digest = crypto.createHash('sha256').update(bytes).digest('hex');
        if (digest !== file.sha256) throw new BuildError('ARTIFACT_CORRUPT', `Integrity check failed: ${file.path}`);
    }
    const scene = JSON.parse(await fs.promises.readFile(path.join(buildRoot, 'content', manifest.entryScene), 'utf8'));
    validateDocument('scene', scene);
    let state = { frame: 0, sceneId: scene.sceneId, objectCount: scene.gameObjects.length };
    for (let frame = 1; frame <= frames; frame += 1) state = { ...state, frame };
    return Object.freeze({ ...state, stateHash: contentHash(stableStringify(state)) });
}

if (require.main === module) {
    const buildRoot = process.argv[2];
    const frames = Number(process.argv[3] || 1);
    runPackagedPlayer(buildRoot, { frames }).then(
        (result) => { process.stdout.write(stableStringify({ ok: true, result })); },
        (error) => {
            process.stderr.write(stableStringify({ ok: false, error: { code: error.code || 'PLAYER_FAILED', message: error.message } }));
            process.exitCode = 1;
        }
    );
}

module.exports = Object.freeze({ runPackagedPlayer });
