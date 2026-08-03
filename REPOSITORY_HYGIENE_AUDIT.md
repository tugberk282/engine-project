# Repository Hygiene Audit

Date: 2026-07-28
Issue: TUG-28

## Removed

| File | Evidence of non-use |
| --- | --- |
| `src/editor/PlayModeControls.ts` | No source, test, build, packaging, or runtime reference imports this module. The active play-mode toolbar and lifecycle are implemented directly by `src/editor/Editor.ts` and `src/engine/PlayModeManager.ts`. Its only repository mention was historical release documentation. |
| `src/editor/CommandOptimization.ts` | No source, test, build, packaging, or runtime reference imports this module. The only external mention was a legacy static verification message in `verify_phase5_closure.cjs`; no production command history uses its exported classes. |

Both files were ordinary TypeScript modules, were absent from dynamic registries and package/build resource lists, and had no side-effect import path. Removing them therefore changes neither the application entry graph nor packaged resources.

## Retained after review

- `src/scripts/AutoRotate.ts` and `src/scripts/PhysicsTest.ts`: script components can be resolved by name through the script registry/project asset flow, so a lack of static imports is not sufficient proof.
- `Assets/**` and matching `.meta` files: user-authored/project assets and metadata are intentionally preserved.
- Phase reports, roadmap documents, and root verification scripts: retained as historical/release evidence even when not called by the default npm scripts.
- `smoke-test-result.json`: retained as release evidence produced by packaged smoke verification.
- `scripts/fix-dist-paths.js`, packaged-smoke/installer scripts, Electron architecture/security files, and tests: currently referenced by package scripts or active implementation work.
- `dist/`, `node_modules/`, and editor/OS caches: already covered by `.gitignore`; no tracked generated directory was found.

## Verification

- Repository-wide reference search confirmed the removed modules have no consumers.
- `npm run build` validates the TypeScript import graph and production bundle after removal.
- `npm run test:editor-workflow` provides a focused editor lifecycle/command contract check.

The worktree contained extensive pre-existing concurrent changes. This pass did not reset, overwrite, or reformat them.
