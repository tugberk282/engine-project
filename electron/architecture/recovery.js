const fs = require('fs');
const path = require('path');
const { atomicWriteText } = require('./persistence');

const MAX_RECOVERY_BYTES = 8 * 1024 * 1024;
const RECOVERY_FILE = path.join('Library', 'Recovery', 'active-scene.json');

function recoveryPath(projectRoot) {
    return path.join(projectRoot, RECOVERY_FILE);
}

function writeRecovery(projectRoot, scenePath, sceneText, now = Date.now()) {
    if (typeof sceneText !== 'string' || Buffer.byteLength(sceneText, 'utf8') > MAX_RECOVERY_BYTES) {
        throw new Error('Recovery snapshot exceeds limit');
    }
    JSON.parse(sceneText);
    const target = recoveryPath(projectRoot);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    atomicWriteText(target, JSON.stringify({
        formatVersion: 1,
        capturedAt: now,
        scenePath: typeof scenePath === 'string' ? scenePath : null,
        scene: JSON.parse(sceneText)
    }));
    return true;
}

function readRecovery(projectRoot, canonicalModifiedAt = 0) {
    const target = recoveryPath(projectRoot);
    try {
        if (!fs.existsSync(target) || fs.statSync(target).size > MAX_RECOVERY_BYTES) return null;
        const value = JSON.parse(fs.readFileSync(target, 'utf8'));
        if (value?.formatVersion !== 1 || !Number.isFinite(value.capturedAt) || !value.scene || typeof value.scene !== 'object') return null;
        return value.capturedAt > canonicalModifiedAt ? value : null;
    } catch {
        return null;
    }
}

function discardRecovery(projectRoot) {
    const target = recoveryPath(projectRoot);
    try {
        fs.rmSync(target, { force: true });
        return true;
    } catch {
        return false;
    }
}

module.exports = { MAX_RECOVERY_BYTES, RECOVERY_FILE, recoveryPath, writeRecovery, readRecovery, discardRecovery };
