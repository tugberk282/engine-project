# ADR-0001: Editor/runtime process and trust boundary

- Status: Accepted baseline
- Date: 2026-07-28
- Owners: Editor/platform team
- Decision horizon: Reassess after the first packaged runtime milestone

## Context

Tugberk Engine is an Electron editor whose renderer currently owns the editor
model and rendering loop. Native access is supplied by a preload bridge. The
existing bridge exposes broad, synchronous filesystem operations and the
BrowserWindow currently runs with `sandbox: false`. Those APIs are a migration
constraint, not the desired boundary.

The baseline must let the product ship incrementally without making project
files, renderer crashes, or an evolving runtime protocol irreversible.

## Decision

### Process model

1. **Electron main (trusted host)** owns windows, lifecycle, OS integration,
   project grants, durable preferences, atomic persistence, and child-process
   supervision. It never owns mutable scene objects.
2. **Preload (capability adapter)** exposes a frozen, versioned API made only of
   named request/response commands. It contains no product state and exposes no
   raw Electron, Node, filesystem, shell, or synchronous IPC primitive.
3. **Editor renderer (untrusted UI)** owns transient UI state, command history,
   the editable in-memory scene, and the edit-mode preview. It requests durable
   operations through the capability API.
4. **Runtime worker/process (separate failure domain)** owns a disposable
   play-session copy of the scene, simulation clock, physics, and game scripts.
   It receives a serialized snapshot and returns telemetry/events; it never
   mutates the editor's authoritative scene directly.

Initially the runtime may be a Web Worker to validate the protocol. Before
third-party scripts are enabled it must become a sandboxed utility/child
process with resource limits and main-process supervision.

### State ownership

| State | Authority | Persistence |
| --- | --- | --- |
| Window, grants, recent projects | Main | userData, atomic write |
| Editable scene/assets metadata | Editor renderer | project files via main |
| Selection, panels, undo/redo | Editor renderer | session; optional settings |
| Play-mode world, physics, time | Runtime | disposable snapshot |
| Logs, crash envelopes, metrics | Origin process; collected by main | bounded rotating files |

Each item has one writer. Messages carry values, identifiers, and revisions,
not shared mutable objects. Entering play mode creates a versioned snapshot;
stopping discards runtime state unless an explicit, reviewed apply-back command
is introduced.

### IPC contract

Every envelope has:

```text
{ protocolVersion, requestId, command, payload }
{ protocolVersion, requestId, ok, value | error }
```

Commands are allowlisted and schema-validated at both preload and main.
Baseline commands are `project.readText`, `project.writeText`,
`project.listDirectory`, `dialog.openProject`, and `telemetry.record`.
Project operations accept a grant ID and project-relative path, never an
arbitrary absolute path. Responses use stable error codes and do not expose
native stack traces.

`electron/architecture/contract.js` is the executable protocol nucleus.
`test/architecture-contract.test.cjs` proves version, command, payload, path,
and response-boundary rejection.

### Security boundary

- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`,
  `webSecurity: true`.
- A restrictive Content Security Policy; navigation and new windows denied by
  default.
- Preload exposes `window.tugberk.v1`, frozen and least-privileged.
- Main resolves project-relative paths against a canonical granted root and
  rejects traversal, absolute paths, symlink escape, and revoked grants.
- Writes use temporary sibling + fsync + rename where supported.
- Shell launches and destructive operations require dedicated commands and
  explicit user intent.
- No synchronous IPC crosses the renderer boundary.

The current broad `electronAPI`, sync `fs-*` channels, absolute-path methods,
and disabled sandbox are documented legacy exceptions. They must not gain new
callers and are removed command-by-command during the migration.

### Failure recovery and observability

- Main records structured events with timestamp, process, session/request ID,
  command (never file content), duration, outcome, and stable error code.
- Renderer checkpoints dirty documents through a debounced, revisioned atomic
  save journal. On restart, the user chooses restore or discard.
- Runtime heartbeat loss or crash ends only play mode. Main captures the last
  bounded logs, restarts at most twice with backoff, then asks the user.
- Renderer crash recreates the window and offers the latest validated
  checkpoint. Main-process fatal startup failure enters a diagnostic safe mode.
- Protocol counters include latency, failures by code, rejected messages,
  runtime restarts, recovery success, and unclean shutdowns.
- Logs are size/age bounded and redact project contents and credentials.

### Compatibility and migration

The protocol version is an integer. Additive optional fields are allowed within
v1; removing/renaming fields or changing semantics requires v2. Main supports
the current and previous protocol during a release transition. Project/scene
formats carry separate `formatVersion` values and migrations are pure,
forward-only transforms performed on a backup.

Migration sequence:

1. Land the contract module/tests and instrument legacy calls.
2. Introduce grants and async v1 project commands alongside legacy APIs.
3. Move call sites by vertical slice; compare behavior and error telemetry.
4. Remove sync/raw filesystem APIs, enable sandbox, enforce CSP.
5. Extract play mode behind the snapshot/runtime protocol.

## Consequences

The UI cannot directly use Node libraries or arbitrary paths, and operations
become asynchronous. In return, native authority is reviewable, play-mode
failure is isolated, tests can run without Electron, and protocols can evolve
without sharing implementation details.

## Reversible and irreversible choices

Reversible now: Worker versus utility process for the first runtime proof,
serialization encoding, logging backend, checkpoint interval, and individual
command grouping.

Costly/architecturally binding: one-writer ownership, grant-scoped filesystem
authority, asynchronous typed IPC, editor/runtime snapshot separation, and
versioned project/protocol data. Reversing these would reintroduce shared
authority and require broad application rewrites, so changes require a new ADR.

