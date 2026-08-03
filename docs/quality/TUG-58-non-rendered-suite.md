# TUG-58 — Complete non-rendered verification suite

Run date: 2026-07-28  
Qualification: **bounded suite completed; 2 contract failures identified**

## Scope

The complete non-rendered suite is every test-runner file currently present under
`test/`:

- 30 `*.test.cjs` files
- 1 `*.test.mjs` file

The source-built editor launch, packaged application launch, installer, renderer
build, and legacy phase 8 UI-rendering verifier are intentionally excluded
because they render or package the application. The
`source-built-editor-smoke.test.cjs` contract test is included because it
validates the smoke harness without launching a renderer.

## Deterministic execution contract

Command:

```text
node --experimental-strip-types --test test/*.test.cjs test/*.test.mjs
```

The command was launched as one process with:

- a hard 600-second timeout;
- recursive process-tree termination via `taskkill /T /F` on timeout;
- redirected stdout and stderr retained in the Paperclip run scratch directory
  during execution;
- a structured metadata record containing the file inventory, timestamps,
  duration, timeout state, and runtime version.

The process reached a normal terminal result, so no cleanup kill was required.
No application or test child process from this run remained active.

## Result

Environment: Node.js `v24.13.0` (repository constraint: `>=22.12.0`)  
Test files: 31  
Tests: 135  
Passed: 132  
Failed: 2  
Skipped: 1  
Cancelled: 0  
Runner duration: 5310.8217 ms  
Timed out: no

Failing contracts:

1. `electron-boundary.test.cjs` — `preload exports only the reviewed API and maps
   every method to an allowlisted channel`
2. `typed-ipc-production.test.cjs` — `legacy adapter inventory is frozen so new
   positional IPC channels fail the gate`

Both failures are caused by the production preload exposing
`readSceneDocument`/`writeSceneDocument` and the corresponding
`scene-document-read`/`scene-document-write` channels while the tests' frozen
reviewed inventories do not list them.

## Qualification

The suite is fully enumerated and finishes deterministically within the bound,
but it is **red** due to two related inventory assertions. This issue records
the suite boundary and result only; no production or test source was changed.
