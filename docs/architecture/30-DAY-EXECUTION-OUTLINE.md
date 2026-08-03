# 30-day architecture execution outline

## Days 1–5: Make the boundary measurable

- Adopt ADR-0001 and contract tests in CI.
- Inventory every preload channel and renderer caller; add legacy-call counters.
- Define v1 TypeScript declarations and validation fixtures.
- Outcome: contract suite green; 100% of native channels classified; no new
  synchronous channel can merge.

Dependencies: none. Decision gate: approve grant semantics and error taxonomy.

## Days 6–12: Secure project persistence

- Implement main-owned project grants and canonical path resolution.
- Add async `readText`, atomic `writeText`, and `listDirectory`.
- Migrate scene save/load and one asset-browser slice.
- Outcome: traversal/symlink/invalid-payload tests green; migrated flows have
  zero raw filesystem calls; save interruption test preserves last good file.

Dependencies: v1 contract and path-threat fixtures.

## Days 13–18: Recoverability and diagnostics

- Add structured request/runtime logging with redaction and retention.
- Add revisioned dirty-scene checkpoints and restore/discard startup flow.
- Capture renderer/runtime termination envelopes.
- Outcome: forced renderer crash restores latest checkpoint; logs correlate a
  UI request to host outcome without recording file contents.

Dependencies: atomic persistence and request IDs.

## Days 19–24: Runtime isolation proof

- Define versioned scene snapshot and runtime command/event protocol.
- Run play mode in a Worker first; supervise heartbeat and bounded restart.
- Add deterministic fixed-step fixture and crash/hang injection.
- Outcome: runtime crash does not terminate editor; fixture replay hash is
  stable; stop play mode leaves edit scene unchanged.

Dependencies: serialization fixtures and observability.

## Days 25–30: Close the legacy boundary

- Migrate remaining filesystem callers, remove sync `fs-*` and raw path APIs.
- Enable Chromium sandbox and enforce CSP in development and packaged builds.
- Run packaged smoke, recovery, and protocol N/N-1 tests.
- Outcome: zero legacy-call telemetry, no `sendSync`, sandbox enabled, security
  regression suite and packaged editor smoke green.

Dependencies: all vertical slices migrated. CEO review receives the metrics,
open R1–R10 items, runtime process recommendation, and next-quarter staffing
or scope choices.

