# V1 dependency status — 2026-11-17

This is a dependency-maintenance checkpoint, not a repository security audit.

- `npm audit --omit=dev --json`: zero advisories.
- Full audit after the targeted override: 13 high entries, all propagated from picomatch GHSA-fc5q-39xc-vjpf. There is one root advisory; the count includes affected parent packages.
- Picomatch advisory currently affects versions through 4.0.7 and lists no patched release: https://github.com/advisories/GHSA-fc5q-39xc-vjpf . Keep this unresolved; do not claim release-toolchain security is fully qualified.
- Minimatch GHSA-g3hv-75wg-m249 affects >=7 and <11.0.1: https://github.com/advisories/GHSA-g3hv-75wg-m249 . The override selects 11.0.9 for affected 7–10 dependencies. Older unaffected 3/5 chains are preserved.
- First tested the override in an isolated current-source copy: npm install, production build and electron-builder Windows directory packaging passed. Main-source fast tests, full 253 tests and production build then passed.

Do not use `npm audit fix --force` merely to reduce the count: current suggestions include major tool downgrades and cannot supply a patched picomatch version. Remaining work is upstream patch availability and a scoped review of attacker-controlled glob reachability in the development/build toolchain. Packaged runtime dependency audit alone cannot establish that build tooling is safe.
