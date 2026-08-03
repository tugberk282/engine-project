'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const matrixPath = path.join(__dirname, '..', 'docs', 'quality', 'phase-2-authoring-interaction-matrix.md');
const matrix = fs.readFileSync(matrixPath, 'utf8');
const rows = matrix.split(/\r?\n/).filter((line) => /^\| (?:CH|SV|IN|PR|CO|SH|TX)-\d{2} \|/.test(line));

function cells(row) {
    return row.split('|').slice(1, -1).map((cell) => cell.trim());
}

test('Phase 2 matrix covers every authoring surface and cross-cutting transaction class', () => {
    const ids = rows.map((row) => cells(row)[0]);
    assert.equal(new Set(ids).size, ids.length, 'matrix IDs must be unique');
    for (const prefix of ['CH', 'SV', 'IN', 'PR', 'CO', 'SH', 'TX']) {
        assert.ok(ids.some((id) => id.startsWith(`${prefix}-`)), `missing ${prefix} matrix rows`);
    }
    assert.ok(rows.length >= 40, `expected a complete matrix of at least 40 transactions, found ${rows.length}`);
});

test('every matrix row defines modalities, acceptance, durability, negative path, evidence and status', () => {
    const allowedStatuses = new Set(['specified', 'source-contract', 'rendered-partial', 'rendered-pass', 'blocked']);
    for (const row of rows) {
        const [id, surface, pointer, keyboard, focus, acceptance, durability, negative, evidence, status] = cells(row);
        assert.equal(cells(row).length, 10, `${id} must have exactly ten columns`);
        for (const [name, value] of Object.entries({ surface, pointer, keyboard, focus, acceptance, durability, negative, evidence })) {
            assert.ok(value && value !== '?', `${id} has no ${name} contract`);
        }
        assert.ok(allowedStatuses.has(status), `${id} has unsupported status ${status}`);
    }
});

test('the matrix cannot promote source evidence to observable parity', () => {
    for (const row of rows) {
        const [id, , , , , , , , evidence, status] = cells(row);
        if (status === 'rendered-pass') {
            assert.match(evidence, /packaged/i, `${id} rendered-pass must cite packaged evidence`);
        }
        if (/source|unit|implementation|service|assertion/i.test(evidence)) {
            assert.notEqual(status, 'rendered-pass', `${id} source/unit evidence cannot be rendered-pass`);
        }
    }
    assert.match(matrix, /Source-pattern tests never qualify a row beyond `source-contract`/);
});

test('qualification includes desktop scale, resizing, keyboard-only, focus and recovery', () => {
    for (const phrase of [
        '100%, 150%, and 200%',
        '900x600',
        'keyboard-only',
        'focus returns',
        'lost capture',
        'save/restart',
        'empty/loading/error/disabled',
        'Assistive'
    ]) {
        assert.ok(matrix.toLowerCase().includes(phrase.toLowerCase()), `missing qualification obligation: ${phrase}`);
    }
});
