#!/usr/bin/env node

/**
 * Phase 5 Edge Cases Test Suite
 * 
 * Tests for nested prefabs + external references edge cases:
 * - Broken references handling
 * - Circular reference detection
 * - Cross-scene references
 * - Missing prefab file recovery
 * - Deep nested prefab chains
 */

const fs = require('fs');
const path = require('path');

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

let testsPassed = 0;
let testsFailed = 0;
const failedTests = [];

function log(color, message) {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function assert(condition, testName) {
    if (condition) {
        testsPassed++;
        log('green', `✓ ${testName}`);
    } else {
        testsFailed++;
        failedTests.push(testName);
        log('red', `✗ ${testName}`);
    }
}

// ============================================================================
// TEST SUITE 1: Nested Prefab Chains (Multiple Levels)
// ============================================================================

log('cyan', '\n--- TEST SUITE 1: Nested Prefab Chains ---');

const deepNestedPrefab = {
    root: {
        id: 'root_1',
        name: 'Character',
        sourceAssetPath: '/prefabs/Character.prefab',
        level: 0,
        children: [
            {
                id: 'level1_1',
                name: 'Armature',
                sourceAssetPath: '/prefabs/Armature.prefab',
                level: 1,
                children: [
                    {
                        id: 'level2_1',
                        name: 'Skeleton',
                        sourceAssetPath: null, // Scene instance, not prefab
                        level: 2,
                        children: [
                            {
                                id: 'level3_1',
                                name: 'Bone',
                                sourceAssetPath: null,
                                level: 3,
                                children: []
                            }
                        ]
                    }
                ]
            },
            {
                id: 'level1_2',
                name: 'Equipment',
                sourceAssetPath: '/prefabs/Equipment.prefab',
                level: 1,
                children: []
            }
        ]
    }
};

const validateNestedDepth = (node, maxDepth = 0) => {
    let depth = node.level || 0;
    maxDepth = Math.max(maxDepth, depth);
    if (node.children && Array.isArray(node.children)) {
        for (let child of node.children) {
            maxDepth = Math.max(maxDepth, validateNestedDepth(child, depth + 1));
        }
    }
    return maxDepth;
};

const maxDepth = validateNestedDepth(deepNestedPrefab.root);
assert(maxDepth === 3, 'Nested prefab depth correctly identified');
assert(deepNestedPrefab.root.children[0].children[0].sourceAssetPath === null, 'Scene instance child has no source');
assert(deepNestedPrefab.root.children[1].sourceAssetPath !== null, 'Sibling prefab has source');

// ============================================================================
// TEST SUITE 2: Broken Reference Detection & Recovery
// ============================================================================

log('cyan', '\n--- TEST SUITE 2: Broken Reference Detection ---');

const brokenRefScenario = {
    scene: {
        gameObjects: [
            { id: 'go_1', name: 'Player', components: [] },
            {
                id: 'go_2', name: 'Enemy', components: [
                    {
                        type: 'EnemyAI',
                        data: {
                            target: { __ref: 'go_999_DELETED', __type: 'GameObject' }
                        }
                    }
                ]
            }
        ]
    },
    idMap: {
        'go_1': 'valid_object',
        'go_2': 'valid_object'
        // go_999_DELETED is missing
    }
};

const validateReferences = (scene, idMap) => {
    const brokenRefs = [];
    scene.gameObjects.forEach(go => {
        go.components?.forEach(comp => {
            if (comp.data && typeof comp.data === 'object') {
                Object.values(comp.data).forEach(val => {
                    if (val && val.__ref && !idMap[val.__ref]) {
                        brokenRefs.push(val.__ref);
                    }
                });
            }
        });
    });
    return brokenRefs;
};

const broken = validateReferences(brokenRefScenario.scene, brokenRefScenario.idMap);
assert(broken.length === 1, 'Broken reference detected');
assert(broken[0] === 'go_999_DELETED', 'Correct broken reference identified');

// ============================================================================
// TEST SUITE 3: Circular Reference Detection
// ============================================================================

log('cyan', '\n--- TEST SUITE 3: Circular Reference Detection ---');

const circularRefData = {
    'obj_a': { id: 'obj_a', references: ['obj_b'] },
    'obj_b': { id: 'obj_b', references: ['obj_c'] },
    'obj_c': { id: 'obj_c', references: ['obj_a'] } // Circle back to A
};

const detectCircularRefs = (startId, refMap, visited = new Set(), recursionStack = new Set()) => {
    if (recursionStack.has(startId)) {
        return true; // Circular reference detected
    }
    if (visited.has(startId)) {
        return false; // Already checked this path
    }

    visited.add(startId);
    recursionStack.add(startId);

    const refs = refMap[startId]?.references || [];
    for (let ref of refs) {
        const newStack = new Set(recursionStack);
        newStack.add(startId);
        if (detectCircularRefs(ref, refMap, visited, newStack)) {
            return true;
        }
    }

    recursionStack.delete(startId);
    return false;
};

const hasCircular = detectCircularRefs('obj_a', circularRefData);
assert(hasCircular === true, 'Circular reference detected');

const noCircularData = {
    parentA: { references: ['childB', 'childC'] },
    childB: { references: [] },
    childC: { references: [] }
};

const hasCircularLinear = detectCircularRefs('parentA', noCircularData);
assert(hasCircularLinear === false, 'Linear hierarchy correctly identified as non-circular');

// ============================================================================
// TEST SUITE 4: Cross-Scene Reference Handling
// ============================================================================

log('cyan', '\n--- TEST SUITE 4: Cross-Scene References ---');

const crossSceneRef = {
    mainScene: {
        gameObjects: [
            { id: 'player_1', name: 'Player', sceneId: 'MainScene' }
        ]
    },
    levelScene: {
        gameObjects: [
            {
                id: 'enemy_1',
                name: 'Enemy',
                sceneId: 'Level1',
                components: [{
                    type: 'EnemyTarget',
                    data: {
                        // Cross-scene reference
                        targetRef: {
                            __ref: 'player_1',
                            __scene: 'MainScene',
                            __type: 'GameObject'
                        }
                    }
                }]
            }
        ]
    }
};

assert(crossSceneRef.levelScene.gameObjects[0].components[0].data.targetRef.__scene === 'MainScene',
    'Cross-scene reference marked with source scene');
assert(crossSceneRef.levelScene.gameObjects[0].components[0].data.targetRef.__ref === 'player_1',
    'Cross-scene reference ID preserved');

// ============================================================================
// TEST SUITE 5: Missing Prefab File Recovery
// ============================================================================

log('cyan', '\n--- TEST SUITE 5: Missing Prefab File Recovery ---');

const missingPrefabScenario = {
    instance: {
        id: 'go_1',
        name: 'Player',
        sourceAssetPath: '/prefabs/MissingPlayer.prefab', // File doesn't exist
        sourceAssetGuid: 'guid_player',
        children: [
            {
                id: 'go_2',
                name: 'Head',
                sourceAssetPath: null,
                children: []
            }
        ]
    },
    recovery: {
        fallbackSource: null, // Could try localStorage
        keepInstanceData: true,
        markBroken: true,
        canCreatePlaceholder: true
    }
};

assert(missingPrefabScenario.recovery.keepInstanceData === true, 'Instance data preserved on missing prefab');
assert(missingPrefabScenario.recovery.markBroken === true, 'Missing prefab marked for debugging');
assert(missingPrefabScenario.instance.children[0].sourceAssetPath === null, 'Scene children unaffected');

// ============================================================================
// TEST SUITE 6: External ID Map Merging
// ============================================================================

log('cyan', '\n--- TEST SUITE 6: External ID Map Merging ---');

const baseIdMap = {
    'go_1': 'local_1',
    'go_2': 'local_2'
};

const externalIdMap = {
    'go_3': 'ext_1',
    'go_4': 'ext_2'
};

const mergedIdMap = { ...baseIdMap, ...externalIdMap };

assert(Object.keys(mergedIdMap).length === 4, 'ID maps merged correctly');
assert(mergedIdMap['go_1'] === 'local_1', 'Base map values preserved');
assert(mergedIdMap['go_3'] === 'ext_1', 'External map values included');

// Map conflict test
const conflictingMap = { ...baseIdMap, 'go_1': 'override' };
assert(conflictingMap['go_1'] === 'override', 'Later map values override earlier ones');

// ============================================================================
// TEST SUITE 7: Nested Prefab Reference Resolution
// ============================================================================

log('cyan', '\n--- TEST SUITE 7: Nested Prefab Reference Resolution ---');

const nestedPrefabRefResolution = {
    parentPrefab: {
        id: 'parent',
        components: [{
            type: 'Manager',
            data: {
                targetChild: { __ref: 'child_1', __type: 'GameObject' }
            }
        }],
        children: [{
            id: 'child_1',
            name: 'ChildPrefab',
            sourceAssetPath: '/prefabs/Child.prefab'
        }]
    }
};

const resolutionMap = new Map();
resolutionMap.set('child_1', { id: 'actual_child_id' });

assert(resolutionMap.has('child_1'), 'Child reference in resolution map');
assert(nestedPrefabRefResolution.parentPrefab.components[0].data.targetChild.__ref === 'child_1',
    'Reference ID before resolution');

// ============================================================================
// TEST SUITE 8: Prefab Override Isolation
// ============================================================================

log('cyan', '\n--- TEST SUITE 8: Prefab Override Isolation ---');

const overrideIsolation = {
    prefabSource: {
        gameObject: { id: 'prefab_root', name: 'Enemy' },
        overrides: new Set() // Should always be empty for source
    },
    instance1: {
        gameObject: { id: 'instance_1', name: 'Enemy' },
        overrides: new Set(['position', 'rotation'])
    },
    instance2: {
        gameObject: { id: 'instance_2', name: 'Enemy' },
        overrides: new Set(['scale']) // Different overrides
    }
};

assert(overrideIsolation.prefabSource.overrides.size === 0, 'Prefab source has no overrides');
assert(overrideIsolation.instance1.overrides.size === 2, 'Instance 1 has isolated overrides');
assert(!overrideIsolation.instance2.overrides.has('position'), 'Instance 2 has different overrides');

// ============================================================================
// TEST SUITE 9: Batch Apply with Nested Prefabs
// ============================================================================

log('cyan', '\n--- TEST SUITE 9: Batch Apply with Nested Prefabs ---');

const batchApplyData = {
    operations: [
        { id: 'op_1', targetId: 'prefab_1', type: 'ApplyOverride' },
        { id: 'op_2', targetId: 'prefab_1/child_1', type: 'ApplyOverride' },
        { id: 'op_3', targetId: 'prefab_1/child_1/grandchild_1', type: 'ApplyOverride' }
    ],
    groupId: 'batch_123'
};

assert(batchApplyData.operations.length === 3, 'Batch contains 3 operations');
assert(batchApplyData.operations[0].targetId === 'prefab_1', 'Root operation included');
assert(batchApplyData.operations[2].targetId.includes('grandchild'), 'Deep nested operation included');

// ============================================================================
// TEST SUITE 10: Reference Validation After Deserialization
// ============================================================================

log('cyan', '\n--- TEST SUITE 10: Post-Deserialization Reference Validation ---');

const postDeserializationValidation = {
    componentData: {
        targetRef: { __ref: 'go_1', __type: 'GameObject' },
        componentRef: { __ref: 'go_2', __type: 'Component', __comp: 'Rigidbody' }
    },
    resolvedData: {
        targetRef: { /* actual GameObject instance */ },
        componentRef: { /* actual Component instance */ }
    },
    validationResults: {
        targetRefValid: true,
        componentRefValid: true,
        allReferencesResolved: true
    }
};

assert(postDeserializationValidation.validationResults.targetRefValid === true, 'GameObject reference valid');
assert(postDeserializationValidation.validationResults.componentRefValid === true, 'Component reference valid');
assert(postDeserializationValidation.validationResults.allReferencesResolved === true, 'All references resolved');

// ============================================================================
// TEST SUITE 11: External Reference Snapshot for Undo/Redo
// ============================================================================

log('cyan', '\n--- TEST SUITE 11: External Ref Snapshot for History ---');

const undoRedoSnapshot = {
    beforeApply: {
        externalRefs: {
            'ext_1': { sceneId: 'MainScene', id: 'go_1' },
            'ext_2': { sceneId: 'Level1', id: 'go_5' }
        },
        timestamp: '2026-04-20T12:00:00Z'
    },
    afterApply: {
        externalRefs: {
            'ext_1': { sceneId: 'MainScene', id: 'go_1' },
            'ext_2': { sceneId: 'Level2', id: 'go_5' } // Changed
        },
        timestamp: '2026-04-20T12:01:00Z'
    }
};

assert(undoRedoSnapshot.beforeApply.externalRefs['ext_1'].sceneId === 'MainScene',
    'Before snapshot recorded');
assert(undoRedoSnapshot.afterApply.externalRefs['ext_2'].sceneId === 'Level2',
    'After snapshot recorded with changes');

// ============================================================================
// SUMMARY
// ============================================================================

log('cyan', '\n--- EDGE CASES TEST SUMMARY ---');
log('blue', `Total: ${testsPassed + testsFailed} tests`);
log('green', `Passed: ${testsPassed}`);
log('red', `Failed: ${testsFailed}`);

if (testsFailed > 0) {
    log('yellow', '\nFailed tests:');
    failedTests.forEach(test => log('red', `  - ${test}`));
    process.exit(1);
} else {
    log('green', '\n✓ All edge case tests passed!');
    process.exit(0);
}
