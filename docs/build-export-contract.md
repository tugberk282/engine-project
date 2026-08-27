# Deterministic build/export contract

Build requests are immutable version-1 records containing an absolute project
root, the SHA-256 revision of `project.json`, an absolute output path outside
the project, and a supported target. Electron main owns `BuildService`; renderer
code may only submit or cancel requests through a validated versioned protocol.

The supervised child executes `validate`, `resolve`, `import`, `bundle`, and
`package` in order. It canonicalizes project and scene JSON, resolves scene IDs,
sorts all input paths, hashes every output, and emits a deterministic manifest.
Build hooks and native tools are rejected until execution policy permits them.

Publication uses a unique temporary directory and a final same-volume rename.
Failure, cancellation, timeout, child exit, and shutdown terminate the child and
remove temporary output. No partial artifact is published. Logs are bounded.
The packaged player validates the manifest and every content digest before
loading the entry scene.

For `win-x64`, package emits a self-contained `Tugberk Player.exe` beside its
runtime DLLs, `manifest.json`, and `content` directory. The executable starts
the dedicated sandboxed player document directly; it does not load the editor
application. The shell is project-data-driven and has no sample-specific game
logic. Relocating the complete output directory preserves launch behavior.

`node --test test/build-service.test.cjs` verifies repeatable manifests,
deterministic player frames, a fresh Windows executable launch, stale-revision
and path rejection, cancellation, cleanup, and absence of partial published
artifacts.

## Editor and shared-runtime integration

File > Build Settings reads `project.json`, presents its authored scene list,
obtains an output directory through the desktop picker, and submits a validated
`build.start` envelope. The ordered selection is non-empty and bounded; every
selected path must be declared by the project, and unselected scene documents
are excluded. Electron main confines the project root to the renderer's active
project capability, owns the worker, reports progress, and aborts work on explicit
cancellation, renderer loss, or shutdown. Typed failures stay visible in the
Build Settings window.

The packaged player hosts the same generic `runtime.worker.js` contract as Play
Mode. It maps keyboard input to configured axes/actions, advances deterministic
movement, collision, and trigger state, and displays configured gameplay status
and score. The retained executable smoke drives configured input and asserts
movement, collision, trigger transition, and UI output without editor services.
