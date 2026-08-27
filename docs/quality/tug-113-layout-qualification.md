# TUG-113 layout qualification ledger

Date: 2026-08-27  
Owner: Tuval  
Scope: SH-02–05 and SH-09

## Prioritized findings

1. **P0 — persisted layout publication had no recovery boundary.** `EditorSettings.save()` replaced one key directly and `load()` accepted only that key. A corrupt primary value or interrupted write could not recover a last-known-good layout.
2. **P0 — cancel semantics remain incomplete.** Floating move/resize and splitter pointer workflows mutate live layout state before pointer-up and do not yet restore the pre-gesture snapshot on Escape, blur, or pointer cancellation.
3. **P1 — rendered packaged coverage is incomplete.** Existing evidence exercises one reversible keyboard splitter change, but does not retain the required all-host docking, floating bounds, 100/125/150/200% scale, two packaged restarts, or missing-monitor cases.

## Implemented in this heartbeat

- Layout settings now stage complete bytes, publish the primary, and advance a separate last-known-good copy only after successful publication.
- Loading tries the primary first and falls back to the last-known-good copy without replacing corrupt primary bytes before an explicit successful save.
- Focused tests inject corrupt JSON and a failed primary write and assert unchanged recovery bytes and cleanup of staged data.
- Floating move/resize and pointer splitter gestures now retain their pre-gesture geometry. Escape, window blur, and pointer cancellation restore that geometry, clear transient styling/listeners, and do not call layout persistence; pointer-up remains the commit boundary.

## Verification

- `node --experimental-strip-types --test test/editor-layout-persistence.test.mjs test/viewport-sizing.test.mjs`: 8/8 pass.
- `node --test test/editor-keyboard-accessibility.test.cjs`: 5/5 pass.
- `npm.cmd run build`: pass (`tsc`, Vite production build, and path repair).
- Build emits the pre-existing large-chunk advisory; no build error.

## Remaining acceptance work

- Extend the packaged harness with isolated project/user-data roots, package identity/hash, before/after geometry and focus assertions, screenshots, all dock targets, two restarts, corrupt/off-screen/oversized layouts, and 100/125/150/200% scale at 1280x720 and a high-DPI resolution.
- Promote matrix rows only after the complete retained rendered run; current status remains source-contract/rendered-partial.
