#!/usr/bin/env node

/**
 * Legacy compatibility runner.
 * Keeps older workflows working while delegating to the canonical
 * Phase 1-8 parity runner.
 */

const path = require('path');
const { spawnSync } = require('child_process');

const runnerPath = path.join(__dirname, 'test_all_phases.cjs');

console.log('run_all_tests.cjs -> delegating to test_all_phases.cjs');

const result = spawnSync('node', [runnerPath], {
    cwd: __dirname,
    stdio: 'inherit',
    shell: false
});

process.exit(result.status ?? 0);
