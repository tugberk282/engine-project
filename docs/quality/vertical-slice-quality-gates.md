# Vertical-slice quality and release gates

Status: governing baseline for the first buildable vertical slice. These gates validate a candidate; they do not authorize a production release.

## Required CI gates

Every pull request and push to `main` runs `.github/workflows/quality-gates.yml` on Windows with Node 22.12:

1. Focused tests: architecture/IPC, persistence and migration, asset database, rendered editor interactions, runtime/play-mode bridge, and renderer security.
2. Source-built rendered smoke: delete generated `dist`, compile/package the
   production renderer, then launch that artifact twice against isolated fixture
   copies. The build is bounded to 120 seconds and each launch to 45 seconds.
   Every exit path terminates the spawned process tree. The JSON result retains
   the Git revision, dirty-worktree flag, source hash, and built-bundle hash.
3. Package assembly smoke: Electron Builder must create an unpacked Windows application containing `app.asar`.
4. Baseline retention: successful source-build and packaged-smoke lanes upload
   commit-and-attempt-named artifacts for 30 days. Each upload includes a
   machine-readable provenance record with repository, exact commit/ref, workflow
   run and attempt, job, runner/toolchain identity, and the size and SHA-256 of
   every qualifying output. Missing evidence fails the lane instead of producing
   an empty artifact.

The test job deliberately uses focused `node --test` suites instead of the historical all-phase verifier. Editor workflow evidence comes from `test/editor-interaction.test.cjs`, which launches the built Electron editor, dispatches user events, and observes rendered and runtime state; source-text patterns are not accepted as editor interaction evidence. Build first so the interaction lane exercises the candidate renderer bundle. Add a focused regression test to the relevant suite for each corrected defect. The full parity suite remains an optional local diagnostic until its older assumptions are reconciled with the current architecture.

Local equivalents:

```powershell
npm run bootstrap
node --test test/architecture-contract.test.cjs test/persistence.test.cjs test/asset-database-contract.test.cjs test/editor-workflow-contract.test.cjs test/runtime-bridge.test.cjs test/project-capabilities.test.cjs test/editor-html-injection.test.cjs
npm run test:source-built-smoke-contract
npm run test:source-built-smoke
npm run electron:build -- --win --dir --publish never
```

`npm run bootstrap` is the canonical clean-checkout setup. It runs `npm ci` and
then invokes the pinned Electron 43 package's official `install-electron --no`
on-demand binary installer. The source-built smoke also loads the pinned local
Electron package, so it cannot bypass that supported on-demand path by assuming
`node_modules/electron/dist/electron.exe` already exists.

## Performance budgets

These are conservative baseline budgets, measured on a supported Windows 11 x64 machine in a release build. A result over budget blocks release qualification; update a budget only with a recorded before/after measurement and architecture-owner approval.

| Signal | Initial budget | Measurement |
| --- | ---: | --- |
| Renderer assets in `dist/assets` | <= 6 MiB total | `npm run build`; sum file sizes under `dist/assets` (also enforced by CI) |
| Cold editor launch to usable shell | p95 <= 5 s over 10 runs | From main-process launch timestamp to renderer `editor-ready`; capture 10 clean launches with DevTools closed |
| Enter play mode | p95 <= 500 ms for fixture scene | Mark immediately before runtime `loadScene`; mark after first acknowledged frame; 30 iterations |
| Exit play mode and restore edit snapshot | p95 <= 500 ms | Mark stop request through restored editor scene; 30 iterations |
| Canonical scene save | p95 <= 100 ms for 1,000 objects | Time atomic persistence call over 30 saves on local SSD |
| Idle editor memory | <= 500 MiB private working set | Record Electron process-tree private bytes after five idle minutes |

`electron/diagnostics/performance-budgets.js` is the shared evaluator for cold
launch, enter-play, frame, idle-memory, and asset-scan samples. It validates
sample sets and reports p95 (maximum for memory) against the checked-in
thresholds. Collection remains a packaged release-harness responsibility:
measurements must record hardware, OS, commit, fixture, raw samples, median,
and p95 in the release evidence.

## Crash telemetry and privacy boundary

No remote crash reporting is enabled in this slice. Local structured crash records may contain: app version, OS/architecture, process role, stable error code, bounded stack frames from engine-owned code, and a random per-install identifier.

They must not contain project paths, project or asset contents, source code, scene/object names, user names, environment variables, access tokens, console history, or arbitrary renderer payloads. Scrub path-like values before persistence.

Remote transmission requires all of the following:

- explicit, default-off user consent with a preview of collected fields;
- a documented endpoint, processor/subprocessor list, encryption in transit and at rest, and deletion mechanism;
- maximum 30-day raw-event retention and 90-day aggregate retention;
- security and product-owner approval recorded in a follow-up issue;
- a visible setting to revoke consent, after which no further events are sent.

Crash collection must never delay shutdown or become a release prerequisite. Security-sensitive dumps stay local unless the user explicitly attaches them to a report.

## Compatibility matrix

| Area | Required for first slice | Status rule |
| --- | --- | --- |
| Host OS | Windows 11 x64 | Required CI/package target |
| Node/toolchain | Node 22.12, npm lockfile install | Required for clean build |
| GPU | Direct3D-capable hardware through Electron/Chromium | Launch and basic render smoke |
| Project format | canonical project format v1 | Open, validate, save, reopen |
| Scene format | canonical scene format v1 | Deterministic round trip; stable IDs |
| Legacy scene | documented 1.4 migration path | Migration test must pass |
| Editor/runtime | same canonical scene payload | Edit, play, stop, restore |
| Distribution | unpacked Windows x64 package and per-user NSIS installer | Automated packaged launch plus silent install, installed launch, and uninstall smoke; code signing remains deferred |

macOS, Linux, ARM64, code signing, auto-update, and production crash ingestion are unsupported for this slice and require separate qualification.

## Release-candidate checklist

- [ ] Required CI jobs pass on the exact candidate commit.
- [ ] Source and packaged baseline artifacts retain provenance and SHA-256 manifests.
- [ ] A clean checkout completes all local-equivalent commands.
- [ ] New regressions have focused automated tests.
- [ ] Canonical project and scene open, save, close, and reopen without identifier drift.
- [ ] Play mode uses the saved scene, accepts input, renders at least one frame, and restores edit state on stop.
- [ ] Unpacked application launches with no missing entry point or asset.
- [ ] Performance evidence meets every budget or carries an approved exception.
- [ ] No critical/high security issue is open against the candidate.
- [ ] Crash collection remains local-only, or separately approved consent/privacy controls are verified.
- [ ] Known parity gaps and user-visible limitations are recorded.
- [ ] Version and release notes are prepared.
- [ ] Signing, installer publishing, auto-update, and store/upload steps remain disabled.

The release owner attaches the CI run, package checksum, smoke-test record, performance measurements, and known-gap list to the release issue. Production distribution needs a separate explicit approval.
