'use strict';

const fs = require('node:fs');
const path = require('node:path');

function playerSmokeExitCode(result) {
    return result?.ok === true ? 0 : 1;
}

function playerSmokeFailure(error, details = {}) {
    return Object.freeze({ ok: false, error, details: Object.freeze({ ...details }) });
}

function playerStartupFailure(error, fallbackCode = 'PLAYER_STARTUP_FAILED') {
    const message = String(error?.message || error || 'Unknown player startup error');
    const errorCode = String(error?.code || '');
    if (/integrity check failed|escapes content root/i.test(message)) {
        return Object.freeze({
            code: 'PLAYER_BUILD_INTEGRITY_FAILED',
            message: 'The exported game files failed integrity verification. Re-export or reinstall this build.'
        });
    }
    if (/ENOENT/i.test(errorCode) || /ENOENT|not found|unexpected end|JSON|manifest/i.test(message)) {
        return Object.freeze({
            code: 'PLAYER_BUILD_UNREADABLE',
            message: 'The exported game files are missing or unreadable. Re-export or reinstall this build.'
        });
    }
    return Object.freeze({
        code: fallbackCode,
        message: 'The player could not start. Re-export the game and try again.'
    });
}

function playerProcessIsAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return error?.code === 'EPERM';
    }
}

function pruneStalePlayerSessionData(root, {
    currentPid = process.pid,
    isProcessAlive = playerProcessIsAlive,
    fileSystem = fs
} = {}) {
    if (!fileSystem.existsSync(root)) return [];
    const removed = [];
    for (const entry of fileSystem.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
        const pid = Number(entry.name);
        if (pid === currentPid || isProcessAlive(pid)) continue;
        try {
            fileSystem.rmSync(path.join(root, entry.name), { recursive: true, force: true });
            removed.push(entry.name);
        } catch {
            // Chromium or antivirus may briefly retain a handle. A later player
            // launch retries the same bounded stale-directory cleanup.
        }
    }
    return removed;
}

module.exports = Object.freeze({
    playerSmokeExitCode,
    playerSmokeFailure,
    playerStartupFailure,
    playerProcessIsAlive,
    pruneStalePlayerSessionData
});
