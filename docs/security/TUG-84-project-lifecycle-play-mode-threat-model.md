# TUG-84: Project lifecycle and play-mode execution threat model

Date: 2026-08-03  
Scope: read-only review of the current project protocol, project trust controls,
supervised play runtime, and the boundary required before project-controlled code
is executable.

## Executive conclusion

The current play child is data-only: it parses a bounded JSON snapshot and implements
lifecycle counters. No reviewed path dynamically loads code from an opened project, so
this review did not verify a current project-to-host RCE.

The current runtime protocol must not be extended to load C#, JavaScript, plugins,
native libraries, importers, or build hooks as-is. `runtime.start` contains only a
snapshot and is dispatched directly to a normal Node child process. It carries no
canonical project identity, project grant, trust state, entrypoint, or execution
operation identity. Adding code loading there would bypass the existing
`TrustGatedExecutionBroker` and give project code the ambient authority of the desktop
user.

## Assets and trust zones

| Zone | Trust | Authority / security invariant |
| --- | --- | --- |
| Project directory and contents | Untrusted by default | Cannot grant itself trust or execute in safe mode. |
| Renderer | Untrusted UI | Owns transient editor state; cannot directly acquire native or filesystem authority. |
| Preload | Trusted adapter | Exposes only frozen, versioned, validated requests. |
| Electron main | Trusted host | Owns project identity, grants, trust, lifecycle, execution authorization, and supervision. |
| Play runtime | Disposable, potentially hostile | Receives a value snapshot; must not mutate editor authority or inherit ambient host authority. |
| Trust store | Trusted persistent state | Lives outside projects and is keyed by canonical OS path identity. |

Security-sensitive assets are user files outside the project, credentials and tokens,
editor integrity, trusted-project decisions, build/release artifacts, and the
authoritative edit-mode scene.

## Attacker-controlled inputs

- Project paths, aliases, symlinks/junctions, replacement directories, and files.
- Scene JSON and every nested name, identifier, component record, and asset reference.
- Asset and package metadata, imported archives, C#/TypeScript source, generated code,
  plugins, native libraries, importers, post-processors, build hooks, and their output.
- Renderer IPC envelopes and ordering, including repeated, stale, concurrent, or
  oversized lifecycle requests.
- Future runtime stdout/stderr, telemetry, stack traces, exit codes, IPC messages, and
  apply-back data.

## Lifecycle and capability invariants

1. Selecting, reopening, or reading a project never implies trust.
2. Main canonicalizes project identity and owns the trust decision; trust state is
   rechecked immediately before every project-controlled execution dispatch.
3. A runtime session is bound immutably to `{ownerWebContentsId, canonicalProjectId,
   grantId, trustEpoch, sessionId}`. Control messages from other or stale owners fail.
4. Safe mode can start a data-only preview, but it cannot execute project-controlled
   code. Code-enabled play requires an explicit trusted execution request.
5. Revocation, grant revocation, project close/switch, renderer destruction, and app
   shutdown abort the associated runtime and its complete process tree, then await
   cleanup before acknowledgement.
6. The runtime receives a copied, versioned, schema-validated snapshot. Stopping drops
   runtime state. Any future apply-back feature is a separate, narrow, validated editor
   command—not an arbitrary object or filesystem merge.
7. Runtime filesystem, network, environment, child-process, native-module, and host IPC
   capabilities are denied by default and granted explicitly per workflow.

## Verified controls

- Canonical project identity uses `realpath` and stores trust outside the project
  (`electron/security/project-trust.js:7-16`, `:47-52`).
- Unknown projects are read-only; mutation authorization rechecks trust-backed root
  writability (`electron/security/project-capabilities.js:79-83` and the mutation paths
  exercised by `test/project-trust.test.cjs:45-55`).
- The execution broker rejects every declared execution kind in safe mode, validates a
  project-relative entrypoint, provides an abort signal, and waits for cleanup on
  revocation (`electron/security/execution-broker.js`; regression coverage in
  `test/execution-broker.test.cjs:26-41` and `:78-110`).
- Runtime IPC limits the snapshot to 16 MiB and frame delta to 0.1 seconds
  (`electron/architecture/contract.js:81-90`).
- The play runtime is a separate supervised process with bounded restart count,
  lifecycle timeouts, heartbeat handling, and a 512 MiB V8 heap setting
  (`electron/runtime/runtime-supervisor.js:9-16`, `:96-108`, `:135-156`).
- Runtime snapshot version and lifecycle transitions fail with stable errors
  (`electron/runtime/runtime-process.js:27-61`).

## Findings and required issues

### F1 — High: future play-mode code execution would bypass project trust

Preconditions: a future implementation loads any project-controlled executable content
through the existing play runtime path, and an attacker convinces a user to open but not
trust a malicious project.

Evidence: `runtime.start` accepts exactly `{snapshot}`
(`electron/architecture/contract.js:81-84`) and main calls
`runtimeSupervisor.start(snapshot)` directly (`electron/main.js:211-212`). The request
has no project identity, grant, trust epoch, or execution kind. The separate execution
broker is not involved. `RuntimeBridge.start` likewise sends only the snapshot
(`src/engine/RuntimeBridge.ts:24-27`).

Impact: if project code loading is added to this route, safe-mode projects can reach a
code-executing process without main-process trust authorization.

Remediation: define a distinct code-enabled play-start contract bound to the active
main-owned project grant and canonical identity. Route it through the trust-gated
execution authority, recheck trust immediately before launch, bind the resulting
operation/session to the initiating renderer, and abort it on revocation or project
switch. Keep current data-only preview available in safe mode.

Verification: tests must prove unknown/revoked projects can use data-only preview but
cannot start code-enabled play; trusted projects can; revocation races abort and await
cleanup; mismatched project/grant/owner/session identifiers fail before process launch.

### F2 — High: the current Node child is isolation, not a sandbox

Preconditions: project-controlled JavaScript, compiled C#, native code, or an adapter
capable of invoking it is loaded into the current runtime process.

Evidence: the supervisor uses `child_process.fork` with standard Node execution and only
a V8 heap flag (`electron/runtime/runtime-supervisor.js:4`, `:9-14`). There is no OS
sandbox, restricted token, filesystem allowlist, network policy, environment scrub,
module allowlist, or child-process-tree containment.

Impact: project code would inherit the desktop user's filesystem, network, credentials,
and process-launch authority; process separation alone does not prevent host compromise.

Remediation: choose and document the supported script threat model. For untrusted code,
use an OS-enforced sandbox/isolated worker with a deny-by-default brokered capability
API, minimal environment, no ambient Node/native module access, network off by default,
project-root filesystem confinement, CPU/memory/time quotas, and whole-process-tree
termination. If full-trust Unity-compatible plugins are intentionally supported, label
them as trusted native code and require explicit per-project consent without describing
the child as a sandbox.

Verification: adversarial fixtures attempt reads/writes outside the project, environment
and credential access, network access, child process creation, native module loading,
and survival after stop/revoke; all must fail or be explicitly consented and audited.

#### TUG-105 fail-closed execution contract

Until an OS-enforced launcher implements the untrusted requirements above, the engine
supports no sandboxed project-code execution policy. `CodePlaySessions` now consults a
main-process admission authority before it replaces an active session or calls any
launcher. The default and `disabled` modes reject with `PLAY_CODE_DISABLED`;
`sandboxed` rejects with `PLAY_SANDBOX_UNAVAILABLE`. Project trust alone is not code
execution consent. Consequently JavaScript, compiled C#, plugins, native modules, and
other project-controlled code remain disabled even for a trusted project unless the
separate full-trust capability below has been issued.

The only represented executable policy is explicitly consented `full-trust`. Its opaque
consent capability is bound to renderer owner, project grant, canonical project identity,
and trust epoch. The launcher receives an immutable policy labeled `sandboxed: false`,
`securityBoundary: none`, with filesystem, environment, network, child-process, and
native-module authority all declared ambient. Main-process UI code must issue this
capability only after showing the exact acknowledgement exported by
`play-execution-admission.js`; the admission API must not be exposed to a renderer.
Revoking the renderer owner, grant, or project invalidates matching consent and awaits
active runtime cleanup. Re-trusting creates a new epoch and cannot revive old consent.

This is an admission gate, not a sandbox implementation. Full-trust code can compromise
the desktop user and may evade cooperative cleanup or leave descendants. Safe/data-only
preview is outside this code-enabled authority and remains the available workflow for
untrusted projects. A future untrusted launcher must deny ambient filesystem,
environment/credential, network, process, and native-module access with OS controls and
must terminate the whole process tree before `sandboxed` can be admitted.

Focused regression evidence is in `test/play-script-sandbox-gate.test.cjs`: adversarial
capability probes are rejected before launcher invocation, denied replacement leaves an
existing session intact, full-trust labeling and consent binding are exact, and revoked
or stale consent cannot launch.

### F3 — Medium: runtime lifecycle is global and not bound to a renderer/project owner

Preconditions: multiple editor windows/webContents exist, a renderer is replaced after
crash/navigation, or a stale renderer retains access long enough to send lifecycle IPC.

Evidence: main owns one module-global `RuntimeSupervisor` (`electron/main.js:54-56`).
Runtime commands authenticate an editor sender, but dispatch without sender/project
ownership (`electron/main.js:211-220`). The runtime-generated session ID is not exposed
as an authorization token to the calling renderer (`runtime-supervisor.js:51-57`).

Impact: one authenticated renderer can pause, tick, stop, or replace another project's
session; project close/switch is not itself represented in runtime authorization.

Remediation: maintain main-owned sessions keyed by owner webContents and canonical
project grant, return an opaque session capability, validate it on every transition,
and dispose sessions on owner destruction, grant revocation, project switch, and close.

Verification: two-owner tests prove cross-owner and stale-session commands fail without
state changes, while owner teardown reliably kills its process and clears pending work.

### F4 — Medium: snapshot validation is byte-bounded but structurally shallow

Preconditions: a malicious project supplies a pathological but sub-16-MiB scene that is
started in data-only preview.

Evidence: the protocol caps UTF-8 bytes (`contract.js:81-84`), while the child validates
only that parsed JSON is an object with `formatVersion === 1`
(`runtime-process.js:27-35`). It retains the full object for the session. No depth,
object-count, string-field, component schema, or asset-reference validation is applied
at this boundary.

Impact: parser/consumer complexity and memory amplification can terminate or stall the
runtime repeatedly. Future component/script materialization would broaden this into
unsafe type selection or asset-resolution behavior.

Remediation: validate a normalized snapshot schema before launch with explicit maximum
depth, entity/component counts, string lengths, finite numeric values, allowed component
types, and project-relative asset references. Reject before spawning where practical.

Verification: boundary tests cover deeply nested JSON, excessive entity/component
counts, huge strings, non-finite/coercive numeric values, unknown component types, and
traversal/absolute asset references with bounded stable failures and no restart loop.

## Regression gate before enabling project code

Code execution must remain disabled until F1 and F2 are closed. Release CI should then
run a security matrix covering safe/trusted/revoked state; canonical alias and project
replacement; owner/session mismatch; revoke/start and project-switch races; sandbox
escape probes; snapshot resource limits; bounded logs/errors; deterministic stop and
whole-tree cleanup; and confirmation that play state cannot mutate the authoritative
editor scene or filesystem except through explicit capabilities.

## Non-findings and limitations

- Static `import.meta.glob('../scripts/*.ts', { eager: true })` in
  `src/engine/ScriptRegistry.ts:125-127` bundles repository source; this review found no
  dynamic import of scripts from an opened project, so it is not reported as a current
  project RCE.
- Path trust is identity/consent, not content integrity. In-place project replacement
  after trust remains a documented limitation and should be handled by package/release
  integrity controls, not misrepresented as a sandbox guarantee.
- This was a source and focused-test review on a heavily dirty shared worktree. No
  implementation files were modified.
