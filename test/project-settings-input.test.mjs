import assert from 'node:assert/strict';
import test from 'node:test';

test('project input axes survive JSON persistence as a Map', async () => {
    const values = new Map();
    globalThis.localStorage = {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, String(value))
    };

    const { ProjectSettings } = await import('../src/engine/ProjectSettings.ts');
    ProjectSettings.inputAxes = new Map([
        ['Move', {
            positiveButton: 'd', negativeButton: 'a', altPositiveButton: 'ArrowRight', altNegativeButton: 'ArrowLeft',
            gravity: 4, sensitivity: 7, snap: true, type: 'KeyOrMouseButton'
        }]
    ]);
    ProjectSettings.save();

    const serialized = JSON.parse(values.get('tugberkengine_project_settings'));
    assert.equal(serialized.inputAxes.Move.positiveButton, 'd');
    assert.equal(serialized.inputAxes.Move.sensitivity, 7);

    ProjectSettings.inputAxes = new Map();
    ProjectSettings.load();
    assert.equal(ProjectSettings.inputAxes instanceof Map, true);
    assert.equal(ProjectSettings.inputAxes.get('Move').negativeButton, 'a');
});
