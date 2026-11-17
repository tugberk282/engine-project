# V1 acceptance ledger

Scope: usable Windows editor and exported small 3D games, as defined by AGENT_HANDOFF.md. Unity-wide parity is outside this gate. This ledger distinguishes current local evidence from release qualification still to obtain.

## Current local evidence

- Editor authoring transaction: source-built smoke runs twice with 62 checks; packaged and installed smoke also pass 62 checks.
- Windows export: canonical build-service test launches the produced executable and checks rendering, configured movement/jump/look, physics, authored UI, models, particles and scene transition/retry.
- Failure paths: missing player HTML, corrupt build integrity, runtime error, worker startup crash/hang and post-start silence are covered by visible qualification or disposable executable tests.
- Lifecycle: late states, deferred texture ownership, model resource sharing and idempotent fatal cleanup have targeted coverage.
- Current packaged persistence qualification passed author/save-as, reopen, stale external conflict, forced crash, recovery restore and discard. Evidence: `C:/Users/tugbe/AppData/Local/Temp/tug-79-packaged-persistence-aVhMJQ/summary.json` and six retained result/screenshot pairs.
- Current packaged keyboard qualification passed author (12 checks) and reopen (2 checks). Evidence: `C:/Users/tugbe/AppData/Local/Temp/tug-112-packaged-keyboard-O1MN3m/summary.json`. This does not qualify the whole authoring matrix or multi-DPI behavior.
- Relocation: canonical build test moves the second export and renames its source project before runtime/executable checks. The moved player passes without the original authored source path.
- Endurance baseline: `node scripts/player-endurance.cjs 120` passed on the relocated stock-sample export, 5,664 real worker/render frames over 120 seconds. Geometry count stayed 3, textures 0, draw calls 3. Evidence: `C:/Users/tugbe/AppData/Local/Temp/tugberk-player-endurance-GdcTBG/result.json`. Fifteen sample-relevant checks pass; layout/ScrollRect/filled-image injection fixtures are absent and their raw false results remain recorded. This does not qualify textured/model-heavy memory, process heap stability, device loss or hours-long sessions.
- Textured-model profile: `node scripts/player-endurance.cjs 120 textured-models` passed with 24 imported textured GLTF models, 5,597 real frames, stable 27 geometries/24 textures/27 draw calls. Evidence: `C:/Users/tugbe/AppData/Local/Temp/tugberk-player-endurance-HAcvUP/result.json`. A 25-cycle scene teardown test verifies material arrays/shared textures and reference cleanup. Process memory/churn and hours-long behavior remain separate obligations.
- Imported-model churn: extended profile passed 24 load/draw/remove/dispose cycles over 120s, 5,626 frames, stable 27 geometries/24 textures. Process-memory evidence: `C:/Users/tugbe/AppData/Local/Temp/tugberk-player-endurance-pTVYNy/process-memory.json` (23 samples). After filtering to four processes and skipping three warm-up samples, 19 samples span 289,882,112–325,226,496 private bytes, first-to-last +17.484375 MiB. This does not prove leak freedom; longer trend measurement remains open.
- Isolated source installation: 301 tracked/untracked nonignored files were copied without node_modules/dist into `C:/Users/tugbe/AppData/Local/Temp/tugberk-clean-v1-9a363760186c4371b3f2a352640653be`. `npm ci`, Electron bootstrap, production build and 253 tests passed. This uses the current dirty source on the same Windows host, not a separate clean machine.
- Dependency checkpoint: production audit reports zero advisories. Targeted minimatch override to 11.0.9 removes GHSA-g3hv-75wg-m249; isolated Windows packaging and packaged smoke 62/62 plus main-source 253 tests/build passed. Full audit retains 13 high entries propagated from the unpatched picomatch advisory. Details: docs/quality/v1-dependency-status.md. Toolchain qualification remains open.
- Packaging: fresh NSIS install, same-version archive repair, sandbox matrix and uninstall passed on this Windows machine. This is not a distinct-version migration or clean-machine result.

## Remaining evidence to resolve in order

Latest observations (2026-11-17):

- RESOLVED layout width defect: primary and LKG correctly retained the width; hidden startup roots had zero clientWidth and `clampLayoutSizes` reduced it to minimum before display. Clamping now skips unmeasurable roots and normal resize applies real bounds later. Four-launch packaged test preserves the nondefault 302px width through corrupt-primary recovery. Evidence `C:/Users/tugbe/AppData/Local/Temp/tug-112-packaged-keyboard-tdozca/summary.json`. Full 254 tests, build and two 62-check source-built smoke runs pass with no process leak. Prior failing observations below are historical; off-screen/oversized bounds and DPI matrix remain open.

- Stronger layout recovery check reopens the issue: after native splitter change and corrupting primary settings, saved visible width 232px becomes 182px at recovery. Evidence `C:/Users/tugbe/AppData/Local/Temp/tug-112-packaged-keyboard-unVB1T/layout-recovery/result.json`. The earlier default-docked recovery assertion was insufficient. Keep the stronger test failing until the persistence/application cause is resolved.
- Native keyboard dock activation is now verified after explicitly refocusing webContents following accessibility capture; DOM focus alone was insufficient for harness input. Three-launch evidence `C:/Users/tugbe/AppData/Local/Temp/tug-112-packaged-keyboard-Kqx9le/summary.json`.
- Separate forced-GC diagnostic mode (`120 textured-models gc`) recorded post-warmup JS heap 7,122,229–7,396,671 bytes, ending below its first comparable sample. Artifact `C:/Users/tugbe/AppData/Local/Temp/tugberk-player-endurance-RsGaTl/result.json`. Normal process-memory growth is not proven to be JS retained-heap growth; native memory remains open.

- Five-minute textured churn passed 60 cycles/14,001 frames with fixed 27 geometries/24 textures. `C:/Users/tugbe/AppData/Local/Temp/tugberk-player-endurance-LbGOiD/process-memory.json` retains 58 samples. Filtering four-process samples and skipping three warm-up entries gives 53 samples, 285,376,512–347,164,672 private bytes and +36.90234375 MiB first-to-last. Do not close memory qualification; inspect heap/GC versus retained allocations.
- Packaged layout harness now uses shared user-data over three launches: native keyboard float, restart floating persistence, native pointer dock, second restart docked persistence; evidence `C:/Users/tugbe/AppData/Local/Temp/tug-112-packaged-keyboard-zzqdRD/summary.json`. It exposed and fixed a production focus-loss bug: re-appending an already-mounted floating panel on focus removes child keyboard focus. DOM focus now survives. Native keyboard dock activation still needs diagnosis; pointer docking passes. Full layout matrix remains partial.

1. Worker responsiveness is complete: full 253-test suite, production build and two 62-check source-built smokes passed.
2. Scoped packaged persistence/recovery and keyboard lanes passed on the freshly rebuilt package; broader authoring matrix rows need separate evidence as applicable to intended V1 scope.
3. Relocated player and two-minute baseline endurance pass. Extend to textured/model-heavy runtime churn, process memory/device behavior and longer sessions before claiming general endurance.
4. Isolated lockfile bootstrap passed. Resolve the full dependency audit findings through targeted compatible updates and rebuild verification.
5. Rebuild final Windows package and rerun installed qualification after the remaining implementation slices.
6. Record external qualification still requiring another environment: clean Windows machine, multi-DPI/multi-monitor/device matrix, distinct prior-version migration and retained CI artifacts. Do not mark these complete from one-machine smoke evidence.

Completion requires resolving the intended V1 acceptance gates with evidence, or an explicit user decision to narrow release scope. Percentages in handoff are estimates, not gate completion.
