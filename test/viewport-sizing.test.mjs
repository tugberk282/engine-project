import test from 'node:test';
import assert from 'node:assert/strict';
import {
    MAX_VIEWPORT_PIXEL_RATIO,
    calculateViewportSize,
    viewportSizeEquals
} from '../src/editor/ViewportSizing.ts';

test('viewport sizing caps DPR and rounds CSS dimensions down', () => {
    assert.deepEqual(calculateViewportSize(801.9, 599.8, 3), {
        width: 801,
        height: 599,
        pixelRatio: MAX_VIEWPORT_PIXEL_RATIO
    });
});

test('viewport sizing rejects hidden and zero-sized hosts', () => {
    assert.equal(calculateViewportSize(0, 600, 1.5), null);
    assert.equal(calculateViewportSize(800, 0, 1.5), null);
});

test('viewport sizing normalizes invalid and sub-one DPR', () => {
    assert.equal(calculateViewportSize(800, 600, Number.NaN)?.pixelRatio, 1);
    assert.equal(calculateViewportSize(800, 600, 0.5)?.pixelRatio, 1);
});

test('size equality detects CSS-size and scale changes', () => {
    const baseline = calculateViewportSize(800, 600, 1.5);
    assert.ok(baseline);
    assert.equal(viewportSizeEquals(baseline, { width: 800, height: 600, pixelRatio: 1.5 }), true);
    assert.equal(viewportSizeEquals(baseline, { width: 800, height: 600, pixelRatio: 2 }), false);
});
