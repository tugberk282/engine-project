'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { atomicWriteJson } = require('../architecture/persistence');

class StartupRecovery {
    constructor(file, { safeModeThreshold = 3, now = () => Date.now() } = {}) {
        this.file = file;
        this.safeModeThreshold = safeModeThreshold;
        this.now = now;
        this.state = { consecutiveUnclean: 0, lastClean: true };
    }

    begin() {
        try {
            const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
            if (parsed && parsed.schemaVersion === 1) this.state = parsed;
        } catch {}
        const previousUnclean = this.state.lastClean === false;
        const consecutiveUnclean = previousUnclean ? this.state.consecutiveUnclean + 1 : 0;
        this.state = {
            schemaVersion: 1,
            lastClean: false,
            consecutiveUnclean,
            startedAt: this.now()
        };
        this.persist();
        return Object.freeze({
            previousUnclean,
            consecutiveUnclean,
            safeMode: consecutiveUnclean >= this.safeModeThreshold
        });
    }

    markClean() {
        this.state = { schemaVersion: 1, lastClean: true, consecutiveUnclean: 0, stoppedAt: this.now() };
        return this.persist();
    }

    persist() {
        try {
            fs.mkdirSync(path.dirname(this.file), { recursive: true });
            atomicWriteJson(this.file, this.state);
            return true;
        } catch {
            return false;
        }
    }
}

module.exports = Object.freeze({ StartupRecovery });
