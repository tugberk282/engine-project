# Phase 0 packaged editor and installer evidence

Qualified on Windows x64 on 2026-07-28.

- `npm run test:release-integrity`: 3/3 checks passed.
- `npm run electron:build -- --win nsis --publish never`: produced the unpacked editor and NSIS installer under `release/`.
- `npm run test:packaged-smoke`: 17/17 editor checks passed from `release/win-unpacked/Tugberk Engine.exe`.
- `npm run test:installer`: silent install, 17/17 checks from the installed editor, and silent uninstall passed.

Installer retained locally (gitignored):

- File: `release/Tugberk Engine-Setup-0.1.0.exe`
- Size: 101,041,078 bytes
- SHA-256: `EC60F3B2D084456E3CFB764F5A14A4FBF1E61720B746323F459EBA13854DC539`

The test work directories were created under `PAPERCLIP_RUN_SCRATCH_DIR`; the repository retains only this compact evidence record and the gitignored release artifacts.
