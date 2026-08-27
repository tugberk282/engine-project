# Tugberk Engine Unity Parity Roadmap

Audit baseline: 2026-08-18, current uncommitted working tree plus detached clean-checkout evidence at revision `e0ddf59553daa3272e82ed59919c8163a2c798b2`

Owner: Independent parity audit (Hakem)
Product state: **not production-ready; the Electron 43 clean-checkout bootstrap and source-built two-run rendered smoke are independently verified, while packaged-editor, installer, player, and broader Unity-parity gates remain open**

## 1. Scope and definition of parity

Tugberk Engine is an Electron desktop editor and TypeScript/Three.js/Cannon runtime which aims to support Unity-like authoring and game execution. The parity target for this roadmap is the observable Unity 6 desktop workflow, not source/API name similarity and not pixel-perfect imitation.

A capability has parity only when a user can complete the equivalent workflow with the same material results, state transitions, persistence, failure behavior, and lifecycle expectations. A class, menu label, visual resemblance, mocked action, or source-pattern test is not parity.

The usable-core target is narrower than all of Unity: a Windows desktop editor in which a user can create/open a project, import assets, author and persist scenes and prefabs, edit GameObjects and components, run the authored scene without mutating edit state, and produce a runnable standalone build. Advanced Unity services, package ecosystem compatibility, DOTS, multiplayer, XR, platform-specific players, source-level Unity API compatibility, and exact `.unity`/`.prefab`/`.meta` compatibility are out of scope until this core is proven.

Unity behavioral references:

- Editor areas and their linked roles: [Unity editor interface](https://docs.unity3d.com/2023.2/Documentation/Manual/UsingTheEditor.html)
- Scene navigation and framing controls: [Scene view navigation](https://docs.unity3d.com/Manual/SceneViewNavigation.html)
- GameObjects as component containers and mandatory Transform behavior: [Components](https://docs.unity3d.com/Manual/Components.html)
- Inspector selection and editing behavior: [Inspector window](https://docs.unity3d.com/Manual/UsingTheInspector.html)
- Play mode resets scene and scripting state on exit by default: [Configurable Enter Play Mode](https://docs.unity3d.com/Manual/configurable-enter-play-mode.html)
- Input covers keyboard, mouse, gamepad, touch, sensors, XR, and configurable systems: [Input](https://docs.unity3d.com/Manual/Input.html)

## 2. Status vocabulary and evidence rules

| Status | Meaning |
|---|---|
| **Verified parity** | Current observable end-to-end evidence matches the scoped Unity behavior, including persistence and negative paths. |
| **Partial** | A usable subset works, but important Unity behavior, integration, or evidence is absent. |
| **Incorrect** | Implemented behavior materially contradicts the reference behavior or advertised result. |
| **Missing** | No meaningful implementation was found. |
| **Broken** | Intended implementation exists but cannot currently complete its workflow. |
| **Not tested** | Implementation may exist, but current evidence cannot support a result. |

Verification rules:

1. Run against a clean, reproducible build of the current tree. A stale `dist/` artifact cannot qualify source behavior.
2. Prefer a packaged-app interaction test or recorded manual reproduction. Unit tests prove only the contract they exercise.
3. A source-pattern assertion proves presence, not behavior. The historical root `verify_phase*.cjs` suites and closure reports were removed on 2026-08-18; Git history preserves them, but they are not parity evidence.
4. Each parity claim needs: Unity reference, fixture/project, exact steps, expected and actual result, platform/build identity, and retained output (test, log, screenshot, scene/build artifact).
5. Verify destructive and recovery paths, keyboard/focus, restart persistence, and error messages where they are part of the workflow.
6. “Verified parity” applies to a narrowly named capability. Broad systems remain Partial when only a subset is proven.

## 3. Current architecture

| Layer | Current responsibility | Evidence |
|---|---|---|
| Desktop host | Electron window, dialogs, lifecycle, IPC registration, navigation restrictions | `electron/main.js`, `electron/preload.js` |
| Security and protocol | Versioned request envelopes, project grants/trust, confined filesystem, protocol router | `electron/architecture/*`, `electron/security/*` |
| Desktop services | Project/recent-project/asset services, build worker, runtime supervisor, diagnostics and recovery | `electron/platform/*`, `electron/build/*`, `electron/runtime/*`, `electron/lifecycle/*`, `electron/diagnostics/*` |
| Editor shell | Menus, toolbar, docking/layout, view routing, scene view and command wiring | `index.html`, `src/editor/Editor.ts`, `src/style.css` |
| Editor views | Hierarchy, Inspector, Project, Console, settings and build windows | `src/editor/*Window.ts`, `src/editor/EditorInspectors.ts` |
| Authoring model | Scene, GameObject, Component, Transform, prefab and serialization models | `src/engine/Scene.ts`, `GameObject.ts`, `Component.ts`, `Prefab.ts`, `Serialization.ts` |
| Asset model | GUID metadata, scan/import cache and importers | `src/engine/AssetDatabase.ts`, `AssetImporter.ts` |
| Runtime | Play-mode snapshot bridge, separate runtime process/worker, frame protocol | `src/engine/PlayModeManager.ts`, `RuntimeBridge.ts`, `electron/runtime/*`, `src/engine/runtime.worker.js` |
| Rendering/physics/audio/UI | Three.js, cannon-es, Web Audio/Three audio, DOM-backed UI components | `src/engine/components/*`, `src/engine/PhysicsSystem.ts` |
| Scripting | Built-in/user TypeScript component registry; C# samples and watcher | `src/engine/ScriptRegistry.ts`, `src/scripts/*`, `scripts/watch-csharp.js` |
| Verification | Node contract/behavior tests plus rendered and packaged smoke lanes | `test/*`, `scripts/*smoke*.cjs` |

Architectural warning: the editor is concentrated in very large mutable modules (`Editor.ts` is about 441 KB and `EditorInspectors.ts` about 263 KB). Editor state, rendering, commands, persistence adapters, and UI event wiring are tightly coupled, making behavior difficult to isolate and qualify.

## 4. Audit baseline

Phase 0 was independently reverified for TUG-55 from the repository root on 2026-07-28:

- `npm.cmd run test:source-built-smoke-contract` — **4/4 pass** in 466 ms. This proves the harness contract has finite build/launch bounds, two runs, deterministic artifact identity, source identity, and rejection of a hung child.
- `$env:ENGINE_SOURCE_SMOKE_RESULT = Join-Path $env:PAPERCLIP_RUN_SCRATCH_DIR 'tug-55-source-smoke-final.json'; npm.cmd run test:source-built-smoke` — **pass** in 8.5 seconds. The harness deleted generated `dist/`, ran `npm run build`, then launched the newly built Electron editor twice against isolated project/user-data copies; both runs passed **17/17 rendered checks**.
- Retained result identity: revision `3d4c9af388afbc504e2e3ae1757f32bc9b1e8407`; dirty tree `true`; source SHA-256 `88f0395f745fc253c0f5cfa1e8d2e1ea1808cce737f1781f063b2f718fef8faf`; four-file built bundle SHA-256 `fa9314468957bbeaeae945899a9a615d65b5172a22cc7f742066d6dddcd0025b`.
- Declared bounds were 120,000 ms for build and 45,000 ms per editor launch. `Get-Process electron -ErrorAction SilentlyContinue` returned no remaining Electron process after the gate.

TUG-106 independently adjudicated TUG-57 from a clean detached checkout on Windows x64 on 2026-08-18:

- Revision `e0ddf59553daa3272e82ed59919c8163a2c798b2`, tree `0ee92c20a66a0f9a3184107db59afed1f13fcafb`, lockfile SHA-256 `24451b4b96835da07b3f415b0fd32c92a84535b9aed5a641bac96dab177f5c10`, Node `v24.13.0`, npm `11.6.2`; initial checkout clean and `dist/` absent.
- `npm.cmd ci` exited 0 in 7.4 s and left the lockfile and checkout unchanged, but did **not** create `node_modules/electron/dist/electron.exe`. `npm.cmd run build` then exited 0 in 3.9 s and produced four fresh files; `npm.cmd run test:source-built-smoke` exited 1 before launch on its direct executable assertion. Electron process count was 0 before and after.
- The committed repository has no `install-electron`/`electron/install.js` script or setup documentation. Electron 43 deliberately moved binary download from `postinstall` to the first execution of its bin wrapper, or to the explicit `npx install-electron --no` command ([official Electron breaking change](https://www.electronjs.org/docs/latest/breaking-changes#behavior-changed-electron-no-longer-downloads-itself-via-postinstall-script)); this repository's smoke bypasses that wrapper and directly requires the binary.
- Diagnostic control only: `npx.cmd install-electron --no` exited 0 in 2.4 s and produced `electron.exe` SHA-256 `8593db40c0c6e5e3c4b6b0a225b1dc9a549ecdf10f6cf2010cf5b6ce869ce07f`. The smoke contract then passed 4/4, and the source-built smoke passed twice at 21/21 checks with source SHA-256 `9ef997cfb15fe8725690608d6fe24256da0e3fbda26d776eee1e29f5de6b95ac`, four-file bundle SHA-256 `5b1197af52ae15cd1f93157829737ff217b448dd46c266b0143f803d57dad7ad`, and zero Electron processes before/after. This proves the manual intervention is sufficient; it does not make the ordinary repository workflow self-reproducing.

TUG-108 independently re-audited the repository-owned correction on Windows x64 on 2026-08-18:

- An isolated candidate snapshot was built from revision `e0ddf59553daa3272e82ed59919c8163a2c798b2` plus only the five TUG-108 files (`README.md`, `docs/quality/vertical-slice-quality-gates.md`, `package.json`, `scripts/source-built-editor-smoke.cjs`, and `test/source-built-editor-smoke.test.cjs`). It began without `node_modules/`, `dist/`, or Electron cache content.
- `npm.cmd run bootstrap` exited 0 in 23.4 s, ran lockfile-only `npm ci`, invoked the pinned Electron 43.2.0 `install-electron --no` bin, created `node_modules/electron/dist/electron.exe`, and changed zero tracked file contents. The raw `package-lock.json` SHA-256 remained `24451b4b96835da07b3f415b0fd32c92a84535b9aed5a641bac96dab177f5c10`.
- The focused contract passed 5/5. The fresh-build source smoke passed twice at 21/21 checks, retained four generated files with bundle SHA-256 `5b1197af52ae15cd1f93157829737ff217b448dd46c266b0143f803d57dad7ad`, and left Electron process counts at 0 -> 0.
- A separate empty-cache control ran only `npm ci`, confirmed that Electron remained absent, then ran `npm.cmd run test:source-built-smoke`. The smoke printed `Downloading Electron binary...`, installed through Electron 43's supported package-load path, rebuilt, passed two more 21/21 runs, preserved the raw lockfile hash, and again left zero Electron processes.
- The smoke result field named `source.lockSha256` is a path-delimited artifact-identity hash produced by `hashFiles`, not the raw file SHA-256. Raw lockfile immutability was independently compared outside the harness; the label should not be used as a literal file checksum.

Audit conclusion:

- Fresh source compilation and the Electron 43 clean bootstrap are verified from an isolated clean-base candidate. The canonical `npm run bootstrap` path and the smoke's own supported on-demand fallback both reproduce without a pre-existing Electron cache.
- The successful two-run smoke is narrow foundation evidence, not Unity parity and not release qualification. The checks are deliberately shallow.
- Packaged editor, installer/uninstaller, standalone player, and clean-machine behavior remain outside TUG-106's evidence.
- No broad capability receives **Verified parity** solely from this gate. Existing service tests remain foundation evidence and do not by themselves prove complete editor workflows.

## 5. Capability truth matrix

| Capability | Status | Current evidence and finding | Acceptance needed for parity |
|---|---|---|---|
| Install, launch, single-instance desktop lifecycle | **Partial** | TUG-108 verifies the repository-owned clean bootstrap: `npm run bootstrap` performs `npm ci` plus pinned Electron 43.2.0 `install-electron --no`, preserves tracked files and the lockfile, and the smoke can also trigger Electron's supported package-load download after plain `npm ci`. Two independent qualifications each passed two 21/21 rendered launches with 0 -> 0 Electron processes. Packaging configuration and lifecycle/security tests exist, but packaged artifact, installer and full lifecycle behavior were not exercised. | Installer installs/uninstalls; packaged app launches twice without corrupting state; second-instance behavior, close/cancel/save, crash and restart are observed. |
| Project browser: create/open/recent/trust | **Partial** | Grant-scoped project and recent-project services pass behavioral tests (`test/project-asset-services.test.cjs`, `recent-project-service.test.cjs`, `project-trust.test.cjs`). Renderer end-to-end create/open/reopen was not completed. | Create project in chosen folder, reopen it after restart, switch projects, reject malformed/non-project folder, revoke/regrant trust, preserve recent list. |
| Editor chrome, menus and shortcuts | **Partial** | Extensive wiring in `index.html` and `Editor.ts`; keyboard/source contract tests pass. TUG-55 rendered evidence proves the File menu opens by pointer in two isolated launches, but not the complete menu/shortcut matrix. Native platform conventions and complete enabled/disabled/focus behavior are unverified. | Traverse every top-level menu by mouse and keyboard; validate command results, shortcut conflicts, Escape dismissal, disabled items, focus return and OS accelerators. |
| Docking, tabs, layouts and maximization | **Partial** | Dock/floating/layout persistence logic exists in `Editor.ts`; accessibility source checks pass. No current rendered restart test. | Move every view among valid docks, float/resize/maximize/restore, save layouts, restart, recover invalid layout, verify min sizes and multi-monitor/DPI behavior. |
| Scene view navigation | **Partial** | Three.js scene view, editor camera controller, gizmo and transform-control code exist (`Editor.ts`, `EditorCameraController.ts`, `SceneGizmo.ts`). No systematic comparison of pan/orbit/zoom/flythrough/frame/axis snap/local-global/pivot-center. | Execute Unity-equivalent mouse/keyboard navigation and transform tool matrix; verify selection, occlusion, snapping, undo, camera speed, orthographic views and DPI resizing. |
| Game view | **Partial** | A game-view tab/render path is present, but output resolution/aspect, camera selection, input routing, stats and play coupling were not proven. | Render from active camera at selected aspect/resolution; isolate Scene/Game focus and input; validate resize, play/pause, no-camera and multiple-camera behavior. |
| Scene create/open/save/save-as | **Partial** | TUG-71 source re-audit confirms New, direct Open, and dialog Open now share `confirmSceneReplacement`; clean scenes bypass it and dirty scenes expose Save, discard, and cancel branches (`src/editor/Editor.ts:6380-6438`). The focused source-contract test passes (`test/scene-data-safety-ui.test.cjs`), as does the current build. This is not parity: dialog Open asks before file selection, and the discard branch deletes recovery before selection/load succeeds, so cancelling the picker or a failed load retains the in-memory scene but can destroy its recovery snapshot. The nested native `confirm()` sequence and exact state preservation are not rendered-tested. | Move the dirty decision after file selection and defer recovery deletion until scene replacement commits; use one explicit Save/Don't Save/Cancel dialog; prove New/direct Open/dialog Open across clean, Save success/failure, discard, cancel-picker, invalid/corrupt load, and successful replacement with exact scene/path/dirty/recovery assertions. |
| Multi-scene workflow | **Missing** | One active-scene model is exposed by `SceneManager.ts`; no additive scene workflow, scene headers, active-scene switching, unload, or cross-scene reference handling was evidenced. | Open scenes additively, set active scene, move objects between scenes, save/unload individually, and reject invalid cross-scene references consistently. |
| Hierarchy display and selection | **Partial** | Hierarchical rows, search, multiselect, context menus, rename and drag/drop code exist in `HierarchyWindow.ts`. TUG-115 adds a typed stable-ID/GUID selection authority used by Scene, Hierarchy, Project and Inspector integration, with focused tests for stale scene deletion, asset moves and missing assets; the existing source-built Electron workflow passes. This still does not cover the complete pointer/keyboard selection matrix, assistive technology, packaged behavior, or retained restart evidence. | Mouse/keyboard single/range/toggle select, expand/collapse, rename, search, drag reparent/reorder, scene roots, active state, prefab indicators, focus preservation and undo all pass. |
| GameObject lifecycle and parenting | **Partial** | `GameObject.ts`, `Scene.ts`, `Component.ts` implement IDs, hierarchy and components; editor commands cover create/duplicate/copy/paste/delete. Runtime lifecycle ordering and edge behavior are insufficiently exercised. | Prove mandatory Transform, unique IDs, activation propagation, world/local transform preservation, cyclic-parent rejection, duplicate naming, destruction timing, lifecycle callback order and undo/redo. |
| Inspector GameObject editing | **Partial** | Large custom inspector implementation supports many fields/components (`InspectorWindow.ts`, `EditorInspectors.ts`). TUG-115 routes Project and scene selection through one typed authority and adds validated GUID-bearing material drops plus keyboard clear and Escape cancellation for object fields; focused selection/reference tests and the existing rendered workflow pass. Complete field typing, mixed values, all reference target types, validation, persistence and assistive-technology behavior remain unqualified. | Edit name/tag/layer/static/active and every supported serialized type; multi-edit and mixed values; drag references; numeric expressions/validation; focus commit/cancel; undo/redo; restart persistence. |
| Component add/remove/reorder/reset/copy | **Partial** | Registry and add-component UI exist; component context behavior is largely source-evidenced. Unity dependency rules and missing-script handling are not proven. | Add/search/remove/reorder/reset/copy/paste components; prohibit Transform removal; enforce required/conflicting components; preserve unknown components as recoverable missing scripts; undo and persist. |
| Undo/redo and dirty state | **Partial** | Command-checkpoint behavior, redo branching, and representative lifecycle mutations pass `test/lifecycle-undo-runtime.test.cjs`; the renderer forwards dirty state to the desktop close guard. No complete mutation inventory or rendered title/close/open/new prompt matrix exists. | A mutation inventory proves every authoring action is undoable or explicitly exempt; redo invalidation, grouped drags, visible dirty marker, save checkpoint, New/Open/Close prompts and play-mode boundary behave consistently. |
| Context menus | **Partial** | Custom menus exist across scene, hierarchy, project, inspector and console. TUG-102 rendered evidence narrowly covers keyboard open, initial action focus, Escape dismissal and focus return for the Hierarchy menu only. Arrow/Home/End activation remains source-contract evidence; other menus, viewport bounds, submenu semantics and command equivalence are not comprehensively rendered-tested. | Open each context menu by pointer and keyboard; verify position, dismissal, focus, enabled state, submenus, destructive confirmation, shortcut equivalence and undo. |
| Drag and drop | **Partial** | Hierarchy and Project drag handlers exist. Cross-window asset-to-scene, asset-to-field, reparent ordering, invalid drop feedback and external file import are unverified. | Run a source/target/type matrix; verify pointer/keyboard alternatives, visual feedback, cancellation, undo, persistence, move/copy semantics and safe rejection. |
| Project/asset browser | **Partial** | Grid/tree/search/rename/delete/reference tools exist in `ProjectWindow.ts`; keyboard and backend asset-service tests pass. TUG-115 makes rendered Project selection publish the asset GUID through the shared selection authority, includes GUID in drag payloads, and preserves the selected identity across known GUID moves or as a recoverable missing state. Full external-refresh, restart, focus/reveal and error-path qualification remains open. | Create/move/rename/duplicate/delete folders/assets; external changes refresh; selection opens correct inspector; GUID survives move; search/type filters, focus, reveal and undo/error paths work. |
| Asset metadata and GUID identity | **Partial** | Versioned `.meta` model, atomic metadata writes, GUID move tracking and bounded scans have service tests (`asset-database-contract`, `asset-security`, `project-asset-services`). Compatibility is Tugberk-specific and editor integration is incomplete. | Import/move/reimport/delete/recover assets through UI and external filesystem; GUID/reference stability survives restart; duplicate/corrupt/orphan metadata receives deterministic repair UI. |
| Model, texture and audio import | **Partial** | Three.js loaders and size guards exist in `AssetImporter.ts`; texture settings have source-contract checks. No representative format corpus or visible importer Inspector/reimport qualification. | Test documented formats, bad/huge files, color/alpha/wrap/filter settings, model hierarchy/materials/scale, audio decode/settings, deterministic reimport and dependency refresh. |
| Materials, shaders and lighting | **Partial** | `Material.ts`, `MeshRenderer`, `Light` and renderer paths provide a Three.js subset. No Unity shader/material model parity; probes, baked lighting, shadows and color-space behavior are not qualified. | Define supported rendering contract, then verify material serialization, texture slots, transparency, lights/shadows, camera output, color space, error material and scene/build equivalence. |
| Prefabs | **Partial** | Substantial Tugberk prefab serialization/override code exists in `Prefab.ts`, `Editor.ts`, and inspectors. Nested prefab identity, apply/revert semantics and broken-link recovery lack current behavioral evidence. | Create instance, edit override, apply/revert selected/all, unpack, nest, add/remove components/children, move/rename source, handle missing source, undo, save/reopen, and play/build equivalence. |
| Serialization and references | **Partial** | TUG-67 verified deterministic JSON, stable IDs, conflicts, recovery, migration and unknown-data passthrough. TUG-115 adds typed editor reference identities, GUID-first material-drop resolution, invalid-payload rejection, keyboard clearing and non-mutating Escape behavior. It does not yet prove persistence of every object/component/asset reference or recovery of unresolved serialized scene references across restart. | Round-trip every supported serialized field/reference/container and a full editor-authored project; deterministic bytes; cyclic/null/missing references; version migration; unknown component/field preservation; no silent data loss. |
| Autosave, crash recovery and conflicts | **Partial** | TUG-67 verified atomic, bounded, newer-only recovery storage separate from the canonical scene and a nested stale-revision scenario (`recovery-dirty`, `scene-data-safety-ui`, `persistence`). TUG-97 independently reproduced the packaged structural conflict/recovery assertions, including forced process-tree termination, but the harness replaces confirmation UI with scripted return values, directly discards recovery in the main process, and overwrites restore/discard evidence; user-visible decisions and error presentation remain unproven. | Kill the packaged editor during a real UI mutation/save; restart; visibly preview and choose restore/discard; retain distinct artifacts for both decisions; ensure canonical scene remains safe; test stale revision plus disk-full/permission/oversize/corrupt recovery errors with no data loss. |
| Play mode controls and state isolation | **Partial** | `PlayModeManager.ts` snapshots/restores scene and calls `RuntimeBridge`; runtime supervisor tests pass and the current tree compiles. The source-built smoke does not demonstrate authored gameplay; the worker/supervisor evidence remains a minimal deterministic protocol rather than full scene execution. | Play/pause/step/stop repeatedly from a representative scene, run scripts/render/physics/audio/input, restore edit state exactly, surface runtime crashes, and prove Game view/player equivalence. |
| TypeScript scripting lifecycle | **Partial** | Vite eagerly registers source-tree TypeScript components in `ScriptRegistry.ts`; component lifecycle code exists. Project-local compile/reload, diagnostic mapping, domain reload, serialization continuity and build inclusion are not proven. | Add/edit/break/fix a project script without modifying engine source; show compiler diagnostics; reload safely; execute documented lifecycle order; preserve serialized fields; include the same behavior in player build. |
| C# scripting | **Incorrect** | C# files are samples/stubs; `src/scripts/CSharp/Component.cs` explicitly labels GameObject, Transform, Vector3 and Input as stubs. No compiler/runtime bridge proves Unity-style C# execution. | Either remove C#/Unity compatibility claims or implement a documented C# toolchain and runtime with compile errors, lifecycle, serialized fields, API surface, reload and build execution tests. |
| Console and diagnostics | **Partial** | Console filtering/collapse/selection/context/stack-navigation contracts pass (`console-window-contract.test.cjs`); diagnostic redaction/retention tests pass. Real compiler/runtime navigation and high-volume UI behavior are not observed. | Capture editor/compiler/runtime/build logs with correct severity/count; collapse/clear/pause; double-click navigates to source; stack traces are useful but safe; persist/configure as specified; stress without lockup. |
| Physics | **Partial** | Cannon-backed rigid bodies/colliders and `PhysicsSystem.ts` exist. TUG-124 reproduced a standalone-worker smoke in which the canonical player becomes grounded and later reaches a terminal trigger state; this is narrow state evidence, not general collision/trigger callback or Game-view equivalence evidence. Layers, materials, queries, constraints and editor/runtime/build agreement remain unverified. | Author a physics fixture covering body types, primitive colliders, gravity, triggers/collisions, filtering, raycasts, sleep, fixed timestep and transform sync; compare play restart and built player. |
| Audio | **Partial** | `AudioSource.ts` supports clip, volume, pitch, loop, play-on-awake and positional audio through Three.js. Mixer, buses/effects, listener rules, import settings, pause/focus/device lifecycle are absent or unverified. | Validate 2D/3D playback, listener selection, spatial falloff, pause/stop/restart, focus/device changes, clip errors and scene/build equivalence; explicitly scope mixer support. |
| Input | **Partial** | TUG-124 reproduced the shared worker's synthetic horizontal-input path in a fresh standalone player and `gameplay-input-contract` passed 2/2. The executable smoke injects `{ Horizontal: 1 }` directly and hard-codes `configuredInput: true`; it does not prove physical keyboard delivery or persisted/user-configured mappings. Gamepad/touch/sensors/XR, rebinding and full focus/device lifecycle remain open. | Define supported devices; configure and persist actions; verify down/held/up, axes, mouse position/wheel, focus loss, gamepad connect/rebind and UI/gameplay routing in Game view and built player. |
| Runtime UI | **Partial** | DOM-backed Canvas, RectTransform, controls, layout groups, raycaster and EventSystem classes exist. TUG-124's hidden-player smoke verified only that a status dataset matched worker state; it did not visually inspect UI, exercise controls, or compare Game view. Layout, scaling, navigation, masking, accessibility and representative build behavior remain unqualified. | Build a UI fixture covering anchors/pivots/scalers, nested layouts, draw order, clipping/scrolling, pointer/keyboard navigation, events, disabled states, resolution/DPI and player parity. |
| Animation and particles | **Partial** | `Animator.ts` and `ParticleSystem.ts` exist as limited components. No Animator Controller/state machine/import/event/root-motion or robust particle authoring parity is evidenced. | Publish a deliberately scoped contract and fixtures for clip import/playback, transitions/parameters/events, serialization and particles; otherwise classify unsupported Unity features as Missing. |
| Build settings UI and build/export | **Partial** | TUG-124 source inspection confirms `File > Build Settings` constructs `BuildSettingsWindow`, which reads `project.json`, chooses scenes/output, and routes `build.start`, progress and `build.cancel` through preload/main to `BuildService`; the former mock action is gone. `test/build-service.test.cjs` passed 5/5 and a fresh service build completed all five stages. The actual editor window, picker, visible progress/cancel/error states and editor-initiated output were not exercised, settings are not persisted, and runtime-content dependency pruning is not proven. | Drive the packaged editor UI through success, cancellation and typed failures; retain visible evidence; persist settings; verify exact dependency inclusion and Game-view/player equivalence. |
| Player executable | **Partial** | TUG-124 freshly produced and launched `dist/tug-124-audit-player/Tugberk Player.exe` on Windows; it exited 0 and retained `dist/tug-124-player-smoke.json` with movement, grounded collision, terminal trigger and status-binding checks true. The smoke is hidden and synthetic, `configuredInput` is asserted as a literal, and no human interactive window, physical input, rendering, audio, scripts, relocation, clean-machine run or Game-view comparison was observed. | Interactively launch and relocate the representative player; use physical input; visually/audio inspect it; compare recorded Game-view and player traces for the same saved project; test logs, integrity failures and graceful exit on the supported Windows matrix. |
| Error handling and security | **Partial** | Strong service-level evidence exists for IPC isolation, CSP, grants, symlink confinement, cancellation and stable errors. TUG-102 reproduced the TUG-86 authority slice at 18 pass, 0 fail, 1 Windows symlink skip: the standalone `CodePlaySessions` contract denies safe/revoked starts before launch, binds trusted sessions to owner/grant/project/trust epoch, and cleans up races/stale sessions. Repository search found production use only in that test and module, so no production IPC/runtime route currently receives this protection and no project code was executed. Renderer presentation, recovery actions and adversarial packaged testing remain incomplete. | Route any future code-enabled play IPC exclusively through the authority and sandboxed launcher; then trigger each typed failure through UI, verify actionable non-leaking recovery, and adversarially test the packaged app without blocking valid workflows. |
| Keyboard, focus and accessibility | **Partial** | TUG-102 reproduced 11/11 source-contract tests plus one source-built Windows Electron workflow covering Hierarchy create, rename/focus return, context-menu focus/dismissal, and shortcut suppression in a temporary textarea. The Electron harness dispatches synthetic DOM events through `executeJavaScript`, is not packaged, retains no screenshot/result after teardown, and does not prove native key delivery, visible focus styling, menu/dialog/docking/Inspector completeness, assistive technology, or the canonical keyboard-only authoring path. | Full keyboard-only critical path in the packaged editor; deterministic focus order/return; visible focus; correct roles/names/states; zoom/high-contrast/DPI; screen-reader smoke; no global shortcuts while typing. |
| Performance and stability | **Not tested** | A diagnostic budget helper is unit-tested; no representative large-project editor/runtime profiling or endurance run was performed. | Set budgets, then measure startup, scene load/save, import, hierarchy/search, frame time, memory and shutdown on small/medium/large fixtures; 8-hour edit/play endurance with bounded resources. |

## 6. Prioritized gaps

Priority is based on unlocking a trustworthy create-to-player workflow, not on matching the largest number of Unity menu items.

1. **Complete release-grade baseline qualification.** The dirty-tree source-built gate now passes and rejects stale `dist/`; still prove lockfile installation from a clean checkout, the packaged editor/installer, and retained CI artifacts on the supported Windows matrix.
2. **Wire the vertical slice end to end.** Project create/open → asset import → scene authoring → save/reopen → play → stop/restore → real build → launch player. The existing services and editor must use one production path.
3. **Prove data safety.** Complete UI-backed scene/prefab/reference round trips, dirty prompts, conflicts, crash recovery, migrations and unknown-data handling before expanding features.
4. **Make play mode execute authored behavior.** Define the runtime snapshot contract and prove scripts, rendering, physics, audio, input and UI run in the isolated runtime with exact edit-state restoration.
5. **Replace mock build UI.** Connect build settings to the tested build service and produce an interactive player; never report success for a log-only operation.
6. **Qualify core authoring interactions.** Scene navigation/tools, hierarchy, Inspector, undo, context menus, drag/drop, keyboard/focus and layout persistence need rendered workflow matrices.
7. **Define honest subsystem scopes.** Rendering, physics, audio, input, UI, animation and scripting need explicit supported subsets and representative fixtures. Remove unsupported Unity/C# implications.
8. **Add broad parity only after the core gate.** Multi-scene, advanced prefabs, richer importers, animation controllers, audio mixing, modern input and advanced rendering follow a stable player loop.

## 7. Phased implementation sequence and gates

### Phase 0 — Reproducible baseline

Dependencies: none.

- **Verified narrowly:** `npm run bootstrap` performs lockfile install plus pinned Electron 43 on-demand installation from an empty cache; the smoke self-recovers after plain `npm ci`; fresh TypeScript/renderer build, two bounded source-built editor launches, tracked-file preservation, and process cleanup pass.
- **Still required:** complete non-rendered suite under a documented bound; packaged editor and installer launch; retained CI artifact/result provenance. The smoke's `source.lockSha256` label is not a raw file hash and should not be treated as one.

Gate: **Partial, not closed.** TUG-108 closes the repository bootstrap defect that invalidated TUG-57's earlier clean-run claim. Close Phase 0 only when the remaining bounded non-rendered suite, packaged editor, installer, and retained-provenance requirements pass. No stale artifact may satisfy the gate.

### Phase 1 — Project and scene data safety

Dependencies: Phase 0.

- **Verified foundation (TUG-67, 2026-07-28):** 40/40 targeted Node tests passed across `persistence`, `recovery-dirty`, `scene-data-safety-ui`, `lifecycle-undo-runtime`, `editor-workflow-contract`, and `project-asset-services`. Evidence covers deterministic versioned documents, stable/unique IDs, migrations, unknown payload retention, atomic backup writes, stale-revision rejection, bounded recovery storage, representative lifecycle undo/redo, confined project writes, and GUID-preserving asset moves.
- **Partial/UI-contract only:** startup loads the canonical scene before offering newer recovery; accepted recovery is marked dirty; Save carries the loaded revision; the desktop close guard offers Save/Don't Save/Cancel. These are source and service assertions, not rendered packaged-editor observations.
- **Partial with remaining data-loss risk (TUG-71, 2026-07-28):** New, direct Open, and dialog Open share a dirty replacement guard; clean scenes bypass it, Save failure/cancel blocks replacement, and explicit cancel blocks replacement. However, dialog Open prompts before file selection and discard deletes recovery before picker/load success. Cancelling the picker or failing to load therefore keeps the dirty in-memory scene while unnecessarily deleting its recovery snapshot. Evidence is source inspection plus 5/5 focused tests and a successful build, not rendered interaction proof.
- **TUG-81 independent re-audit of TUG-79 (2026-07-28): rejected as a Phase 1 gate closure.** The startup-scene source change resolves the first safe, existing project-relative `project.json.scenes` entry before the legacy sample fallback, and the focused `startup-scene-persistence`, `scene-data-safety-ui`, and `persistence` suites passed 20/20 twice; `npm.cmd run build` also passed. However, `test/startup-scene-persistence.test.cjs` is source-pattern evidence, while `test/editor-interaction.test.cjs` launches the development Electron executable against `dist`, covers only create/select/inspect/File-menu checks, and deletes its result directory in teardown. No retained packaged interaction evidence exists for nested UI author/save, Save As, restart structural equality, stale external conflict without overwrite, forced-termination restore, or recovery discard. Those six workflows therefore remain **Not tested** in the packaged editor.
- **TUG-85 reconciliation (2026-08-03): remains Partial.** A fresh `npm.cmd run build` passed and the focused rendered development-Electron interaction test passed, but that interaction only creates/selects a Cube, adds one component, and opens the File menu. The accompanying workflow/keyboard tests passed 14/14 and support narrow source contracts; none executes the Phase 1 packaged data-safety gate. The former root Phase 1 static suite imported no product code and tested hard-coded values plus unconditional claims; it was removed on 2026-08-18 and is not evidence for editor chrome, project/scene safety, or Unity parity.
- **TUG-97 independent packaged re-audit (2026-08-03): rejected as gate closure; narrow structural evidence accepted.** `npm.cmd run test:phase1-packaged-persistence` independently passed once in 14.5 s against `release/win-unpacked/Tugberk Engine.exe`; retained run `tug-79-packaged-persistence-7cjXdJ` contains four screenshots, four phase JSON files, `summary.json`, and the isolated project/user-data. The assertions reproduce Save/Save As bytes, restart structural equality for the nested fixture, stable child ID/selection and unknown-data retention, stale-write denial without overwriting the external marker, a recovery file surviving forced process-tree termination, restored recovery state, and removal of discarded recovery. This does **not** prove the requested visible UI matrix: `electron/main.js:448-542` directly mutates `GameObject` and dirty state through `executeJavaScript`; confirmation is replaced by `window.confirm = () => ...`; discard is also executed directly by the main-process harness; restore and discard both reuse `reopen.json`/`reopen.png`, overwriting earlier evidence; and no conflict/recovery decision dialog is retained. The author screenshot visibly reports `Scene save failed` despite the harness passing, so user-visible save success is not established. `scripts/phase1-packaged-persistence.cjs` and its `summary.json` therefore overstate six independently evidenced rendered phases.
- **Not tested:** packaged create/open/recent/trust; pointer/keyboard authoring of the nested edit; visible save-success feedback; visible stale-conflict decision/error UI; distinct recovery restore/discard presentation and choice; corrupt/oversize/disk-full/permission failures; every supported component/reference type; full mutation-to-dirty inventory.

Required sequence:

1. Finish the shared dirty-scene decision contract: cover project switch, window close, and quit; select an Open target before prompting; delete recovery only after replacement commits; and prove cancellation or failed save/load preserves scene, path, dirty checkpoint, and recovery byte-for-byte.
2. Exercise save, save-as, restart reopen, stale conflict, and recovery through the packaged UI using one nested representative scene.
3. Publish and test the supported serialized field/reference schema, migrations, and unknown-data policy.
4. Inventory every hierarchy/GameObject/component/inspector mutation against undo and dirty checkpoints.

Gate: **Partial, not closed.** The packaged structural persistence core is now narrowly evidenced, but closure still requires visible pointer/keyboard authoring and save success, retained conflict and recovery decision UI, distinct restore/discard artifacts, cancelled New/Open/Close preservation, and structural comparison with no silent loss.

### Phase 2 — Core editor authoring

Dependencies: Phase 1.

- **TUG-85 reconciliation (2026-08-03): remains Partial and dependency-blocked by Phase 1.** Production source contains a substantial layout model (`EditorSettings` snapshots, dock graph, host/tab orders, floating panel geometry, presets, two saved slots, normalization and rollback paths in `src/editor/Editor.ts`), and the current tree builds. The rendered interaction lane does not drag, dock, float, resize, maximize, save/load, restart, or recover a layout. `test/editor-keyboard-accessibility.test.cjs` checks source strings rather than dispatching keyboard input. The former private layout mock never imported `Editor`, `EditorSettings`, DOM/CSS, or Electron; it was removed on 2026-08-18 and cannot qualify production docking/windowing. Therefore editor chrome, layout/windowing, and the broader authoring gate are **Partial**, not complete or Verified parity.
- **Narrow observed result:** the development Electron smoke opens the File menu by pointer and completes a small create/select/add-component flow. Menu keyboard behavior, toolbar state transitions, all other menus, panel focus, docking, floating, tab movement, splitters, layout persistence across restart, malformed-layout recovery, native-window behavior, DPI and multi-monitor operation remain **Not tested** by current rendered evidence.
- **TUG-102 independent reconciliation of TUG-90 (2026-08-18): accepted only as narrow evidence; Phase 2 remains Partial.** At revision `e0ddf59553daa3272e82ed59919c8163a2c798b2` with unrelated dirty-tree product/test changes present, `node --test test/editor-keyboard-accessibility.test.cjs test/project-browser-keyboard.test.cjs test/console-window-contract.test.cjs` passed 11/11, `npm.cmd run build` passed, and `node --test test/editor-interaction.test.cjs` passed 2/2 in 28.1 s. The first rendered case includes the four TUG-90 checks: Ctrl+Shift+N creation, F2/Enter rename with Hierarchy focus return, Hierarchy ContextMenu/Escape focus lifecycle, and suppression of Ctrl+Shift+N in a textarea. The second rendered case is unrelated launcher-error coverage added by current dirty-tree work. The harness launches development Electron against freshly built `dist`, injects synthetic DOM events from `electron/main.js`, deletes its temporary JSON/project/user-data in teardown, and does not retain screenshots. It therefore does not prove OS-level input, visible focus, every panel/menu/dialog/context menu, docking/layout lifecycle, screen-reader behavior, pointer-free canonical scene construction, persistence/undo, or packaged-editor parity.
- **TUG-103 independent review of the expanded TUG-40 gate (2026-08-18): Partial; original acceptance REJECTED.** After TUG-108 restored the pinned Electron 43 distribution, a fresh `npm.cmd run build` passed (108 modules), followed by two independent `npm.cmd run test:editor-workflow` executions passing 12/12 each. The rendered lane therefore provides stable integrated smoke evidence for pointer menu opening, Hierarchy keyboard/range/rename-cancel behavior, Project async selection and typed drag data, Inspector model non-mutation before commit and change-event commit, Console selection/filtering, reversible keyboard splitter movement, launcher failure visibility, and additional scene transaction/undo behavior. It does **not** satisfy TUG-40's accepted deterministic fake-backed/headless DOM-harness contract: behavior is injected by `electron/main.js` through `webContents.executeJavaScript` into a development Electron process, depends on `window.Editor` internals, and is not isolated per view. Three original interaction details also remain unproved by this lane: menu **keyboard** operation (only `MouseEvent('click')` is asserted), Inspector Escape restoring the rendered field value (only model non-mutation is asserted), and docking resize **cancel** (two opposite arrow steps prove reversibility, not cancellation). Keep TUG-40 verification debt open; treat the twice-green suite as rendered smoke, not Unity parity or replacement for fake-backed/native/manual qualification.

- Qualify Scene view navigation and transform tools.
- Complete Hierarchy/Inspector/Project selection and edit transactions.
- Complete context-menu, drag/drop, keyboard/focus and layout matrices.
- Wire asset import/reimport and GUID reference behavior through the UI.

Gate: keyboard and pointer users can construct the canonical scene solely through the packaged editor; every mutation persists and is correctly undoable; GUID references survive moves/restart.

### Phase 3 — Real play mode

Dependencies: Phases 1–2.

- **TUG-102 independent reconciliation of TUG-86 (2026-08-18): security foundation verified, production play remains unproven.** `node --test test/code-play-sessions.test.cjs test/project-trust.test.cjs test/execution-broker.test.cjs test/protocol-grants.test.cjs` reproduced 18 pass, 0 fail, and 1 platform skip (`canonical identity collapses symlink aliases`). The tests cover safe/revoked denial before launch, trusted owner/grant/project/trust-epoch binding, cross-owner and stale-session denial, revoke/start cleanup, owner teardown, and stale-epoch rejection after re-trust. `electron/security/code-play-sessions.js` is referenced by its focused test only; it is not instantiated by `electron/main.js`, the IPC router, runtime supervisor, or another production route. Consequently this is **Verified parity only for the standalone authority contract**, not code-enabled play, sandboxing, editor/runtime integration, or Unity play-mode behavior. Safe-mode `runtime.start` remains data-only according to the implementation claim; TUG-102 did not execute project-controlled code.

- Finalize editor-to-runtime snapshot/version/error contract.
- Execute project scripts and supported render/physics/audio/input/UI behavior in the isolated runtime.
- Make pause, step, crash, restart and stop deterministic.
- Restore edit scene and selection without leaking play-state mutation.

Gate: 100 automated play/stop cycles plus a manual gameplay run produce stable results, bounded resources and byte/structure-equivalent edit state after stop; runtime crash leaves the editor usable.

### Phase 4 — Real build and player

Dependencies: Phase 3.

- **TUG-124 focused re-audit of TUG-122 (2026-08-26): accepted as narrow Partial evidence, not gate closure.** `node --test test/build-service.test.cjs` passed 5/5; `node --test test/vertical-slice.test.cjs test/gameplay-input-contract.test.cjs` passed 7/7; and `npm.cmd run build` passed. Source tracing found the visible menu/window connected through the versioned preload/main protocol to `BuildService`, but no rendered editor build interaction was performed. A fresh retained build completed `validate`, `resolve`, `import`, `bundle`, and `package`; its executable exited 0 under the hidden smoke. Retained artifacts are `dist/tug-124-audit-player/` and `dist/tug-124-player-smoke.json`. SHA-256: player `8593db40c0c6e5e3c4b6b0a225b1dc9a549ecdf10f6cf2010cf5b6ce869ce07f`, manifest file `2a1501943e62d24b46fd108d982f4c6e64702c7f57841b44427df3c0d103ca3f`, smoke `e5c76bd4f4fd0d2592cf02708b6a0ac59085df08ec8dab00dad44e5f3cd71e59`. The smoke's `configuredInput` value is hard-coded, input is injected at worker level, collision means grounded state, trigger means any non-`playing` status, and UI means a DOM dataset equals worker status. These checks do not establish physical input, visual UI/rendering, general physics, scripting/audio, or Game-view equivalence.
- Exercise the now-wired build action in the packaged editor and retain success, progress, cancellation and typed-error evidence.
- Persist scene list/settings.
- Package all and only referenced runtime content.
- Interactively inspect and relocate the standalone Windows player using physical input.

Gate: one saved project runs equivalently in Game view and standalone player for scripts, render, physics, input, audio and UI; reproducible builds match manifests; cancel/failure publishes no partial output.

### Phase 5 — Prefabs and production asset workflow

Dependencies: Phases 2–4.

- Qualify prefab instances, overrides, nesting and broken references.
- Add importer Inspector/reimport workflows and format fixtures.
- Complete dependency invalidation, external filesystem refresh and repair UI.

Gate: prefab and asset mutation matrix passes across editor restart, play and build, including missing/corrupt/moved source cases.

### Phase 6 — Supported subsystem depth

Dependencies: stable vertical slice through Phase 5.

- Expand only explicitly scoped rendering, physics, audio, input, UI and animation features.
- Decide TypeScript-only versus real C# support and make product messaging consistent.
- Add multi-scene only with serialization, runtime and build semantics designed together.

Gate: each subsystem has a published support contract, representative authored fixture, negative tests, packaged-editor run and standalone-player equivalence result.

### Phase 7 — Production qualification

Dependencies: all intended v1 capability gates.

- Installer/updater/uninstaller and clean-machine validation.
- Large-project performance and endurance.
- Accessibility and multi-DPI/multi-monitor qualification.
- Failure injection for disk, permissions, devices, GPU/runtime crash and shutdown.
- Security review of packaged artifacts and release pipeline.

Gate: release candidate passes the complete acceptance suite on the supported Windows matrix with no critical data-loss, security, build, play-mode or player defects.

## 8. Known risks

- **Qualification-boundary risk:** clean bootstrap and source-built smoke are verified, but this is not packaged-editor, installer, clean-machine, or retained-CI-artifact evidence. `npm ci` also reported four high-severity dependency advisories; their applicability was not adjudicated by TUG-108.
- **Packaging gap:** source-built Electron smoke does not qualify the packaged editor or installer/uninstaller. TUG-124 qualifies only a fresh hidden standalone-player smoke on the audit machine, not an interactive or clean-machine player run.
- **False-confidence risk:** many tests match source strings; legacy phase reports claim completion without current observable proof.
- **Split-path risk:** the build UI is source-wired to the tested service, but its rendered packaged-editor behavior is unobserved; the same runtime worker is used by play and player paths without a recorded state/output equivalence comparison.
- **Data-loss risk:** broad inspector/prefab/serialization surface exceeds current round-trip coverage.
- **Runtime fidelity risk:** deterministic supervisor/worker tests do not establish that authored component behavior runs.
- **Scripting identity risk:** TypeScript modules are bundled from engine source; C# APIs are stubs. This conflicts with ordinary project-local Unity scripting expectations.
- **Maintainability risk:** very large editor modules make mutation inventory, lifecycle reasoning and regression isolation difficult.
- **Web-platform risk:** Electron/DOM/WebGL/Web Audio behavior differs from native Unity editor/player behavior, especially focus, input, audio devices, filesystem dialogs and GPU recovery.
- **Scope risk:** “Unity parity” is effectively unbounded unless every release publishes an explicit supported subset.

## 9. Manual testing still required

The following were not established by this audit and must remain unverified until recorded:

- Fresh install, packaged launch, project creation/opening, app close and uninstall.
- Every menu, shortcut, context menu, dialog, focus transition and drag/drop path.
- Scene navigation and transform manipulation with real pointer/keyboard input.
- Inspector editing and undo across all supported components and field types.
- Scene/prefab/asset persistence across restart and external filesystem changes.
- Forced crash recovery and stale-save conflict presentation.
- Real play-mode script/render/physics/audio/input/UI execution and edit-state restoration.
- Real build from the rendered editor, plus interactive/relocated standalone-player inspection with physical input and Game-view comparison.
- Multiple displays, scaling levels, GPU/device loss, audio device/focus changes and gamepads.
- Large projects, long sessions, memory stability and accessibility technology.

## 10. Definition of the next audit

Do not re-audit broad Unity parity after isolated class additions. Re-audit when the remaining Phase 0 qualifications are green and the team supplies:

1. exact source revision/working-tree identity;
2. reproducible build and packaged artifact;
3. canonical project fixture;
4. bounded rendered test command and retained results;
5. claimed capability list mapped to acceptance gates above.

Until then, the defensible product statement is: **Tugberk Engine has a verified Electron 43 clean bootstrap, fresh source build, and bounded two-run editor smoke, plus substantial tested service foundations; package/release qualification and the core editor-to-runtime-to-player path are not proven, so Unity parity is not established.**
