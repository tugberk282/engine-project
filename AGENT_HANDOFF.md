# Tugberk Engine - Compact Handoff

Read this file first in a new coding session. Do not read the full roadmap unless the current task needs a specific section.

## Goal

Build a Windows Electron desktop game engine capable of authoring, running and exporting small 3D games. Unity is the workflow and behavior reference, but full Unity API parity is not the V1 requirement.

V1 must provide a usable editor, scene/component authoring, persistence, prefabs, Play Mode, input, physics, cameras, authored UI events, assets and a runnable Windows player.

## Current Position

- Estimated V1 completion: about 82%.
- Branch: `main`; last committed revision at this handoff: `ca0aded`.
- The working tree is intentionally dirty. Never reset or discard unrelated changes.
- The current large change set expands bounded `BehaviourScript` gameplay authoring and runtime prefab instantiation in Play Mode and exported players.
- Runtime prefabs already cover primitive rendering, colliders/rigidbodies, BehaviourScript lifecycle, audio sources/listeners and particle systems.
- Runtime-prefab camera render-pass rebuilding, inactive-hierarchy filtering, light materialization, imported GLB/GLTF loading and the supported UI subset are now directly covered and verified. Animation commands racing spawned-model loading are retained and replayed.
- BehaviourScript authoring now includes bounded, undoable Inspector templates for Empty, Input Movement, Rotator and Trigger Deactivator programs.
- Latest verification passed: `npm test` 241/241, TypeScript through the production build, two source-built Electron runs at 62/62 with no process leak, a fresh unpacked Windows package, and packaged-editor smoke at 62/62.

## Latest Completed Slice

`electron/build/player-scene.mjs` now rebuilds camera render passes when a runtime prefab is materialized, and `electron/build/player-renderer.js` skips camera passes whose runtime hierarchy is inactive. `test/player-scene.test.mjs` verifies that spawned cameras and lights preserve their authored runtime behavior. Runtime-prefab imported models reuse the authored model loader, including safe GLTF dependency resolution, cloned hierarchy binding and Animator controller setup. Runtime-prefab UI supports idempotent `UIText`, `UIImage`, native controls, `UIScrollRect` and `UIEventAction/LoadScene` collection and pending mount behavior while preserving cloned active hierarchy paths. Spawned-model animation commands now use the same latest-command pending strategy as asynchronously loaded audio. `BehaviourScriptTemplates.ts` supplies four validated inline starting points that the Inspector applies through `CommandHistory`; external assets remain read-only.

The rendered Build Settings Windows lane now executes the player it just published. It directly verifies the exported scene, rendering, shadow/material setup, configured input, movement, jump, mouse look, collision, trigger and UI state; the existing rendered Play Mode lane verifies the matching Game View input/physics behaviors. Packaged smoke now has a 90-second default bound because the full 62-check authoring transaction consistently exceeds the former 60-second bound in the packaged host.

The next focused slice is visible interactive Windows player qualification, followed by a scoped stability/diagnostics or packaging gap. Start with a scoped graphify query and preserve the current dirty tree.

The latest slice verification was `npm.cmd run test:fast`, the direct rendered Build Settings plus Play Mode tests (3/3), `npm.cmd test`, `npm.cmd run build`, `npm.cmd run test:source-built-smoke`, `npm.cmd run electron:build:dir`, and `npm.cmd run test:packaged-smoke`. Source-built smoke performs two editor runs internally.

## Working Systems

- Desktop project create/open/recent/trust lifecycle.
- Hierarchy, Scene View navigation, transforms, primitives, components and Inspector editing.
- Undo/redo, scene persistence, asset GUID transactions and prefab source/apply/revert/repair/unpack workflows.
- Supervised Play Mode with edit-state restoration.
- Keyboard/mouse/gamepad input mappings, player controller and follow camera.
- Box, sphere and capsule collision; triggers; generic rigidbody fixed-step simulation.
- Authored UI controls, events, nested RectTransforms, layout groups, images and bounded ScrollRect behavior.
- Standalone materials/textures, audio, particles, GLB/GLTF models, basic animation and camera stacks.
- Multi-scene authored transitions and Windows player export.
- Bounded JSON `BehaviourScript`: lifecycle/events, variables, conditions, world reads, transform/physics actions, pooling, prefab spawn, effects and destruction.

## Highest-Value Remaining Work

1. Expand gameplay templates only when a concrete repeated authoring pattern justifies it.
2. Perform visible interactive Windows player qualification; automated Game View/export equivalence is now recorded.
3. Close remaining stability, diagnostics and packaging gaps without claiming unsupported components.

## Efficient Workflow

- Use `graphify query`, `graphify path` or `graphify explain` before broad source searches when `graphify-out/graph.json` exists.
- Read only files and line ranges relevant to the active slice. Never load all of `UNITY_PARITY_ROADMAP.md` for ordinary development.
- Use `npm.cmd run test:fast` while editing.
- Run a directly related test file when the fast set is still broader than necessary.
- Run `npm.cmd test`, typecheck and build once after a completed product slice, not after every edit.
- Run Electron smoke only for editor/render/lifecycle changes or before a checkpoint/commit.
- Keep command output bounded. On success report only exit status and counts; investigate detailed output only on failure.
- Do not spawn multiple agents for routine implementation. Use a specialist only for an isolated review that avoids duplicate repository exploration.
- Do not commit or push every turn. Batch several verified slices unless the user asks for a checkpoint.
- Update this handoff by replacing stale facts. Detailed historical evidence belongs in `UNITY_PARITY_ROADMAP.md`.

## Key Paths

- Editor integration: `src/editor/Editor.ts`, `src/editor/EditorInspectors.ts`
- Runtime bridge: `src/engine/RuntimeBridge.ts`, `src/engine/runtime.worker.js`
- Supervised runtime: `electron/runtime/`
- Exported player: `electron/build/player-renderer.js`, `electron/build/player-scene.mjs`
- Script asset resolution: `src/engine/BehaviourScriptAssets.ts`, `electron/build/behaviour-script-assets.js`
- Detailed audit archive: `UNITY_PARITY_ROADMAP.md`

## Truth Rules

- A passing source-pattern test does not prove rendered behavior.
- Do not describe unsupported C#/TypeScript execution as implemented.
- Do not claim full Unity parity.
- Preserve project confinement, bounded runtime execution and unknown serialized component data.
