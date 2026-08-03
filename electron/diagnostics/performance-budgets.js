'use strict';

const BUDGETS = Object.freeze({
    coldLaunchMs: 5000,
    enterPlayMs: 500,
    frameMs: 16.67,
    idleMemoryBytes: 500 * 1024 * 1024,
    assetScanMs: 1000
});

function percentile(samples, percentileValue = 0.95) {
    if (!Array.isArray(samples) || samples.length === 0 || samples.some((value) => !Number.isFinite(value) || value < 0)) {
        throw new TypeError('Samples must be a non-empty array of non-negative finite numbers');
    }
    const sorted = [...samples].sort((left, right) => left - right);
    return sorted[Math.ceil(percentileValue * sorted.length) - 1];
}

function evaluatePerformance(samples, budgets = BUDGETS) {
    const result = {};
    for (const [signal, budget] of Object.entries(budgets)) {
        const values = samples[signal];
        const measured = signal === 'idleMemoryBytes' ? Math.max(...values) : percentile(values);
        result[signal] = Object.freeze({ measured, budget, pass: measured <= budget });
    }
    return Object.freeze(result);
}

module.exports = Object.freeze({ BUDGETS, percentile, evaluatePerformance });
