# Tugberk Engine Agent Handoff

This file is the compact continuation context for future coding sessions. Read it before inspecting the broader roadmap.

## Product Goal

Tugberk Engine is an Electron desktop game engine. The usable target is a real editor that can author, save, run, and export small 3D games. Unity is the behavioral reference, but exact full Unity parity is not claimed.

Continuation efficiency is part of the product goal. This repository-local file is the canonical short-term project memory: keep only the latest verified state, open risks, next work, and exact verification commands so future sessions do not replay the full conversation history or load unrelated context. External note tools such as Obsidian may display this Markdown file, but must not become a required dependency or a second source of truth.

## Current Verified State

- Desktop launcher supports create/open/recent/trust flows and recoverable failures.
- Scene authoring includes hierarchy, Scene View navigation, transform tools, snapping, primitives, components, inspector commits, undo/redo and persistence.
- Runtime includes supervised play mode, input, keyboard/gamepad paths, gravity, rigidbody, box/sphere/capsule collision contracts, triggers, player controller, follow camera, UI events and bounded diagnostics. The rendered Windows lane now proves configured movement, mouse look and grounded jump reach the child runtime, then verifies key release, Pause/Step and exact Stop restoration. The freshly built Windows player smoke drives the same behaviors through browser keyboard/mouse events rather than direct runtime snapshots.
- Standalone Windows player packages authored scenes, primitives, materials/textures, audio, UI controls and supported runtime components. Its bounded render contract now preserves depth-ordered Base/Overlay camera stacks, clear flags/color/alpha, culling layers and viewport rect, mesh layers, linear/Exp2 fog, light masks/shadows and environment tone mapping.
- Asset transactions preserve bytes/GUIDs through create, duplicate, move/rename, delete, undo and redo.
- Windows unpacked release, NSIS installer, packaged editor smoke and AppContainer sandbox are verified.

## Verification Snapshot

- `npm test`: 120/120 passed.
- Full sweep: 279/280 passed; one Windows symlink-alias identity case is skipped by platform capability.
- Source-built editor smoke: 2 runs, 62/62 checks each, including rendered prefab save/GUID/instantiate, three-level nested identity/apply/revert, structural overrides, GUID path reconnection, corrupt-source preservation, missing-source recovery UI, Repair and Unpack undo/redo.
- Packaged editor smoke: 43/43 checks.
- Installer install, launch, packaged smoke, sandbox matrix and uninstall: passed.
- `npx tsc --noEmit`, `npm run build` and `git diff --check`: passed.
- Known build warning: hierarchy chunk remains larger than the configured warning limit.
- Prefab source saving now links the authored root to the created `.prefab` asset, persists its GUID/source type, and rewrites the asset with the stable source link for reload-safe apply/revert behavior.
- Filesystem stat now treats an expected post-undo `ENOENT` as a null stat, preventing Project refresh races from becoming uncaught renderer errors; stale drag sources are rejected with a visible refresh message.
- Prefab asset refresh captures structural differences from one in-memory source instance, preserving descendant component and child add/remove overrides without repeated disk queries. The two-run 58/58 source-built smoke passes within a finite 60-second per-run bound.
- Built-in and user component registrations now carry stable type names independent of production minification. Serialization, GameObject lookup, prefab apply/revert, Inspector collider routing and structural refresh use those names; this removes the bundled `Add Component $` identity failure.
- Linked prefab roots resolve stale paths through their asset GUID before load/apply/revert. Missing or invalid source refreshes emit a bounded diagnostic and leave the current scene instance untouched; corrupt-source preservation and successful recovery are rendered-qualified.
- Prefab-backed global commands await both the mutation and CommandHistory's asynchronous source/scene snapshot restore. Apply calls no longer return while stale scene objects or source bytes are still being replaced.
- Packaged-player tests now retain renderer diagnostics on failure and launch the isolated Windows smoke lane with in-process GPU and no-sandbox switches; normal exported players keep their sandbox and default acceleration. The real player render/input/physics/UI build test passes.
- Rendered Build Settings qualifies scene loading, cancelled output selection, bounded progress, a real Windows player artifact, and recoverable publication failure. Electron-hosted builds force the worker into Node mode and copy ASAR files as opaque bytes, so export works from the desktop editor rather than only from Node tests.
- Atomic build publication retries only transient Windows rename locks (`EPERM`, `EBUSY`, `EACCES`) with bounded backoff across publish, replacement and rollback moves. Permanent filesystem errors remain immediate.
- Build diagnostics now surface scenes with no enabled Camera and Overlay cameras whose assigned base is not an enabled Base camera. The player retains malformed overlays as independent passes instead of silently dropping authored output.
- Game View camera discovery now traverses the complete active GameObject hierarchy in deterministic preorder, so child cameras and child Base/Overlay stacks match the standalone player instead of being ignored by the editor.
- `CapsuleCollider` now participates as an authored world collider, not only as the player shape: generic rigidbodies and standalone player controllers resolve against capsule platforms/triggers with authored center, height and horizontal scale.
- Supervised Play Mode now applies serialized `RigidBody.drag` and `freezePositionX/Y/Z` using the same damping contract as the standalone runtime, removing an editor/player movement divergence.
- The standalone worker now resolves generic RigidBody contacts against authored Box/Sphere/Capsule colliders with trigger exclusion and the project collision matrix; exported non-player bodies no longer fall through static geometry.
- Standalone generic rigidbody simulation now uses the same bounded 50 Hz fixed-step cadence as supervised Play Mode; equivalent elapsed time split across different render frames produces the same transform.
- CapsuleCollider is routed to the dedicated Collider Inspector; Radius and Height are editable through undoable, prefab-aware commands, while setters reject invalid geometry and keep height at least the diameter.
- Authored `UIEventAction.LoadScene` now exposes an undoable Scene Path in a dedicated Inspector and reloads only manifest-selected scenes in the Windows player. A fresh executable smoke drives the real authored `NextScene` UI event from the canonical sample through worker state, secure IPC and reload into the second scene; excluded targets produce Build Settings diagnostics.
- Prefab Inspector checks source health asynchronously, disables source-mutating actions for missing/invalid assets, and exposes project-confined Repair, Unpack and Unpack Completely actions. Repair and Unpack are rendered-qualified as single undo/redo units in two 62/62 Electron runs; missing filesystem probes also tolerate bounded Windows `ENOENT`/`EBADF` disappearance races without weakening confinement.
- The retained editor-interaction lane saves the post-Repair/Unpack prefab identity matrix, closes Electron, reopens the same project, and proves every source link survives while the new process starts with fresh undo history. This matches Unity-style restart semantics rather than attempting to persist an old process's undo stack.

## Immediate Next Work

1. Add a recorded Game View/player frame comparison; the standalone camera/layer/fog/shadow/tone-mapping/viewport contract and gameplay input are now covered independently.
2. Add broader material/post-processing parity; depth-ordered Base/Overlay camera stacking now follows the Game View contract.
3. Keep unsupported runtime components explicit in build diagnostics; do not execute arbitrary project code without a bounded compiler/sandbox contract.

## Working Rules

- Read this handoff first; open only the roadmap sections and source files needed for the current task.
- Replace stale handoff facts instead of appending a session diary; keep detailed historical evidence in the roadmap.
- Work in the repository root, not a demo copy.
- Use `rg` for search and `apply_patch` for edits.
- Run focused tests first, then `npm test`, typecheck/build when product code changes.
- Do not reset or revert unrelated user changes.
- Do not claim Unity parity or completion from source-only evidence; update the roadmap with verified evidence.
