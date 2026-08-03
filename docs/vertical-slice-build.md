# First buildable vertical slice

The checked-in `samples/vertical-slice` project is the canonical fixture for the
first packaged slice. It contains one scene, a renderable player material, a
main camera, and a player controller bound to the `Horizontal` input axis.

## Reproduce from a clean checkout

Use Windows 11 x64 with Node 22.12 or newer:

```powershell
npm ci
npm run verify:vertical-slice
npm run electron:build -- --win --dir --publish never
npm run test:packaged-smoke
npm run electron:build -- --win nsis --publish never
npm run test:installer
```

The verification proves that the project resolves its scene and asset, the
canonical scene survives edit/save/reopen without identifier drift, and the
same serialized payload starts, accepts an input-bearing tick, renders a
runtime frame acknowledgement, stops, and leaves the editor snapshot intact.

The package command creates `dist/win-unpacked/Tugberk Engine.exe`. The
`test:packaged-smoke` command launches that binary with an isolated user-data
directory and validates the editor boot, hierarchy editing, inspector
interaction, and render canvas.

For manual diagnosis, the equivalent launch is:

```powershell
$env:ENGINE_LOAD_DIST = '1'
$env:ENGINE_SMOKE_TEST = '1'
$env:ENGINE_AUTO_OPEN_PROJECT_PATH = (Resolve-Path samples/vertical-slice)
$env:ENGINE_SMOKE_TEST_OUTPUT = (Join-Path $PWD 'smoke-test-result.json')
& '.\dist\win-unpacked\Tugberk Engine.exe'
Get-Content .\smoke-test-result.json
```

A successful smoke record has `ok: true`. `test:installer` also performs a
silent per-user install into a temporary location, reruns the same smoke
against the installed executable, verifies an uninstaller exists, and invokes
the uninstaller.

## Behavioral parity gaps

| Severity | Gap | Follow-up recommendation |
| --- | --- | --- |
| High | The packaged slice is Windows x64 only and is unsigned. | Qualify signing and installer publishing before external distribution. |
| High | Runtime script execution is not yet a production trust boundary. | Require explicit project trust and isolate compilation/execution before enabling arbitrary project scripts. |
| Medium | The runtime worker acknowledges input-bearing frames but does not yet expose deterministic gameplay-state assertions. | Extend the runtime protocol with bounded state snapshots and add movement assertions for the sample controller. |
| Medium | Launch/play/save performance budgets still require manual release evidence. | Add timestamp probes and collect p50/p95 data in packaged CI. |
| Medium | macOS, Linux, ARM64, auto-update, and crash ingestion are unqualified. | Track each platform/release service as an independently approved qualification issue. |

This fixture validates an engineering candidate, not a production release.
The full release checklist remains in `docs/quality/vertical-slice-quality-gates.md`.
