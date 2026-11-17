# Tugberk Engine - Compact Handoff

Read this file first in a new coding session. Do not read the full roadmap unless the current task needs a specific section.

## Goal

Build a Windows Electron desktop game engine capable of authoring, running and exporting small 3D games. Unity is the workflow and behavior reference, but full Unity API parity is not the V1 requirement.

V1 must provide a usable editor, scene/component authoring, persistence, prefabs, Play Mode, input, physics, cameras, authored UI events, assets and a runnable Windows player.

## Current Position

- Push checkpoint (2026-11-18): six-launch packaged layout qualification passed, including oversized/off-screen and negative-coordinate floating state at 150% zoom, 900x600 content size (600x400 CSS viewport). Evidence `C:/Users/tugbe/AppData/Local/Temp/tug-112-packaged-keyboard-hjgQK0/summary.json`. Latest full suite 254/254; release-integrity 4/4, architecture/provenance 10/10, release audit policy and production build pass. The broad V1 goal was explicitly paused; current user request authorizes commit/push and GitHub CI fixes, not automatic goal completion. Native memory trend, wider DPI/device matrix and unpatched development-tool picomatch advisory remain open.

- Authoritative latest checkpoint: layout recovery width defect is FIXED. `clampLayoutSizes` no longer clamps persisted geometry against zero-sized hidden startup roots. Four packaged launches including native float/dock, two restarts and corrupt-primary/LKG recovery preserve a native-splitter custom width (expected=actual 302px). Evidence `C:/Users/tugbe/AppData/Local/Temp/tug-112-packaged-keyboard-tdozca/summary.json`. Full 254/254, production build and source-built smoke 62/62 twice pass with no leaked processes. Historical failing-layout notes below are superseded. Next: off-screen/oversized floating bounds and viewport-size qualification; native process-memory trend still open.

- Estimated V1 completion: about 85%.
- Branch: `main`; last committed revision at this handoff: `e00c9c7`.
- The working tree is intentionally dirty. Never reset or discard unrelated changes.
- The current large change set expands bounded `BehaviourScript` gameplay authoring and runtime prefab instantiation in Play Mode and exported players.
- Runtime prefabs already cover primitive rendering, colliders/rigidbodies, BehaviourScript lifecycle, audio sources/listeners and particle systems.
- Runtime-prefab camera render-pass rebuilding, inactive-hierarchy filtering, light materialization, imported GLB/GLTF loading and the supported UI subset are now directly covered and verified. Animation commands racing spawned-model loading are retained and replayed.
- BehaviourScript authoring now includes bounded, undoable Inspector templates for Empty, Input Movement, Rotator and Trigger Deactivator programs.
- Latest unit/integration verification: `npm test` 253/253, production build and source-built smoke (62/62 twice, zero leaked processes) passed. The preceding Windows package and installer checkpoint passed two installed 62-check smokes, exact archive repair, the sandbox matrix and uninstall.
- Visible player qualification confirms a real exported window, rendered 3D scene, live HUD, Restart, authored Next Scene transition, drag-driven mouse-look and clean shutdown with no remaining player process. Computer Use only exposes discrete key presses, so held movement/jump remain covered by automated player smoke rather than visible qualification.

## Latest Completed Slice

`electron/build/player-scene.mjs` now rebuilds camera render passes when a runtime prefab is materialized, and `electron/build/player-renderer.js` skips camera passes whose runtime hierarchy is inactive. `test/player-scene.test.mjs` verifies that spawned cameras and lights preserve their authored runtime behavior. Runtime-prefab imported models reuse the authored model loader, including safe GLTF dependency resolution, cloned hierarchy binding and Animator controller setup. Runtime-prefab UI supports idempotent `UIText`, `UIImage`, native controls, `UIScrollRect` and `UIEventAction/LoadScene` collection and pending mount behavior while preserving cloned active hierarchy paths. Spawned-model animation commands now use the same latest-command pending strategy as asynchronously loaded audio. `BehaviourScriptTemplates.ts` supplies four validated inline starting points that the Inspector applies through `CommandHistory`; external assets remain read-only.

The rendered Build Settings Windows lane now executes the player it just published. It directly verifies the exported scene, rendering, shadow/material setup, configured input, movement, jump, mouse look, collision, trigger and UI state; the existing rendered Play Mode lane verifies the matching Game View input/physics behaviors. Packaged smoke now has a 90-second default bound because the full 62-check authoring transaction consistently exceeds the former 60-second bound in the packaged host.

Standalone player smoke completion now exits with code `0` only for an explicit `{ ok: true }` result. Failed or malformed smoke results exit with code `1`, and the small pure contract is copied into every exported player. The canonical build-service test covers the successful packaged-player path; a real reduced-fixture export confirmed the failing exit path.

Smoke-mode player startup is also fail-fast: `did-fail-load`, renderer termination, renderer unresponsiveness and rejected startup/load promises write a structured failure result and exit with code `1` instead of waiting for the outer qualification timeout. The Windows build-service test removes `player.html` from a disposable export and verifies `PLAYER_LOAD_FAILED / ERR_FILE_NOT_FOUND` end to end.

Exported-player Chromium session data is isolated per PID and stale PID directories are now pruned on the next player launch. Cleanup preserves the current process, other live player processes and non-PID directories, and retries undeletable stale directories on a later launch.

Normal exported players now replace blank windows or silent exits with a local CSP-protected startup error page. Build integrity failures, unreadable exports and player HTML load failures receive stable user-facing codes and re-export/reinstall guidance without exposing raw paths. Disposable Windows export qualification visibly confirmed both `PLAYER_BUILD_INTEGRITY_FAILED` and `PLAYER_LOAD_FAILED`; smoke mode remains fail-fast and machine-readable.

Exported-player runtime worker failures no longer freeze on the last rendered frame. Post-start runtime errors, worker crashes, message deserialization failures and render-state exceptions converge on a single bounded diagnostic contract, terminate the failed worker, stop the animation loop, mount an accessible user-facing runtime error overlay and fail smoke with a stable code. A disposable Windows export forces a first-tick `FORCED_RUNTIME_FAILURE` and verifies exit code `1` plus structured details end to end.

A fresh NSIS artifact passes the full installer gate: silent install to an isolated directory, installed packaged-editor smoke at 62/62, packaged AppContainer adversarial sandbox matrix, and silent uninstall. Authenticode remains optional unless `TUGBERK_REQUIRE_AUTHENTICODE=1` is supplied.

The installer gate now also qualifies same-version overwrite/repair. It runs an initial 62-check packaged smoke, deliberately corrupts the installed `resources/app.asar`, reinstalls the same NSIS artifact into the same directory, requires the original SHA-256 to be restored, runs a second 62-check smoke, then executes the sandbox matrix and verifies the asynchronously completing NSIS uninstall removes the application executable.

The user explicitly requested continuous work until V1 completion; an active goal tracks it. Follow V1_ACCEPTANCE.md in order. Next: sustained runtime operation and isolated clean lockfile installation. Current-source fresh Windows package passed six persistence/recovery phases and keyboard author/reopen (12+2 checks); retained temp evidence paths are in the acceptance ledger. Canonical Windows build test now moves the exported player and renames the source project before executing checks; relocation passes. Post-start watchdog is complete. Do not mark the goal complete from percentage estimates.

The latest slice adds four lifecycle tests: deferred texture decode across shutdown, live/failed attachment ownership, shared model material-array/texture cleanup and cleanup continuing after a disposal exception. Material and particle texture loaders share `attachPlayerTexture`; late model cleanup deduplicates resources and aggregates failures. Fast tests, Windows build-service 11/11, full 249/249, production build and source-built smoke (62/62 twice, zero leaked processes) passed.

## Working Systems

CURRENT PRIORITY (supersedes historical next notes): stronger packaged layout recovery test is FAILING and must be fixed, not weakened. Harness stages corruption only after changing left splitter with native Shift+Right and storing actual width. Last run `C:/Users/tugbe/AppData/Local/Temp/tug-112-packaged-keyboard-unVB1T/layout-recovery/result.json`: expected 232px, restored 182px. Earlier default-docked check passed but was too weak. Native keyboard docking itself is now verified: refocus mainWindow/webContents after AX capture; three-launch evidence `.../tug-112-packaged-keyboard-Kqx9le`, earlier four-launch weak recovery `.../tug-112-packaged-keyboard-Yc4Pj0`. Inspect Editor.saveLayout, setSideSlotWidth, startup preset application and EditorSettings.load fallback. Preserve failing width assertion. GC diagnostic endurance passed at `C:/Users/tugbe/AppData/Local/Temp/tugberk-player-endurance-RsGaTl`: 120s/24 cycles; post-warmup JS heap 7,122,229–7,396,671 bytes, first 7,370,401, last 7,325,687. This mode forces GC only in disposable player, so do not substitute for normal memory qualification. Fast tests/build pass; latest enhanced layout qualification remains red.

Latest active work: five-minute textured churn passes 60 model cycles/14,001 frames, GPU resources fixed 27/24. Four-process post-warmup private memory still increases +36.90234375 MiB across 53 samples (285,376,512–347,164,672 bytes); evidence `C:/Users/tugbe/AppData/Local/Temp/tugberk-player-endurance-LbGOiD/process-memory.json`. Memory is NOT closed. Also expanded packaged keyboard/layout harness to shared user-data and three launches; native float, floating restart, pointer dock, docked restart pass (`.../tug-112-packaged-keyboard-zzqdRD/summary.json`). Fixed Editor.setActivePanel unnecessarily appendChild'ing an already-mounted floating panel, which dropped child focus. DOM focus assertion passes; keyboard dock activation remains unresolved (pointer path passes). Next: diagnose native keyboard activation/focus after capturePage/debugger AX collection, then heap/GC trend. Current label-only harness wording edit after the passing run is not a behavioral change.

Churn/process memory checkpoint: endurance textured-models now loads an extra GLTF every five seconds, draws it, removes it and disposes resources. It samples only processes whose executable path exactly matches the disposable player and retains process-memory.json. 120s run `C:/Users/tugbe/AppData/Local/Temp/tugberk-player-endurance-pTVYNy` passed 24 cycles/5,626 frames, stable 27 geometries/24 textures. 23 memory samples; four-process post-warmup series has 19 samples, 289,882,112–325,226,496 private bytes and +17.484375 MiB first-to-last growth. Do not call memory stability complete; extend to 5–10min trend. Fast tests/syntax and real executable profile pass. Next also qualify layout dock/float/restart recovery using docs/quality/tug-113-layout-qualification.md; current keyboard evidence does not close that matrix.

Textured model cleanup/endurance checkpoint: createPlayerScene.dispose now uses deduplicated material-array/texture cleanup, releases shadow render targets and clears scene/lookup/render-pass references; disposal is idempotent. New 25-cycle test passes. Full suite 254/254, build and source-built smoke twice at 62/62 pass. Endurance `120 textured-models` passed with 24 imported textured GLTF models, 5,597 frames, stable 27 geometries/24 textures/27 draw calls. Evidence: `C:/Users/tugbe/AppData/Local/Temp/tugberk-player-endurance-HAcvUP/result.json`. Next: process-memory sampling and repeated imported-scene churn, then remaining authoring/release qualification. This is two-minute fixed-scene evidence, not general leak freedom or hours-long qualification.

Real player endurance checkpoint: added `npm.cmd run test:player-endurance -- 120` (duration 10–3600s). It builds, relocates the export, takes source offline and drives actual worker ticks/rendering with five-second GPU resource samples. Stock-sample 120s run passed with 5,664 frames, stable 3 geometries/0 textures/3 draw calls. Fifteen relevant smoke checks pass; three absent layout injection fixture results remain false in raw evidence, not promoted to success. Artifact: `C:/Users/tugbe/AppData/Local/Temp/tugberk-player-endurance-GdcTBG/result.json`. Main tests 253/253 and build pass. Next: texture/model-heavy churn and process-memory endurance plus remaining authoring qualification; stock sample alone cannot prove broad leak freedom. Goal remains active.

Dependency maintenance checkpoint: package.json now overrides affected minimatch >=7,<11.0.1 to 11.0.9 and lockfile is regenerated. First validated in the isolated source copy, including fresh Windows package and 62-check packaged smoke; main worktree fast tests, full 253/253 and production build passed. Production npm audit is clean. Remaining full audit: 13 high entries from one unpatched picomatch root advisory; docs/quality/v1-dependency-status.md records evidence and limits. Earlier 15-advisory checkpoint is historical. Next: real renderer/worker endurance; do not substitute runPackagedPlayer frame counting for simulation. Goal stays active.

Isolated install checkpoint: current dirty source copied into `C:/Users/tugbe/AppData/Local/Temp/tugberk-clean-v1-9a363760186c4371b3f2a352640653be` without preexisting dependencies or dist; npm ci, Electron bootstrap, build and 253 tests passed. Production npm audit is clean; full audit reports 10 high/5 moderate development-tool advisories, including picomatch/fdir/minimatch/node-gyp chains. Next parallel-in-sequence priorities: targeted dependency repair (do not blindly apply suggested major downgrades) and real renderer/worker endurance. `runPackagedPlayer` only validates artifacts and increments a frame counter; it must not be used as simulation/endurance evidence. Main worktree dependencies were not changed during this checkpoint.

Worker startup checkpoint: `startPlayerWorker` bounds initial state wait to 10 seconds, accepts only the current session, rejects worker errors/messageerrors and synchronous send/render failures, and clears temporary listeners/timer on completion. Real Windows export tests verify a nonresponding worker returns `PLAYER_RUNTIME_START_TIMEOUT` and a startup crash returns `PLAYER_RUNTIME_WORKER_CRASHED`, both exit 1 within a 20-second outer bound. Session filtering and listener cleanup have focused tests. Latest full suite: 251/251; build and two 62/62 source-built smoke runs passed with no leaked processes.

The dated paragraphs immediately below are historical checkpoint notes. Their embedded "Next" tasks are superseded by the current next-focused-slice paragraph above.

Late-completion guards (2026-11-17): disposed players ignore render states, stop RAF scheduling, suppress late asset warnings and skip model/material/texture work after asynchronous reads. Textures finishing after disposal are disposed before assignment; late model disposal supports material arrays and their textures. Particle texture failures now use the recoverable asset warning. The forced-fatal Windows export test submits a late render after cleanup and verifies the disposed view is never updated. Fast tests, build-service 11/11, full 245/245, production build and source-built smoke 62/62 twice passed with zero leaked processes. Next targeted task: delay a texture decode across disposal and verify the produced texture is disposed without material assignment. Keep V1 estimate at 85%; the late-texture guard has code review/regression coverage but not this dedicated race test yet.

Player cleanup and packaging checkpoint (2026-11-17): fatal runtime errors and pagehide now share early-registered, idempotent resource disposal. Worker, resize observer, pointer lock, audio sources/context, animation mixers, particles, object URLs, scene and renderer are released independently so one disposal failure cannot suppress later cleanup. Startup rejection also releases these resources. Disposable Windows export instrumentation invokes cleanup twice and requires exactly one scene disposal. Fast tests, build-service 11/11, full 245/245, production build, fresh NSIS build and expanded installer gate all passed (installed smoke 62/62 twice, archive hash repair, AppContainer matrix, uninstall). Next: inspect queued worker-state handling after fatal disposal and late asynchronous asset completions; add targeted coverage before the next packaging batch. V1 estimate remains 85%.

Recoverable asset failure qualification (2026-11-17): a disposable Windows export now rejects material resource loading and verifies the accessible `PLAYER_ASSET_LOAD_FAILED` warning remains mounted after the full gameplay smoke. All checks other than the deliberately broken material fidelity check remain true, including movement, jump, collision, trigger and UI. The smoke correctly exits 1 for failed material fidelity; the player continues rendering/simulating through the recoverable error. Fast tests, build-service 11/11 and full 245/245 suite passed. Next: review accumulated player diagnostics changes for cleanup/recovery gaps before the next packaging checkpoint. V1 estimate remains 85%.

Recoverable asset diagnostics (2026-11-17): model, audio, UI image and material load failures now retain a generic `PLAYER_ASSET_LOAD_FAILED` HUD warning while gameplay continues. Distinct failure accounting is capped at 100; raw paths/errors remain in console diagnostics. Fast tests, full 245/245, production build and two source-built smokes at 62/62 passed with zero leaked processes. Next: a forced asset-load failure export test proving warning persistence and continued gameplay. V1 estimate remains 85%.

Scene-transition failure/retry qualification (2026-11-17): the disposable Windows export test now forces the first scene activation to reject, advances four runtime frames, asserts the warning/retry button persist and only one activation was attempted, clicks the actual retry button and confirms the target scene loads. Fast tests, focused build-service 11/11 and full 245/245 suite passed. This closes the dedicated transition failure/retry validation task; recoverable asset-load diagnostics remain next.

Scene-transition diagnostics follow-up (2026-11-17): failed exported-player scene loads now retain a visible `PLAYER_SCENE_LOAD_FAILED` warning across rendered frames and offer an explicit retry button. A failed action is latched to prevent automatic per-frame IPC retries. Fast tests, full 245-test suite, production build and source-built smoke (62/62 twice, zero leaked processes) passed. A dedicated forced transition-failure/retry end-to-end test remains the next validation task; V1 estimate stays at 85%.

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
2. Add a true prior-version-to-current installer migration lane when two distinct release artifacts exist.

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
