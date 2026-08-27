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

The manual `signed-windows-release.yml` lane is the only signed-artifact qualification
path. It downloads LLVM-MinGW 20250613 by immutable URL and verifies its SHA-256 before
building. The `windows-code-signing` GitHub environment must require release-owner review
and expose only non-secret Azure resource identifiers as environment variables. Azure
authentication uses GitHub OIDC; do not add a client secret, PFX, certificate password,
or signing key to repository variables, secrets, workflow environment, logs, or artifacts.
Grant the federated identity only the Artifact Signing Certificate Profile Signer role for
the selected profile. The lane signs the helper before packaging, rewrites its integrity
manifest, signs the NSIS envelope, and requires Windows trust-chain validation for both
files before executing the installed sandbox matrix.

The full development graph can temporarily contain high advisories when upstream
packaging tools have no fixed release. Such exceptions must not be hidden with
audit suppression. Record the dependency path, preconditions, and upstream fix,
and keep the critical gate enforced.
