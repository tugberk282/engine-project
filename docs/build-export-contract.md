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
