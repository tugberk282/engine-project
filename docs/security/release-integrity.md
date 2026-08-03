# Release integrity baseline

Tugberk Engine treats the Node build graph and CI actions as release inputs.

- Use the repository's declared Node and npm versions and install with `npm ci`.
- Do not replace exact versions of Electron, electron-builder, or Vite with ranges.
- GitHub Actions must be pinned to full commit SHAs; the adjacent version comment is
  informational and must be verified when the SHA is updated.
- `npm run audit:release` blocks high-severity production advisories and critical
  advisories anywhere in the build graph.
- `npm run test:release-integrity` verifies exact toolchain pins, lockfile SHA-512
  integrity entries, immutable action references, and CI enforcement.
- Packaging must use `--publish never` in verification. Publishing and signing are
  separate release-authorized operations and require protected credentials.

The full development graph can temporarily contain high advisories when upstream
packaging tools have no fixed release. Such exceptions must not be hidden with
audit suppression. Record the dependency path, preconditions, and upstream fix,
and keep the critical gate enforced.
