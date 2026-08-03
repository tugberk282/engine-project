'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SECRET_KEY = /(authorization|cookie|credential|password|secret|token)/i;
const PATH_KEY = /(path|root|directory|cwd|file(name)?)/i;
const PATH_VALUE = /(?:[A-Za-z]:[\\/]|\/(?:Users|home|var|tmp)\/|\\\\[^\\]+\\)/;

function redact(value, key = '', depth = 0) {
    if (SECRET_KEY.test(key)) return '[REDACTED]';
    if (PATH_KEY.test(key)) return '[PATH]';
    if (depth > 5) return '[TRUNCATED]';
    if (typeof value === 'string') {
        if (PATH_VALUE.test(value)) return '[PATH]';
        return value.length > 512 ? `${value.slice(0, 509)}...` : value;
    }
    if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, key, depth + 1));
    if (value && typeof value === 'object') {
        const output = {};
        for (const [childKey, childValue] of Object.entries(value).slice(0, 50)) {
            output[childKey] = redact(childValue, childKey, depth + 1);
        }
        return output;
    }
    return typeof value === 'number' || typeof value === 'boolean' || value === null ? value : String(value);
}

class DiagnosticStore {
    constructor({
        directory,
        maxBytes = 1024 * 1024,
        maxFiles = 4,
        maxAgeMs = 7 * 24 * 60 * 60 * 1000,
        now = () => Date.now()
    }) {
        this.directory = directory;
        this.maxBytes = maxBytes;
        this.maxFiles = maxFiles;
        this.maxAgeMs = maxAgeMs;
        this.now = now;
        this.disabled = false;
        this.writing = false;
    }

    record(event) {
        if (this.disabled || this.writing) return false;
        this.writing = true;
        try {
            fs.mkdirSync(this.directory, { recursive: true });
            this.prune();
            const file = path.join(this.directory, 'events.ndjson');
            const safe = redact({
                timestamp: new Date(this.now()).toISOString(),
                processRole: event.processRole || 'main',
                requestId: event.requestId,
                sessionId: event.sessionId,
                operation: event.operation || 'unknown',
                durationMs: Number.isFinite(event.durationMs) ? Math.max(0, event.durationMs) : undefined,
                outcome: event.outcome || 'unknown',
                errorCode: event.errorCode,
                details: event.details
            });
            const line = `${JSON.stringify(safe)}\n`;
            if (fs.existsSync(file) && fs.statSync(file).size + Buffer.byteLength(line) > this.maxBytes) {
                this.rotate(file);
            }
            fs.appendFileSync(file, line, { encoding: 'utf8', mode: 0o600 });
            return true;
        } catch {
            // Diagnostics are best-effort and must never recurse or block shutdown.
            this.disabled = true;
            return false;
        } finally {
            this.writing = false;
        }
    }

    rotate(file) {
        for (let index = this.maxFiles - 1; index >= 1; index -= 1) {
            const source = index === 1 ? file : `${file}.${index - 1}`;
            const target = `${file}.${index}`;
            if (fs.existsSync(source)) fs.renameSync(source, target);
        }
    }

    prune() {
        const cutoff = this.now() - this.maxAgeMs;
        for (const entry of fs.readdirSync(this.directory, { withFileTypes: true })) {
            if (!entry.isFile() || !/^events\.ndjson(?:\.\d+)?$/.test(entry.name)) continue;
            const file = path.join(this.directory, entry.name);
            if (fs.statSync(file).mtimeMs < cutoff || Number(entry.name.split('.').at(-1)) >= this.maxFiles) {
                fs.rmSync(file, { force: true });
            }
        }
    }
}

module.exports = Object.freeze({ DiagnosticStore, redact });
