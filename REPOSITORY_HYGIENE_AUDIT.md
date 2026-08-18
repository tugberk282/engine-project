# Repository Hygiene Audit

Last updated: 2026-08-18

## Removed

| File | Evidence of non-use |
| --- | --- |
| `src/editor/PlayModeControls.ts` | No source, test, build, packaging, or runtime reference imports this module. The active play-mode toolbar and lifecycle are implemented directly by `src/editor/Editor.ts` and `src/engine/PlayModeManager.ts`. Its only repository mention was historical release documentation. |
| `src/editor/CommandOptimization.ts` | No source, test, build, packaging, or runtime reference imports this module. The only external mention was a legacy static verification message in `verify_phase5_closure.cjs`; no production command history uses its exported classes. |

Both files were ordinary TypeScript modules, were absent from dynamic registries and package/build resource lists, and had no side-effect import path. Removing them therefore changes neither the application entry graph nor packaged resources.

The 2026-08-18 pass also removed the root `verify_phase*.cjs` mock/static suites, their compatibility runners, stale phase closure reports, and the tracked `smoke-test-result.json`. These artifacts were not part of CI, duplicated the roadmap, and could be mistaken for behavioral parity evidence. Smoke output is now ignored and CI retains qualified evidence as workflow artifacts.

## Retained after review

- `src/scripts/AutoRotate.ts` and `src/scripts/PhysicsTest.ts`: script components can be resolved by name through the script registry/project asset flow, so a lack of static imports is not sufficient proof.
- `Assets/**` and matching `.meta` files: user-authored/project assets and metadata are intentionally preserved.
- `UNITY_PARITY_ROADMAP.md` and focused architecture/quality/security documents: retained as the current evidence and planning record.
- `scripts/fix-dist-paths.js`, packaged-smoke/installer scripts, Electron architecture/security files, and tests: currently referenced by package scripts or active implementation work.
- `dist/`, `node_modules/`, and editor/OS caches: already covered by `.gitignore`; no tracked generated directory was found.

## Verification

- Repository-wide reference search confirmed the removed modules have no consumers.
- `npm run build` validates the TypeScript import graph and production bundle after removal.
- `npm run test:editor-workflow` provides a focused editor lifecycle/command contract check.

The worktree contained extensive pre-existing concurrent changes. This pass did not reset, overwrite, or reformat them.
