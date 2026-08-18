# TUG-107 Windows sandbox launcher decision record

Status: native launcher and source-built adversarial harness implemented; production
admission remains fail closed with `PLAY_SANDBOX_UNAVAILABLE` until the installed-NSIS
matrix, signing identity, and remaining adapter-specific probes are qualified.

## Verified baseline

- Tugberk Engine packages only for Windows (`package.json` uses the NSIS Windows target).
- `native/play-sandbox-launcher/launcher.c` is the native AppContainer/Job Object host.
  `scripts/build-play-sandbox-launcher.cjs` builds it and writes a SHA-256 manifest, and
  packaging unpacks both files beside the installed application.
- `electron/security/windows-play-sandbox-launcher.js` verifies the helper hash, stages
  only regular files, uses bounded immutable policy values, strips the helper environment,
  rejects non-zero workers, and removes the staging tree on success, denial, timeout, or
  abort.
- The current machine has MinGW-w64 but no MSVC, Windows SDK compiler, .NET SDK, or signing
  tool. The build now fails if the declared native helper cannot be reproduced rather than
  silently packaging without the boundary.
- `processmodel.dll` exists on this Windows 11 build. Microsoft's June 2026
  `Experimental_CreateProcessInSandbox` API would provide AppContainer-backed filesystem
  and network isolation, but Microsoft explicitly labels the API experimental and subject
  to change; its header and FlatBuffer schema are not public. It cannot be the sole
  production boundary.
- A normal Node child, Electron utility process, `node:vm`, low-integrity token, or Job
  Object alone does not remove the desktop user's ambient read authority and therefore
  cannot satisfy this issue.

## Recommended production boundary

Build and sign a small native Windows launcher using the stable AppContainer APIs, with a
dedicated AppContainer identity per project trust epoch. The launcher must create the
worker suspended and apply all policy before the first project-controlled instruction:

1. AppContainer token with no network capabilities and no inherited handles.
2. A per-session staging root as the only project-data filesystem capability. Main copies
   approved inputs into the staging root and brokers validated output commits back to the
   real project; the AppContainer SID is never added to the real project ACL.
3. A Job Object with kill-on-close, no breakaway, active-process, job-memory, CPU-time,
   and wall-clock enforcement. Stop/revoke closes or terminates the job and waits for the
   empty-job signal before reporting completion.
4. Child-process restriction, Win32k disablement, DLL search hardening, extension-point
   disablement, and an allowlisted signed runtime adapter. No inherited environment;
   construct a minimal Unicode block containing only non-secret runtime values.
5. Separate signed adapters for JavaScript, managed C#, and native/plugin ABI inputs.
   An input kind remains disabled until its adapter has its own escape and resource-abuse
   matrix. Native input must never be loaded into the editor/main process.

The launch policy is immutable and includes the helper build identity, AppContainer SID,
staging-root identity, quotas, adapter kind/hash, trust epoch, and grant/renderer owner.
Any missing helper, unsupported OS, signature/hash mismatch, policy mismatch, or cleanup
timeout returns a stable denial and never falls back to a normal child process.

## Packaged acceptance gate

Run from a clean installed NSIS artifact, not only from source:

- outside-root read and write probes, including junction/reparse swaps, fail;
- environment and credential-store probes return no secret values;
- loopback, LAN, Internet, DNS, and named-pipe escape probes fail unless explicitly
  brokered;
- child creation, process-handle escape, and non-allowlisted DLL/native loading fail;
- memory, CPU, process-count, output-size, and wall-clock limits fail closed;
- stop, renderer destruction, project switch, grant/trust revocation, helper crash, and
  launch races leave zero surviving processes and no committable output;
- JavaScript, managed C#, plugin, and native fixtures each pass the same matrix before that
  adapter becomes selectable;
- the admission authority labels a policy `sandboxed: true` only after the helper attests
  to the exact immutable policy and all packaged gates pass.

## Remaining production gates

- Release owner: provision the reproducible MinGW/MSVC lane and Authenticode identity, then
  run `scripts/verify-installer.cjs` against a clean NSIS artifact. That flow now invokes
  the installed-helper adversarial matrix before uninstall.
- Runtime owners: provide separately signed headless JavaScript and managed-C# adapters.
  The helper intentionally applies Win32k and child-process restrictions; the Electron GUI
  executable is not a sandbox adapter.
- Security: extend the packaged probe from the current outside-root read/write, secret,
  loopback, child-process, timeout, hash-tamper, and cleanup gates to LAN/Internet/DNS,
  named pipes, process handles, non-allowlisted DLLs, CPU/memory/output quotas, revocation
  races, and helper-crash cleanup. Native/plugin inputs remain disabled.

## Primary platform references

- Microsoft Learn, “Create Process in Sandbox” (experimental, Windows 11):
  https://learn.microsoft.com/windows/win32/secauthz/createprocessinsandbox
- Microsoft Learn, “UpdateProcThreadAttribute” (AppContainer security capabilities and
  child-process policy):
  https://learn.microsoft.com/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute
- Microsoft Learn, “Job Objects” (limits and whole-tree termination):
  https://learn.microsoft.com/windows/win32/procthread/job-objects
