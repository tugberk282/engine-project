# Architecture risk register

| ID | Risk | Likelihood / impact | Mitigation | Signal / owner |
| --- | --- | --- | --- | --- |
| R1 | Legacy sync filesystem IPC blocks UI and bypasses grants | High / High | Freeze surface; migrate vertical slices to async v1 commands | Legacy call count; platform owner |
| R2 | Renderer compromise reaches host through broad preload | Medium / Critical | Allowlist, validation, sandbox, CSP, grant roots | Rejected IPC; security owner |
| R3 | Path traversal or symlink escape writes outside project | Medium / Critical | Canonicalize root/target, reject absolute/traversal, recheck before write | `PATH_OUTSIDE_GRANT`; platform owner |
| R4 | Play scripts freeze/crash the editor | High / High | Separate runtime failure domain, heartbeat, limits, bounded restart | Runtime heartbeat/restarts; runtime owner |
| R5 | Crash loses or corrupts scene edits | Medium / High | Revisioned checkpoints and atomic replace; restore UX | Recovery rate, corrupt saves; editor owner |
| R6 | Protocol drift breaks packaged editor/runtime pair | Medium / High | Version handshake, contract tests, N/N-1 transition | Version mismatch count; release owner |
| R7 | Telemetry leaks source/project data | Low / High | Structured metadata only, redaction, retention bounds | Privacy review; platform owner |
| R8 | Dual legacy/v1 paths persist indefinitely | High / Medium | Removal milestones and call-count gate | Remaining legacy callers; tech lead |
| R9 | Runtime extraction changes simulation determinism | Medium / High | Snapshot fixtures, fixed-step tests, replay hashes | Divergent replay hash; runtime owner |
| R10 | Main process becomes a business-logic monolith | Medium / Medium | Capability handlers delegate to small services; scene logic stays out | Dependency review; architect |

Risks R2/R3/R5 require release-blocking tests before untrusted project content
or third-party scripts are supported.

